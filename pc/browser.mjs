import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { chromeEndpoint } from './browser-worker.mjs';
import { mkdirSync } from 'node:fs';

/**
 * The browser's process owns its profile and ephemeral login key. The node only relays encrypted logins, and the
 * frames of the live view to `onFrame` (a closed browser sends `{ closed: true }`).
 */
export class PcBrowser {
  constructor(directory, { onFrame = () => {}, mineProfile = join(homedir(), '.config/google-chrome') } = {}) { this.directory = directory; this.workers = new Map(); this.onFrame = onFrame; this.modes = new Map(); this.mineProfile = mineProfile; }
  configure(botId, mode) {
    if (!['own','mine','claude'].includes(mode)) throw new Error('Modo de navegador inválido.');
    if (this.modes.has(botId) && this.modes.get(botId) !== mode) this.stop(botId);
    this.modes.set(botId, mode);
  }
  worker(botId) {
    if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error('Bot inválido.');
    const mine = this.modes.get(botId) === 'mine', key = mine ? 'mine' : botId;
    const endpoint = mine ? chromeEndpoint(this.mineProfile) : null;
    const current = this.workers.get(key);
    if (current && current.endpoint === endpoint) { current.botIds.add(botId); return current; }
    if (current) { current.child.kill('SIGTERM'); this.workers.delete(key); }
    const profile = join(this.directory, 'browsers', mine ? 'mine' : botId);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    const env = Object.fromEntries(['PATH', 'HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = fork(fileURLToPath(new URL('./browser-worker.mjs', import.meta.url)), [profile, mine ? 'mine' : 'own', ...(endpoint ? [endpoint] : [])], { env, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true });
    const worker = { child, pending: new Map(), botIds: new Set([botId]), mine, endpoint }; this.workers.set(key, worker);
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
    if (op === 'view' && !args?.on && !this.workers.has(this.modes.get(botId) === 'mine' ? 'mine' : botId)) return Promise.resolve({ watching: false });
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
    const key = this.modes.get(botId) === 'mine' ? 'mine' : botId, worker = this.workers.get(key);
    if (!worker) return;
    if (worker.mine) { worker.child.send({ botId, op: 'close' }, () => {}); worker.botIds.delete(botId); return; }
    this.workers.delete(key);
    try { process.kill(-worker.child.pid, 'SIGKILL'); } catch {}
  }
  close() {
    const closing = [...this.workers.values()].map(worker => new Promise(resolve => {
      const timer = setTimeout(() => { try { process.kill(-worker.child.pid, 'SIGKILL'); } catch {} resolve(); }, 5000); timer.unref();
      worker.child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (worker.mine) worker.child.kill('SIGTERM'); else { try { process.kill(-worker.child.pid, 'SIGKILL'); } catch { clearTimeout(timer); resolve(); } }
    }));
    this.workers.clear(); return Promise.all(closing);
  }
}
