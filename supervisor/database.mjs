import { uuid } from './validation.mjs';
import { checkNote, saveNote, PERSON_NOTE, PERSON_TITLE, writePersonNote } from './notes.mjs';
import { PROVIDER_NAMES } from '../lib/models.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { costOf } from '../lib/pricing.mjs';
import { validateProfile, browserMode, TOOL_DEFINITIONS, toolArguments } from './tool-policy.mjs';
import { validateBackup, mergeBotLists, deleteLocalBot, defaultBotAccess, validGoogleAccount } from '../mobile/local.js';

export const now = () => new Date().toISOString();
// An IA's session: Codex, Claude and Antigravity use a UUID; opencode, "ses_" and letters/digits.
export const sessionId = value => uuid(value) || (typeof value === 'string' && /^ses_[A-Za-z0-9]{8,60}$/.test(value));
export { uuid };
const ACTIVE = ['queued', 'running', 'waiting_approval'];
// The two kinds of conversation: a bot's private chat and a room. Both are read in pages by rowid and only appended to.
const CHATS = { bot: ['messages', 'bot_id'], room: ['room_messages', 'room_id'] };
const parse = row => JSON.parse(row.body);
// What a conversation list needs of the latest message, without its whole text or files.
const preview = message => message && { id: message.id, role: message.role, status: message.status, text: String(message.text || '').slice(0, 280), createdAt: message.createdAt,
  ...Object.fromEntries(['botId', 'origin', 'routineTitle', 'progress', 'error'].filter(key => message[key] !== undefined).map(key => [key, key === 'error' ? String(message.error).slice(0, 200) : message[key]])),
  ...(message.attachments?.length ? { attachments: message.attachments.slice(0, 1).map(item => ({ name: item.name })) } : {}) };

const blank = () => ({ input: 0, cached: 0, output: 0, turns: 0 });
const money = () => ({ today: 0, week: 0, month: 0 });
// Token counts as the IA reported them for one reply (Codex turn.completed, Claude result.usage).
function tokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const count = value => Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1e9) : 0;
  const result = { input: count(usage.input), cached: count(usage.cached), output: count(usage.output) };
  return result.input || result.output ? result : null;
}

/**
 * What the change log tracks, for the two devices (phone and computer) to share later: table -> its key column, an optional
 * row filter, and where the row's own "last edited" time is. Everything else stays on its device: tasks and their events,
 * IA sessions, approvals, activity, notifications, heartbeats, connectors, usage, the browser's steps and downloads,
 * negotiations, skills (files on disk), pairing and node data. Grants are logged but never applied from the other device:
 * what a bot may do is decided on each device.
 */
export const SYNCED = {
  bots: { key: 'id', at: "json_extract(body,'$.updatedAt')" },
  messages: { key: 'id', at: "json_extract(body,'$.createdAt')" },
  memory: { key: 'id', at: 'updated_at' },
  notes: { key: 'path', at: 'updated_at' },
  grants: { key: 'id' },
  rooms: { key: 'id', at: 'updated_at' },
  room_messages: { key: 'id', at: 'created_at' },
  // A routine's schedule fields change at every run; only its content and on/off state are shared.
  routines: { key: 'id', at: 'updated_at', updateOf: 'body, enabled, bot_id' },
  pending_items: { key: 'id', at: 'created_at' },
  // The tables every bot reads and writes, and the person's decisions (shared-data.mjs).
  shared_rows: { key: 'id', at: 'updated_at' },
  decisions: { key: 'id', at: 'updated_at' },
  // The team's canvas: cards and the links between them (canvas.mjs).
  canvas_items: { key: 'id', at: 'updated_at' },
  attachments: { key: 'id', at: 'created_at' },
  // The person's own settings; limits, models, queue pauses and link data are per device.
  metadata: { key: 'key', where: "(key IN ('person.name','person.theme','person.chief','person.profile','google.accounts','time_zone') OR key LIKE 'chat.session.%' OR key LIKE 'budget.%' OR key LIKE 'table.access.%')" }
};
const EPOCH = '1970-01-01T00:00:00.000Z';
export const SCHEMA = 22;
// Per conversation of a bot (its private chat, or one room): when its current IA session began, and the summary for the next one.
const sinceKey = (botId, roomId) => 'session.since.' + (roomId ? roomId + '.' : '') + botId;
const handoffKey = (botId, roomId) => 'session.handoff.' + (roomId ? roomId + '.' : '') + botId;
export const HANDOFF_CHARS = 6000;

