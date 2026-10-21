import { createServer as createHttps } from 'node:https';
import { createServer as createHttp } from 'node:http';
import { randomBytes, randomUUID, X509Certificate, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from '../supervisor/node_modules/ws/wrapper.mjs';
import { runReply } from '../supervisor/queue.mjs';
import { Codex } from '../lib/codex.mjs';
import { Claude } from '../lib/claude.mjs';
import { TUNNEL_PATHS, proof, pairingLink, MAX_FRAME } from '../supervisor/link.mjs';
import { SENSITIVE } from '../supervisor/tool-policy.mjs';
import { createUi, phoneBridge, DEFAULT_UI_PORT } from './ui.mjs';

export const DEFAULT_PORT = 3230;
const PAIRING_MS = 10 * 60000;
const read = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, value) => { writeFileSync(file + '.tmp', JSON.stringify(value, null, 1), { mode: 0o600 }); renameSync(file + '.tmp', file); };

/** The addresses the phone may try: home network and Tailscale (100.64.0.0/10), never loopback. */
export function addresses() {
  return Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address)
    .sort((a, b) => Number(/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) - Number(/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(b))).slice(0, 6);
}

/**
 * The computer's identity: an id, a name and a self-signed TLS certificate made once with openssl. The phone pins
 * the certificate's fingerprint at pairing, so it never talks to another machine pretending to be this one.
 */
export function identity(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const file = join(directory, 'identity.json');
  const saved = read(file, null) || { id: randomBytes(9).toString('base64url'), name: hostname().slice(0, 40) || 'Computador' };
  if (!existsSync(file)) write(file, saved);
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '3650', '-subj', '/CN=mybots-pc'], { stdio: 'ignore' });
    chmodSync(key, 0o600);
  }
  const pem = readFileSync(cert, 'utf8');
  return { ...saved, key: readFileSync(key, 'utf8'), cert: pem, fingerprint: new X509Certificate(pem).fingerprint256 };
}

/** A one-use pairing code, valid for 10 minutes, and the link the QR carries. */
export function startPairing(directory, port = DEFAULT_PORT, advertise = addresses) {
  const me = identity(directory);
  const code = randomBytes(12).toString('base64url');
  write(join(directory, 'pairing.json'), { code, expiresAt: Date.now() + PAIRING_MS });
  return { link: pairingLink({ id: me.id, name: me.name, port, fingerprint: me.fingerprint, code, addresses: advertise() }), name: me.name };
}

/**
 * Each bot's own folder on the computer, where it creates and edits freely: ~/MyBots/<name>. The folder keeps its
 * name if the bot is renamed (the mapping is saved), and two bots with the same name get "Nome 2".
 */
