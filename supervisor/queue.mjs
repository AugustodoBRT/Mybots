import { EventEmitter } from 'node:events';
import runner from '../lib/codex-runner.cjs';
import claudeRunner from '../lib/claude-runner.cjs';
import { promptFor } from '../mobile/local.js';
import { friendlyError } from '../lib/codex.mjs';
import { now } from './database.mjs';
import { processIdentity, stopOrphan } from './process.mjs';
import { browserMode } from './tool-policy.mjs';
import { fileURLToPath } from 'node:url';

export const runReply = (bot, prompt, options) => bot.provider === 'claude'
  ? claudeRunner.runReply(bot, prompt, { ...options, binary: process.env.CLAUDE_BIN || 'claude' })
  : runner.runReply(bot, prompt, { ...options, binary: process.env.CODEX_BIN || 'codex' });

// Why a running turn was stopped by the supervisor instead of the person, and what the conversation says.
const STOPPED = {
  shutdown: 'Supervisor reiniciado durante a resposta. O histórico foi preservado.',
  node_lost: 'O computador desconectou durante esta resposta. O histórico foi preservado; mande de novo quando ele voltar.'
};

// How much of a private chat a new IA session reads at most (promptFor keeps what fits in its size budget).
const PROMPT_WINDOW = 400;

// How many turns may run together on each device ("lane"): a bot working for a long time must not keep the person
// from talking to the others. Small on the phone, whose Termux has little memory.
export const LANE_LIMITS = { phone: 3, pc: 4 };

/**
 * Different bots answer at the same time, up to the lane's limit; one bot answers one turn at a time (its private chat
 * and its rooms share that). Only a room message with no @ (everyone answers in turn) keeps its order.
 * A turn whose bot lives on the computer waits while it is off.
 */
