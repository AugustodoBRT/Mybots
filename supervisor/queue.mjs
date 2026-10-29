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

// Why a turn the person steered ended, and what the instruction tells the IA when it resumes.
const STEERED = 'Interrompida para corrigir o rumo.';
const STEER_NOTE = 'A pessoa interrompeu a tarefa em andamento para corrigir o rumo. Continue de onde parou, seguindo esta instrução:\n';

// A subscription limit (or quota) ending, as the runners' errors and the raw CLI output say it.
const LIMIT = /usage.limit|limite de uso|rate.limit|limit reached|insufficient_quota|\bquota\b|\b429\b/i;

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
  /** Whether the person paused this bot's line: the turn running keeps going, the ones waiting do not start. */
  paused(botId) { return this.db.get('SELECT value FROM metadata WHERE key=?', 'queue.paused.' + botId)?.value === '1'; }
  pause(botId, paused) {
    this.db.requireBot(botId);
    if (paused) this.db.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'queue.paused.' + botId, '1');
    else this.db.run('DELETE FROM metadata WHERE key=?', 'queue.paused.' + botId);
    this.emit('changed', { event: 'task.progress', botId }); this.schedule();
    return { paused: Boolean(paused) };
  }
  /**
   * "Corrigir rumo": an instruction for the turn in progress, without waiting for its turn. The running turn is stopped
   * and the instruction becomes the bot's next one, ahead of the line, resuming the same IA session.
   */
  async steer(botId, requestId, text) {
    const running = this.db.activeTasks(botId).find(task => ['running', 'waiting_approval'].includes(task.state));
    if (!running) throw new Error('Este bot não está trabalhando agora. Mande uma mensagem normal.');
    if (this.db.roomTurn(running.id)) throw new Error('Corrigir rumo vale para a conversa privada; numa sala, mande uma mensagem nova.');
    const selection = { model: this.db.requireBot(botId).model, reasoningEffort: this.db.requireBot(botId).reasoningEffort };
    const task = this.db.enqueue(botId, requestId, text, selection, { steer: true });
    const current = this.running.get(running.id);
    if (current) { this.db.run('UPDATE tasks SET cancel_requested=1 WHERE id=?', running.id); current.controller.abort('steer'); await current.done; }
    else this.db.finish(running.id, 'cancelled', null, STEERED);
    this.schedule();
    return { taskId: task.id, messageId: task.message_id, state: task.state };
  }
  /** The first queued turn that may start: its lane has room, its bot is free and no earlier turn of its room message runs. */
  next() {
    // Conversation with the person goes before routine runs.
    // A "corrigir rumo" instruction goes before everything else the bot has waiting, and the pause does not hold it back;
    // a paused bot starts nothing else.
    const queued = this.db.all("SELECT id,bot_id,json_extract(payload,'$.steer') AS steer FROM tasks WHERE state='queued' ORDER BY json_extract(payload,'$.steer') IS NULL, id IN (SELECT task_id FROM routine_runs),created_at,rowid").filter(task => task.steer || !this.paused(task.bot_id));
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
    let capability = this.tools?.open(task, controller.signal, next.lane);
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
        // The reply as it is being written: the owner of the draft is the room (with the bot) or the private chat.
        const draftOf = text => { this.emit('changed', { event: 'message.draft', taskId: task.id, botId: task.bot_id, ...(turn ? { roomId: turn.room_id } : {}), text }); };
        // One try of the turn with `runBot`: the bot itself, or its reserve model when the subscription limit ended.
        // The pictures of the person's message go straight to a Codex bot that runs here on the phone (a bot on the computer, or Claude, reads them with attachment_read).
        const pictures = next.lane === 'phone' && this.tools?.attachments ? (this.db.message(task.message_id)?.attachments || []).filter(file => /^image\/(png|jpe?g|webp|gif)$/i.test(file.mime || '') && file.size <= 10 * 1024 * 1024).slice(0, 4).map(file => this.tools.attachments.path(file.id)) : [];
        const attempt = (runBot, runPrompt, spare) => execute(runBot, runPrompt, {
          signal: controller.signal,
          ...(runBot.provider !== 'claude' && pictures.length ? { images: pictures } : {}),
          onDelta: text => { if (!controller.signal.aborted) draftOf(text); },
          workspace: capability?.workspace,
          tools: capability ? { token: capability.token, taskId: task.id, desktop: next.lane === 'pc' && this.tools.policy(runBot.id, 'desktop') === 'allow', browser: this.tools.policy(runBot.id, 'browser') !== 'deny', endpoint: this.toolEndpoint, entry: fileURLToPath(new URL('./mcp/index.mjs', import.meta.url)), connectors, connectorDeny, connectorWrites: ['full', 'free'].includes(bot.access),
            // On the computer the IA may use its files and terminal, each step decided by the bot's level.
            computer: next.lane === 'pc' && this.tools.policy(runBot.id, 'computer') !== 'deny' ? { folders: Array.isArray(runBot.folders) ? runBot.folders : [], full: ['full', 'free'].includes(runBot.access) } : false,
            // Livre on the phone: Termux's whole shell. Codex cannot ask command by command, so "Comandos no Termux" on the list keeps it without one.
            termux: next.lane === 'phone' && this.tools.policy(runBot.id, 'termux') === 'allow' && (runBot.provider === 'claude' || !this.tools.freeAsk('termux')),
            phone: this.tools.policy(runBot.id, 'phone') === 'allow' } : undefined,
          // The reserve model's session is never kept: the bot's own CLI could not resume it.
          onSession: async id => { if (spare) return; if (turn) this.db.setRoomSession(turn.room_id, bot.id, id); else this.db.session(bot.id, id); },
          // What the bot says along the way becomes a message now; what it is doing shows under "Pensando".
          onProgress: ({ say, step } = {}) => {
            if (controller.signal.aborted) return;
            // A step is only an event: the conversation is not written for it.
            if (typeof say === 'string' && say.trim()) { this.db.progressMessage(task.id, say); this.steps.delete(task.id); draftOf(''); }
            else if (typeof step === 'string' && step.trim()) this.steps.set(task.id, step.trim().slice(0, 160));
            else return;
            this.emit('changed', { event: 'task.progress', taskId: task.id, botId: task.bot_id, step: this.steps.get(task.id) || null });
          },
          // Only a local process can be found again (and stopped) after a crash.
          onProcess: pid => { if (next.lane === 'phone') this.db.run('UPDATE tasks SET worker_pid=?,worker_start=?,updated_at=? WHERE id=?', pid, processIdentity(pid), now(), task.id); }
        });
        let reply;
        try { reply = await attempt(bot, prompt, false); }
        catch (error) {
          // The subscription limit ended: the same turn, with the bot's reserve model, keeping its level, grants and "sempre perguntar".
          const reserve = !turn && !controller.signal.aborted && LIMIT.test(`${error.output || ''}\n${error.message || ''}`) ? this.reserve(owner) : null;
          if (!reserve) throw error;
          capability?.close(); capability = this.tools?.open(task, controller.signal, next.lane);
          const spare = { ...owner, ...reserve, codexSessionId: undefined, ...(browserMode(owner) === 'claude' ? { browserMode: 'shared' } : {}) };
          this.db.record('model_fallback', `Limite do ${owner.provider === 'claude' ? 'Claude' : 'Codex'} atingido; respondendo com o ${reserve.provider === 'claude' ? 'Claude' : 'Codex'}.`, owner.id, task.id);
          try { reply = await attempt(spare, promptFor(this.chat(spare, task.message_id), task.message_id, { tools: Boolean(this.tools) }), true); }
          catch (second) { delete second.codexSessionId; throw second; }
          // Its session is the other CLI's: drop the bot's own so its next turn starts fresh from the saved history.
          reply = { ...reply, codexSessionId: undefined, fallback: true, provider: reserve.provider };
          this.db.run('DELETE FROM codex_sessions WHERE bot_id=?', owner.id); this.db.putBot({ ...this.db.requireBot(owner.id), codexSessionId: undefined });
        }
        if (controller.signal.aborted) this.db.finish(task.id, STOPPED[controller.signal.reason] ? 'failed' : 'cancelled', null, STOPPED[controller.signal.reason] || (controller.signal.reason === 'steer' ? STEERED : 'Pedido cancelado.'));
        else { if (reply.accountServers?.length) this.rememberServers?.(reply.accountServers); this.tools?.adoptImages(task.bot_id, task.id, reply.images); const { images, ...rest } = reply; this.db.finish(task.id, 'done', { ...rest, attachments: this.tools?.takeOutgoing(task.id) || [] }); }
      } catch (error) {
        if (error.codexSessionId) { const turn = this.db.roomTurn(task.id); if (turn) this.db.setRoomSession(turn.room_id, task.bot_id, error.codexSessionId); else this.db.session(task.bot_id, error.codexSessionId); }
        const stopped = controller.signal.aborted && STOPPED[controller.signal.reason];
        const detail = controller.signal.aborted ? stopped || (controller.signal.reason === 'steer' ? STEERED : 'Pedido cancelado.') : error.output ? friendlyError(error.output) : error.message;
        // Files already sent stay in the conversation even when the turn fails afterwards.
        this.db.finish(task.id, controller.signal.aborted && !stopped ? 'cancelled' : 'failed', { attachments: this.tools?.takeOutgoing(task.id) || [] }, detail);
      } finally {
        capability?.close(); this.emit('changed', { event: 'message.draft', taskId: task.id, botId: task.bot_id, text: '' });
        this.running.delete(task.id); this.steps.delete(task.id);
        this.emit('changed', { event: 'task.done', taskId: task.id });
        this.schedule();
      }
    })();
    // Other bots, or the other lane, may have work too.
    this.schedule();
    await current.done;
  }
  /** The reserve model of a bot, when it is another provider's (the limit is the subscription's) and still valid. */
  reserve(bot) {
    const item = bot.fallback;
    if (!item || !['codex', 'claude'].includes(item.provider) || item.provider === (bot.provider || 'codex') || typeof item.model !== 'string') return null;
    return { provider: item.provider, model: item.model, reasoningEffort: item.reasoningEffort };
  }
  /** The bot with the part of its chat the prompt needs: the message alone in a resumed session, else the latest ones. */
  chat(bot, messageId) {
    const framed = message => message.steer ? { ...message, text: STEER_NOTE + message.text } : message;
    if (bot.codexSessionId) return { ...bot, messages: [this.db.message(messageId)].filter(Boolean).map(framed) };
    const page = this.db.page({ botId: bot.id, limit: PROMPT_WINDOW });
    return { ...bot, messages: page.messages.map(framed), earlier: page.more };
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