export class Database {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.directory = directory;
    this.db = new DatabaseSync(join(directory, 'mybots.db'));
    chmodSync(join(directory, 'mybots.db'), 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.get('PRAGMA user_version').user_version;
    if (version > SCHEMA) { this.db.close(); throw new Error('O banco foi criado por uma versão mais recente do MyBots.'); }
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
    // Skills: small programs a bot made that run on the phone without the IA (code and manifest in body).
    if (version < 7) this.transaction(() => {
      this.db.exec(`CREATE TABLE skills (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL);
        PRAGMA user_version=7;`);
    });
    // Files the person sends to a room: kept once, readable by whoever is a member of that room.
    if (version < 8) this.transaction(() => {
      this.db.exec(`CREATE TABLE room_files (attachment_id TEXT NOT NULL, room_id TEXT NOT NULL, PRIMARY KEY (attachment_id, room_id));
        CREATE INDEX room_files_room ON room_files(room_id);
        PRAGMA user_version=8;`);
    });
    // Room messages leave the room's JSON body: appending one no longer rewrites the whole room, and there is no cap.
    // An SQLite index ends with the rowid, so room_messages_room (like messages_bot) is the (room_id, rowid) order.
    // Read marks start at the current end, so updating does not show every old message as unread.
    if (version < 9) this.transaction(() => {
      this.db.exec(`CREATE TABLE room_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX room_messages_room ON room_messages(room_id);`);
      for (const row of this.all('SELECT id,body FROM rooms')) {
        const { messages = [], earlier, ...room } = JSON.parse(row.body);
        for (const message of messages) if (typeof message?.id === 'string') this.run('INSERT OR IGNORE INTO room_messages(id,room_id,body,created_at) VALUES(?,?,?,?)', message.id, row.id, JSON.stringify(message), message.createdAt || room.updatedAt || now());
        this.run('UPDATE rooms SET body=? WHERE id=?', JSON.stringify(room), row.id);
      }
      for (const row of [...this.all('SELECT bot_id AS id, max(rowid) AS last FROM messages GROUP BY bot_id'), ...this.all('SELECT room_id AS id, max(rowid) AS last FROM room_messages GROUP BY room_id')])
        this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'read.' + row.id, String(row.last));
      this.db.exec('PRAGMA user_version=9;');
    });
    // The browser's timeline (each step of a bot with a small picture of the page) and the downloads of the phone's browser.
    if (version < 10) this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS browser_steps (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, task_id TEXT, caption TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, image BLOB, width INTEGER, height INTEGER, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS browser_steps_bot ON browser_steps(bot_id);
        CREATE TABLE IF NOT EXISTS browser_downloads (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, place TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, attachment_id TEXT, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS browser_downloads_bot ON browser_downloads(bot_id);
        PRAGMA user_version=10;`);
    });
    // Negotiation mandates (what a bot may offer, buy or sell, and until when) and every offer made or received under them.
    if (version < 11) this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS negotiations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, deadline TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS negotiations_bot ON negotiations(bot_id, status);
        CREATE TABLE IF NOT EXISTS negotiation_offers (id TEXT PRIMARY KEY, negotiation_id TEXT NOT NULL REFERENCES negotiations(id), body TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS negotiation_offers_negotiation ON negotiation_offers(negotiation_id, created_at);
        PRAGMA user_version=11;`);
    });
    // Full-text search over every conversation: one FTS5 index per message table, keyed by the message's rowid and kept by triggers.
    // The backfill clears the index first, so running it again (the migration tests lower user_version) never duplicates rows.
    if (version < 12) this.transaction(() => {
      for (const [table, fts] of [['messages', 'messages_fts'], ['room_messages', 'room_messages_fts']]) {
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${fts} USING fts5(text, tokenize='unicode61 remove_diacritics 2');
          CREATE TRIGGER IF NOT EXISTS ${table}_fts_insert AFTER INSERT ON ${table} BEGIN INSERT INTO ${fts}(rowid,text) VALUES(new.rowid, coalesce(json_extract(new.body,'$.text'),'')); END;
          CREATE TRIGGER IF NOT EXISTS ${table}_fts_update AFTER UPDATE OF body ON ${table} BEGIN UPDATE ${fts} SET text=coalesce(json_extract(new.body,'$.text'),'') WHERE rowid=new.rowid; END;
          CREATE TRIGGER IF NOT EXISTS ${table}_fts_delete AFTER DELETE ON ${table} BEGIN DELETE FROM ${fts} WHERE rowid=old.rowid; END;
          DELETE FROM ${fts};
          INSERT INTO ${fts}(rowid,text) SELECT rowid, coalesce(json_extract(body,'$.text'),'') FROM ${table};`);
      }
      this.db.exec('PRAGMA user_version=12;');
    });
    // Change log: every write to a synced table leaves one line (table, key, a counter that only grows on this device, the
    // time, whether it was a deletion). One line per row: a newer write replaces the older one. The row's content is read
    // when someone asks for the changes, so the log stays small. Triggers do the logging, so no code path can forget it.
    if (version < 14) this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK(id=1), device TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, applying INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS changes (tbl TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, lamport INTEGER NOT NULL, origin TEXT NOT NULL, at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tbl, key));
        CREATE INDEX IF NOT EXISTS changes_seq ON changes(seq);`);
      this.run('INSERT OR IGNORE INTO sync_state(id,device,counter,applying) VALUES(1,?,0,0)', randomUUID());
      for (const [table, spec] of Object.entries(SYNCED)) {
        if (!['notes', 'shared_rows', 'decisions', 'canvas_items'].includes(table)) this.installSyncLog(table, spec);   // these are made (and logged) by later versions
      }
      this.db.exec('PRAGMA user_version=14;');
    });
    if (version < 15) this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, bot_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('chefe','entrega','arquivo')), title TEXT NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
      this.installSyncLog('notes', SYNCED.notes);
      this.db.exec('PRAGMA user_version=15;');
    });
    if (version < 16) this.transaction(() => {
      this.installSyncLog('metadata', SYNCED.metadata);
      this.db.exec('PRAGMA user_version=16;');
    });
    // How big the IA session's prompt was at the reply's last model call (null when the IA did not say).
    if (version < 17) this.transaction(() => {
      if (!this.all("SELECT name FROM pragma_table_info('usage')").some(column => column.name === 'context')) this.db.exec('ALTER TABLE usage ADD COLUMN context INTEGER;');
      this.db.exec('PRAGMA user_version=17;');
    });
    // Shared tables (rows with columns that every bot reads and writes) and the person's decisions, both synced.
    if (version < 18) this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS shared_rows (id TEXT PRIMARY KEY, tbl TEXT NOT NULL, body TEXT NOT NULL, bot_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS shared_rows_tbl ON shared_rows(tbl, created_at);
        CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS decisions_bot ON decisions(bot_id, state);`);
      this.installSyncLog('shared_rows', SYNCED.shared_rows); this.installSyncLog('decisions', SYNCED.decisions);
      this.db.exec('PRAGMA user_version=18;');
    });
    // The person's profile (person.profile) joins the synced settings.
    if (version < 19) this.transaction(() => {
      this.installSyncLog('metadata', SYNCED.metadata);
      this.db.exec('PRAGMA user_version=19;');
    });
    // Spending limits per bot (budget.<id>) and who reads and writes each shared table (table.access.<name>) join the synced settings.
    if (version < 20) this.transaction(() => {
      this.installSyncLog('metadata', SYNCED.metadata);
      this.db.exec('PRAGMA user_version=20;');
    });
    // The team's canvas (it replaces the 3D office): cards the bots leave and the links between them, synced.
    if (version < 21) this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS canvas_items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, bot_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
      this.installSyncLog('canvas_items', SYNCED.canvas_items);
      this.db.exec('PRAGMA user_version=21;');
    });
    // The person's profile leaves the settings and becomes the note "Você" (chefe/voce.md) at the center of the memory map.
    if (version < 22) this.transaction(() => {
      const profile = this.get("SELECT value FROM metadata WHERE key='person.profile'")?.value;
      // Created when there is something to put in it; until then the Memória's "Você" button opens it to be written.
      if (profile && !this.get('SELECT 1 FROM notes WHERE path=?', PERSON_NOTE)) {
        const at = new Date().toISOString();
        this.run('INSERT INTO notes(path,bot_id,kind,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', PERSON_NOTE, null, 'chefe', PERSON_TITLE, profile, at, at);
      }
      this.run("DELETE FROM metadata WHERE key='person.profile'");
      this.db.exec('PRAGMA user_version=22;');
    });
  }
  installSyncLog(table, spec) {
    const filter = spec.where ? ` AND ${spec.where}` : '';
    const touch = (row, deleted) => `UPDATE sync_state SET counter=counter+1 WHERE id=1 AND applying=0;
      INSERT INTO changes(tbl,key,seq,lamport,origin,at,deleted) SELECT '${table}', ${row}.${spec.key}, counter, counter, device, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ${deleted} FROM sync_state WHERE id=1 AND applying=0
      ON CONFLICT(tbl,key) DO UPDATE SET seq=excluded.seq, lamport=excluded.lamport, origin=excluded.origin, at=excluded.at, deleted=excluded.deleted;`;
    const condition = row => spec.where ? `WHEN ${spec.where.replaceAll(/\bkey\b/g, `${row}.key`)}` : '';
    const only = spec.updateOf ? ` OF ${spec.updateOf}` : '';
    this.db.exec(`DROP TRIGGER IF EXISTS ${table}_log_insert; DROP TRIGGER IF EXISTS ${table}_log_update; DROP TRIGGER IF EXISTS ${table}_log_delete;
      CREATE TRIGGER ${table}_log_insert AFTER INSERT ON ${table} ${condition('new')} BEGIN ${touch('new', 0)} END;
      CREATE TRIGGER ${table}_log_update AFTER UPDATE${only} ON ${table} ${condition('new')} BEGIN ${touch('new', 0)} END;
      CREATE TRIGGER ${table}_log_delete AFTER DELETE ON ${table} ${condition('old')} BEGIN ${touch('old', 1)} END;`);
    // What already exists starts in the log, with its own time when it has one (rows without one count as never edited).
    const base = this.get('SELECT counter FROM sync_state WHERE id=1').counter;
    this.db.exec(`INSERT INTO changes(tbl,key,seq,lamport,origin,at,deleted)
      SELECT '${table}', ${spec.key}, ${base}+row_number() OVER (ORDER BY rowid), ${base}+row_number() OVER (ORDER BY rowid), (SELECT device FROM sync_state WHERE id=1), coalesce(${spec.at || 'NULL'}, '${EPOCH}'), 0
      FROM ${table} WHERE 1=1${filter} AND ${spec.key} NOT IN (SELECT key FROM changes WHERE tbl='${table}')`);
    this.db.exec('UPDATE sync_state SET counter=(SELECT coalesce(max(seq),0) FROM changes) WHERE id=1');
  }
  /** This device's id in the change log and how far its counter has gone. */
  syncState() { const row = this.get('SELECT device, counter FROM sync_state WHERE id=1'); return { device: row.device, counter: row.counter }; }
  /**
   * The changes after a counter value, oldest first, each with the row's current content (or marked deleted).
   * `next` is where the next call continues; `more` says whether there is anything beyond this page.
   */
  changesSince(after = 0, limit = 200, exclude = '') {
    const start = Number.isSafeInteger(after) && after > 0 ? after : 0; const size = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    // `exclude` is the asking device: what it sent us is not sent back.
    const rows = this.all('SELECT tbl,key,seq,lamport,origin,at,deleted FROM changes WHERE seq>? AND origin<>? ORDER BY seq LIMIT ?', start, typeof exclude === 'string' ? exclude : '', size + 1);
    const page = rows.slice(0, size).map(row => {
      const spec = SYNCED[row.tbl]; const data = !row.deleted && spec ? this.get(`SELECT * FROM ${row.tbl} WHERE ${spec.key}=?`, row.key) : null;
      return { table: row.tbl, key: row.key, seq: row.seq, lamport: row.lamport, origin: row.origin, at: row.at, deleted: Boolean(row.deleted) || !data, ...(data ? { data } : {}) };
    });
    const state = this.syncState(); const more = rows.length > size;
    // Past the last page everything up to the counter has been seen (what was left out belongs to the asker), so the cursor can jump there.
    return { ...state, schema: SCHEMA, changes: page, next: more ? page.at(-1).seq : Math.max(start, state.counter), more };
  }
  /**
   * Applies changes that came from the other device. Each record keeps whichever version is newer (time, then Lamport
   * counter, then device id); an older or equal one is skipped. The change is written without logging as ours and its own
   * version is kept in the log, so it never goes back to where it came from. A record edited here and not yet delivered
   * (`delivered` is how far the other device has read our log) that loses to a newer remote one is a conflict: it is
   * recorded in Activity, never lost silently. Never taken from the other device: grants (decided per device), the access
   * level of a bot that exists here, and any bot's Livre level (a new bot arrives at most with Médio).
   */
  applyChanges(changes, { from = '', delivered = 0 } = {}) {
    if (!Array.isArray(changes) || changes.length > 1000) throw new Error('Mudanças inválidas.');
    const me = this.syncState().device; const result = { applied: 0, skipped: 0, conflicts: [], bots: [], chats: [], rooms: [], files: [] };
    const newer = (a, b) => (a.at > b.at) - (a.at < b.at) || (a.lamport - b.lamport) || (a.origin > b.origin) - (a.origin < b.origin);
    const columns = table => (this.columnCache ||= {})[table] ||= this.all(`PRAGMA table_info(${table})`).map(row => row.name);
    const label = table => ({ bots: 'bot', rooms: 'sala', memory: 'memória', notes: 'nota', routines: 'rotina', pending_items: 'pendência', metadata: 'ajuste', attachments: 'anexo' }[table] || table);
    // What a record says apart from the bookkeeping that changes at every write (the edit time).
    const material = row => { try { const body = JSON.parse(row?.body ?? row?.value ?? 'null'); if (body && typeof body === 'object') delete body.updatedAt; return JSON.stringify(body ?? row?.value ?? null); } catch { return String(row?.body ?? row?.value ?? ''); } };
    const name = (table, data) => { try { const body = JSON.parse(data?.body || '{}'); return String(body.name || body.title || body.text || '').slice(0, 60); } catch { return ''; } };
    this.db.exec('PRAGMA foreign_keys=OFF');
    try {
      this.transaction(() => this.withoutLogging(() => {
        for (const change of [...changes].sort((a, b) => a.seq - b.seq)) {
          const spec = SYNCED[change?.table];
          if (!spec || change.table === 'grants' || typeof change.key !== 'string' || !change.key || change.key.length > 200 || !Number.isSafeInteger(change.lamport) || typeof change.at !== 'string' || change.at.length > 40 || typeof change.origin !== 'string' || !change.origin || change.origin.length > 64) { result.skipped++; continue; }
          if (change.table === 'metadata' && change.key === 'person.chief' && !change.deleted && !uuid(change.data?.value)) { result.skipped++; continue; }
          if (change.table === 'notes' && !change.deleted) {
            try { checkNote(change.data); } catch { result.skipped++; continue; }
          }
          if (change.origin === me) { result.skipped++; continue; }
          const remote = { at: change.at, lamport: change.lamport, origin: change.origin };
          const local = this.get('SELECT seq,lamport,origin,at FROM changes WHERE tbl=? AND key=?', change.table, change.key);
          const existing = this.get(`SELECT * FROM ${change.table} WHERE ${spec.key}=?`, change.key);
          // Both sides changed it since they last met (ours is not read by the other side yet) and the content really differs: a conflict, whoever wins.
          const concurrent = Boolean(local && local.origin === me && local.seq > delivered && existing && !['messages', 'room_messages'].includes(change.table) && material(existing) !== material(change.data));
          const note = outcome => {
            if (!concurrent || result.conflicts.length >= 20) return;
            const who = name(change.table, existing) || name(change.table, change.data);
            result.conflicts.push({ table: change.table, key: change.key, name: who });
            this.record('sync_conflict', `Conflito em ${label(change.table)}${who ? ` “${who}”` : ''}: o outro aparelho editou ao mesmo tempo e a versão mais recente ficou (${outcome}).`, change.table === 'bots' ? change.key : null);
          };
          if (local && newer(remote, local) <= 0) { note('a deste aparelho'); result.skipped++; continue; }
          note('a do outro aparelho');
          if (change.deleted) {
            if (existing) this.run(`DELETE FROM ${change.table} WHERE ${spec.key}=?`, change.key);
          } else {
            const data = change.data;
            if (!data || typeof data !== 'object' || data[spec.key] !== change.key) { result.skipped++; continue; }
            let allowed = columns(change.table); if (change.table === 'routines') allowed = ['id', 'bot_id', 'body', 'enabled', 'created_at', 'updated_at'];
            const row = Object.fromEntries(allowed.filter(column => column in data).map(column => [column, data[column]]));
            if (Object.values(row).some(value => value !== null && !['string', 'number'].includes(typeof value) || (typeof value === 'string' && value.length > 6e6))) { result.skipped++; continue; }
            if (change.table === 'bots') {
              try {
                const body = JSON.parse(row.body); const mine = existing ? JSON.parse(existing.body) : null;
                if (mine) { if (mine.access === undefined) delete body.access; else body.access = mine.access; }
                else body.access = body.access === 'basic' ? 'basic' : 'ask';
                row.body = JSON.stringify(body);
              } catch { result.skipped++; continue; }
            }
            const names = Object.keys(row); if (!names.includes(spec.key)) { result.skipped++; continue; }
            const update = names.filter(column => column !== spec.key).map(column => `${column}=excluded.${column}`).join(',');
            this.run(`INSERT INTO ${change.table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')}) ON CONFLICT(${spec.key}) DO ${update ? `UPDATE SET ${update}` : 'NOTHING'}`, ...names.map(column => row[column]));
            if (change.table === 'attachments') result.files.push(change.key);
          }
          // The counter moves past the remote one (Lamport), and the record keeps the version it came with.
          const counter = Math.max(this.syncState().counter, change.lamport) + 1;
          this.run('UPDATE sync_state SET counter=? WHERE id=1', counter);
          this.run('INSERT INTO changes(tbl,key,seq,lamport,origin,at,deleted) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tbl,key) DO UPDATE SET seq=excluded.seq, lamport=excluded.lamport, origin=excluded.origin, at=excluded.at, deleted=excluded.deleted',
            change.table, change.key, counter, change.lamport, change.origin, change.at, change.deleted ? 1 : 0);
          if (change.table === 'notes') this.notify('notes.changed', { path: change.key });
          if (change.table === 'canvas_items') result.canvas = true;
          result.applied++;
          if (change.table === 'metadata' && change.key === 'person.chief') {
            for (const id of [existing?.value, change.deleted ? null : change.data.value]) {
              if (id && this.bot(id) && !result.bots.includes(id)) result.bots.push(id);
            }
          }
          const botId = change.table === 'bots' ? change.key : change.table === 'messages' || change.table === 'memory' ? (change.data?.bot_id || existing?.bot_id) : null;
          if (botId) { if (!result.bots.includes(botId)) result.bots.push(botId); if (change.table === 'messages' && !result.chats.includes(botId)) result.chats.push(botId); }
          if (change.table === 'room_messages' || change.table === 'rooms') { const roomId = change.table === 'rooms' ? change.key : (change.data?.room_id || existing?.room_id); if (roomId && !result.rooms.includes(roomId)) result.rooms.push(roomId); }
        }
      }));
    } finally { this.db.exec('PRAGMA foreign_keys=ON'); }
    // Open screens reload what changed.
    for (const botId of result.chats) this.notify('chat.reset', { botId });
    for (const roomId of result.rooms) this.notify('chat.reset', { roomId });
    if (result.canvas) this.notify('canvas.changed', {});
    for (const botId of result.bots) if (!result.chats.includes(botId)) this.notify('bot.updated', { botId });
    if (result.applied) this.notify('connection.changed', {});
    return result;
  }
  /** Runs work whose writes must not enter the change log (changes arriving from the other device, so they do not bounce back). */
  withoutLogging(work) {
    this.run('UPDATE sync_state SET applying=1 WHERE id=1');
    try { return work(); } finally { this.run('UPDATE sync_state SET applying=0 WHERE id=1'); }
  }
  /** One step of a bot in its browser, kept with a small picture; only the latest 120 of each bot stay. */
  addBrowserStep(botId, taskId, { caption, url = '', title = '', image = null, width = null, height = null }) {
    const step = { id: randomUUID(), botId, taskId: taskId || null, caption: String(caption).slice(0, 120), url: String(url).slice(0, 500), title: String(title).slice(0, 200), width, height, at: now() };
    this.transaction(() => {
      this.run('INSERT INTO browser_steps VALUES(?,?,?,?,?,?,?,?,?,?)', step.id, botId, step.taskId, step.caption, step.url, step.title, image, width, height, step.at);
      this.run('DELETE FROM browser_steps WHERE bot_id=? AND rowid <= (SELECT rowid FROM browser_steps WHERE bot_id=? ORDER BY rowid DESC LIMIT 1 OFFSET 120)', botId, botId);
    });
    return { ...step, image: Boolean(image) };
  }
  /** The latest steps of a bot, oldest first; `before` (a step id) pages back. */
  browserSteps(botId, { before, limit = 40 } = {}) {
    const cursor = before ? this.get('SELECT rowid FROM browser_steps WHERE id=? AND bot_id=?', before, botId)?.rowid : null;
    const rows = this.all(`SELECT id,bot_id,task_id,caption,url,title,width,height,created_at,image IS NOT NULL AS has_image FROM browser_steps WHERE bot_id=?${cursor ? ' AND rowid<?' : ''} ORDER BY rowid DESC LIMIT ?`, botId, ...(cursor ? [cursor] : []), Math.max(1, Math.min(120, Number(limit) || 40)));
    return rows.reverse().map(row => ({ id: row.id, botId: row.bot_id, taskId: row.task_id, caption: row.caption, url: row.url, title: row.title, width: row.width, height: row.height, at: row.created_at, image: Boolean(row.has_image) }));
  }
  browserStepImage(id) { const row = this.get('SELECT bot_id,image FROM browser_steps WHERE id=?', id); return row?.image ? { botId: row.bot_id, image: Buffer.from(row.image).toString('base64') } : null; }
  /** Changes are told to the listener (the supervisor's broadcast) only after their transaction commits. */
  listen(listener) { this.listener = listener; }
  notify(event, data) {
    if (this.depth) (this.pending ||= []).push([event, data]);
    else try { this.listener?.(event, data); } catch {}
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
  // Rooms (the bots' group conversations): one JSON body with the name and members; the messages are rows of room_messages.
  room(id) { const row = uuid(id) ? this.get('SELECT body FROM rooms WHERE id=?', id) : null; return row ? JSON.parse(row.body) : null; }
  rooms() { return this.all('SELECT body FROM rooms ORDER BY updated_at DESC').map(row => JSON.parse(row.body)); }
  requireRoom(id) { const room = this.room(id); if (!room || room.deletedAt) throw new Error('Sala não encontrada.'); return room; }
  putRoom(room) { const { messages, earlier, ...body } = room; this.run('INSERT INTO rooms(id,body,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at', room.id, JSON.stringify(body), room.updatedAt); }
  /** A new line in a room; the room moves to the top of the list. */
  appendRoomMessage(roomId, message) {
    const room = this.room(roomId); if (!room) return null;
    this.run('INSERT INTO room_messages(id,room_id,body,created_at) VALUES(?,?,?,?)', message.id, roomId, JSON.stringify(message), message.createdAt);
    this.putRoom({ ...room, updatedAt: message.createdAt });
    this.notify('message.added', { roomId, message });
    return message;
  }
  roomMessages(roomId) { return this.all('SELECT body FROM room_messages WHERE room_id=? ORDER BY rowid', roomId).map(parse); }
  replaceRoomMessages(roomId, messages) {
    this.run('DELETE FROM room_messages WHERE room_id=?', roomId);
    for (const message of messages) this.run('INSERT OR IGNORE INTO room_messages(id,room_id,body,created_at) VALUES(?,?,?,?)', message.id, roomId, JSON.stringify(message), message.createdAt || now());
    this.notify('chat.reset', { roomId });
  }
  roomTurn(taskId) { return this.get('SELECT * FROM room_turns WHERE task_id=?', taskId); }
  roomSession(roomId, botId) { return this.get('SELECT session_id FROM room_sessions WHERE room_id=? AND bot_id=?', roomId, botId)?.session_id; }
  setRoomSession(roomId, botId, id) {
    if (!sessionId(id)) throw new Error('Sessão inválida.');
    this.run('INSERT INTO room_sessions VALUES(?,?,?,?) ON CONFLICT(room_id, bot_id) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at', roomId, botId, id, now());
  }
  /** A bot's answer in a room becomes a message of the room (or an error line), never of its private chat. */
  roomReply(turn, bot, state, reply, error, files, usage) {
    const room = this.room(turn.room_id); if (!room) return;
    const stamp = now();
    const message = state === 'done'
      ? { id: randomUUID(), role: 'assistant', botId: bot.id, text: reply.text, status: 'complete', model: reply.model, ...(reply.fallback ? { fallback: true } : {}), ...(typeof reply.modelId === 'string' ? { modelId: reply.modelId.slice(0, 80) } : {}), reasoningEffort: reply.reasoningEffort, ...files, ...(usage ? { usage: { input: usage.input, output: usage.output } } : {}), replyTo: turn.message_id, createdAt: stamp }
      : { id: randomUUID(), role: 'assistant', botId: bot.id, text: files.attachments ? 'Estes arquivos ficaram prontos antes da interrupção.' : '', status: 'error', error: error || 'A resposta não foi concluída.', ...files, replyTo: turn.message_id, createdAt: stamp };
    if (state === 'done' && reply?.codexSessionId) this.setRoomSession(room.id, bot.id, reply.codexSessionId);
    this.appendRoomMessage(room.id, message);
  }
  /** Something the bot says while it still works: a message in its chat (or room) before the final reply. */
  progressMessage(taskId, text) {
    const task = this.task(taskId);
    if (!task || !ACTIVE.includes(task.state) || typeof text !== 'string' || !text.trim()) return;
    const stamp = now(); const turn = this.roomTurn(taskId);
    const message = { id: randomUUID(), role: 'assistant', text: text.trim().slice(0, 4000), status: 'complete', progress: true, createdAt: stamp };
    this.transaction(() => {
      if (turn) this.appendRoomMessage(turn.room_id, { ...message, botId: task.bot_id, replyTo: turn.message_id });
      else { this.appendMessage(task.bot_id, message); this.putBot({ ...this.bot(task.bot_id), updatedAt: stamp }); }
    });
  }
  /** How the person wants to be called (home-screen greeting) and the look they chose (dark, light or the system's). */
  googleAccounts() {
    try { const saved = JSON.parse(this.get("SELECT value FROM metadata WHERE key='google.accounts'")?.value || '[]'); return Array.isArray(saved) ? saved.filter(validGoogleAccount) : []; } catch { return []; }
  }
  addGoogleAccount(account) {
    if (!validGoogleAccount(account)) throw new Error('Informe o e-mail da conta Google.');
    const accounts = [...new Set([...this.googleAccounts(), account.trim().toLowerCase()])];
    if (accounts.length > 50) throw new Error('Use até 50 contas Google.');
    this.run("INSERT INTO metadata VALUES('google.accounts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(accounts));
    return accounts;
  }
  setPhoneControl(id, on) {
    if (typeof on !== 'boolean') throw new Error('Escolha se o bot pode controlar o celular.');
    const bot = { ...this.requireBot(id), phoneControl: on, updatedAt: now() };
    this.transaction(() => { this.putBot(bot); this.run('DELETE FROM codex_sessions WHERE bot_id=?', id); this.run('DELETE FROM room_sessions WHERE bot_id=?', id); this.record('grant_changed', `Controle do celular: ${on ? 'ligado' : 'desligado'}.`, id); });
    return bot;
  }
  /** Monthly spending limits per bot, in dollars (estimated cost, like the usage screen). */
  budgets() { return Object.fromEntries(this.all("SELECT key, value FROM metadata WHERE key LIKE 'budget.%' AND key NOT LIKE 'budget.warned.%'").map(row => [row.key.slice(7), Number(row.value)])); }
  setBudget(botId, usd) {
    this.requireBot(botId);
    if (usd === null || usd === undefined || usd === '') { this.run('DELETE FROM metadata WHERE key=?', 'budget.' + botId); return this.budgets(); }
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > 100000) throw new Error('O limite é um valor em dólares maior que zero.');
    this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'budget.' + botId, String(Math.round(usd * 100) / 100));
    return this.budgets();
  }
  person() {
    const theme = this.get("SELECT value FROM metadata WHERE key='person.theme'")?.value;
    // The note "Você"; a profile synced from a device that has not moved it to the note yet still counts until it does.
    const profile = this.get('SELECT body FROM notes WHERE path=?', PERSON_NOTE)?.body ?? this.get("SELECT value FROM metadata WHERE key='person.profile'")?.value;
    return { name: this.get("SELECT value FROM metadata WHERE key='person.name'")?.value || '', ...(theme ? { theme } : {}), ...(profile ? { profile } : {}) };
  }
  setPerson({ name, theme, profile, botId } = {}) {
    // The person's note "Você": data and preferences every bot reads (never passwords, keys or cards).
    if (profile !== undefined) {
      if (typeof profile !== 'string' || /\u0000/.test(profile)) throw new Error('Texto inválido para a nota Você.');
      if (/(senha|password|cvv|token|chave\s*(pix|api|privada))\s*[:=]/i.test(profile)) throw new Error('A nota Você é lida por todos os bots: tire senhas, chaves e dados de cartão dela.');
      this.transaction(() => { writePersonNote(this, profile.trim(), { botId: botId ?? null }); this.run("DELETE FROM metadata WHERE key='person.profile'"); });
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length > 40 || /[\u0000-\u001f]/.test(name)) throw new Error('Use um nome de até 40 letras.');
      const clean = name.trim().replace(/\s+/g, ' ');
      if (clean) this.run("INSERT INTO metadata VALUES('person.name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", clean);
      else this.run("DELETE FROM metadata WHERE key='person.name'");
    }
    if (theme !== undefined) {
      if (!['dark', 'light', 'system'].includes(theme)) throw new Error('Escolha escuro, claro ou o do sistema.');
      this.run("INSERT INTO metadata VALUES('person.theme',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", theme);
    }
    return this.person();
  }
  /** The plan's usage windows (5 hours, week) as the IA last reported them. */
  setLimits(provider, limits) {
    const windows = Array.isArray(limits?.windows) ? limits.windows.filter(item => Number.isFinite(item?.used)).slice(0, 4).map(item => ({ key: String(item.key).slice(0, 20), used: Math.max(0, Math.min(100, Math.round(item.used))), resetsAt: Number.isFinite(item.resetsAt) ? new Date(item.resetsAt).toISOString() : null })) : [];
    if (!windows.length) return;
    this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'limits.' + provider, JSON.stringify({ plan: typeof limits.plan === 'string' ? limits.plan.slice(0, 30) : null, windows, checkedAt: now() }));
  }
  limits() { return Object.fromEntries(['codex', 'claude'].map(provider => [provider, JSON.parse(this.get('SELECT value FROM metadata WHERE key=?', 'limits.' + provider)?.value || 'null')]).filter(([, value]) => value)); }
  /** Tokens per bot (today, 7 and 30 days) and per day for the last week, from the replies' usage; `cost` is the API-equivalent estimate in USD. */
  usage(days = 7) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString(); const day = new Date(); day.setHours(0, 0, 0, 0);
    const week = new Date(day.getTime() - (days - 1) * 86400000);
    const bots = {}; const daily = new Map(); const dailyCost = new Map();
    for (const row of this.all('SELECT bot_id,provider,model,input,cached,output,created_at FROM usage WHERE created_at>=?', since)) {
      const at = Date.parse(row.created_at); const add = (target) => { target.input += row.input; target.cached += row.cached; target.output += row.output; target.turns += 1; };
      const cost = costOf(row);
      const entry = bots[row.bot_id] ||= { today: blank(), week: blank(), month: blank(), provider: row.provider, cost: money() };
      add(entry.month); entry.cost.month += cost; if (at >= week.getTime()) { add(entry.week); entry.cost.week += cost; } if (at >= day.getTime()) { add(entry.today); entry.cost.today += cost; }
      if (at >= week.getTime()) { const key = new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 10); add(daily.get(key) || daily.set(key, blank()).get(key)); dailyCost.set(key, (dailyCost.get(key) || 0) + cost); }
    }
    const series = [...Array(days)].map((_, index) => { const date = new Date(week.getTime() + index * 86400000); const key = new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return { date: key, ...(daily.get(key) || blank()), cost: dailyCost.get(key) || 0 }; })
    return { bots, days: series, limits: this.limits() };
  }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(work) {
    // Nested calls join the outer transaction, so composed writes (a routine run and its task) commit together.
    if (this.depth) return work();
    this.db.exec('BEGIN IMMEDIATE'); this.depth = 1;
    let result;
    try { result = work(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); this.pending = null; throw error; }
    finally { this.depth = 0; }
    const pending = this.pending || []; this.pending = null;
    for (const [event, data] of pending) this.notify(event, data);
    return result;
  }
  close() { this.db.close(); }
  /** A bot's profile, without its messages (those are read by page, or whole with messages()). */
  bot(id) {
    const row = this.get("SELECT body, id=(SELECT value FROM metadata WHERE key='person.chief') AS chief FROM bots WHERE id=?", id);
    if (!row) return null;
    const stored = JSON.parse(row.body);
    if (stored.phoneControl === undefined && stored.access === 'free' && this.get('SELECT body FROM grants WHERE bot_id=? AND tool=?', id, 'phone')?.body === 'false') stored.phoneControl = false;
    const bot = defaultBotAccess(stored);
    bot.isChief = Boolean(row.chief && !bot.deletedAt);
    bot.browserMode = browserMode(bot); delete bot.mainChrome; delete bot.messages;
    const session = this.get('SELECT session_id FROM codex_sessions WHERE bot_id=?', id);
    if (session) bot.codexSessionId = session.session_id;
    return bot;
  }
  bots() { return this.all('SELECT id FROM bots').map(row => this.bot(row.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  teamStatus() {
    const bots = this.all("SELECT id,json_extract(body,'$.name') AS name FROM bots WHERE json_extract(body,'$.deletedAt') IS NULL ORDER BY name,id");
    return { bots: bots.map(bot => {
      const openItems = this.all(`SELECT json_extract(body,'$.title') AS title,json_extract(body,'$.due') AS due,COUNT(*) OVER() AS total
        FROM pending_items WHERE bot_id=? AND state='open' ORDER BY due IS NULL,due,created_at,id LIMIT 50`, bot.id);
      const routines = this.all(`SELECT json_extract(body,'$.title') AS title,enabled,next_run_at AS nextRunAt,last_run_at AS lastRunAt,last_result AS lastResult
        FROM routines WHERE bot_id=? ORDER BY created_at,id`, bot.id);
      const tasks = this.all("SELECT state,COUNT(*) AS count FROM tasks WHERE bot_id=? AND state IN ('queued','running','waiting_approval') GROUP BY state", bot.id);
      const lastActivity = this.get('SELECT kind,created_at AS at FROM activity WHERE bot_id=? ORDER BY id DESC LIMIT 1', bot.id) || null;
      return { ...bot, activeTasks: Object.fromEntries(tasks.map(row => [row.state, row.count])), openItemCount: openItems[0]?.total || 0,
        openItems: openItems.map(({ title, due }) => ({ title, due })), routines: routines.map(row => ({ ...row, enabled: Boolean(row.enabled) })), lastActivity };
    }), untrusted: true };
  }
  /** The bot with its whole conversation: for backups and the rare operations that rewrite it. */
  fullBot(id) { const bot = this.bot(id); return bot && { ...bot, messages: this.messages(id) }; }
  messages(botId) { return this.all('SELECT body FROM messages WHERE bot_id=? ORDER BY rowid', botId).map(parse); }
  /** One message of a private chat or a room, by id. */
  message(id) { const row = this.get('SELECT body FROM messages WHERE id=?', id) || this.get('SELECT body FROM room_messages WHERE id=?', id); return row ? parse(row) : null; }
  /** The latest message of a bot's chat said by `role` (the reply a routine run produced). */
  latest(botId, role) { const row = this.get("SELECT body FROM messages WHERE bot_id=? AND json_extract(body,'$.role')=? ORDER BY rowid DESC LIMIT 1", botId, role); return row ? parse(row) : null; }
  /** A new message at the end of a bot's chat: one insert, whatever the size of the conversation. */
  appendMessage(botId, message) {
    // The Chefe's conversation is split in sessions: every message carries the one it belongs to (none before sessions began).
    const session = message.session === undefined ? this.chatSession(botId) : null;
    if (session) message = { ...message, session };
    this.run('INSERT INTO messages(id,bot_id,body) VALUES(?,?,?)', message.id, botId, JSON.stringify(message));
    this.notify('message.added', { botId, message });
    return message;
  }
  /** Changes fields of one message of a bot's chat (undefined removes a field). */
  updateMessage(id, patch) {
    const row = this.get('SELECT bot_id,body FROM messages WHERE id=?', id); if (!row) return null;
    const message = { ...parse(row), ...patch };
    for (const key of Object.keys(message)) if (message[key] === undefined) delete message[key];
    this.run('UPDATE messages SET body=? WHERE id=?', JSON.stringify(message), id);
    this.notify('message.updated', { botId: row.bot_id, message });
    return message;
  }
  /** Rewrites a whole chat: restoring, merging or deleting a bot, never for a new message. */
  replaceMessages(botId, messages) {
    this.run('DELETE FROM messages WHERE bot_id=?', botId);
    for (const message of messages) this.run('INSERT INTO messages(id,bot_id,body) VALUES(?,?,?)', message.id, botId, JSON.stringify(message));
    this.notify('chat.reset', { botId });
  }
  /**
   * Search across every private chat and room: each word of `query` must appear (the last one as a prefix; accents and case ignored).
   * Best matches first; `botId`/`roomId` narrow it to one conversation and `pinned` keeps only pinned messages.
   */
  search({ query, botId, roomId, pinned = false, limit = 30 } = {}) {
    const words = String(query ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) || [];
    const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 30;
    const match = words.map((word, index) => `"${word}"${index === words.length - 1 ? '*' : ''}`).join(' ');
    const found = [];
    for (const [kind, [table, column]] of Object.entries(CHATS)) {
      if (kind === 'bot' ? roomId !== undefined : botId !== undefined) continue;
      const owner = kind === 'bot' ? botId : roomId;
      const where = [owner !== undefined ? `m.${column}=@owner` : '', pinned ? "json_extract(m.body,'$.pinned')=1" : '', match ? `${table}_fts MATCH @match` : ''].filter(Boolean);
      if (!match && !pinned) return { results: [] };
      const sql = match
        ? `SELECT m.${column} AS owner, m.body, bm25(${table}_fts) AS rank, snippet(${table}_fts,0,'','','…',24) AS snippet FROM ${table}_fts JOIN ${table} m ON m.rowid=${table}_fts.rowid WHERE ${where.join(' AND ')} ORDER BY rank LIMIT @size`
        : `SELECT m.${column} AS owner, m.body, 0 AS rank, '' AS snippet FROM ${table} m WHERE ${where.join(' AND ')} ORDER BY m.rowid DESC LIMIT @size`;
      const params = { size, ...(owner !== undefined ? { owner } : {}), ...(match ? { match } : {}) };
      for (const row of this.db.prepare(sql).all(params)) { const message = parse(row); found.push({ kind, ownerId: row.owner, rank: row.rank, message: { id: message.id, role: message.role, botId: message.botId, text: String(message.text || '').slice(0, 280), createdAt: message.createdAt, pinned: message.pinned === true }, snippet: row.snippet || String(message.text || '').slice(0, 120) }); }
    }
    found.sort((a, b) => a.rank - b.rank || String(b.message.createdAt).localeCompare(String(a.message.createdAt)));
    return { results: found.slice(0, size) };
  }
  /** Pins or unpins one message of a chat or a room. */
  pinMessage(id, pinned) {
    const row = this.get('SELECT bot_id,body FROM messages WHERE id=?', id);
    if (row) return this.updateMessage(id, { pinned: pinned ? true : undefined });
    const room = this.get('SELECT room_id,body FROM room_messages WHERE id=?', id); if (!room) throw new Error('Mensagem não encontrada.');
    const message = { ...parse(room), pinned: pinned ? true : undefined }; if (!pinned) delete message.pinned;
    this.run('UPDATE room_messages SET body=? WHERE id=?', JSON.stringify(message), id);
    this.notify('message.updated', { roomId: room.room_id, message });
    return message;
  }
  /**
   * A page of a conversation, oldest first: the `limit` messages before the rowid `before` (or the latest ones).
   * `before` of the answer is the cursor for the next older page; `more` says whether there is one.
   */
  page({ botId, roomId, before, limit = 40 } = {}) {
    const [table, column] = botId !== undefined ? CHATS.bot : CHATS.room; const owner = botId ?? roomId;
    if (before !== undefined && before !== null && (!Number.isSafeInteger(before) || before < 1)) throw new Error('Página inválida.');
    const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 40;
    const rows = before ? this.all(`SELECT rowid,body FROM ${table} WHERE ${column}=? AND rowid<? ORDER BY rowid DESC LIMIT ?`, owner, before, size + 1)
      : this.all(`SELECT rowid,body FROM ${table} WHERE ${column}=? ORDER BY rowid DESC LIMIT ?`, owner, size + 1);
    const kept = rows.slice(0, size).reverse();
    return { messages: kept.map(parse), before: kept[0]?.rowid ?? null, more: rows.length > size };
  }
  /** The conversation was seen up to its latest message. */
  markRead({ botId, roomId }) {
    const [table, column] = botId !== undefined ? CHATS.bot : CHATS.room; const owner = botId ?? roomId;
    const last = this.get(`SELECT max(rowid) AS last FROM ${table} WHERE ${column}=?`, owner)?.last;
    if (last) this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'read.' + owner, String(last));
  }
  /** What the conversation lists show: the latest message (shortened), how many there are and how many came unseen. */
  chatSummary(kind, id) {
    const [table, column] = CHATS[kind];
    const latest = this.get(`SELECT body FROM ${table} WHERE ${column}=?${kind === 'room' ? " AND json_extract(body,'$.role')<>'system'" : ''} ORDER BY rowid DESC LIMIT 1`, id);
    const mark = Number(this.get('SELECT value FROM metadata WHERE key=?', 'read.' + id)?.value || 0);
    return { lastMessage: latest ? preview(parse(latest)) : null, messageCount: this.get(`SELECT count(*) AS count FROM ${table} WHERE ${column}=?`, id).count,
      unread: this.get(`SELECT count(*) AS count FROM (SELECT 1 FROM ${table} WHERE ${column}=? AND rowid>? AND json_extract(body,'$.role')<>'user' LIMIT 100)`, id, mark).count };
  }
  requireBot(id) {
    if (!uuid(id)) throw new Error('Bot inválido.');
    const bot = this.bot(id);
    if (!bot || bot.deletedAt) throw new Error('Bot não encontrado.');
    return bot;
  }
  /** Saves the bot's profile only; its messages are written with appendMessage/updateMessage. */
  putBot(bot) {
    const { messages, codexSessionId, isChief, lastMessage, messageCount, unread, ...body } = bot;
    this.run('INSERT INTO bots(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', bot.id, JSON.stringify(body));
    if (codexSessionId) this.session(bot.id, codexSessionId);
    else this.run('DELETE FROM codex_sessions WHERE bot_id=?', bot.id);
    this.notify('bot.updated', { botId: bot.id });
  }
  session(botId, id) {
    if (!sessionId(id)) throw new Error('Sessão inválida.');
    this.run('INSERT INTO codex_sessions VALUES(?,?,?) ON CONFLICT(bot_id) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at', botId, id, now());
  }
  /**
   * How big the IA's context for this bot probably is. The usage of a turn adds up every model call of it (each tool call rereads the
   * whole context), so the size is estimated from the last turn: its tokens divided by its calls, times 1.3 because the context grows
   * during the turn. Turns counts the answers since the session began.
   */
  /** One reply's tokens, with the size of its last model call: the IA's own number, or the reply's prompt tokens over its calls. */
  addUsage(bot, taskId, reply, usage = this.turnTokens(bot.id, reply)) {
    if (!usage) return;
    const raw = reply?.usage || {}, calls = Number.isFinite(raw.calls) && raw.calls >= 1 ? raw.calls : null;
    const context = Number.isFinite(raw.context) && raw.context > 0 ? Math.round(raw.context) : calls ? Math.round(usage.input / calls) : null;
    this.run('INSERT INTO usage(id,bot_id,task_id,provider,model,input,cached,output,created_at,context) VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), bot.id, taskId, reply.provider || bot.provider || 'codex', reply.model || null, usage.input, usage.cached, usage.output, now(), context == null ? null : Math.min(context, 1e9));
  }
  /**
   * How big the bot's IA session in this conversation (its private chat, or the room given) is now: the prompt of the last
   * model call of its latest reply, and how many replies it has had. Every IA reports input with the cached part already in it.
   */
  contextLoad(botId, roomId = null) {
    const since = this.get('SELECT value FROM metadata WHERE key=?', sinceKey(botId, roomId))?.value || '';
    const scope = roomId ? 'task_id IN (SELECT task_id FROM room_turns WHERE room_id=?)' : 'task_id NOT IN (SELECT task_id FROM room_turns)';
    const args = roomId ? [botId, since, roomId] : [botId, since];
    // Only turns of the current session count: a new session must not inherit the size of the one it replaced.
    const last = this.get(`SELECT task_id, input, context FROM usage WHERE bot_id=? AND created_at>? AND (task_id IS NULL OR ${scope}) ORDER BY created_at DESC, rowid DESC LIMIT 1`, ...args);
    const turns = this.get(`SELECT count(*) AS n FROM usage WHERE bot_id=? AND created_at>? AND (task_id IS NULL OR ${scope})`, ...args).n;
    if (!last) return { estimate: 0, turns };
    if (last.context != null) return { estimate: last.context, turns };
    // An older reply without it: its prompt tokens over the calls the MyBots saw (its own tools, plus the answer).
    const calls = 1 + (this.get("SELECT count(*) AS n FROM activity WHERE task_id=? AND kind IN ('tool_done','tool_denied')", last.task_id)?.n || 0);
    return { estimate: Math.round((last.input || 0) / calls), turns };
  }
  /** The summary the bot wrote of the session it closed, for the new one in that conversation (null once that one began). */
  handoff(botId, roomId = null) { return this.get('SELECT value FROM metadata WHERE key=?', handoffKey(botId, roomId))?.value || null; }
  setHandoff(botId, roomId, text) { if (text == null) return this.run('DELETE FROM metadata WHERE key=?', handoffKey(botId, roomId)); this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', handoffKey(botId, roomId), String(text).slice(0, HANDOFF_CHARS)); }
  /**
   * Forgets the IA's session of this bot in one conversation (its private chat, or the room given): the next answer starts a new one with
   * only the latest messages, and the bot finds the rest in its memory and pending items. The conversation, memories and pending items
   * stay as they are, and a line in the conversation says where the new session began.
   */
  newSession(botId, why, { roomId = null } = {}) {
    this.requireBot(botId);
    return this.transaction(() => {
      this.forgetSession(botId, roomId);
      this.record('session_reset', why, botId);
      this.sessionNote(why, { botId, roomId });
    });
  }
  /** The same for a whole room: every member starts a new session in it, with one line in the room. */
  newRoomSession(roomId, why) {
    const room = this.requireRoom(roomId);
    return this.transaction(() => {
      for (const botId of room.botIds || []) if (this.bot(botId)) this.forgetSession(botId, roomId);
      this.record('session_reset', why); this.sessionNote(why, { roomId });
    });
  }
  forgetSession(botId, roomId = null) {
    if (roomId) this.run('DELETE FROM room_sessions WHERE room_id=? AND bot_id=?', roomId, botId); else { this.run('DELETE FROM codex_sessions WHERE bot_id=?', botId); const bot = this.bot(botId); if (bot?.codexSessionId) this.putBot({ ...bot, codexSessionId: undefined, updatedAt: now() }); }
    this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', sinceKey(botId, roomId), now());
    this.run('DELETE FROM metadata WHERE key=?', handoffKey(botId, roomId));
    this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'session.compact.' + (roomId ? roomId + '.' : '') + botId, '1');
  }
  // Sessions of the Chefe's conversation (what the person sees as separate chats, like in Claude). Each keeps the IA's own session id, so
  // picking an old one continues it with everything the IA remembers of it. `null` is the conversation from before sessions began ("base").
  chatSession(botId) { return this.get('SELECT value FROM metadata WHERE key=?', 'chat.session.' + botId)?.value || null; }
  setChatSession(botId, id) { if (id) this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'chat.session.' + botId, id); else this.run('DELETE FROM metadata WHERE key=?', 'chat.session.' + botId); }
  archiveAi(botId) { const ai = this.bot(botId)?.codexSessionId; if (ai) this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'chat.ai.' + botId + '.' + (this.chatSession(botId) || 'base'), ai); }
  /** A new chat: the IA session of the one that was open is kept for later, and the next answer starts a fresh one. */
  startSession(botId, why) {
    this.requireBot(botId);
    return this.transaction(() => {
      this.archiveAi(botId);
      const id = randomUUID(); this.setChatSession(botId, id);
      this.forgetSession(botId);
      this.record('session_reset', why, botId);
      this.sessionNote(why, { botId });
      return id;
    });
  }
  /** Picking an old chat: it becomes the open one and the IA session it had comes back (a fresh one when that is gone). */
  resumeSession(botId, wanted) {
    this.requireBot(botId);
    const target = wanted === 'base' ? null : wanted;
    if (target && !this.get("SELECT 1 FROM messages WHERE bot_id=? AND json_extract(body,'$.session')=? LIMIT 1", botId, target)) throw new Error('Sessão não encontrada.');
    // Already the open one (the app was just reopened): only the marker that brings it back on screen.
    if ((this.chatSession(botId) || null) === target) { this.sessionNote('Sessão retomada. A conversa continua de onde parou.', { botId }); return false; }
    return this.transaction(() => {
      this.archiveAi(botId);
      this.setChatSession(botId, target);
      this.forgetSession(botId);
      const ai = this.get('SELECT value FROM metadata WHERE key=?', 'chat.ai.' + botId + '.' + (target || 'base'))?.value;
      if (ai) { this.putBot({ ...this.requireBot(botId), codexSessionId: ai }); this.run('DELETE FROM metadata WHERE key=?', 'session.compact.' + botId); }
      this.record('session_reset', 'Sessão retomada.', botId);
      this.sessionNote('Sessão retomada. A conversa continua de onde parou.', { botId });
      return true;
    });
  }
  sessionTitle(botId, id, title) {
    const row = this.get("SELECT id FROM messages WHERE bot_id=? AND json_extract(body,'$.session')=? AND json_extract(body,'$.role')='system' AND json_extract(body,'$.text') LIKE 'Nova sessão%' ORDER BY rowid LIMIT 1", botId, id);
    if (row) this.updateMessage(row.id, { title });
    return Boolean(row);
  }
  /** The line "Nova sessão…" in the conversation (a system message: shown, never sent to the IA as something the person said). */
  sessionNote(text, { botId = null, roomId = null }) {
    const message = { id: randomUUID(), role: 'system', text, status: 'complete', createdAt: now() };
    if (roomId) this.appendRoomMessage(roomId, message); else this.appendMessage(botId, message);
  }
  record(kind, detail, botId = null, taskId = null) {
    this.run('INSERT INTO activity(kind,detail,bot_id,task_id,created_at) VALUES(?,?,?,?,?)', kind, detail, botId, taskId, now());
  }
  /** Everything, with every message: backups and export. The app's state is lighter (see the supervisor's state()). */
  snapshot() { return { schema: 1, googleAccounts: this.googleAccounts(), mode: 'phone', supervisorMigrated: true, bots: this.bots().map(bot => ({ ...bot, messages: this.messages(bot.id) })), roomsState: { schema: 1, rooms: this.rooms().map(room => ({ ...room, messages: this.roomMessages(room.id) })) }, skillsState: { schema: 1, skills: this.all('SELECT * FROM skills') }, toolsState: {
    schema: 1, notes: this.all('SELECT * FROM notes'), memory: this.all('SELECT * FROM memory'), pendingItems: this.all('SELECT * FROM pending_items'), grants: this.all('SELECT * FROM grants')
  } }; }
  validateTools(snapshot) {
    if (snapshot.toolsState === undefined) return;
    const state = snapshot.toolsState; const ids = new Set(snapshot.bots.map(bot => bot.id));
    if (state?.schema !== 1 || !['memory','pendingItems','grants'].every(key => Array.isArray(state[key]) && state[key].length <= 20000)) throw new Error('Backup de ferramentas inválido.');
    if (state.notes !== undefined) {
      if (!Array.isArray(state.notes) || state.notes.length > 20000) throw new Error('Lista de notas inválida no backup.');
      const paths = new Set();
      for (const row of state.notes) {
        checkNote(row);
        if (paths.has(row.path)) throw new Error('Caminho de nota repetido no backup.');
        paths.add(row.path);
      }
    }
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
        this.putBot(bot); this.replaceMessages(bot.id, messages);
      }
      this.run("INSERT INTO metadata VALUES('legacy_imported',?)", now());
      const chief = snapshot.bots.find(bot => bot.isChief && !bot.deletedAt);
      if (chief) this.setChief(chief.id);
      this.record('migration', `${snapshot.bots.length} bots migrados com seus identificadores.`);
      return true;
    });
  }
  restore(snapshot) {
    validateBackup(snapshot); this.validateTools(snapshot);
    if (snapshot.googleAccounts !== undefined && (!Array.isArray(snapshot.googleAccounts) || snapshot.googleAccounts.length > 50 || !snapshot.googleAccounts.every(validGoogleAccount))) throw new Error('Contas Google inválidas no backup.');
    if (this.activeTasks().length) throw new Error('Aguarde ou cancele as tarefas antes de restaurar.');
    this.backup();
    this.transaction(() => {
      if (snapshot.googleAccounts) this.run("INSERT INTO metadata VALUES('google.accounts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(snapshot.googleAccounts));
      const stamp = now();
      const restored = new Set(snapshot.bots.map(bot => bot.id));
      for (const bot of this.bots()) if (!restored.has(bot.id)) { this.putBot({ ...bot, deletedAt: stamp, updatedAt: stamp, codexSessionId: undefined }); this.replaceMessages(bot.id, []); }
      for (const bot of snapshot.bots) { this.putBot({ ...bot, ...(!bot.deletedAt ? { restoredAt: stamp } : {}) });
        this.replaceMessages(bot.id, bot.messages.map(message => message.status === 'pending' || message.awaitingResponse ? { ...message, status: 'error', awaitingResponse: false, error: 'Pedido interrompido no backup.' } : message)); }
      this.run('DELETE FROM memory'); this.run('DELETE FROM pending_items'); this.run('DELETE FROM grants');
      // Rooms came with backups from v35 on; older backups leave the current rooms as they are.
      if (snapshot.roomsState?.schema === 1 && Array.isArray(snapshot.roomsState.rooms)) {
        this.run('DELETE FROM room_sessions');
        for (const room of snapshot.roomsState.rooms.slice(0, 200)) if (uuid(room?.id) && typeof room.name === 'string' && Array.isArray(room.botIds) && Array.isArray(room.messages)) {
          this.putRoom({ ...room, updatedAt: typeof room.updatedAt === 'string' ? room.updatedAt : stamp });
          this.replaceRoomMessages(room.id, room.messages.filter(message => typeof message?.id === 'string').slice(-20000));
        }
      }
      // Skills came with backups from v42 on; older backups leave the installed ones as they are.
      if (snapshot.skillsState?.schema === 1 && Array.isArray(snapshot.skillsState.skills)) {
        this.run('DELETE FROM skills');
        for (const row of snapshot.skillsState.skills.slice(0, 200)) if (uuid(row?.id) && typeof row.body === 'string' && row.body.length < 300000 && typeof row.created_at === 'string') this.run('INSERT INTO skills VALUES(?,?,?)', row.id, row.body, row.created_at);
      }
      if (snapshot.toolsState?.notes !== undefined) {
        const restoredPaths = new Set(snapshot.toolsState.notes.map(row => row.path));
        for (const { path } of this.all('SELECT path FROM notes')) {
          if (!restoredPaths.has(path)) this.notify('notes.changed', { path });
        }
        this.run('DELETE FROM notes');
        for (const row of snapshot.toolsState.notes) saveNote(this, row);
      }
      for (const row of snapshot.toolsState?.memory || []) this.run('INSERT INTO memory VALUES(?,?,?,?)', row.id, row.bot_id, row.body, row.updated_at);
      for (const row of snapshot.toolsState?.pendingItems || []) this.run('INSERT INTO pending_items VALUES(?,?,?,?,?)', row.id, row.bot_id, row.body, row.state, row.created_at);
      for (const row of snapshot.toolsState?.grants || []) this.run('INSERT INTO grants VALUES(?,?,?,?)', row.id, row.bot_id, row.tool, row.body);
      const chief = snapshot.bots.find(bot => bot.isChief && !bot.deletedAt);
      if (chief || snapshot.bots.some(bot => bot.isChief !== undefined) || !this.bots().some(bot => bot.isChief)) this.setChief(chief?.id || null);
      this.record('restore', 'Backup restaurado.');
    });
  }
  merge(incoming) {
    validateBackup({ schema: 1, bots: incoming });
    if (this.activeTasks().length) throw new Error('Aguarde as tarefas antes de sincronizar.');
    const existing = new Map(this.bots().map(bot => [bot.id, { ...bot, messages: this.messages(bot.id) }]));
    const merged = mergeBotLists([...existing.values()], incoming.map(({ codexSessionId, ...bot }) => ({ ...bot,
      ...(existing.get(bot.id)?.codexSessionId ? { codexSessionId: existing.get(bot.id).codexSessionId } : {}) })));
    this.transaction(() => { for (const bot of merged) { this.putBot(bot); this.replaceMessages(bot.id, bot.messages); } });
  }
  // One synchronized pointer makes concurrent offline promotions converge like any other personal setting.
  setChief(id) {
    return this.transaction(() => {
      const previous = this.get("SELECT value FROM metadata WHERE key='person.chief'")?.value;
      if (id) this.requireBot(id);
      if ((previous || null) === id) return;
      if (id) this.run("INSERT INTO metadata VALUES('person.chief',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", id);
      else this.run("DELETE FROM metadata WHERE key='person.chief'");
      for (const changed of [previous, id].filter(Boolean)) {
        this.run('DELETE FROM codex_sessions WHERE bot_id=?', changed);
        this.run('DELETE FROM room_sessions WHERE bot_id=?', changed);
        this.notify('bot.updated', { botId: changed });
      }
      this.record('bot_updated', id ? 'Chefe da equipe escolhido.' : 'Papel de Chefe removido.', id || previous);
    });
  }
  create(data, selection) {
    validateProfile({ ...data, ...selection });
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 40 ||
      (data.instructions !== undefined && (typeof data.instructions !== 'string' || data.instructions.length > 2000)) ||
      !['green','blue','purple','orange'].includes(data.color || 'green')) throw new Error('Informe nome, personalidade e cor válidos.');
    const stamp = now();
    const bot = { id: randomUUID(), name: data.name.trim(), instructions: (data.instructions || '').trim(), color: data.color || 'green', avatar: data.avatar || 'orbit', ...(data.face ? { face: data.face } : {}), autonomy: data.autonomy || 'ask', ...(data.access ? { access: data.access } : {}), home: data.home || 'phone', browserMode: data.access === 'basic' && browserMode({ ...data, ...selection }) === 'shared' ? 'separate' : browserMode({ ...data, ...selection }), ...selection, ...(data.aiAccount && data.aiAccount !== 'default' ? { aiAccount: data.aiAccount } : {}), createdAt: stamp, updatedAt: stamp, messages: [] };
    Object.assign(bot, defaultBotAccess(bot), { googleAccount: data.googleAccount || '' });
    this.transaction(() => {
      if (bot.googleAccount) this.addGoogleAccount(bot.googleAccount);
      this.putBot(bot);
      if (data.isChief === true) {
        if (this.bots().some(item => item.isChief)) throw new Error('Já existe um Chefe. Para trocar, promova o novo bot pelo perfil.');
        this.setChief(bot.id);
      }
      this.record('bot_created', `Bot ${bot.name} criado.`, bot.id);
    });
    return { ...bot, isChief: data.isChief === true };
  }
  configure(id, selection, changes = {}) {
    const bot = this.requireBot(id);
    validateProfile({ ...changes, provider: selection.provider || bot.provider });
    if (this.activeTasks(id).length) throw new Error('Aguarde a resposta antes de alterar o bot.');
    const updated = { ...bot, ...selection, updatedAt: now() };
    for (const field of ['name','instructions','color','avatar','face','autonomy','access','home','folders','browserMode','skills','gpu','googleAccount','aiAccount']) if (changes[field] !== undefined) updated[field] = changes[field];
    if (updated.aiAccount === '' || updated.aiAccount === 'default') delete updated.aiAccount;   // the IA's own login is the default
    // The reserve model for when the subscription's limit ends (null removes it); only another provider's makes sense.
    if (changes.fallback !== undefined) { if (changes.fallback === null) delete updated.fallback; else updated.fallback = { provider: changes.fallback.provider, model: changes.fallback.model, reasoningEffort: changes.fallback.reasoningEffort }; }
    if (updated.fallback && updated.fallback.provider === (updated.provider || 'codex')) delete updated.fallback;
    if (changes.mainChrome !== undefined && changes.browserMode === undefined) updated.browserMode = changes.mainChrome && updated.provider === 'claude' ? 'claude' : 'shared';
    if (changes.provider === 'codex' && changes.browserMode === undefined && updated.browserMode === 'claude') updated.browserMode = 'shared';
    Object.assign(updated, defaultBotAccess(updated));
    validateProfile(updated);
    if (typeof updated.name !== 'string' || !updated.name.trim() || updated.name.trim().length > 40 || typeof updated.instructions !== 'string' || updated.instructions.length > 2000 || !['green','blue','purple','orange'].includes(updated.color)) throw new Error('Informe nome, personalidade e cor válidos.');
    updated.name = updated.name.trim(); updated.instructions = updated.instructions.trim();
    // codexSessionId holds the session of the bot's current provider; another CLI cannot resume it.
    const switched = (updated.provider || 'codex') !== (bot.provider || 'codex');
    // A new access level, like a new grant, needs a fresh session so the bot stops repeating "I have no access".
    // Moving to another device also starts a new session there: an IA session lives on the machine that made it.
    const moved = (updated.home || 'phone') !== (bot.home || 'phone') || browserMode(updated) !== browserMode(bot);
    if (switched || moved || updated.name !== bot.name || updated.instructions !== bot.instructions || updated.access !== bot.access || updated.googleAccount !== bot.googleAccount || (updated.aiAccount || '') !== (bot.aiAccount || '')) delete updated.codexSessionId;   // a session lives in the folder of the account that made it
    const level = { basic: 'Pouco acesso', ask: 'Médio', full: 'Acesso total', free: 'Livre' }[updated.access];
    const where = { phone: 'no celular', pc: 'no computador', any: 'onde estiver ligado' }[updated.home || 'phone'];
    this.transaction(() => {
      if (updated.googleAccount) this.addGoogleAccount(updated.googleAccount);
      this.putBot(updated);
      if (changes.isChief !== undefined && changes.isChief !== bot.isChief) {
        const previous = this.get("SELECT value FROM metadata WHERE key='person.chief'")?.value;
        if (previous && this.activeTasks(previous).length) throw new Error('Aguarde o Chefe terminar a tarefa antes de trocar.');
        this.setChief(changes.isChief ? id : null);
      }
      if (updated.googleAccount !== bot.googleAccount) this.run('DELETE FROM room_sessions WHERE bot_id=?', id);
      this.record('bot_updated', switched ? `IA alterada para ${PROVIDER_NAMES[updated.provider] || 'Codex'}; a conversa continua com o histórico salvo.` : moved ? `Agora vive ${where}.` : updated.access !== bot.access ? `Nível de acesso: ${level}.` : 'Perfil atualizado.', id);
    });
    return this.requireBot(id);
  }
  delete(id) {
    this.requireBot(id);
    if (this.activeTasks(id).length) throw new Error('Aguarde a tarefa antes de apagar o bot.');
    this.backup();
    const next = deleteLocalBot({ bots: [this.fullBot(id)] }, id).bots[0];
    this.transaction(() => { if (this.bot(id).isChief) this.setChief(null); this.putBot(next); this.replaceMessages(id, []); this.run('DELETE FROM browser_steps WHERE bot_id=?', id); this.run('DELETE FROM browser_downloads WHERE bot_id=?', id); this.record('bot_deleted', 'Bot apagado.', id); });
  }
  task(id) { return this.get('SELECT * FROM tasks WHERE id=?', id); }
  tasks(limit = -1) { return this.all('SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?', limit); }
  /** Tasks still to finish (of one bot, or all), without reading the whole history of tasks. */
  activeTasks(botId) { return this.all(`SELECT * FROM tasks WHERE state IN ('queued','running','waiting_approval')${botId ? ' AND bot_id=?' : ''} ORDER BY created_at DESC, rowid DESC`, ...(botId ? [botId] : [])); }
  enqueue(botId, requestId, text, selection, origin = {}) {
    this.requireBot(botId);
    if (!uuid(requestId) || typeof text !== 'string' || !text.trim() || text.trim().length > 8000) throw new Error('Escreva uma mensagem de até 8.000 caracteres.');
    const payload = JSON.stringify({ text: text.trim(), ...selection, ...(origin.steer ? { steer: true } : {}) });
    const existing = this.task(requestId);
    if (existing) {
      if (existing.bot_id !== botId || existing.payload !== payload) throw new Error('Este pedido já foi usado para outra mensagem.');
      return existing;
    }
    // Messages sent while the bot works wait in line and become its next turns, in order.
    if (this.activeTasks(botId).length >= 10) throw new Error('Este bot já tem 10 mensagens esperando. Aguarde ele responder algumas.');
    return this.transaction(() => {
      const bot = this.requireBot(botId); const stamp = now(); const messageId = randomUUID();
      this.putBot({ ...bot, ...selection, updatedAt: stamp });
      this.appendMessage(botId, { id: messageId, requestId, role: 'user', text: text.trim(), status: 'pending', ...selection, ...origin, createdAt: stamp });
      this.run("INSERT INTO tasks(id,bot_id,message_id,state,payload,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)", requestId, botId, messageId, payload, stamp, stamp);
      this.event(requestId, 'queued');
      return this.task(requestId);
    });
  }
  /**
   * Messages the person sent while this bot's turn was running ("live": see chat.send): they are handed to the running turn with
   * the next tool result instead of waiting for it to end. Each one is marked delivered (message complete, its own turn done, no
   * reply of its own: the running turn answers it). Returns what to show the model. Nothing for room turns and routine runs.
   */
  takeLive(botId, runTaskId) {
    const running = this.task(runTaskId);
    if (!running || running.bot_id !== botId || !['running', 'waiting_approval'].includes(running.state) || this.roomTurn(runTaskId) || this.get('SELECT 1 FROM routine_runs WHERE task_id=?', runTaskId)) return [];
    return this.transaction(() => {
      const rows = this.all("SELECT t.id AS id, t.message_id AS message_id FROM tasks t JOIN messages m ON m.id=t.message_id WHERE t.bot_id=? AND t.state='queued' AND json_extract(m.body,'$.live')=1 AND t.id NOT IN (SELECT task_id FROM routine_runs) ORDER BY t.created_at, t.rowid", botId);
      const taken = [];
      for (const row of rows) {
        const message = this.message(row.message_id); if (!message) continue;
        this.updateMessage(row.message_id, { status: 'complete', delivered: 'live', deliveredAt: now() });
        this.run("UPDATE tasks SET state='done',updated_at=? WHERE id=? AND state='queued'", now(), row.id);
        this.event(row.id, 'done');
        taken.push({ text: message.text, attachments: (message.attachments || []).map(file => ({ id: file.id, name: file.name, mime: file.mime, size: file.size })) });
      }
      return taken;
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
      if (!turn) this.updateMessage(task.message_id, { status: state === 'done' ? 'complete' : 'error', error: error || undefined });
      if (!turn && state === 'done') this.appendMessage(bot.id, { id: randomUUID(), role: 'assistant', text: reply.text, status: 'complete', model: reply.model, ...(reply.fallback ? { fallback: true } : {}), ...(typeof reply.modelId === 'string' ? { modelId: reply.modelId.slice(0, 80) } : {}), reasoningEffort: reply.reasoningEffort, ...files, ...(usage ? { usage: { input: usage.input, output: usage.output } } : {}), ...(this.message(task.message_id)?.via === 'chief' ? { replyTo: task.message_id } : {}), createdAt: now() });
      else if (!turn && files.attachments) this.appendMessage(bot.id, { id: randomUUID(), role: 'assistant', text: 'Estes arquivos ficaram prontos antes da interrupção.', status: 'complete', ...files, createdAt: now() });
      if (!turn) this.putBot({ ...bot, ...(reply?.codexSessionId ? { codexSessionId: reply.codexSessionId } : {}), updatedAt: now() });
      if (usage) this.addUsage(bot, id, reply, usage);
      if (reply?.limits && ['codex', 'claude'].includes(reply.provider || bot.provider || 'codex')) this.setLimits(reply.provider || bot.provider || 'codex', reply.limits);
      // What each Claude alias resolves to now, so the model picker can say "Claude Opus 5.5".
      if (state === 'done' && bot.provider === 'claude' && typeof reply.modelId === 'string' && /^[a-z]{1,20}$/.test(reply.model || '')) this.run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'claude.model.' + reply.model, reply.modelId.slice(0, 80));
      this.run('UPDATE tasks SET state=?,error=?,worker_pid=NULL,worker_start=NULL,updated_at=? WHERE id=?', state, error, now(), id);
      this.event(id, state);
    });
  }
}