export class Queue extends EventEmitter {
  constructor(db, execute = runReply, tools) { super(); this.db = db; this.execute = execute; this.tools = tools; this.running = new Map(); // task id -> { id, lane, controller, done }
    this.stopped = false; this.steps = new Map(); }
  recover() {
    for (const task of this.db.activeTasks().filter(task => ['running','waiting_approval'].includes(task.state))) {
      stopOrphan(task);
      // A chat may already have reached Codex; never replay it silently after a crash.
      this.db.finish(task.id, 'failed', null, 'O supervisor foi interrompido durante esta resposta. O histórico foi preservado; tente novamente.');
    }
  }
  schedule() { queueMicrotask(() => this.pump().catch(() => this.emit('changed'))); }
  laneOf(botId) {
    const body = this.db.get('SELECT body FROM bots WHERE id=?', botId)?.body;
    const bot = body ? JSON.parse(body) : null;
    return this.nodes ? this.nodes.lane(bot) : 'phone';
  }
  /** The first queued turn that may start: its lane has room, its bot is free and no earlier turn of its room message runs. */
  next() {
    // Conversation with the person goes before routine runs.
    const queued = this.db.all("SELECT id,bot_id FROM tasks WHERE state='queued' ORDER BY id IN (SELECT task_id FROM routine_runs),created_at,rowid");
    // The turns of a room message to everyone (same origin) wait for each other; bots called with @ have their own origin.
    const busyChains = new Set(this.db.all("SELECT room_id,origin_id FROM room_turns JOIN tasks ON tasks.id=room_turns.task_id WHERE tasks.state IN ('running','waiting_approval')").map(row => row.room_id + ':' + row.origin_id));
    const used = {}; for (const current of this.running.values()) used[current.lane] = (used[current.lane] || 0) + 1;
    const busyBots = new Set(this.db.all("SELECT bot_id FROM tasks WHERE state IN ('running','waiting_approval')").map(row => row.bot_id));
    for (const task of queued) {
      const lane = this.laneOf(task.bot_id);
      if (!lane || (used[lane] || 0) >= (LANE_LIMITS[lane] || 1) || busyBots.has(task.bot_id)) continue;
      const turn = this.db.roomTurn(task.id);
      if (turn && busyChains.has(turn.room_id + ':' + turn.origin_id)) continue;
      return { id: task.id, lane };
    }
    return null;
  }
  async pump() {
    if (this.stopped) return;
    const next = this.next();
    if (!next) return;
    const task = this.db.start(next.id);
    const controller = new AbortController();
    const current = { id: task.id, lane: next.lane, controller, done: null }; this.running.set(task.id, current);
    const execute = next.lane === 'phone' ? this.execute : this.nodes.executor(next.lane);
    const capability = this.tools?.open(task, controller.signal, next.lane);
    this.emit('changed', { event: 'task.progress', taskId: task.id });
    current.done = (async () => {
      try {
        // A room turn: the bot answers in the room with its own permissions, in the IA session it keeps for that room.
        const turn = this.db.roomTurn(task.id);
        // An IA session lives on the machine that made it: a bot that changed device starts a new one, with the history.
        const marker = 'session.lane.' + (turn ? turn.room_id + '.' : '') + task.bot_id;
        const sessionLane = next.lane === 'pc' && (browserMode(this.db.requireBot(task.bot_id)) === 'claude') ? 'pc:claude-chrome' : next.lane === 'pc' && browserMode(this.db.requireBot(task.bot_id)) === 'mine' ? 'pc:mine' : next.lane;
        if ((this.db.get('SELECT value FROM metadata WHERE key=?', marker)?.value || 'phone') !== sessionLane) {
          if (turn) this.db.run('DELETE FROM room_sessions WHERE room_id=? AND bot_id=?', turn.room_id, task.bot_id); else this.db.run('DELETE FROM codex_sessions WHERE bot_id=?', task.bot_id);
          this.db.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', marker, sessionLane);
        }
        const owner = this.db.requireBot(task.bot_id);
        const bot = turn ? { ...owner, codexSessionId: this.db.roomSession(turn.room_id, owner.id) } : owner;
        // Account apps: only the ones picked for this bot; the rest of the account's connectors are blocked.
        const picked = this.tools ? this.tools.accountApps(bot.id) : [];
        const connectors = Boolean(this.tools) && this.tools.policy(bot.id, 'account.connectors') !== 'deny' && picked.length > 0;
        const connectorDeny = connectors && bot.provider === 'claude' ? (await this.accountServers?.() || []).filter(name => !picked.includes(name)) : [];
        const prompt = turn ? this.rooms.prompt(bot, task.id, { tools: Boolean(this.tools), resumed: Boolean(bot.codexSessionId) }) : promptFor(this.chat(bot, task.message_id), task.message_id, { tools: Boolean(this.tools) });
        const reply = await execute(bot, prompt, {
          signal: controller.signal,
          workspace: capability?.workspace,
          tools: capability ? { token: capability.token, taskId: task.id, desktop: next.lane === 'pc' && this.tools.policy(bot.id, 'desktop') === 'allow', browser: this.tools.policy(bot.id, 'browser') !== 'deny', endpoint: this.toolEndpoint, entry: fileURLToPath(new URL('./mcp/index.mjs', import.meta.url)), connectors, connectorDeny, connectorWrites: ['full', 'free'].includes(bot.access),
            // On the computer the IA may use its files and terminal, each step decided by the bot's level.
            computer: next.lane === 'pc' && this.tools.policy(bot.id, 'computer') !== 'deny' ? { folders: Array.isArray(bot.folders) ? bot.folders : [], full: ['full', 'free'].includes(bot.access) } : false,
            // Livre on the phone: Termux's whole shell. Codex cannot ask command by command, so "Comandos no Termux" on the list keeps it without one.
            termux: next.lane === 'phone' && this.tools.policy(bot.id, 'termux') === 'allow' && (bot.provider === 'claude' || !this.tools.freeAsk('termux')),
            phone: this.tools.policy(bot.id, 'phone') === 'allow' } : undefined,
          onSession: async id => { if (turn) this.db.setRoomSession(turn.room_id, bot.id, id); else this.db.session(bot.id, id); },
          // What the bot says along the way becomes a message now; what it is doing shows under "Pensando".
          onProgress: ({ say, step } = {}) => {
            if (controller.signal.aborted) return;
            // A step is only an event: the conversation is not written for it.
            if (typeof say === 'string' && say.trim()) { this.db.progressMessage(task.id, say); this.steps.delete(task.id); }
            else if (typeof step === 'string' && step.trim()) this.steps.set(task.id, step.trim().slice(0, 160));
            else return;
            this.emit('changed', { event: 'task.progress', taskId: task.id, botId: task.bot_id, step: this.steps.get(task.id) || null });
          },
          // Only a local process can be found again (and stopped) after a crash.
          onProcess: pid => { if (next.lane === 'phone') this.db.run('UPDATE tasks SET worker_pid=?,worker_start=?,updated_at=? WHERE id=?', pid, processIdentity(pid), now(), task.id); }
        });
        if (controller.signal.aborted) this.db.finish(task.id, STOPPED[controller.signal.reason] ? 'failed' : 'cancelled', null, STOPPED[controller.signal.reason] || 'Pedido cancelado.');
        else { if (reply.accountServers?.length) this.rememberServers?.(reply.accountServers); this.db.finish(task.id, 'done', { ...reply, attachments: this.tools?.takeOutgoing(task.id) || [] }); }
      } catch (error) {
        if (error.codexSessionId) { const turn = this.db.roomTurn(task.id); if (turn) this.db.setRoomSession(turn.room_id, task.bot_id, error.codexSessionId); else this.db.session(task.bot_id, error.codexSessionId); }
        const stopped = controller.signal.aborted && STOPPED[controller.signal.reason];
        const detail = controller.signal.aborted ? stopped || 'Pedido cancelado.' : error.output ? friendlyError(error.output) : error.message;
        // Files already sent stay in the conversation even when the turn fails afterwards.
        this.db.finish(task.id, controller.signal.aborted && !stopped ? 'cancelled' : 'failed', { attachments: this.tools?.takeOutgoing(task.id) || [] }, detail);
      } finally {
        capability?.close();
        this.running.delete(task.id); this.steps.delete(task.id);
        this.emit('changed', { event: 'task.done', taskId: task.id });
        this.schedule();
      }
    })();
    // Other bots, or the other lane, may have work too.
    this.schedule();
    await current.done;
  }
  /** The bot with the part of its chat the prompt needs: the message alone in a resumed session, else the latest ones. */
  chat(bot, messageId) {
    if (bot.codexSessionId) return { ...bot, messages: [this.db.message(messageId)].filter(Boolean) };
    const page = this.db.page({ botId: bot.id, limit: PROMPT_WINDOW });
    return { ...bot, messages: page.messages, earlier: page.more };
  }
  /** The computer went away: its running turn ends as interrupted (never replayed), waiting turns keep waiting. */
  lost(lane = 'pc') { for (const current of this.running.values()) if (current.lane === lane) current.controller.abort('node_lost'); this.schedule(); }
  async cancel(id) {
    const task = this.db.task(id);
    if (!task) throw new Error('Tarefa não encontrada.');
    if (!['queued','running','waiting_approval'].includes(task.state)) return task;
    const current = this.running.get(id);
    if (current) {
      this.db.run('UPDATE tasks SET cancel_requested=1 WHERE id=?', id);
      current.controller.abort('cancelled');
      await current.done;
    } else this.db.finish(id, 'cancelled', null, 'Pedido cancelado antes de executar.');
    this.emit('changed', { event: 'task.done', taskId: id });
    return this.db.task(id);
  }
  async close() {
    this.stopped = true;
    const running = [...this.running.values()];
    for (const current of running) current.controller.abort('shutdown');
    await Promise.all(running.map(current => current.done));
  }
}
