import { personInput as cleanPersonInput } from '../supervisor/browser.mjs';
import { createServer as createHttps } from 'node:https';
import { createServer as createHttp } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { randomBytes, randomUUID, X509Certificate, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync, renameSync, statSync, readdirSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep, relative, isAbsolute, basename } from 'node:path';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from '../supervisor/node_modules/ws/wrapper.mjs';
import { runReply } from '../supervisor/queue.mjs';
import { Codex } from '../lib/codex.mjs';
import { Claude } from '../lib/claude.mjs';
import agentSkills from '../lib/agent-skills.cjs';
const { discover, enabledFor } = agentSkills;
import { TUNNEL_PATHS, proof, pairingLink, MAX_FRAME } from '../supervisor/link.mjs';
import { SENSITIVE, browserMode } from '../supervisor/tool-policy.mjs';
import { createUi, phoneBridge, paced, DEFAULT_UI_PORT } from './ui.mjs';
import { Desktop } from './desktop.mjs';
import { PcBrowser } from './browser.mjs';
import { createDictation } from './dictation.mjs';
import { createDiscovery } from './discovery.mjs';
import { encodeFrame, frameMetadata, viewSize, ViewGovernor } from '../supervisor/browser-frame.mjs';
import { tailscaleAddress } from '../supervisor/discovery.mjs';

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

/** A folder typed on the phone (~/vscodeprojects) found on this disk even if the letters' case differs (~/vscodeProjects). */
function findFolder(path) {
  if (existsSync(path)) return path;
  let current = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    const exact = join(current, part);
    if (existsSync(exact)) { current = exact; continue; }
    let match; try { match = readdirSync(current).find(name => name.toLowerCase() === part.toLowerCase()); } catch { return null; }
    if (!match) return null;
    current = join(current, match);
  }
  return current;
}

/** What the bot may edit here: its own folder, the folders the person freed for it, or the whole home on Acesso total. */
export function computerFor(allowed, workspace, home = homedir(), skills = []) {
  if (!allowed) return false;
  const folders = (Array.isArray(allowed.folders) ? allowed.folders : []).map(path => findFolder(resolve(path.startsWith('~') ? join(home, path.slice(1)) : path)))
    .filter(path => path && !SENSITIVE.test(path) && path !== home && path !== '/' && statSync(path).isDirectory());
  // Skills turned on: Claude may look into their folders (--add-dir); Codex may write only in the ones to improve.
  return { workspace, folders: [...new Set(folders)], full: Boolean(allowed.full), home, skillDirs: skills.map(skill => skill.path), skillWritable: skills.filter(skill => skill.write).map(skill => skill.path) };
}

/** The graphics card's device files that exist here: the DRM nodes and the NVIDIA ones. */
export function gpuDevices(dev = '/dev') {
  const names = []; try { names.push(...readdirSync(dev)); } catch {}
  return [...(names.includes('dri') ? ['dri'] : []), ...names.filter(name => /^nvidia/.test(name))].map(name => join(dev, name));
}

