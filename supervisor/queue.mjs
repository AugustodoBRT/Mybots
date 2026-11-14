import { EventEmitter } from 'node:events';
import os from 'node:os';
import runner from '../lib/codex-runner.cjs';
import claudeRunner from '../lib/claude-runner.cjs';
import agyRunner from '../lib/agy-runner.cjs';
import opencodeRunner from '../lib/opencode-runner.cjs';
import { promptFor } from '../mobile/local.js';
import { aiBinary } from '../lib/ai-runtimes.mjs';
import { friendlyError } from '../lib/codex.mjs';
import { PROVIDERS, PROVIDER_NAMES } from '../lib/models.mjs';
import { now } from './database.mjs';
import { processIdentity, stopOrphan } from './process.mjs';
import { browserAccountGuidance } from '../mobile/local.js';
import { browserMode } from './tool-policy.mjs';
import { fileURLToPath } from 'node:url';
import { accounts } from '../lib/accounts.mjs';

// The turn runs with the login of the account the bot chose (lib/accounts.mjs); without one, the IA's own login.
export const runReply = (bot, prompt, options) => {
  const provider = bot.provider || 'codex', env = accounts.env(provider, bot.aiAccount);
  const withAccount = { ...options, ...(env ? { env } : {}) };
  return provider === 'claude' ? claudeRunner.runReply(bot, prompt, { ...withAccount, binary: aiBinary('claude') })
    : provider === 'agy' ? agyRunner.runReply(bot, prompt, { ...withAccount, binary: aiBinary('agy') })
    : provider === 'opencode' ? opencodeRunner.runReply(bot, prompt, { ...withAccount, binary: aiBinary('opencode') })
    : runner.runReply(bot, prompt, { ...withAccount, binary: aiBinary('codex') });
};

// Why a running turn was stopped by the supervisor instead of the person, and what the conversation says.
const STOPPED = {
  shutdown: 'Supervisor reiniciado durante a resposta. O histórico foi preservado.',
  node_lost: 'O computador desconectou durante esta resposta. O histórico foi preservado; mande de novo quando ele voltar.'
};

// Why a turn the person steered ended, and what the instruction tells the IA when it resumes.
const STEERED = 'Interrompida para corrigir o rumo.';
const STEER_NOTE = 'A pessoa interrompeu a tarefa em andamento para corrigir o rumo. Continue de onde parou, seguindo esta instrução:\n';

// A subscription limit (or quota) ending, as the runners' errors and the raw CLI output say it.
// The IA no longer has the session the app kept for the bot (its file was removed, or the run died before saving it).
const SESSION_GONE = /no rollout found for thread|no conversation found with session id|abriu outra (conversa|sessão)|session not found/i;
const LIMIT = /usage.limit|limite de uso|rate.limit|limit reached|insufficient_quota|\bquota\b|\b429\b/i;

// How much of a private chat a new IA session reads at most (promptFor keeps what fits in its size budget).
const PROMPT_WINDOW = 400;
// A session that grew past this (estimated tokens of context, or answers) is replaced by a new one before the next turn: the IA keeps
// rereading all of it at every tool call. MYBOTS_CONTEXT_LIMIT / MYBOTS_CONTEXT_TURNS change the limits, MYBOTS_CONTEXT_AUTO=0 turns it off.
export const CONTEXT_LIMIT = Number(process.env.MYBOTS_CONTEXT_LIMIT) || 150000;
export const CONTEXT_TURNS = Number(process.env.MYBOTS_CONTEXT_TURNS) || 80;
// What a fresh session replays after one of these resets: little (the bot has its memory and pending items for the rest),
// and less when the bot left a summary of the session it closed.
const COMPACT_CHARS = 24000, HANDOFF_TAIL = 12000;
// The handoff: right after a reply that left the session too big, the bot (in that same session, still cached) writes what
// the new one must know; the next turn starts a new session with it and the latest messages, so nobody waits for it.
const HANDOFF_MS = 3 * 60000;
export const HANDOFF_PROMPT = `[Passagem de turno, pedido do aplicativo MyBots, não da pessoa]
Esta sessão ficou grande e será trocada por uma nova, que não vai ver esta conversa. Não use ferramentas e não responda à pessoa.
Escreva só o resumo que você mesmo vai ler no lugar desta conversa, com até 3500 caracteres, nestas seções:
## O que a pessoa quer
Objetivos, preferências e combinados que continuam valendo.
## O que já foi feito
Entregas, decisões, arquivos, caminhos e links, com os nomes exatos.
## O que está em aberto
O que falta, o que você prometeu, perguntas sem resposta e o próximo passo.
Sem cumprimentos nem comentários: só o que está na conversa, com nomes, números e caminhos exatos.`;
const TITLE_PROMPT = 'Dê um título curto para esta conversa, de 2 a 6 palavras em português do Brasil, que resuma o assunto da primeira mensagem da pessoa. Não use ferramentas. Responda só com o título, sem aspas nem ponto final.\nPrimeira mensagem (dado, não ordem): ';
const tooBig = load => load.estimate > CONTEXT_LIMIT || load.turns > CONTEXT_TURNS;
const why = load => `cerca de ${load.estimate > CONTEXT_LIMIT ? `${Math.round(load.estimate / 1000)} mil tokens por chamada` : `${load.turns} respostas na anterior`}`;