export function workspaceFor(directory, projects, bot) {
  const file = join(directory, 'workspaces.json'); const map = read(file, {});
  const id = /^[0-9a-f-]{36}$/i.test(bot.id || '') ? bot.id : 'geral';
  if (!map[id]) {
    const base = String(bot.name || 'Bot').replace(/[\u0000-\u001f/\\:*?"<>|]/g, ' ').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Bot';
    const taken = new Set(Object.values(map));
    let name = base; for (let n = 2; taken.has(join(projects, name)); n++) name = `${base} ${n}`;
    map[id] = join(projects, name); write(file, map);
  }
  mkdirSync(map[id], { recursive: true, mode: 0o700 });
  return map[id];
}

/** What the bot may edit here: its own folder, the folders the person freed for it, or the whole home on Acesso total. */
export function computerFor(allowed, workspace, home = homedir()) {
  if (!allowed) return false;
  const folders = (Array.isArray(allowed.folders) ? allowed.folders : []).map(path => resolve(path.startsWith('~') ? join(home, path.slice(1)) : path))
    .filter(path => !SENSITIVE.test(path) && path !== home && path !== '/' && existsSync(path) && statSync(path).isDirectory());
  return { workspace, folders: [...new Set(folders)], full: Boolean(allowed.full), home };
}

// Folders with keys, passwords and the other IA's login. Every IA turn here runs in a bubblewrap view of the disk where
// they are empty, so no command or file read can reach them, whatever the IA decides.
const HIDDEN = ['.ssh', '.gnupg', '.mybots-pc', '.password-store', '.aws', '.kube', '.docker', '.local/share/keyrings', '.config/gh', '.config/rclone'];
export function sandboxFor(provider, home = homedir(), bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find(path => existsSync(path))) {
  if (!bwrap) return null;
  const hidden = [...HIDDEN, provider === 'claude' ? '.codex' : '.claude'].map(path => join(home, path)).filter(path => existsSync(path) && statSync(path).isDirectory());
  return [bwrap, '--dev-bind', '/', '/', '--die-with-parent', ...hidden.flatMap(path => ['--tmpfs', path])];
}

const local = { codex: new Codex(), claude: new Claude(process.env.CLAUDE_BIN || 'claude') };
/** Which IAs are logged in on this computer, and their models, for the phone to show and check. */
async function localStatus() {
  const connections = {}, models = [];
  for (const [key, client] of Object.entries(local)) {
    connections[key] = await client.status().catch(() => ({ available: false, loggedIn: false }));
    if (connections[key].loggedIn) models.push(...(await client.models().catch(() => [])).map(item => ({ ...item, provider: key === 'claude' ? 'claude' : item.provider })));
  }
  return { connections, models };
}

/**
 * The MyBots node on the computer. It waits for the paired phone, which connects to it (the phone never listens on
 * the network), and runs the turns the phone sends with the IA logged in here. The bot's tools stay on the phone:
 * a local endpoint forwards the IA's tool calls through the same connection, with the run's own token.
 */
export async function createNode({ directory = join(homedir(), '.mybots-pc'), port = DEFAULT_PORT, host = '0.0.0.0', execute = runReply, status = localStatus, advertise = addresses, projects = join(homedir(), 'MyBots'), uiPort = DEFAULT_UI_PORT, uiRoot, downloads, log = () => {} } = {}) {
  const me = identity(directory);
  const phonesFile = join(directory, 'phones.json');
  const server = createHttps({ key: me.key, cert: me.cert, minVersion: 'TLSv1.3' }, (request, response) => response.writeHead(404).end());
  const sockets = new WebSocketServer({ server, maxPayload: MAX_FRAME });
  let current = { connections: {}, models: [] };
  const refresh = async () => { current = await status(); for (const ws of sockets.clients) if (ws.phone) ws.send(JSON.stringify({ type: 'status', ...current })); };
  await refresh().catch(() => {});
  const statusTimer = setInterval(() => refresh().catch(() => {}), 5 * 60000);
  // The MyBots window on this computer talks to the phone through the paired phone's connection.
  const bridge = phoneBridge();
  const ui = createUi({ port: uiPort, phone: bridge, log, ...(uiRoot ? { root: uiRoot } : {}), ...(downloads ? { downloads } : {}) });

  sockets.on('connection', (ws, request) => {
    const nonce = randomBytes(32).toString('base64url');
    const runs = new Map(); const waiting = new Map(); let proxy = null;
    const send = value => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };
    const timer = setTimeout(() => { if (!ws.phone) ws.terminate(); }, 15000);
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });
    send({ type: 'hello', id: me.id, name: me.name, nonce });

    const ready = phone => {
      clearTimeout(timer); ws.phone = phone; bridge.attach(ws); ui.broadcast('desktop.phone', { online: true });
      log(`${phone.name} conectado (${request.socket.remoteAddress}).`);
      send({ type: 'ready', id: me.id, name: me.name, addresses: advertise(), port: server.address().port, ...current });
    };
    // Tool calls of the IA running here go to the phone's supervisor, which checks the run token as usual.
    const tunnel = () => proxy ||= new Promise((resolve, reject) => {
      const http = createHttp(async (request, response) => {
        if (!TUNNEL_PATHS.includes(request.url) || request.headers.origin) { response.writeHead(403).end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 4_000_000) { response.writeHead(413).end(); return; } chunks.push(chunk); }
        const rid = randomUUID();
        const answer = await new Promise(done => {
          const timeout = setTimeout(() => { waiting.delete(rid); done({ status: 504, headers: {}, body: '' }); }, 150000);
          waiting.set(rid, value => { clearTimeout(timeout); waiting.delete(rid); done(value); });
          send({ type: 'http', rid, method: request.method, path: request.url, body: Buffer.concat(chunks).toString('utf8'),
            headers: Object.fromEntries(['authorization', 'content-type', 'mcp-session-id', 'accept'].filter(name => request.headers[name]).map(name => [name, request.headers[name]])) });
        });
        response.writeHead(answer.status, answer.headers).end(answer.body);
      });
      http.on('error', reject);
      http.listen(0, '127.0.0.1', () => resolve(http));
    });

    ws.on('message', async raw => {
      let message; try { message = JSON.parse(raw); } catch { ws.terminate(); return; }
      if (!ws.phone) {
        const phones = read(phonesFile, []);
        if (message.type === 'pair' && typeof message.code === 'string' && typeof message.phoneId === 'string') {
          const pairing = read(join(directory, 'pairing.json'), null);
          const valid = pairing && Date.now() < pairing.expiresAt && Buffer.byteLength(message.code) === Buffer.byteLength(pairing.code) && timingSafeEqual(Buffer.from(message.code), Buffer.from(pairing.code));
          if (!valid) { send({ type: 'refused', error: 'Código de pareamento inválido ou vencido. Gere outro no computador.' }); ws.close(); return; }
          try { unlinkSync(join(directory, 'pairing.json')); } catch {}
          const phone = { id: message.phoneId.slice(0, 64), name: String(message.phoneName || 'Celular').slice(0, 40), secret: randomBytes(32).toString('base64url'), pairedAt: new Date().toISOString() };
          write(phonesFile, [...phones.filter(item => item.id !== phone.id), phone]);
          send({ type: 'paired', secret: phone.secret }); ready(phone); return;
        }
        const phone = message.type === 'auth' && phones.find(item => item.id === message.phoneId);
        const expected = phone && proof(phone.secret, nonce);
        if (!expected || typeof message.proof !== 'string' || Buffer.byteLength(message.proof) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(message.proof), Buffer.from(expected))) {
          send({ type: 'refused', error: 'Este celular não está pareado com o computador.' }); ws.close(); return;
        }
        ready(phone); return;
      }
      if (message.type === 'rpc_reply') { bridge.answer(message); return; }
      if (message.type === 'event') { ui.broadcast(message.event, message.data); return; }
      if (message.type === 'http_reply') { waiting.get(message.rid)?.({ status: message.status, headers: message.headers || {}, body: message.body || '' }); return; }
      if (message.type === 'cancel') { runs.get(message.id)?.abort('cancelled'); return; }
      if (message.type !== 'run' || typeof message.id !== 'string' || runs.has(message.id)) return;
      const controller = new AbortController(); runs.set(message.id, controller);
      try {
        const bot = message.bot || {};
        const workspace = workspaceFor(directory, projects, bot);
        const endpoint = message.tools ? `http://127.0.0.1:${(await tunnel()).address().port}` : null;
        log(`Respondendo como ${bot.name}.`);
        const reply = await execute(bot, message.prompt, {
          signal: controller.signal, workspace,
          wrap: sandboxFor(bot.provider) || undefined,
          tools: message.tools ? { ...message.tools, device: me.name, computer: computerFor(message.tools.computer, workspace), endpoint, entry: fileURLToPath(new URL('../supervisor/mcp/index.mjs', import.meta.url)) } : undefined,
          onSession: async sessionId => send({ type: 'session', id: message.id, sessionId }), onProcess: () => {}
        });
        send({ type: 'done', id: message.id, reply });
      } catch (error) {
        send({ type: 'failed', id: message.id, error: error.message, ...(error.output ? { output: String(error.output).slice(-20000) } : {}), ...(error.codexSessionId ? { codexSessionId: error.codexSessionId } : {}) });
      } finally { runs.delete(message.id); }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      // The phone went away: its turns end there (it marks them interrupted) and must not keep running here.
      for (const controller of runs.values()) controller.abort('phone_lost');
      for (const done of waiting.values()) done({ status: 502, headers: {}, body: '' });
      proxy?.then(http => http.close(), () => {});
      if (ws.phone) { log(`${ws.phone.name} desconectado.`); bridge.detach(ws); ui.broadcast('desktop.phone', { online: false }); }
    });
  });
  const ping = setInterval(() => { for (const ws of sockets.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 20000);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const windowPort = await ui.listen();
  return { id: me.id, name: me.name, fingerprint: me.fingerprint, port: server.address().port, uiPort: windowPort, refresh,
    pairing: () => startPairing(directory, server.address().port, advertise),
    phones: () => read(phonesFile, []).map(({ secret, ...phone }) => phone),
    async close() { clearInterval(ping); clearInterval(statusTimer); for (const ws of sockets.clients) ws.terminate(); await Promise.all([new Promise(resolve => server.close(resolve)), ui.close()]); } };
}
