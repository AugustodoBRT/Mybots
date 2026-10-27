import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { chromeEndpoint, IMPORTED } from './browser-worker.mjs';
import { mkdirSync, existsSync } from 'node:fs';

// "own" is the pre-v58 name of a bot's Chrome; those bots moved to the shared one.
const MODES = ['shared', 'separate', 'mine', 'claude'];

/**
 * The browser's process owns its profile and ephemeral login key. The node only relays encrypted logins, and the
 * frames of the live view to `onFrame` (a closed browser sends `{ closed: true }`). Bots in the shared browser (the
 * default) and in Meu Chrome share one process each, with their own tabs; a separate browser has a process per bot.
 */
export class PcBrowser {
  constructor(directory, { onFrame = () => {}, mineProfile = join(homedir(), '.config/google-chrome'), downloads = join(directory, 'downloads') } = {}) { this.directory = directory; this.workers = new Map(); this.onFrame = onFrame; this.modes = new Map(); this.mineProfile = mineProfile; this.downloads = downloads; this.imports = new Set(); }
  configure(botId, mode) {
    if (mode === 'own') mode = 'shared';
    if (!MODES.includes(mode)) throw new Error('Modo de navegador inválido.');
    if (this.modes.has(botId) && this.modes.get(botId) !== mode) this.stop(botId);
    this.modes.set(botId, mode);
    // Logins of a bot's old Chrome are copied into the shared one once; the old profile stays for "Navegador separado".
    const legacy = join(this.directory, 'browsers', botId);
    if (mode === 'shared' && /^[0-9a-f-]{36}$/i.test(botId) && existsSync(join(legacy, 'Default')) && !existsSync(join(legacy, IMPORTED)) && !this.imports.has(botId)) {
      this.imports.add(botId); this.workers.get('shared')?.child.send({ op: 'import', args: { profile: legacy } }, () => {});
    }
  }
  key(botId) { const mode = this.modes.get(botId) || 'shared'; return mode === 'mine' || mode === 'shared' ? mode : botId; }
  running(botId) { return this.workers.has(this.key(botId)); }
  worker(botId) {
    if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error('Bot inválido.');
    const key = this.key(botId), mine = key === 'mine', shared = key === 'shared';
    const endpoint = mine ? chromeEndpoint(this.mineProfile) : null;
    const current = this.workers.get(key);
    if (current && current.endpoint === endpoint) { current.botIds.add(botId); return current; }
    if (current) { current.child.kill('SIGTERM'); this.workers.delete(key); }
    const profile = join(this.directory, 'browsers', key);
    mkdirSync(profile, { recursive: true, mode: 0o700 }); mkdirSync(this.downloads, { recursive: true, mode: 0o700 });
    const env = Object.fromEntries(['PATH', 'HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.MYBOTS_DOWNLOADS = this.downloads;
    const child = fork(fileURLToPath(new URL('./browser-worker.mjs', import.meta.url)), [profile, mine ? 'mine' : shared ? 'shared' : 'own', ...(endpoint ? [endpoint] : [])], { env, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true });
    const worker = { child, pending: new Map(), botIds: new Set([botId]), mine, multi: mine || shared, endpoint }; this.workers.set(key, worker);
    if (shared) for (const id of this.imports) child.send({ op: 'import', args: { profile: join(this.directory, 'browsers', id) } }, () => {});
    const end = () => {
      if (this.workers.get(key) === worker) this.workers.delete(key);
      for (const done of worker.pending.values()) done({ error: 'O navegador do computador foi interrompido.' });
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      for (const id of worker.botIds) this.onFrame(id, { closed: true });
    };
    child.on('error', end); child.on('exit', end);
    child.on('message', message => message.frame ? this.onFrame(message.botId || botId, message.frame) : worker.pending.get(message.id)?.(message));
    return worker;
  }
  command(botId, op, args, signal) {
    signal?.throwIfAborted();
    if (op === 'view' && !args?.on && !this.running(botId)) return Promise.resolve({ watching: false });
    const worker = this.worker(botId); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const stop = () => this.stop(botId);
      const done = ({ result, error }) => { clearTimeout(timer); worker.pending.delete(id); signal?.removeEventListener('abort', stop); error ? reject(new Error(error)) : resolve(result); };
      const timer = setTimeout(() => { stop(); done({ error: 'O navegador do computador demorou para responder.' }); }, 130000);
      worker.pending.set(id, done); signal?.addEventListener('abort', stop, { once: true });
      worker.child.send({ id, botId, op, args }, error => { if (error) done({ error: 'O processo do navegador encerrou.' }); });
    });
  }
  stop(botId) {
    const key = this.key(botId), worker = this.workers.get(key);
    if (!worker) return;
    // Stopping one bot of a shared process closes only its tabs.
    if (worker.multi) { worker.child.send({ botId, op: 'close' }, () => {}); worker.botIds.delete(botId); return; }
    this.workers.delete(key);
    try { process.kill(-worker.child.pid, 'SIGKILL'); } catch {}
  }
  close() {
    const closing = [...this.workers.values()].map(worker => new Promise(resolve => {
      const timer = setTimeout(() => { try { process.kill(-worker.child.pid, 'SIGKILL'); } catch {} resolve(); }, 5000); timer.unref();
      worker.child.once('exit', () => { clearTimeout(timer); resolve(); });
      // The shared Chrome closes cleanly, so its logins are written to disk.
      if (worker.multi) worker.child.kill('SIGTERM'); else { try { process.kill(-worker.child.pid, 'SIGKILL'); } catch { clearTimeout(timer); resolve(); } }
    }));
    this.workers.clear(); return Promise.all(closing);
  }
}
