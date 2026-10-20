import { EventEmitter } from 'node:events';
import runner from '../lib/codex-runner.cjs';
import claudeRunner from '../lib/claude-runner.cjs';
import { promptFor } from '../mobile/local.js';
import { friendlyError } from '../lib/codex.mjs';
import { now } from './database.mjs';
import { processIdentity, stopOrphan } from './process.mjs';
import { fileURLToPath } from 'node:url';

const runReply = (bot, prompt, options) => bot.provider === 'claude'
  ? claudeRunner.runReply(bot, prompt, { ...options, binary: process.env.CLAUDE_BIN || 'claude' })
  : runner.runReply(bot, prompt, { ...options, binary: process.env.CODEX_BIN || 'codex' });

export class Queue extends EventEmitter {
  constructor(db, execute = runReply, tools) { super(); this.db = db; this.execute = execute; this.tools = tools; this.current = null; this.stopped = false; }
  recover() {
    for (const task of this.db.tasks().filter(task => ['running','waiting_approval'].includes(task.state))) {
      stopOrphan(task);
      // A chat may already have reached Codex; never replay it silently after a crash.
      this.db.finish(task.id, 'failed', null, 'O supervisor foi interrompido durante esta resposta. O histórico foi preservado; tente novamente.');
    }
  }
  schedule() { queueMicrotask(() => this.pump().catch(() => this.emit('changed'))); }
  async pump() {
    if (this.stopped || this.current) return;
    // Conversation with the person goes before routine runs.
    const next = this.db.all("SELECT id FROM tasks WHERE state='queued' ORDER BY id IN (SELECT task_id FROM routine_runs),created_at,rowid LIMIT 1")[0];
    if (!next) return;
    const task = this.db.start(next.id);
    const controller = new AbortController();
    const current = { id: task.id, controller, done: null }; this.current = current;
    const capability = this.tools?.open(task, controller.signal);
    this.emit('changed', { event: 'task.progress', taskId: task.id });
    current.done = (async () => {
      try {
        const bot = this.db.requireBot(task.bot_id);
        // Account apps: only the ones picked for this bot; the rest of the account's connectors are blocked.
        const picked = this.tools ? this.tools.accountApps(bot.id) : [];
        const connectors = Boolean(this.tools) && this.tools.policy(bot.id, 'account.connectors') !== 'deny' && picked.length > 0;
        const connectorDeny = connectors && bot.provider === 'claude' ? (await this.accountServers?.() || []).filter(name => !picked.includes(name)) : [];
        const reply = await this.execute(bot, promptFor(bot, task.message_id, { tools: Boolean(this.tools) }), {
          signal: controller.signal,
          workspace: capability?.workspace,
          tools: capability ? { token: capability.token, endpoint: this.toolEndpoint, entry: fileURLToPath(new URL('./mcp/index.mjs', import.meta.url)), connectors, connectorDeny, connectorWrites: bot.access === 'full' } : undefined,
          onSession: async id => { this.db.session(bot.id, id); },
          onProcess: pid => { this.db.run('UPDATE tasks SET worker_pid=?,worker_start=?,updated_at=? WHERE id=?', pid, processIdentity(pid), now(), task.id); }
        });
        if (controller.signal.aborted) this.db.finish(task.id, controller.signal.reason === 'shutdown' ? 'failed' : 'cancelled', null, controller.signal.reason === 'shutdown' ? 'Supervisor reiniciado durante a resposta. O histórico foi preservado.' : 'Pedido cancelado.');
        else { if (reply.accountServers?.length) this.rememberServers?.(reply.accountServers); this.db.finish(task.id, 'done', { ...reply, attachments: this.tools?.takeOutgoing(task.id) || [] }); }
      } catch (error) {
        if (error.codexSessionId) this.db.session(task.bot_id, error.codexSessionId);
        const detail = controller.signal.aborted ? (controller.signal.reason === 'shutdown' ? 'Supervisor reiniciado durante a resposta. O histórico foi preservado.' : 'Pedido cancelado.') : error.output ? friendlyError(error.output) : error.message;
        // Files already sent stay in the conversation even when the turn fails afterwards.
        this.db.finish(task.id, controller.signal.aborted && controller.signal.reason !== 'shutdown' ? 'cancelled' : 'failed', { attachments: this.tools?.takeOutgoing(task.id) || [] }, detail);
      } finally {
        capability?.close();
        this.current = null;
        this.emit('changed', { event: 'task.done', taskId: task.id });
        this.schedule();
      }
    })();
    await current.done;
  }
  async cancel(id) {
    const task = this.db.task(id);
    if (!task) throw new Error('Tarefa não encontrada.');
    if (!['queued','running','waiting_approval'].includes(task.state)) return task;
    if (this.current?.id === id) {
      this.db.run('UPDATE tasks SET cancel_requested=1 WHERE id=?', id);
      const current = this.current;
      current.controller.abort('cancelled');
      await current.done;
    } else this.db.finish(id, 'cancelled', null, 'Pedido cancelado antes de executar.');
    this.emit('changed', { event: 'task.done', taskId: id });
    return this.db.task(id);
  }
  async close() {
    this.stopped = true;
    if (this.current) { const current = this.current; current.controller.abort('shutdown'); await current.done; }
  }
}