// Folders with keys, passwords and the other IA's login. Every IA turn here runs in a bubblewrap view of the disk where
// they are empty, so no command or file read can reach them, whatever the IA decides.
const HIDDEN = ['.ssh', '.gnupg', '.mybots-pc', '.password-store', '.aws', '.kube', '.docker', '.local/share/keyrings', '.config/gh', '.config/rclone', '.config/google-chrome'];
export function sandboxFor(provider, home = homedir(), bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find(path => existsSync(path)), directory = join(home, '.mybots-pc'), { skills = [], gpu = false, dev = '/dev' } = {}) {
  if (!bwrap) return null;
  const hidden = [...new Set([...HIDDEN, provider === 'claude' ? '.codex' : '.claude'].map(path => join(home, path)).concat(directory))].filter(path => existsSync(path) && statSync(path).isDirectory());
  // Desktop access only through the MCP executor, including for bots with terminal access. A private /proc
  // prevents reaching the host's sockets and browser profiles through another process's root directory.
  const desktop = [process.env.XDG_RUNTIME_DIR, '/tmp/hypr', '/tmp/.X11-unix'].filter(path => path?.startsWith('/') && existsSync(path) && statSync(path).isDirectory());
  const sockets = ['/tmp/.ydotool_socket', process.env.YDOTOOL_SOCKET, process.env.XAUTHORITY, join(home, '.Xauthority')].filter(path => path?.startsWith('/') && existsSync(path) && !statSync(path).isDirectory());
  // Skills turned on for the bot: only their folder, at the same absolute path, mounted after the folders hidden above
  // (a skill under ~/.claude stays reachable for a Codex bot while the rest of ~/.claude is empty). Read-only unless
  // the person allowed improving it.
  const folders = skills.filter(skill => skill?.path && existsSync(skill.path)).flatMap(skill => [skill.write ? '--bind' : '--ro-bind', skill.path, skill.path]);
  // The graphics card only when the person turned it on for this bot: the private /dev has no render devices.
  const devices = gpu ? gpuDevices(dev).flatMap(path => ['--dev-bind', path, path]) : [];
  return [bwrap, '--dev-bind', '/', '/', '--die-with-parent', '--unshare-pid', '--proc', '/proc', '--dev', '/dev',
    ...[...new Set([...hidden, ...desktop])].flatMap(path => ['--tmpfs', path]), ...[...new Set(sockets)].flatMap(path => ['--ro-bind', '/dev/null', path]), ...folders, ...devices];
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

const FILE_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', doc: 'application/msword', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
/** The files a bot's browser downloaded here (~/.mybots-pc/downloads/<bot>): listed, read (to open or send to the bot) and removed for the phone. */
export function browserFiles(root, botId, op, name) {
  if (!/^[0-9a-f-]{36}$/i.test(botId || '')) throw new Error('Bot inválido.');
  const folder = join(root, botId);
  const list = () => { try { return readdirSync(folder, { withFileTypes: true }).filter(item => item.isFile()).map(item => { const stat = statSync(join(folder, item.name)); return { name: item.name, size: stat.size, at: stat.mtime.toISOString(), where: 'pc' }; }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100); } catch { return []; } };
  if (op === 'list') return { files: list() };
  const file = typeof name === 'string' && list().find(item => item.name === name);
  if (!file) throw new Error('Arquivo não encontrado nos downloads do computador.');
  if (op === 'delete') { unlinkSync(join(folder, file.name)); return { deleted: true }; }
  if (op !== 'get') throw new Error('Pedido inválido.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Arquivos de até 20 MB podem ir ao celular.');
  return { ...file, mime: FILE_TYPES[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream', data: readFileSync(join(folder, file.name)).toString('base64') };
}

/**
 * One part (3 MB) of a file the bot asked to send with file_send. Only what the bot may already read: its own folder,
 * the folders freed for it, or the home on Acesso total; never hidden folders or secrets.
 */
export function botFilePart(computer, input, offset = 0, part = 3 * 1024 * 1024) {
  if (!computer || typeof input !== 'string' || !input.trim() || input.length > 1000) throw new Error('Este bot não pode mexer no computador.');
  const home = computer.home || homedir();
  let real; try { real = realpathSync(isAbsolute(input) ? input : input.startsWith('~') ? join(home, input.slice(1)) : resolve(computer.workspace, input)); } catch { throw new Error('Não achei esse arquivo no computador.'); }
  const inside = base => { const rel = relative(base, real); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  const roots = [computer.workspace, ...computer.folders, ...(computer.full ? [home] : [])];
  if (!roots.some(inside) || SENSITIVE.test(real) || (computer.full && !inside(computer.workspace) && !computer.folders.some(inside) && relative(home, real).split(sep).some(name => name.startsWith('.')))) throw new Error('Esse arquivo está fora do que este bot pode acessar no computador.');
  const info = statSync(real);
  if (!info.isFile()) throw new Error('Isso não é um arquivo.');
  const fd = openSync(real, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, Math.min(part, info.size - offset))); const read = buffer.length ? readSync(fd, buffer, 0, buffer.length, offset) : 0;
    return { name: basename(real), size: info.size, chunk: buffer.subarray(0, read).toString('base64'), next: offset + part < info.size ? offset + part : null };
  } finally { closeSync(fd); }
}

/**
 * The MyBots node on the computer. It waits for the paired phone, which connects to it (the phone never listens on
 * the network), and runs the turns the phone sends with the IA logged in here. The bot's tools stay on the phone:
 * a local endpoint forwards the IA's tool calls through the same connection, with the run's own token.
 */
export async function createNode({ directory = join(homedir(), '.mybots-pc'), port = DEFAULT_PORT, host = '0.0.0.0', execute = runReply, status = localStatus, advertise = addresses, projects = join(homedir(), 'MyBots'), uiPort = DEFAULT_UI_PORT, uiRoot, downloads, discoveryPort, discoveryLoopback = false, desktop = new Desktop(), browser = new PcBrowser(directory), log = () => {} } = {}) {
  const me = identity(directory);
  const controls = new Set(); let owner = null;
  const dictation = createDictation(directory);
  // The live view of each bot's Chrome: who watches it (the phone, the window here) and which bots the person took over.
  // Only a taken-over browser accepts the person's taps and keys; the phone decides that and tells the node.
  const viewOptions = new Map(), viewGovernor = new ViewGovernor(); let viewTimer;
  const views = new Map(), browserModes = new Map(); let assumed = new Set();
  const configureBrowser = bot => { const mode = browserMode(bot); browserModes.set(bot.id, mode); browser.configure?.(bot.id, mode); };
  browser.onFrame = (botId, frame) => { for (const sink of views.get(botId) || []) sink(frame); };
  const updateView = async (botId, force = false) => {
    const sinks = [...(views.get(botId) || [])];
    const sizes = sinks.map(sink => sink.options || viewSize());
    const wanted = { on: sinks.length > 0, maxWidth: sizes.length ? Math.max(...sizes.map(size => size.maxWidth)) : 1280, maxHeight: sizes.length ? Math.max(...sizes.map(size => size.maxHeight)) : 800, interactive: assumed.has(botId) || sinks.some(sink => sink.direct), home: sinks.some(sink => sink.direct), congested: sinks.some(sink => sink.remoteCongested) };
    const bytes = Math.max(0, ...sinks.map(sink => sink.bufferedAmount?.() || 0), wanted.congested ? 300_000 : 0);
    const options = viewGovernor.next(botId, wanted, bytes);
    if (!options) { if (force && viewOptions.has(botId)) await browser.command(botId, 'view', viewOptions.get(botId)); return; }
    const previous = viewOptions.get(botId);
    if (!force && previous && Object.keys(options).every(key => previous[key] === options[key])) return;
    viewOptions.set(botId, options);
    try { await browser.command(botId, 'view', options); }
    catch (error) { for (const sink of sinks) sink({ error: error.message }); }
  };
  const watch = async (botId, sink, on, mode, options) => {
    if (on) {
      if (mode) configureBrowser({ id: botId, browserMode: mode });
      else { const state = await bridge.call('state.get', {}); const bot = state.bots?.find(bot => bot.id === botId); if (!bot) throw new Error('Bot não encontrado.'); if (browserMode(bot) === 'mine' && (bot.access === 'basic' || state.grants?.[botId]?.find(grant => grant.name === 'browser')?.state !== 'allow')) throw new Error('Libere Navegador no perfil do bot para usar Meu Chrome.'); configureBrowser(bot); }
    }
    if (options) sink.remoteCongested = Boolean(options.congested);
    sink.options = viewSize(options || sink.options);
    const sinks = views.get(botId) || new Set();
    if (on) sinks.add(sink); else sinks.delete(sink);
    if (sinks.size) views.set(botId, sinks); else views.delete(botId);
    if (views.size && !viewTimer) viewTimer = setInterval(() => { for (const id of views.keys()) updateView(id).catch(() => {}); }, 500);
    if (!views.size && viewTimer) { clearInterval(viewTimer); viewTimer = null; }
    await updateView(botId, on);
  };
  // The computer's own window may always use the page (no "Assumir"); the phone's taps still need it.
  const personInput = async (botId, input, direct = false) => {
    if (!direct && !assumed.has(botId)) throw new Error('Toque em Assumir antes de usar a página.');
    return browser.command(botId, 'input', cleanPersonInput(input));
  };
  const panic = () => { for (const run of controls) run.controller.abort('panic'); return browser.close(); };
  const panicPath = join(directory, 'panic.sock');
  // Refuse a second node using this directory. A stale socket can be removed after an unclean shutdown.
  if (existsSync(panicPath)) {
    const { createConnection } = await import('node:net');
    const live = await new Promise(resolve => { const socket = createConnection(panicPath); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); });
    if (live) throw new Error('Já existe um nó usando esta pasta.');
    unlinkSync(panicPath);
  }
  const panicServer = createSocket(socket => { socket.once('data', data => { if (data.toString() === 'panic') { panic(); socket.end('ok'); } else socket.end(); }); });
  await new Promise((resolve, reject) => { panicServer.once('error', reject); panicServer.listen(panicPath, resolve); }); chmodSync(panicPath, 0o600);
  const phonesFile = join(directory, 'phones.json');
  const server = createHttps({ key: me.key, cert: me.cert, minVersion: 'TLSv1.3' }, (request, response) => response.writeHead(404).end());
  const sockets = new WebSocketServer({ server, maxPayload: MAX_FRAME });
  let current = { connections: {}, models: [] };
  const refresh = async () => { current = await status(); for (const ws of sockets.clients) if (ws.phone) ws.send(JSON.stringify({ type: 'status', ...current })); };
  await refresh().catch(() => {});
  const statusTimer = setInterval(() => refresh().catch(() => {}), 5 * 60000);
  // The MyBots window on this computer talks to the phone through the paired phone's connection.
  const bridge = phoneBridge();
  const ui = createUi({ port: uiPort, phone: bridge, log, browser: { watch, input: (botId, input) => personInput(botId, input, true) }, dictation, tokenFile: join(directory, 'ui-token'), pairing: () => startPairing(directory, server.address().port, advertise), phones: () => read(phonesFile, []), network: () => ({ tailscale: advertise().some(tailscaleAddress) }), ...(uiRoot ? { root: uiRoot } : {}), ...(downloads ? { downloads } : {}) });

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
      send({ type: 'ready', id: me.id, name: me.name, addresses: advertise(), port: server.address().port, tailscale: advertise().some(tailscaleAddress), ...current });
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
      if (message.type === 'browser_view' && typeof message.botId === 'string') {
        ws.views ||= new Map();
        if (message.on && !ws.views.has(message.botId)) {
          let previous = {};
          ws.views.set(message.botId, paced(frame => {
            if (!frame.image) { send({ type: 'browser_frame', botId: message.botId, ...frame }); return; }
            if (ws.readyState !== 1) return;
            const value = { botId: message.botId, ...frame }; ws.send(encodeFrame(value, previous)); previous = frameMetadata(value);
          }, () => ws.readyState === 1 && ws.bufferedAmount > 1_000_000));
          ws.views.get(message.botId).bufferedAmount = () => ws.bufferedAmount;
        }
        const sink = ws.views.get(message.botId);
        if (!message.on) ws.views.delete(message.botId);
        if (sink) watch(message.botId, sink, Boolean(message.on), message.browserMode || 'shared', message).catch(() => {});
        return;
      }
      if (message.type === 'browser_files' && typeof message.rid === 'string') {
        try { send({ type: 'pc_result', rid: message.rid, result: browserFiles(browser.downloads || join(directory, 'downloads'), message.botId, message.op, message.name) }); }
        catch (error) { send({ type: 'pc_result', rid: message.rid, error: error.message }); }
        return;
      }
      if (message.type === 'pc_file' && typeof message.rid === 'string') {
        try {
          const run = [...runs.values()].find(item => item.bot.id === message.botId && item.computer);
          send({ type: 'pc_result', rid: message.rid, result: botFilePart(run?.computer, message.path, Number.isInteger(message.offset) && message.offset >= 0 ? message.offset : 0) });
        } catch (error) { send({ type: 'pc_result', rid: message.rid, error: error.message }); }
        return;
      }
      if (message.type === 'agent_skills' && typeof message.rid === 'string') {
        try { send({ type: 'pc_result', rid: message.rid, result: { skills: discover().map(({ id, name, description, path, source }) => ({ id, name, description, path, source })) } }); }
        catch (error) { send({ type: 'pc_result', rid: message.rid, error: error.message }); }
        return;
      }
      if (message.type === 'browser_control' && message.control && typeof message.control === 'object') { for (const [id, mode] of Object.entries(message.modes || {})) if (['own','shared','separate','mine','claude'].includes(mode)) configureBrowser({ id, browserMode: mode }); const previousControl = assumed; assumed = new Set(Object.entries(message.control).filter(([, who]) => who === 'person').map(([botId]) => botId)); for (const botId of previousControl) if (!assumed.has(botId)) browser.command(botId, 'device', { restore: true }).catch(() => {}); for (const botId of views.keys()) updateView(botId).catch(() => {}); return; }
      if (message.type === 'browser_input' && typeof message.botId === 'string') {
        personInput(message.botId, message.input).then(() => { if (message.rid) send({ type: 'pc_result', rid: message.rid, result: { sent: true } }); }, () => message.rid ? send({ type: 'pc_result', rid: message.rid, error: 'Entrada recusada.' }) : send({ type: 'browser_frame', botId: message.botId, error: 'Toque em Assumir antes de usar a página.' }));
        return;
      }
      if (message.type === 'http_reply') { waiting.get(message.rid)?.({ status: message.status, headers: message.headers || {}, body: message.body || '' }); return; }
      if (message.type === 'cancel') { runs.get(message.id)?.controller.abort('cancelled'); return; }
      if (message.type === 'pc_command') {
        // A bot that answers on the phone has no run here: its browser ops are checked by the supervisor, and only the bot's own Chromium is reachable.
        const direct = !message.id && typeof message.botId === 'string' && ['shared', 'separate'].includes(message.mode) && /^browser\.(act|tabs|find|open|read|inspect|click|type|upload|wait|screenshot|login|login_fill|login_cancel|pay|pay_fill|pay_clear|thumb)$/.test(message.op);
        if (direct && browserModes.get(message.botId) !== message.mode) configureBrowser({ id: message.botId, browserMode: message.mode });
        const run = direct ? { controller: new AbortController(), bot: { id: message.botId, browserMode: message.mode }, tools: { browser: true } } : runs.get(message.id);
        try {
          if (!run || run.controller.signal.aborted) throw new Error('A resposta no computador já foi interrompida.');
          const isDesktop = typeof message.op === 'string' && message.op.startsWith('desktop.');
          const mainChrome = browserMode(run.bot) === 'claude';
          const chrome = mainChrome && message.op === 'chrome.begin';
          if (isDesktop ? !run.tools?.desktop : !run.tools?.browser || (!chrome && (mainChrome || !/^browser\.(act|tabs|find|open|read|inspect|click|type|upload|wait|screenshot|login|login_fill|login_cancel|pay|pay_fill|pay_clear|thumb)$/.test(message.op)))) throw new Error('Ferramenta não permitida nesta resposta.');
          if (!isDesktop && browserMode(run.bot) === 'mine' && [...assumed].some(id => browserModes.get(id) === 'mine')) throw new Error('A pessoa assumiu Meu Chrome. Espere ela devolver.');
          // Only the screen and the mouse have one pilot at a time; each bot's browser is its own, so they run side by side.
          if (isDesktop) { if (owner && owner !== run) throw new Error('Outro bot está controlando o computador. Aguarde ele terminar.'); owner = run; }
          run.indicator ||= direct ? Promise.resolve(() => {}) : desktop.indicate(run.bot);
          const dismiss = await run.indicator;
          if (run.controller.signal.aborted) { await dismiss(); throw new Error('Controle interrompido.'); }
          const result = chrome ? { ready: true } : isDesktop ? await desktop.command(message.op, message.args, run.controller.signal) : await browser.command(run.bot.id, message.op.slice(8), message.args, run.controller.signal);
          if (run.controller.signal.aborted) throw new Error('Controle interrompido.');
          send({ type: 'pc_result', rid: message.rid, result });
        } catch (error) { send({ type: 'pc_result', rid: message.rid, error: error.message }); }
        return;
      }
      if (message.type !== 'run' || typeof message.id !== 'string' || runs.has(message.id)) return;
      const controller = new AbortController(); const run = { controller, bot: message.bot || {}, tools: message.tools };
      runs.set(message.id, run); controls.add(run);
      controller.signal.addEventListener('abort', () => { if (controller.signal.reason !== 'finished') browser.stop(run.bot.id); run.indicator?.then(dismiss => dismiss(), () => {}); }, { once: true });
      try {
        const bot = message.bot || {}; configureBrowser(bot);
        const workspace = workspaceFor(directory, projects, bot);
        const endpoint = message.tools ? `http://127.0.0.1:${(await tunnel()).address().port}` : null;
        const enabledSkills = enabledFor(bot, discover());
        const wrap = sandboxFor(bot.provider, homedir(), undefined, directory, { skills: enabledSkills, gpu: bot.gpu === true });
        if (!wrap) throw new Error('Instale bubblewrap no computador antes de responder; o isolamento é obrigatório.');
        log(`Respondendo como ${bot.name}.`);
        const computer = message.tools ? computerFor(message.tools.computer, workspace, undefined, enabledSkills) : undefined; run.computer = computer || null;
        const reply = await execute(bot, message.prompt, {
          signal: controller.signal, workspace,
          wrap,
          tools: message.tools ? { ...message.tools, chrome: browserMode(bot) === 'claude' && Boolean(message.tools.browser), browserMode: browserMode(bot), device: me.name, computer, skills: enabledSkills, gpu: bot.gpu === true, endpoint, entry: fileURLToPath(new URL('../supervisor/mcp/index.mjs', import.meta.url)) } : undefined,
          onSession: async sessionId => send({ type: 'session', id: message.id, sessionId }), onProcess: () => {},
          onProgress: progress => send({ type: 'progress', id: message.id, ...progress }),
          onDelta: draft => send({ type: 'progress', id: message.id, draft })
        });
        if (controller.signal.aborted) throw new Error(controller.signal.reason === 'panic' ? 'Resposta interrompida pela tecla de pânico no computador.' : 'Resposta interrompida.');
        send({ type: 'done', id: message.id, reply });
      } catch (error) {
        send({ type: 'failed', id: message.id, error: controller.signal.reason === 'panic' ? 'Resposta interrompida pela tecla de pânico no computador.' : error.message, ...(error.output ? { output: String(error.output).slice(-20000) } : {}), ...(error.codexSessionId ? { codexSessionId: error.codexSessionId } : {}) });
      } finally {
        runs.delete(message.id); controls.delete(run); if (owner === run) owner = null;
        // A login or payment still pending ends with the turn, and a card left in a checkout's fields is cleared.
        if (!controller.signal.aborted && (browser.running ? browser.running(run.bot.id) : browser.workers?.has(run.bot.id))) {
          await browser.command(run.bot.id, 'login_cancel', {}, controller.signal).catch(() => {});
          await browser.command(run.bot.id, 'pay_clear', {}, controller.signal).catch(() => {});
        }
        controller.abort('finished');
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      // The phone went away: its turns end there (it marks them interrupted) and must not keep running here.
      for (const run of runs.values()) run.controller.abort('phone_lost');
      for (const done of waiting.values()) done({ status: 502, headers: {}, body: '' });
      assumed = new Set();
      for (const [botId, sink] of ws.views || []) watch(botId, sink, false).catch(() => {});
      proxy?.then(http => http.close(), () => {});
      if (ws.phone) { log(`${ws.phone.name} desconectado.`); bridge.detach(ws); ui.broadcast('desktop.phone', { online: false }); }
    });
  });
  const ping = setInterval(() => { for (const ws of sockets.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 20000);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const windowPort = await ui.listen();
  const discovery = await createDiscovery({ id: me.id, port: server.address().port, addresses: advertise, discoveryPort, allowLoopback: discoveryLoopback, log });
  return { id: me.id, name: me.name, fingerprint: me.fingerprint, port: server.address().port, uiPort: windowPort, discoveryPort: discovery.port, refresh,
    pairing: () => startPairing(directory, server.address().port, advertise),
    phones: () => read(phonesFile, []).map(({ secret, ...phone }) => phone), panic,
    async close() { const stopped = panic(); dictation.close(); clearInterval(ping); clearInterval(statusTimer); clearInterval(viewTimer); for (const ws of sockets.clients) ws.terminate(); await Promise.all([stopped, new Promise(resolve => server.close(resolve)), new Promise(resolve => panicServer.close(resolve)), ui.close(), discovery.close()]); } };
}