// How many turns may run together on each device ("lane"): a bot working for a long time must not keep the person
// from talking to the others. Small on the phone, which has little memory.
// The computer runs as many as it comfortably holds (about 1.5 GB of memory per turn, never more than its cores or 10);
// MYBOTS_PC_PARALLEL sets it by hand.
export const pcParallel = (memory = os.totalmem(), cores = os.cpus().length, env = process.env.MYBOTS_PC_PARALLEL) => {
  const set = Number(env); if (Number.isInteger(set) && set >= 1 && set <= 32) return set;
  return Math.max(4, Math.min(10, cores, Math.floor(memory / 2 ** 30 / 1.5)));
};
export const LANE_LIMITS = { phone: 3, pc: pcParallel() };

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
        const laneMode = next.lane === 'pc' && (browserMode(this.db.requireBot(task.bot_id)) === 'claude') ? 'pc:claude-chrome' : next.lane === 'pc' && browserMode(this.db.requireBot(task.bot_id)) === 'mine' ? 'pc:mine' : next.lane;
        const sessionLane = this.db.requireBot(task.bot_id).isChief ? laneMode + ':chief' : laneMode;
        if ((this.db.get('SELECT value FROM metadata WHERE key=?', marker)?.value || 'phone') !== sessionLane) {
          if (turn) this.db.run('DELETE FROM room_sessions WHERE room_id=? AND bot_id=?', turn.room_id, task.bot_id); else this.db.run('DELETE FROM codex_sessions WHERE bot_id=?', task.bot_id);
          this.db.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', marker, sessionLane);
        }
        // Too big a session is replaced before this turn (not while it is running, never for a routine's one-off), with the latest messages only.
        if (process.env.MYBOTS_CONTEXT_AUTO !== '0' && (turn ? this.db.roomSession(turn.room_id, task.bot_id) : this.db.requireBot(task.bot_id).codexSessionId)) {
          const load = this.db.contextLoad(task.bot_id, turn?.room_id || null);
          if (tooBig(load)) this.db.newSession(task.bot_id, `Nova sessão da IA, iniciada sozinha para economizar contexto (${why(load)}). A conversa, as memórias e as pendências continuam; só as mensagens mais recentes vão para a sessão nova. Para recomeçar quando quiser, escreva /clear.`, { roomId: turn?.room_id || null });
        }
        const compactKey = 'session.compact.' + (turn ? turn.room_id + '.' : '') + task.bot_id;
        const handoff = this.db.get('SELECT 1 FROM metadata WHERE key=?', compactKey) ? this.db.handoff(task.bot_id, turn?.room_id || null) : null;
        const compact = handoff ? HANDOFF_TAIL : this.db.get('SELECT 1 FROM metadata WHERE key=?', compactKey) ? COMPACT_CHARS : undefined;
        const owner = this.db.requireBot(task.bot_id);
        const bot = turn ? { ...owner, codexSessionId: this.db.roomSession(turn.room_id, owner.id) } : owner;
        // Account apps: only the ones picked for this bot; the rest of the account's connectors are blocked.
        const connectors = false, connectorDeny = [];
        const prompt = turn ? this.rooms.prompt(bot, task.id, { tools: Boolean(this.tools), resumed: Boolean(bot.codexSessionId), maxChars: compact, handoff }) : promptFor(this.chat(bot, task.message_id), task.message_id, { tools: Boolean(this.tools), maxChars: compact, handoff });
        // The reply as it is being written: the owner of the draft is the room (with the bot) or the private chat.
        const draftOf = text => { this.emit('changed', { event: 'message.draft', taskId: task.id, botId: task.bot_id, ...(turn ? { roomId: turn.room_id } : {}), text }); };
        // One try of the turn with `runBot`: the bot itself, or its reserve model when the subscription limit ended.
        // The pictures of the person's message go straight to a Codex bot that runs here on the phone (a bot on the computer, or Claude, reads them with attachment_read).
        const pictures = next.lane === 'phone' && this.tools?.attachments ? (this.db.message(task.message_id)?.attachments || []).filter(file => /^image\/(png|jpe?g|webp|gif)$/i.test(file.mime || '') && file.size <= 10 * 1024 * 1024).slice(0, 4).map(file => this.tools.attachments.path(file.id)) : [];
        // `quiet` (the handoff): nothing it writes reaches the conversation, and the session stays the same.
        const attempt = (runBot, runPrompt, spare, quiet = null) => execute(runBot, (this.tools ? browserAccountGuidance(runBot) + '\n\n' : '') + runPrompt, {
          signal: quiet?.signal || controller.signal,
          ...(!quiet && (!runBot.provider || runBot.provider === 'codex') && pictures.length ? { images: pictures } : {}),
          onDelta: quiet ? undefined : text => { if (!controller.signal.aborted) draftOf(text); },
          workspace: capability?.workspace,
          tools: capability ? { token: capability.token, taskId: task.id, desktop: next.lane === 'pc' && this.tools.policy(runBot.id, 'desktop') === 'allow', github: next.lane === 'pc' && this.tools.policy(runBot.id, 'github') === 'allow', browser: this.tools.policy(runBot.id, 'browser') !== 'deny', endpoint: this.toolEndpoint, entry: fileURLToPath(new URL('./mcp/index.mjs', import.meta.url)), connectors, connectorDeny, connectorWrites: ['full', 'free'].includes(bot.access),
            // On the computer the IA may use its files and terminal, each step decided by the bot's level.
            computer: next.lane === 'pc' && this.tools.policy(runBot.id, 'computer') !== 'deny' ? { folders: Array.isArray(runBot.folders) ? runBot.folders : [], full: ['full', 'free'].includes(runBot.access) } : false,
            // Livre on the phone: the whole terminal of its Linux. Codex cannot ask command by command, so "Comandos no celular" on the list keeps it without one.
            phoneShell: next.lane === 'phone' && this.tools.policy(runBot.id, 'shell') === 'allow' && (runBot.provider === 'claude' || !this.tools.freeAsk('shell')),
            phone: this.tools.policy(runBot.id, 'phone') === 'allow' } : undefined,
          // The reserve model's session is never kept: the bot's own CLI could not resume it.
          onSession: async id => { if (spare || quiet) return; if (turn) this.db.setRoomSession(turn.room_id, bot.id, id); else this.db.session(bot.id, id); this.db.run('DELETE FROM metadata WHERE key=?', compactKey); if (handoff) this.db.setHandoff(bot.id, turn?.room_id || null, null); },
          // What the bot says along the way becomes a message now; what it is doing shows under "Pensando".
          onProgress: ({ say, step } = {}) => {
            if (controller.signal.aborted || quiet) return;
            // A step is only an event: the conversation is not written for it.
            if (typeof say === 'string' && say.trim()) { this.db.progressMessage(task.id, say); this.steps.delete(task.id); draftOf(''); }
            else if (typeof step === 'string' && step.trim()) this.steps.set(task.id, step.trim().slice(0, 160));
            else return;
            this.emit('changed', { event: 'task.progress', taskId: task.id, botId: task.bot_id, step: this.steps.get(task.id) || null });
          },
          // Only a local process can be found again (and stopped) after a crash.
          onProcess: pid => { if (next.lane === 'phone' && !quiet) this.db.run('UPDATE tasks SET worker_pid=?,worker_start=?,updated_at=? WHERE id=?', pid, processIdentity(pid), now(), task.id); }
        });
        let reply;
        try {
          try { reply = await attempt(bot, prompt, false); }
          catch (lost) {
            // The saved session is gone and would fail every turn from now on: forget it and answer in a new one, with the history.
            if (!bot.codexSessionId || controller.signal.aborted || !SESSION_GONE.test(`${lost.output || ''}\n${lost.message || ''}`)) throw lost;
            if (turn) this.db.run('DELETE FROM room_sessions WHERE room_id=? AND bot_id=?', turn.room_id, owner.id); else this.db.run('DELETE FROM codex_sessions WHERE bot_id=?', owner.id);
            this.db.record('session_reset', 'A sessão guardada da IA não existe mais; a conversa continua numa sessão nova, com o histórico.', owner.id, task.id);
            capability?.close(); capability = this.tools?.open(task, controller.signal, next.lane);
            const fresh = { ...bot, codexSessionId: undefined };
            reply = await attempt(fresh, turn ? this.rooms.prompt(fresh, task.id, { tools: Boolean(this.tools), resumed: false }) : promptFor(this.chat(fresh, task.message_id), task.message_id, { tools: Boolean(this.tools) }), false);
          }
        }
        catch (error) {
          // The subscription limit ended: the same turn, with the bot's reserve model, keeping its level, grants and "sempre perguntar".
          const reserve = !turn && !controller.signal.aborted && LIMIT.test(`${error.output || ''}\n${error.message || ''}`) ? this.reserve(owner) : null;
          if (!reserve) throw error;
          capability?.close(); capability = this.tools?.open(task, controller.signal, next.lane);
          const spare = { ...owner, ...reserve, codexSessionId: undefined, ...(browserMode(owner) === 'claude' ? { browserMode: 'shared' } : {}) };
          this.db.record('model_fallback', `Limite do ${PROVIDER_NAMES[owner.provider] || 'Codex'} atingido; respondendo com o ${PROVIDER_NAMES[reserve.provider] || 'Codex'}.`, owner.id, task.id);
          try { reply = await attempt(spare, promptFor(this.chat(spare, task.message_id), task.message_id, { tools: Boolean(this.tools) }), true); }
          catch (second) { delete second.codexSessionId; throw second; }
          // Its session is the other CLI's: drop the bot's own so its next turn starts fresh from the saved history.
          reply = { ...reply, codexSessionId: undefined, fallback: true, provider: reserve.provider };
          this.db.run('DELETE FROM codex_sessions WHERE bot_id=?', owner.id); this.db.putBot({ ...this.db.requireBot(owner.id), codexSessionId: undefined });
        }
        if (controller.signal.aborted) this.db.finish(task.id, STOPPED[controller.signal.reason] ? 'failed' : 'cancelled', null, STOPPED[controller.signal.reason] || (controller.signal.reason === 'steer' ? STEERED : 'Pedido cancelado.'));
        else { if (reply.accountServers?.length) this.rememberServers?.(reply.accountServers); this.tools?.adoptImages(task.bot_id, task.id, reply.images); const { images, ...rest } = reply;
          // The chief's answer to the person, once every item of the request's checklist is marked, ends with that list (written by MyBots).
          const closing = this.db.bot(task.bot_id)?.isChief && !this.db.roomTurn(task.id) ? this.tools?.team?.closingNote?.(task.bot_id) : '';
          if (closing) rest.text = String(rest.text || '') + closing;
          this.db.finish(task.id, 'done', { ...rest, attachments: this.tools?.takeOutgoing(task.id) || [] });
          if (!reply.fallback) await this.handOff(task, turn, attempt, controller.signal);
          if (!turn) await this.nameSession(task, attempt, controller.signal); }
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
  /**
   * After a reply that left the IA session too big: the bot writes the handoff in that session, and the next turn begins a new
   * one with it. A handoff that fails leaves the session as it is; the next turn then starts a new one with the latest messages.
   */
  async handOff(task, turn, attempt, stop) {
    if (process.env.MYBOTS_CONTEXT_AUTO === '0') return;
    const roomId = turn?.room_id || null, owner = this.db.bot(task.bot_id);
    const session = owner && (roomId ? this.db.roomSession(roomId, owner.id) : owner.codexSessionId);
    if (!session) return;
    const load = this.db.contextLoad(owner.id, roomId);
    if (!tooBig(load)) return;
    let reply;
    try { reply = await attempt({ ...owner, codexSessionId: session }, HANDOFF_PROMPT, false, { signal: AbortSignal.any([stop, AbortSignal.timeout(HANDOFF_MS)]) }); }
    catch { return; }
    if (stop.aborted) return;
    // The handoff's tokens count for the bot, but not as the size of the session that comes next.
    try { this.db.addUsage(owner, task.id, reply); } catch {}
    const text = String(reply?.text || '').trim();
    if (text.length < 80) return;
    this.db.newSession(owner.id, `Nova sessão da IA, iniciada sozinha para economizar contexto (${why(load)}). Antes de trocar, o bot resumiu a conversa para a sessão nova; as memórias e as pendências continuam. Para recomeçar do zero quando quiser, escreva /clear.`, { roomId });
    this.db.setHandoff(owner.id, roomId, text);
  }
  /**
   * The first answer of a Chefe session gives it a name: the IA summarises what the person said first in a few words, like a chat title.
   * Failing or taking too long leaves the session without one (the list then shows the start of the first message).
   */
  async nameSession(task, attempt, stop) {
    try {
      const owner = this.db.bot(task.bot_id); const key = owner?.isChief ? this.db.chatSession(owner.id) : null;
      if (!owner || !key || this.db.get("SELECT 1 FROM messages WHERE bot_id=? AND json_extract(body,'$.session')=? AND json_extract(body,'$.title') IS NOT NULL LIMIT 1", owner.id, key)) return;
      const asked = this.db.message(task.message_id);
      if (!asked || asked.role !== 'user' || asked.origin) return;
      const reply = await attempt({ ...owner, codexSessionId: undefined }, TITLE_PROMPT + JSON.stringify(String(asked.text || '').slice(0, 1200)), false, { signal: AbortSignal.any([stop, AbortSignal.timeout(40000)]) });
      const title = String(reply?.text || '').split('\n').map(line => line.trim()).find(Boolean)?.replace(/^["“”'«»*#\s]+|["“”'«»*.\s]+$/g, '').slice(0, 60);
      if (title && title.length >= 3 && this.db.sessionTitle(owner.id, key, title)) this.emit('changed', { event: 'bot.updated', botId: owner.id });
    } catch {}
  }
  /** The reserve model of a bot, when it is another provider's (the limit is the subscription's) and still valid. */
  reserve(bot) {
    const item = bot.fallback;
    if (!item || !PROVIDERS.includes(item.provider) || item.provider === (bot.provider || 'codex') || typeof item.model !== 'string') return null;
    return { provider: item.provider, model: item.model, reasoningEffort: item.reasoningEffort };
  }
  /** The bot with the part of its chat the prompt needs: the message alone in a resumed session, else the latest ones. */
  chat(bot, messageId) {
    const framed = message => message.steer ? { ...message, text: STEER_NOTE + message.text } : message;
    if (bot.codexSessionId) return { ...bot, messages: [this.db.message(messageId)].filter(Boolean).map(framed) };
    const page = this.db.page({ botId: bot.id, limit: PROMPT_WINDOW });
    // The Chefe's session in use: a new IA session reads only that chat's messages, not the other sessions'.
    const open = bot.isChief ? this.db.chatSession(bot.id) : undefined;
    const messages = open === undefined ? page.messages : page.messages.filter(message => (message.session || null) === open);
    return { ...bot, messages: messages.map(framed), earlier: page.more };
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
