import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

/**
 * The browser's process owns its profile and ephemeral login key. The node only relays encrypted logins, and the
 * frames of the live view to `onFrame` (a closed browser sends `{ closed: true }`).
 */
export class PcBrowser {
  constructor(directory, { onFrame = () => {} } = {}) { this.directory = directory; this.workers = new Map(); this.onFrame = onFrame; }
  worker(botId) {
    if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error('Bot inválido.');
    if (this.workers.has(botId)) return this.workers.get(botId);
    const profile = join(this.directory, 'browsers', botId);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    const env = Object.fromEntries(['PATH', 'HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = fork(fileURLToPath(new URL('./browser-worker.mjs', import.meta.url)), [profile], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true });
    const worker = { child, pending: new Map() }; this.workers.set(botId, worker);
    const end = () => {
      if (this.workers.get(botId) === worker) this.workers.delete(botId);
      for (const done of worker.pending.values()) done({ error: 'O navegador do computador foi interrompido.' });
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      this.onFrame(botId, { closed: true });
    };
    child.on('error', end); child.on('exit', end);
    child.on('message', message => message.frame ? this.onFrame(botId, message.frame) : worker.pending.get(message.id)?.(message));
    return worker;
  }
  command(botId, op, args, signal) {
    signal?.throwIfAborted();
    const worker = this.worker(botId); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const stop = () => this.stop(botId);
      const done = ({ result, error }) => { clearTimeout(timer); worker.pending.delete(id); signal?.removeEventListener('abort', stop); error ? reject(new Error(error)) : resolve(result); };
      const timer = setTimeout(() => { stop(); done({ error: 'O navegador do computador demorou para responder.' }); }, 130000);
      worker.pending.set(id, done); signal?.addEventListener('abort', stop, { once: true });
      worker.child.send({ id, op, args }, error => { if (error) done({ error: 'O processo do navegador encerrou.' }); });
    });
  }
  stop(botId) {
    const worker = this.workers.get(botId);
    if (!worker) return;
    this.workers.delete(botId);
    try { process.kill(-worker.child.pid, 'SIGKILL'); } catch {}
  }
  close() { for (const botId of this.workers.keys()) this.stop(botId); }
}
