import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProfile, TOOL_DEFINITIONS, toolArguments } from './tool-policy.mjs';
import { validateBackup, mergeBotLists, deleteLocalBot } from '../mobile/local.js';

export const now = () => new Date().toISOString();
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const ACTIVE = ['queued', 'running', 'waiting_approval'];

const blank = () => ({ input: 0, cached: 0, output: 0, turns: 0 });
// Token counts as the IA reported them for one reply (Codex turn.completed, Claude result.usage).
function tokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const count = value => Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1e9) : 0;
  const result = { input: count(usage.input), cached: count(usage.cached), output: count(usage.output) };
  return result.input || result.output ? result : null;
}

export class Database {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.directory = directory;
    this.db = new DatabaseSync(join(directory, 'mybots.db'));
    chmodSync(join(directory, 'mybots.db'), 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.get('PRAGMA user_version').user_version;
    if (version > 6) { this.db.close(); throw new Error('O banco foi criado por uma versão mais recente do MyBots.'); }
    if (version === 0) this.transaction(() => {
      this.db.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE bots (id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE messages (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), body TEXT NOT NULL);
        CREATE INDEX messages_bot ON messages(bot_id);
        CREATE TABLE codex_sessions (bot_id TEXT PRIMARY KEY REFERENCES bots(id), session_id TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE tasks (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), message_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('queued','running','waiting_approval','done','failed','cancelled')),
          payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
          worker_pid INTEGER, worker_start TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
          error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX tasks_queue ON tasks(state, created_at);
        CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), state TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE memory (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), body TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE grants (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), tool TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), action_hash TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE activity (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, bot_id TEXT, task_id TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE connector_state (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE heartbeats (id INTEGER PRIMARY KEY, instance_id TEXT NOT NULL, created_at TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
    });
    if (version < 2) this.transaction(() => {
      this.db.exec(`CREATE TABLE pending_items (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), body TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','done')), created_at TEXT NOT NULL);
        CREATE UNIQUE INDEX grants_bot_tool ON grants(bot_id,tool);
        PRAGMA user_version=2;`);
      // Existing conversations were created with a chat-only instruction; rebuild their context once.
      this.run('DELETE FROM codex_sessions');
    });
    // Connector events (e-mail received, later timers): the input of routines. The id deduplicates.
    if (version < 3) this.transaction(() => {
      this.db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT);
        CREATE INDEX events_kind ON events(kind, created_at);
        PRAGMA user_version=3;`);
    });
    // Routines: a schedule or notification filter that queues tasks for one bot. routine_runs links each task to its routine.
    if (version < 4) this.transaction(() => {
      this.db.exec(`CREATE TABLE routines (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), body TEXT NOT NULL, enabled INTEGER NOT NULL,
          next_run_at TEXT, last_run_at TEXT, last_event_at TEXT, pending INTEGER NOT NULL DEFAULT 0, last_result TEXT, skipped_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX routines_bot ON routines(bot_id);
        CREATE TABLE routine_runs (id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), created_at TEXT NOT NULL);
        CREATE INDEX routine_runs_routine ON routine_runs(routine_id, created_at);
        CREATE TABLE attachments (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX attachments_bot ON attachments(bot_id);
        PRAGMA user_version=4;`);
    });
    // Tokens of each reply, per bot; the account's plan limits are kept in metadata (limits.codex, limits.claude).
    if (version < 5) this.transaction(() => {
      this.db.exec(`CREATE TABLE usage (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), task_id TEXT, provider TEXT NOT NULL, model TEXT,
          input INTEGER NOT NULL, cached INTEGER NOT NULL, output INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX usage_bot ON usage(bot_id, created_at);
        PRAGMA user_version=5;`);
    });
    // Rooms: several bots and the person in one conversation. A room turn is a normal task of the bot that answers,
    // linked to the room message it answers; each bot keeps one IA session per room, apart from its private chat.
    if (version < 6) this.transaction(() => {
      this.db.exec(`CREATE TABLE rooms (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE room_turns (task_id TEXT PRIMARY KEY REFERENCES tasks(id), room_id TEXT NOT NULL REFERENCES rooms(id), message_id TEXT NOT NULL, round INTEGER NOT NULL, origin_id TEXT NOT NULL);
        CREATE INDEX room_turns_room ON room_turns(room_id);
        CREATE TABLE room_sessions (room_id TEXT NOT NULL REFERENCES rooms(id), bot_id TEXT NOT NULL REFERENCES bots(id), session_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (room_id, bot_id));
        PRAGMA user_version=6;`);
    });
  }
  /** One reply's tokens. Codex reports the session's running totals: the reply is the difference from the last one. */
  turnTokens(botId, reply) {
    const usage = tokens(reply?.usage);
    if (!usage || !reply.usage.session) return usage;
    // Per bot and session: a bot alternates between its private chat and its rooms, each with its own totals.
    const key = 'usage.session.' + botId + ':' + (reply.codexSessionId || '');
    const last = JSON.parse(this.get('SELECT value FROM metadata WHERE key=?', key)?.value || 'null');
    this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify({ session: reply.codexSessionId || null, ...usage }));
    const known = last && last.session === (reply.codexSessionId || null) && last.input <= usage.input && last.output <= usage.output;
    // A conversation resumed without a known total (the first reply after updating MyBots) only sets the starting point.
    if (!known) return reply.usage.resumed ? null : usage;
    return tokens({ input: usage.input - last.input, cached: Math.max(0, usage.cached - last.cached), output: usage.output - last.output });
  }
  // Rooms (the bots' group conversations): stored like bots, one JSON body with the members and the messages.
  room(id) { const row = uuid(id) ? this.get('SELECT body FROM rooms WHERE id=?', id) : null; return row ? JSON.parse(row.body) : null; }
  rooms() { return this.all('SELECT body FROM rooms ORDER BY updated_at DESC').map(row => JSON.parse(row.body)); }
  requireRoom(id) { const room = this.room(id); if (!room || room.deletedAt) throw new Error('Sala não encontrada.'); return room; }
  putRoom(room) { this.run('INSERT INTO rooms(id,body,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at', room.id, JSON.stringify(room), room.updatedAt); }
  roomTurn(taskId) { return this.get('SELECT * FROM room_turns WHERE task_id=?', taskId); }
  roomSession(roomId, botId) { return this.get('SELECT session_id FROM room_sessions WHERE room_id=? AND bot_id=?', roomId, botId)?.session_id; }
  setRoomSession(roomId, botId, id) {
    if (!uuid(id)) throw new Error('Sessão inválida.');
    this.run('INSERT INTO room_sessions VALUES(?,?,?,?) ON CONFLICT(room_id, bot_id) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at', roomId, botId, id, now());
  }
  /** A bot's answer in a room becomes a message of the room (or an error line), never of its private chat. */
  roomReply(turn, bot, state, reply, error, files, usage) {
    const room = this.room(turn.room_id); if (!room) return;
    const stamp = now();
    const message = state === 'done'
      ? { id: randomUUID(), role: 'assistant', botId: bot.id, text: reply.text, status: 'complete', model: reply.model, ...(typeof reply.modelId === 'string' ? { modelId: reply.modelId.slice(0, 80) } : {}), reasoningEffort: reply.reasoningEffort, ...files, ...(usage ? { usage: { input: usage.input, output: usage.output } } : {}), replyTo: turn.message_id, createdAt: stamp }
      : { id: randomUUID(), role: 'assistant', botId: bot.id, text: files.attachments ? 'Estes arquivos ficaram prontos antes da interrupção.' : '', status: 'error', error: error || 'A resposta não foi concluída.', ...files, replyTo: turn.message_id, createdAt: stamp };
    if (state === 'done' && reply?.codexSessionId) this.setRoomSession(room.id, bot.id, reply.codexSessionId);
    this.putRoom({ ...room, messages: [...room.messages, message].slice(-1000), updatedAt: stamp });
  }
  /** Something the bot says while it still works: a message in its chat (or room) before the final reply. */
  progressMessage(taskId, text) {
    const task = this.task(taskId);
    if (!task || !ACTIVE.includes(task.state) || typeof text !== 'string' || !text.trim()) return;
    const stamp = now(); const turn = this.roomTurn(taskId);
    const message = { id: randomUUID(), role: 'assistant', text: text.trim().slice(0, 4000), status: 'complete', progress: true, createdAt: stamp };
    this.transaction(() => {
      if (turn) { const room = this.room(turn.room_id); if (room) this.putRoom({ ...room, messages: [...room.messages, { ...message, botId: task.bot_id, replyTo: turn.message_id }].slice(-1000), updatedAt: stamp }); }
      else { const bot = this.bot(task.bot_id); this.putBot({ ...bot, updatedAt: stamp, messages: [...bot.messages, message] }); }
    });
  }
  /** How the person wants to be called (home-screen greeting). */
  person() { return { name: this.get("SELECT value FROM metadata WHERE key='person.name'")?.value || '' }; }
  setPerson({ name } = {}) {
    if (typeof name !== 'string' || name.length > 40 || /[\u0000-\u001f]/.test(name)) throw new Error('Use um nome de até 40 letras.');
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean) this.run("INSERT INTO metadata VALUES('person.name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", clean);
    else this.run("DELETE FROM metadata WHERE key='person.name'");
    return this.person();
  }
  /** The plan's usage windows (5 hours, week) as the IA last reported them. */
  setLimits(provider, limits) {
    const windows = Array.isArray(limits?.windows) ? limits.windows.filter(item => Number.isFinite(item?.used)).slice(0, 4).map(item => ({ key: String(item.key).slice(0, 20), used: Math.max(0, Math.min(100, Math.round(item.used))), resetsAt: Number.isFinite(item.resetsAt) ? new Date(item.resetsAt).toISOString() : null })) : [];
    if (!windows.length) return;
    this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'limits.' + provider, JSON.stringify({ plan: typeof limits.plan === 'string' ? limits.plan.slice(0, 30) : null, windows, checkedAt: now() }));
  }
  limits() { return Object.fromEntries(['codex', 'claude'].map(provider => [provider, JSON.parse(this.get('SELECT value FROM metadata WHERE key=?', 'limits.' + provider)?.value || 'null')]).filter(([, value]) => value)); }
  /** Tokens per bot (today, 7 and 30 days) and per day for the last week, from the replies' usage. */
  usage(days = 7) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString(); const day = new Date(); day.setHours(0, 0, 0, 0);
    const week = new Date(day.getTime() - (days - 1) * 86400000);
    const bots = {}; const daily = new Map();
    for (const row of this.all('SELECT bot_id,provider,input,cached,output,created_at FROM usage WHERE created_at>=?', since)) {
      const at = Date.parse(row.created_at); const add = (target) => { target.input += row.input; target.cached += row.cached; target.output += row.output; target.turns += 1; };
      const entry = bots[row.bot_id] ||= { today: blank(), week: blank(), month: blank(), provider: row.provider };
      add(entry.month); if (at >= week.getTime()) add(entry.week); if (at >= day.getTime()) add(entry.today);
      if (at >= week.getTime()) { const key = new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 10); add(daily.get(key) || daily.set(key, blank()).get(key)); }
    }
    const series = [...Array(days)].map((_, index) => { const date = new Date(week.getTime() + index * 86400000); const key = new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return { date: key, ...(daily.get(key) || blank()) }; });
    return { bots, days: series, limits: this.limits() };
  }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(work) {
    // Nested calls join the outer transaction, so composed writes (a routine run and its task) commit together.
    if (this.depth) return work();
    this.db.exec('BEGIN IMMEDIATE'); this.depth = 1;
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.depth = 0; }
  }
  close() { this.db.close(); }
  bot(id) {
    const row = this.get('SELECT body FROM bots WHERE id=?', id);
    if (!row) return null;
    const bot = JSON.parse(row.body);
    bot.messages = this.all('SELECT body FROM messages WHERE bot_id=? ORDER BY rowid', id).map(item => JSON.parse(item.body));
    const session = this.get('SELECT session_id FROM codex_sessions WHERE bot_id=?', id);
    if (session) bot.codexSessionId = session.session_id;
    return bot;
  }
  bots() { return this.all('SELECT id FROM bots').map(row => this.bot(row.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  requireBot(id) {
    if (!uuid(id)) throw new Error('Bot inválido.');
    const bot = this.bot(id);
    if (!bot || bot.deletedAt) throw new Error('Bot não encontrado.');
    return bot;
  }
  putBot(bot) {
    const { messages, codexSessionId, ...body } = bot;
    this.run('INSERT INTO bots(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', bot.id, JSON.stringify(body));
    this.run('DELETE FROM messages WHERE bot_id=?', bot.id);
    for (const message of messages) this.run('INSERT INTO messages(id,bot_id,body) VALUES(?,?,?)', message.id, bot.id, JSON.stringify(message));
    if (codexSessionId) this.session(bot.id, codexSessionId);
    else this.run('DELETE FROM codex_sessions WHERE bot_id=?', bot.id);
  }
  session(botId, id) {
    if (!uuid(id)) throw new Error('Sessão inválida.');
    this.run('INSERT INTO codex_sessions VALUES(?,?,?) ON CONFLICT(bot_id) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at', botId, id, now());
  }
  record(kind, detail, botId = null, taskId = null) {
    this.run('INSERT INTO activity(kind,detail,bot_id,task_id,created_at) VALUES(?,?,?,?,?)', kind, detail, botId, taskId, now());
  }
  snapshot() { return { schema: 1, mode: 'phone', supervisorMigrated: true, bots: this.bots(), roomsState: { schema: 1, rooms: this.rooms() }, toolsState: {
    schema: 1, memory: this.all('SELECT * FROM memory'), pendingItems: this.all('SELECT * FROM pending_items'), grants: this.all('SELECT * FROM grants')
  } }; }
  validateTools(snapshot) {
    if (snapshot.toolsState === undefined) return;
    const state = snapshot.toolsState; const ids = new Set(snapshot.bots.map(bot => bot.id));
    if (state?.schema !== 1 || !['memory','pendingItems','grants'].every(key => Array.isArray(state[key]) && state[key].length <= 20000)) throw new Error('Backup de ferramentas inválido.');
    for (const key of ['memory','pendingItems','grants']) {
      const seen = new Set();
      for (const row of state[key]) {
        if (!row || !ids.has(row.bot_id) || typeof row.id !== 'string' || seen.has(row.id) || typeof row.body !== 'string') throw new Error('Item de ferramenta inválido no backup.');
        seen.add(row.id);
        if (key === 'grants') {
          // account.apps keeps the list of account apps the bot loads; every other grant is true or false.
          const apps = row.tool === 'account.apps' && (() => { try { const list = JSON.parse(row.body); return Array.isArray(list) && list.length <= 30 && list.every(name => typeof name === 'string' && name.length <= 60); } catch { return false; } })();
          if (!(apps || ((TOOL_DEFINITIONS.some(tool => tool.name === row.tool) || /^(mcp:[0-9a-f]{8}|account\.connectors|browser)(\/write)?$|^computer\/(shell|write|read)$/.test(row.tool)) && ['true','false'].includes(row.body))) || row.id !== row.bot_id + ':' + row.tool) throw new Error('Permissão inválida no backup.');
        } else {
          // Items also keep their dedupe key and when their deadline notice went out.
          const { key: itemKey, remindedAt, ...args } = JSON.parse(row.body);
          toolArguments(key === 'memory' ? 'memory.write' : 'task.create_item', key === 'memory' ? { ...args, ...(itemKey !== undefined ? { key: itemKey } : {}) } : args);
          if (key === 'memory') args.key = itemKey;
          if (!Number.isFinite(Date.parse(key === 'memory' ? row.updated_at : row.created_at)) || (key === 'memory' ? row.id !== row.bot_id + ':' + args.key : !uuid(row.id) || !['open','done'].includes(row.state))) throw new Error('Item de ferramenta inválido no backup.');
        }
      }
    }
  }
  backup() {
    const directory = join(this.directory, 'backup'); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const name = `mybots-${now().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID()}.json`;
    const file = join(directory, name);
    writeFileSync(file + '.tmp', JSON.stringify(this.snapshot()), { mode: 0o600 }); renameSync(file + '.tmp', file);
    return { name, path: file };
  }
  importLegacy(snapshot) {
    if (this.get("SELECT value FROM metadata WHERE key='legacy_imported'")) return false;
    validateBackup(snapshot);
    return this.transaction(() => {
      for (const bot of snapshot.bots) {
        if (this.bot(bot.id)) throw new Error('A migração encontrou um identificador já existente. Dados preservados.');
        const messages = bot.messages.map(message => message.status === 'pending' || message.awaitingResponse ? {
          ...message, status: 'error', awaitingResponse: false, error: 'Pedido anterior à migração interrompido. Envie novamente se necessário.'
        } : message);
        this.putBot({ ...bot, messages });
      }
      this.run("INSERT INTO metadata VALUES('legacy_imported',?)", now());
      this.record('migration', `${snapshot.bots.length} bots migrados com seus identificadores.`);
      return true;
    });
  }
  restore(snapshot) {
    validateBackup(snapshot); this.validateTools(snapshot);
    if (this.tasks().some(task => ACTIVE.includes(task.state))) throw new Error('Aguarde ou cancele as tarefas antes de restaurar.');
    this.backup();
    this.transaction(() => {
      const stamp = now();
      const restored = new Set(snapshot.bots.map(bot => bot.id));
      for (const bot of this.bots()) if (!restored.has(bot.id)) this.putBot({ ...bot, deletedAt: stamp, updatedAt: stamp, messages: [], codexSessionId: undefined });
      for (const bot of snapshot.bots) this.putBot({ ...bot, ...(!bot.deletedAt ? { restoredAt: stamp } : {}),
        messages: bot.messages.map(message => message.status === 'pending' || message.awaitingResponse ? { ...message, status: 'error', awaitingResponse: false, error: 'Pedido interrompido no backup.' } : message) });
      this.run('DELETE FROM memory'); this.run('DELETE FROM pending_items'); this.run('DELETE FROM grants');
      // Rooms came with backups from v35 on; older backups leave the current rooms as they are.
      if (snapshot.roomsState?.schema === 1 && Array.isArray(snapshot.roomsState.rooms)) {
        this.run('DELETE FROM room_sessions');
        for (const room of snapshot.roomsState.rooms.slice(0, 200)) if (uuid(room?.id) && typeof room.name === 'string' && Array.isArray(room.botIds) && Array.isArray(room.messages))
          this.putRoom({ ...room, messages: room.messages.slice(-1000), updatedAt: typeof room.updatedAt === 'string' ? room.updatedAt : stamp });
      }
      for (const row of snapshot.toolsState?.memory || []) this.run('INSERT INTO memory VALUES(?,?,?,?)', row.id, row.bot_id, row.body, row.updated_at);
      for (const row of snapshot.toolsState?.pendingItems || []) this.run('INSERT INTO pending_items VALUES(?,?,?,?,?)', row.id, row.bot_id, row.body, row.state, row.created_at);
      for (const row of snapshot.toolsState?.grants || []) this.run('INSERT INTO grants VALUES(?,?,?,?)', row.id, row.bot_id, row.tool, row.body);
      this.record('restore', 'Backup restaurado.');
    });
  }
  merge(incoming) {
    validateBackup({ schema: 1, bots: incoming });
    if (this.tasks().some(task => ACTIVE.includes(task.state))) throw new Error('Aguarde as tarefas antes de sincronizar.');
    const existing = new Map(this.bots().map(bot => [bot.id, bot]));
    const merged = mergeBotLists([...existing.values()], incoming.map(({ codexSessionId, ...bot }) => ({ ...bot,
      ...(existing.get(bot.id)?.codexSessionId ? { codexSessionId: existing.get(bot.id).codexSessionId } : {}) })));
    this.transaction(() => { for (const bot of merged) this.putBot(bot); });
  }
  create(data, selection) {
    validateProfile(data);
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 40 ||
      (data.instructions !== undefined && (typeof data.instructions !== 'string' || data.instructions.length > 2000)) ||
      !['green','blue','purple','orange'].includes(data.color || 'green')) throw new Error('Informe nome, personalidade e cor válidos.');
    const stamp = now();
    const bot = { id: randomUUID(), name: data.name.trim(), instructions: (data.instructions || '').trim(), color: data.color || 'green', avatar: data.avatar || 'orbit', autonomy: data.autonomy || 'ask', ...(data.access ? { access: data.access } : {}), home: data.home || 'phone', ...selection, createdAt: stamp, updatedAt: stamp, messages: [] };
    this.transaction(() => { this.putBot(bot); this.record('bot_created', `Bot ${bot.name} criado.`, bot.id); });
    return bot;
  }
  configure(id, selection, changes = {}) {
    validateProfile(changes);
    const bot = this.requireBot(id);
    if (this.tasks().some(task => task.bot_id === id && ACTIVE.includes(task.state))) throw new Error('Aguarde a resposta antes de alterar o bot.');
    const updated = { ...bot, ...selection, updatedAt: now() };
    for (const field of ['name','instructions','color','avatar','autonomy','access','home','folders']) if (changes[field] !== undefined) updated[field] = changes[field];
    if (typeof updated.name !== 'string' || !updated.name.trim() || updated.name.trim().length > 40 || typeof updated.instructions !== 'string' || updated.instructions.length > 2000 || !['green','blue','purple','orange'].includes(updated.color)) throw new Error('Informe nome, personalidade e cor válidos.');
    updated.name = updated.name.trim(); updated.instructions = updated.instructions.trim();
    // codexSessionId holds the session of the bot's current provider; another CLI cannot resume it.
    const switched = (updated.provider || 'codex') !== (bot.provider || 'codex');
    // A new access level, like a new grant, needs a fresh session so the bot stops repeating "I have no access".
    // Moving to another device also starts a new session there: an IA session lives on the machine that made it.
    const moved = (updated.home || 'phone') !== (bot.home || 'phone');
    if (switched || moved || updated.name !== bot.name || updated.instructions !== bot.instructions || updated.access !== bot.access) delete updated.codexSessionId;
    const level = { basic: 'Pouco acesso', ask: 'Médio', full: 'Acesso total' }[updated.access];
    const where = { phone: 'no celular', pc: 'no computador', any: 'onde estiver ligado' }[updated.home || 'phone'];
    this.transaction(() => { this.putBot(updated); this.record('bot_updated', switched ? `IA alterada para ${updated.provider === 'claude' ? 'Claude' : 'Codex'}; a conversa continua com o histórico salvo.` : moved ? `Agora vive ${where}.` : updated.access !== bot.access ? `Nível de acesso: ${level}.` : 'Perfil atualizado.', id); });
    return updated;
  }
  delete(id) {
    this.requireBot(id);
    if (this.tasks().some(task => task.bot_id === id && ACTIVE.includes(task.state))) throw new Error('Aguarde a tarefa antes de apagar o bot.');
    this.backup();
    const next = deleteLocalBot(this.snapshot(), id).bots.find(bot => bot.id === id);
    this.transaction(() => { this.putBot(next); this.record('bot_deleted', 'Bot apagado.', id); });
  }
  task(id) { return this.get('SELECT * FROM tasks WHERE id=?', id); }
  tasks() { return this.all('SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC'); }
  enqueue(botId, requestId, text, selection, origin = {}) {
    this.requireBot(botId);
    if (!uuid(requestId) || typeof text !== 'string' || !text.trim() || text.trim().length > 8000) throw new Error('Escreva uma mensagem de até 8.000 caracteres.');
    const payload = JSON.stringify({ text: text.trim(), ...selection });
    const existing = this.task(requestId);
    if (existing) {
      if (existing.bot_id !== botId || existing.payload !== payload) throw new Error('Este pedido já foi usado para outra mensagem.');
      return existing;
    }
    // Messages sent while the bot works wait in line and become its next turns, in order.
    if (this.tasks().filter(task => task.bot_id === botId && ACTIVE.includes(task.state)).length >= 10) throw new Error('Este bot já tem 10 mensagens esperando. Aguarde ele responder algumas.');
    return this.transaction(() => {
      const bot = this.requireBot(botId); const stamp = now(); const messageId = randomUUID();
      this.putBot({ ...bot, ...selection, updatedAt: stamp, messages: [...bot.messages,
        { id: messageId, requestId, role: 'user', text: text.trim(), status: 'pending', ...selection, ...origin, createdAt: stamp }] });
      this.run("INSERT INTO tasks(id,bot_id,message_id,state,payload,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)", requestId, botId, messageId, payload, stamp, stamp);
      this.event(requestId, 'queued');
      return this.task(requestId);
    });
  }
  event(id, state) {
    const task = this.task(id);
    this.run('INSERT INTO task_events(task_id,state,created_at) VALUES(?,?,?)', id, state, now());
    this.record('task_' + state, { queued: 'Mensagem na fila.', running: 'Gerando resposta.', done: 'Resposta concluída.', failed: 'Resposta interrompida ou falhou.', cancelled: 'Pedido cancelado.', waiting_approval: 'Aguardando sua aprovação.' }[state] || state, task.bot_id, id);
  }
  start(id) {
    return this.transaction(() => {
      this.run("UPDATE tasks SET state='running', attempts=attempts+1,updated_at=? WHERE id=? AND state='queued'", now(), id);
      this.event(id, 'running'); return this.task(id);
    });
  }
  finish(id, state, reply = null, error = null) {
    return this.transaction(() => {
      const task = this.task(id);
      if (!task || !ACTIVE.includes(task.state)) return;
      const bot = this.bot(task.bot_id);
      const files = reply?.attachments?.length ? { attachments: reply.attachments } : {};
      const usage = state === 'done' ? this.turnTokens(bot.id, reply) : null;
      const turn = this.roomTurn(id);
      if (turn) this.roomReply(turn, bot, state, reply, error, files, usage);
      const messages = turn ? null : bot.messages.map(message => message.id === task.message_id ? { ...message,
        status: state === 'done' ? 'complete' : 'error', error: error || undefined } : message);
      if (!turn && state === 'done') messages.push({ id: randomUUID(), role: 'assistant', text: reply.text, status: 'complete', model: reply.model, ...(typeof reply.modelId === 'string' ? { modelId: reply.modelId.slice(0, 80) } : {}), reasoningEffort: reply.reasoningEffort, ...files, ...(usage ? { usage: { input: usage.input, output: usage.output } } : {}), createdAt: now() });
      else if (!turn && files.attachments) messages.push({ id: randomUUID(), role: 'assistant', text: 'Estes arquivos ficaram prontos antes da interrupção.', status: 'complete', ...files, createdAt: now() });
      if (!turn) this.putBot({ ...bot, ...(reply?.codexSessionId ? { codexSessionId: reply.codexSessionId } : {}), updatedAt: now(), messages });
      if (usage) this.run('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), bot.id, id, bot.provider || 'codex', reply.model || null, usage.input, usage.cached, usage.output, now());
      if (reply?.limits && ['codex', 'claude'].includes(bot.provider || 'codex')) this.setLimits(bot.provider || 'codex', reply.limits);
      // What each Claude alias resolves to now, so the model picker can say "Claude Opus 5.5".
      if (state === 'done' && bot.provider === 'claude' && typeof reply.modelId === 'string' && /^[a-z]{1,20}$/.test(reply.model || '')) this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'claude.model.' + reply.model, reply.modelId.slice(0, 80));
      this.run('UPDATE tasks SET state=?,error=?,worker_pid=NULL,worker_start=NULL,updated_at=? WHERE id=?', state, error, now(), id);
      this.event(id, state);
    });
  }
}
