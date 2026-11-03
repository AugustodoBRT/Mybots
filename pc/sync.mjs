import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const FILE_LIMIT = 20 * 1024 * 1024;
// Events that mean data changed. Not 'connection.changed' or 'activity.new': the sync's own notes cause those, and it would never settle.
const WORTH = new Set(['message.added', 'message.updated', 'bot.updated', 'chat.reset', 'task.done']);
export const worthSyncing = event => WORTH.has(event);

/**
 * Keeps the phone's supervisor and the computer's own supervisor in step. It runs in the node, which sees both: each side
 * answers `sync.changes` (what changed after a counter, not counting what the asker itself sent) and `sync.apply` (take
 * these, newest version wins). One round pulls the phone's changes into the computer, then the computer's into the phone,
 * remembering how far each log was read (per pair of devices, so a reinstalled device is read again from the start).
 * Files travel after the rows that mention them, in parts, up to FILE_LIMIT; bigger ones stay where they were made.
 */
export function createSync({ directory, phone, local, log = () => {}, pageSize = 300, intervalMs = 60000, minGapMs = 1000, delayMs = 400, fileLimit = FILE_LIMIT, now = () => new Date().toISOString() }) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'sync-state.json');
  let saved; try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { saved = {}; }
  const state = { peers: saved.peers || {}, files: Array.isArray(saved.files) ? saved.files : [] };
  const save = () => { try { writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 }); renameSync(file + '.tmp', file); } catch {} };
  let running = null, again = false, timer = null, closed = false, lastStart = 0, current = { state: 'waiting', online: false, error: null, progress: null };
  let lastPair = null; const sides = { phone, local };

  const set = patch => { current = { ...current, ...patch }; return current; };
  const tell = (side, info, peer) => sides[side].call('sync.mark', { ...(info ? { info } : {}), ...(peer ? { peer } : {}) }).catch(() => {});

  /** Moves every change `from` has beyond the cursor to `to`; returns what happened. */
  async function move(from, to, fromState, toState, cursor, delivered, entry, before, totals, wanted) {
    for (;;) {
      const page = await sides[from].call('sync.changes', { after: entry[cursor], limit: pageSize, exclude: toState.device });
      if (page.changes.length) {
        const result = await sides[to].call('sync.apply', { changes: page.changes, from: fromState.device, delivered: before[delivered] });
        totals.applied += result.applied; totals.conflicts += result.conflicts; totals[from === 'phone' ? 'pulled' : 'pushed'] += result.applied;
        for (const id of result.files || []) wanted.push({ from, id });
      }
      entry[cursor] = page.next; save();
      totals.done += page.changes.length;
      set({ progress: { done: Math.min(totals.done, totals.total), total: totals.total } });
      if (totals.done % (pageSize * 4) < page.changes.length) { tell('phone', { state: 'syncing', progress: current.progress }); tell('local', { state: 'syncing', progress: current.progress }); }
      if (!page.more) return;
    }
  }

  /** The files of rows that just arrived (and the ones that failed before), from where they were made to where they are missing. */
  async function carry(wanted) {
    const queue = [...state.files, ...wanted].filter((item, index, all) => all.findIndex(other => other.id === item.id && other.from === item.from) === index).slice(0, 200);
    state.files = [];
    for (const item of queue) {
      const to = item.from === 'phone' ? 'local' : 'phone';
      try {
        const { missing } = await sides[to].call('sync.have', { ids: [item.id] });
        if (!missing.includes(item.id)) continue;
        let offset = 0;
        for (;;) {
          const part = await sides[item.from].call('sync.file', { id: item.id, offset });
          if (part.size > fileLimit) { log(`Arquivo grande demais para copiar entre os aparelhos (${Math.round(part.size / 1048576)} MB); fica onde foi criado.`); break; }
          await sides[to].call('sync.fileWrite', { id: item.id, offset, chunk: part.chunk });
          if (part.next === null || part.next === undefined) break;
          offset = part.next;
        }
      } catch (error) { if (!/Arquivo (não encontrado|desconhecido)/.test(error.message)) state.files.push(item); }
    }
    state.files = state.files.slice(0, 200); save();
  }

  async function round() {
    if (!phone.online() || !local.online()) { set({ online: false, state: 'waiting', progress: null }); return; }
    let ps, ls;
    try { [ps, ls] = await Promise.all([phone.call('sync.status'), local.call('sync.status')]); }
    catch (error) {
      const message = /só pode ser feito|Isto só/.test(error.message) ? 'O celular precisa do MyBots mais novo para sincronizar.' : error.message;
      set({ state: 'error', error: message.slice(0, 200), online: true }); return;
    }
    if (ps.schema !== ls.schema) { set({ state: 'error', error: 'O celular e o computador estão em versões diferentes do MyBots. Atualize o que estiver mais velho.', online: true }); return; }
    const key = `${ps.device}|${ls.device}`; const entry = state.peers[key] ||= { pulledPhone: 0, pulledLocal: 0, firstAt: null, lastAt: null };
    // A device whose log is shorter than what we read from it was replaced: read it again from the start (safe: older versions are skipped).
    if (entry.pulledPhone > ps.counter) entry.pulledPhone = 0; if (entry.pulledLocal > ls.counter) entry.pulledLocal = 0;
    lastPair = key;
    const totals = { applied: 0, pulled: 0, pushed: 0, conflicts: 0, done: 0, total: Math.max(1, (ps.counter - entry.pulledPhone) + (ls.counter - entry.pulledLocal)) };
    set({ state: 'syncing', online: true, error: null, progress: { done: 0, total: totals.total } });
    const first = !entry.firstAt;
    await Promise.all([tell('phone', { state: 'syncing', firstAt: entry.firstAt || undefined, progress: first ? { done: 0, total: totals.total } : null, error: null }, { known: true, online: true, name: 'Computador', device: ls.device }),
      tell('local', { state: 'syncing', firstAt: entry.firstAt || undefined, progress: first ? { done: 0, total: totals.total } : null, error: null }, { known: true, online: true, name: 'Celular', device: ps.device })]);
    const wanted = []; const before = { pulledPhone: entry.pulledPhone, pulledLocal: entry.pulledLocal };   // what each side had read when the round began: an edit after that is unsynced
    try {
      await move('phone', 'local', ps, ls, 'pulledPhone', 'pulledLocal', entry, before, totals, wanted);
      await move('local', 'phone', ls, ps, 'pulledLocal', 'pulledPhone', entry, before, totals, wanted);
      await carry(wanted);
    } catch (error) {
      set({ state: 'error', error: String(error.message || error).slice(0, 200), progress: null });
      await Promise.all([tell('phone', { state: 'error', error: current.error, progress: null }), tell('local', { state: 'error', error: current.error, progress: null })]);
      return;
    }
    const at = now(); entry.lastAt = at; entry.firstAt ||= at; save();
    set({ state: 'idle', error: null, progress: null, at, firstAt: entry.firstAt });
    if (totals.applied) log(`Sincronizado: ${totals.pulled} do celular, ${totals.pushed} do computador${totals.conflicts ? `, ${totals.conflicts} conflito(s) resolvido(s)` : ''}.`);
    const info = { state: 'idle', at, firstAt: entry.firstAt, applied: totals.applied, pulled: totals.pulled, pushed: totals.pushed, error: null, progress: null };
    await Promise.all([tell('phone', info), tell('local', info)]);
  }

  async function run() {
    timer = null;
    if (closed) return;
    if (running) { again = true; return running; }
    lastStart = Date.now();
    running = round().catch(error => { set({ state: 'error', error: String(error.message || error).slice(0, 200) }); log(`Sincronização falhou: ${error.message}`); }).finally(() => { running = null; if (again && !closed) { again = false; schedule(); } });
    return running;
  }
  function schedule(wait = delayMs) {
    if (closed || timer) return;
    timer = setTimeout(run, Math.max(wait, minGapMs - (Date.now() - lastStart), 0)); timer.unref?.();
  }
  const interval = setInterval(() => { if (phone.online() && local.online()) schedule(0); }, intervalMs); interval.unref?.();

  return {
    /** Something changed on either side (an event, a connection): a round soon, never more often than once a second. */
    kick: () => schedule(),
    /** A round right now (the button), waiting for it to finish. */
    async now() { clearTimeout(timer); timer = null; await run(); return current; },
    /** The phone came or went: the computer's supervisor learns it (it decides who runs the "onde estiver" routines). */
    async phone(online) { set({ online: online && local.online() }); if (!online) await tell('local', null, { online: false }); else schedule(0); },
    status: () => ({ ...current, online: phone.online() && local.online(), synced: Object.values(state.peers).some(entry => entry.lastAt), peer: 'Celular' }),
    synced: () => Object.values(state.peers).some(entry => entry.lastAt),
    close() { closed = true; clearTimeout(timer); clearInterval(interval); }
  };
}
