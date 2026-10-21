import { browserMode } from '../mobile/local.js';
import { createHmac, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { discover } from './discovery.mjs';

// What the computer may ask the phone's supervisor for: only the IA's tool calls, each checked by its run token.
export const TUNNEL_PATHS = ['/mcp', '/tools/claim', '/tools/call', '/tools/list', '/tools/chrome'];
export const MAX_FRAME = 32 * 1024 * 1024;
const NOT_FOUND = 'Não achei o computador neste Wi-Fi. Confira se ele está ligado e na mesma rede, ou use o Tailscale para funcionar de qualquer lugar.';
const RETRY_MS = [2000, 5000, 10000, 20000, 30000];
const HEADERS = ['authorization', 'content-type', 'mcp-session-id', 'accept'];
// What the MyBots window on the computer may do on the phone: the conversation and the bots, not secrets,
// backups, connectors with passwords, pairing or the phone's own hardware.
export const DESKTOP_METHODS = ['state.get', 'connection.refresh', 'bots.list', 'bot.create', 'bot.update', 'bot.delete', 'bot.apps', 'chat.history', 'chat.send',
  'tasks.list', 'task.cancel', 'activity.list', 'grants.set', 'approval.respond', 'room.create', 'room.update', 'room.delete', 'room.send', 'person.update',
  'limits.refresh', 'account.connectors', 'routines.list', 'routine.update', 'routine.delete', 'routine.run', 'item.complete', 'file.read', 'computer.retry', 'skill.run', 'skill.remove', 'browser.control'];
// Events the window needs to refresh; the phone's notice delivery (bot.notify) stays on the phone.
const DESKTOP_EVENTS = ['task.progress', 'task.done', 'activity.new', 'connection.changed', 'browser.changed'];

/** What the phone proves at each connection: it holds the secret the computer gave it at pairing. */
export const proof = (secret, nonce) => createHmac('sha256', secret).update('mybots-link:' + nonce).digest('base64url');

/** The pairing link the computer's QR carries: who it is, where, its certificate and a one-use code. */
export function pairingLink({ id, name, port, fingerprint, code, addresses }) {
  // The certificate's SHA-256 goes as base64url (43 characters instead of 95), so the QR stays small.
  return 'mybots://computador?' + new URLSearchParams({ v: '1', id, n: name, p: String(port), f: Buffer.from(fingerprint.replace(/:/g, ''), 'hex').toString('base64url'), c: code, a: addresses.join(',') });
}
export function parsePairing(text) {
  let url; try { url = new URL(String(text).trim()); } catch { url = null; }
  const get = name => url?.searchParams.get(name) || '';
  const port = Number(get('p')); const addresses = get('a').split(',').filter(item => /^[0-9a-z.:-]{1,253}$/i.test(item)).slice(0, 6);
  if (!url || url.protocol !== 'mybots:' || url.host !== 'computador' || get('v') !== '1' || !/^[A-Za-z0-9_-]{1,64}$/.test(get('id')) || !Number.isInteger(port) || port < 1 || port > 65535
    || !/^[A-Za-z0-9_-]{43}$/.test(get('f')) || !/^[A-Za-z0-9_-]{8,64}$/.test(get('c')) || !addresses.length) throw new Error('Este QR não é de um computador com o MyBots.');
  const fingerprint = Buffer.from(get('f'), 'base64url').toString('hex').toUpperCase().match(/../g).join(':');
  return { id: get('id'), name: get('n').slice(0, 40) || 'Computador', port, fingerprint, code: get('c'), addresses };
}

/**
 * The phone's side of the link to the paired computer. The phone always dials out (its supervisor keeps listening
 * on 127.0.0.1 only), checks the computer's certificate against the one pinned at pairing, proves itself with
 * the pairing secret, and then lends the computer to the queue as a node (`nodes.connect`) until the link drops.
 */
export class Link {
  constructor(db, nodes, { port, changed = () => {}, rpc = null, WebSocketClass = WebSocket, discoveryTargets, discoveryPort, discoveryTimeout = 2000 } = {}) {
    Object.assign(this, { db, nodes, port, changed, rpc, WebSocketClass, discoveryTargets, discoveryPort, discoveryTimeout });
    this.lastDiscovery = -Infinity; this.generation = 0;
    this.runs = new Map(); this.state = 'offline'; this.error = ''; this.attempt = 0; this.closed = false;
    this.commands = new Map();
    // The bots' Chrome live views the app is watching, and who controls each browser; both are sent again on reconnect.
    this.watching = new Set(); this.controls = {}; this.onFrame = () => {};
  }
  saved() { try { return JSON.parse(this.db.get("SELECT value FROM metadata WHERE key='link.computer'")?.value || 'null'); } catch { return null; } }
  save(value) { this.db.run("INSERT INTO metadata VALUES('link.computer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(value)); }
  phoneId() {
    let id = this.db.get("SELECT value FROM metadata WHERE key='link.phone'")?.value;
    if (!id) { id = randomUUID(); this.db.run("INSERT INTO metadata VALUES('link.phone',?)", id); }
    return id;
  }
  status() {
    const saved = this.saved();
    return saved ? { paired: true, id: saved.id, name: saved.name, addresses: saved.addresses, tailscale: saved.tailscale === true, state: this.state, error: this.error } : { paired: false, state: 'offline' };
  }
  set(state, error = '') { if (state === this.state && error === this.error) return; this.state = state; this.error = error; this.changed('connection.changed'); }
  start() { if (this.saved() && !this.socket && !this.timer) this.connect(); }
  /** Opens a TLS WebSocket to one address and waits for the computer's hello, refusing any other certificate. */
  open(address, port, fingerprint) {
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketClass(`wss://${address.includes(':') ? `[${address}]` : address}:${port}/`, { rejectUnauthorized: false, handshakeTimeout: 5000, maxPayload: MAX_FRAME });
      const fail = error => { clearTimeout(timer); ws.removeAllListeners('message'); ws.terminate(); reject(error); };
      const timer = setTimeout(() => fail(new Error('timeout')), 8000);
      ws.on('upgrade', response => { if (response.socket.getPeerCertificate?.()?.fingerprint256 !== fingerprint) fail(new Error('Outro aparelho respondeu no lugar do computador pareado.')); });
      ws.on('error', fail);
      ws.once('message', raw => {
        clearTimeout(timer);
        try { const hello = JSON.parse(raw); if (hello.type !== 'hello' || typeof hello.nonce !== 'string') throw new Error(); ws.off('error', fail); resolve({ ws, hello }); }
        catch { fail(new Error('O computador respondeu algo inesperado.')); }
      });
    });
  }
  async reach(target) {
    let last;
    for (const address of target.addresses) {
      try { return await this.open(address, target.port, target.fingerprint); }
      catch (error) { last = error; if (/Outro aparelho/.test(error.message)) throw error; }
    }
    throw last || new Error('Sem endereço.');
  }
  /** Pairs with the computer whose QR was scanned. The one-use code is traded for a secret kept on the phone. */
  async pair(text) {
    const target = parsePairing(text);
    let connection;
    try { connection = await this.reach(target); }
    catch (error) { throw new Error(/Outro aparelho/.test(error.message) ? error.message : 'Não encontrei o computador. Confira se o MyBots está rodando nele e se os dois estão no mesmo Wi-Fi (ou na mesma Tailscale).'); }
    const { ws, hello } = connection;
    if (hello.id !== target.id) { ws.terminate(); throw new Error('Outro aparelho respondeu no lugar do computador.'); }
    const name = hello.name || target.name;
    // The answer is handled inside the link itself, so the computer's "ready" right after it is never missed.
    await new Promise((resolve, reject) => {
      this.drop();
      this.attach(ws, { reject, resolve: secret => {
        this.save({ id: target.id, name, port: target.port, fingerprint: target.fingerprint, addresses: target.addresses, secret, pairedAt: new Date().toISOString() });
        this.db.record('computer_paired', `${name} pareado.`); resolve();
      } });
      ws.send(JSON.stringify({ type: 'pair', code: target.code, phoneId: this.phoneId(), phoneName: 'Celular' }));
    });
    return { name };
  }
  forget() {
    const saved = this.saved();
    this.drop(); this.db.run("DELETE FROM metadata WHERE key='link.computer'");
    if (saved) this.db.record('computer_forgotten', `${saved.name} esquecido. Para usar de novo, pareie outra vez.`);
    this.set('offline');
    return { forgotten: true };
  }
  async connect(searchFirst = false) {
    this.timer = null;
    const target = this.saved(); const generation = this.generation;
    if (this.closed || !target || this.socket || this.connecting) return;
    this.connecting = true;
    const stale = () => this.closed || this.generation !== generation || this.socket;
    this.set('connecting', this.error);
    let connection, discoveredTarget, lastError;
    const search = async () => {
      if (Date.now() - this.lastDiscovery < 15000) return;
      this.lastDiscovery = Date.now(); this.discoveryAbort = new AbortController();
      const candidates = await discover(target.id, { targets: this.discoveryTargets, port: this.discoveryPort, timeout: this.discoveryTimeout, signal: this.discoveryAbort.signal,
        onError: error => { const reason = error.code || 'erro de rede'; if (!stale() && this.discoveryError !== reason) { this.discoveryError = reason; this.db.record('computer_discovery_error', `Descoberta local indisponível (${reason}). O pareamento por QR continua disponível.`); } } });
      for (const candidate of candidates) {
        if (stale()) return;
        try {
          connection = await this.reach({ ...target, ...candidate });
          if (connection.hello.id !== target.id) { connection.ws.terminate(); connection = null; lastError = new Error('Outro aparelho respondeu no lugar do computador pareado.'); continue; }
          discoveredTarget = candidate; return;
        } catch (error) { if (/Outro aparelho/.test(error.message)) lastError = error; }
      }
    };
    try {
      if (searchFirst) await search();
      if (!connection && !stale()) {
        try { connection = await this.reach(target); } catch (error) { lastError = error; }
      }
      if (!connection && !stale()) await search();
      if (stale()) { connection?.ws.terminate(); return; }
      if (!connection) return this.retry(/Outro aparelho/.test(lastError?.message || '') ? lastError.message : NOT_FOUND);
      const { ws, hello } = connection;
      if (hello.id !== target.id) { ws.terminate(); return this.retry('Outro computador respondeu no endereço salvo.'); }
      // Persist discovery hints only after TLS and the computer's identity have been checked.
      if (discoveredTarget) this.save({ ...target, port: discoveredTarget.port, addresses: [...new Set([...discoveredTarget.addresses, ...target.addresses])].slice(0, 8) });
      ws.send(JSON.stringify({ type: 'auth', phoneId: this.phoneId(), proof: proof(target.secret, hello.nonce) }));
      this.attach(ws);
    } finally {
      if (this.generation === generation) this.connecting = false;
    }
  }
  retry(error) {
    this.set('offline', error);
    if (this.closed || !this.saved()) return;
    this.timer = setTimeout(() => this.connect(), RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]);
  }
  /** Connects again right away (the app came to the foreground or the network changed). */
  kick() { if (!this.socket && !this.connecting && !this.closed) { clearTimeout(this.timer); this.attempt = 0; this.connect(this.state === 'offline'); } }
  attach(ws, pairing = null) {
    this.socket = ws; let leave = null, refusal = ''; ws.alive = true;
    const send = value => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };
    ws.on('error', () => {});
    ws.on('pong', () => { ws.alive = true; });
    const ping = setInterval(() => { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }, 20000);
    ws.on('message', async raw => {
      let message; try { message = JSON.parse(raw); } catch { ws.terminate(); return; }
      if (message.type === 'refused') { refusal = message.error || 'O computador recusou a conexão.'; pairing?.reject(new Error(refusal)); pairing = null; ws.close(); return; }
      if (message.type === 'paired' && pairing && typeof message.secret === 'string') { pairing.resolve(message.secret); pairing = null; return; }
      if (message.type === 'ready') {
        const saved = this.saved();
        // The computer's addresses change with the network; the ones it reports are tried first next time.
        if (saved && Array.isArray(message.addresses)) this.save({ ...saved, name: message.name || saved.name, tailscale: message.tailscale === true, port: Number.isInteger(message.port) && message.port > 0 && message.port <= 65535 ? message.port : saved.port, addresses: [...new Set([...message.addresses.filter(item => typeof item === 'string'), ...saved.addresses])].slice(0, 8) });
        this.attempt = 0; this.set('online');
        for (const botId of this.watching) send({ type: 'browser_view', botId, on: true, browserMode: browserMode(this.db.bot(botId)) });
        send({ type: 'browser_control', control: this.controls, modes: Object.fromEntries(this.db.bots().map(bot => [bot.id, browserMode(bot)])) });
        leave = this.nodes.connect({ id: message.id, name: message.name || saved?.name, connections: message.connections, models: message.models, execute: (bot, prompt, options) => this.run(send, bot, prompt, options) });
        return;
      }
      if (message.type === 'status') { this.nodes.update?.(this.saved()?.id, { connections: message.connections, models: message.models }); this.changed('connection.changed'); return; }
      if (message.type === 'http') { send({ type: 'http_reply', rid: message.rid, ...await this.local(message) }); return; }
      if (message.type === 'rpc') { send({ type: 'rpc_reply', rid: message.rid, ...await this.desktop(message) }); return; }
      if (message.type === 'pc_result') { this.commands.get(message.rid)?.(message); return; }
      if (message.type === 'browser_frame' && typeof message.botId === 'string') { const { type, ...frame } = message; this.onFrame(frame); return; }
      const run = this.runs.get(message.id);
      if (!run) return;
      if (message.type === 'session') await run.onSession?.(message.sessionId);
      else if (message.type === 'progress') run.onProgress?.({ say: typeof message.say === 'string' ? message.say : undefined, step: typeof message.step === 'string' ? message.step : undefined });
      else if (message.type === 'done') run.resolve(message.reply);
      else if (message.type === 'failed') run.reject(Object.assign(new Error(message.error || 'O computador não concluiu a resposta.'), message.output ? { output: message.output } : {}, message.codexSessionId ? { codexSessionId: message.codexSessionId } : {}));
    });
    ws.on('close', () => {
      clearInterval(ping);
      if (this.closed) return;
      if (this.socket !== ws) { leave?.(); return; }
      for (const done of this.commands.values()) done({ error: 'O computador desconectou.' });
      if (this.socket === ws) this.socket = null;
      if (this.closed) return;
      // Interrupt first (the queue marks the turn "computer disconnected"), then end the waiting promises.
      leave?.();
      for (const run of this.runs.values()) run.reject(new Error('O computador desconectou.'));
      pairing?.reject(new Error('O computador fechou a conexão durante o pareamento.'));
      this.retry(refusal);
    });
  }
  drop() { this.generation++; this.connecting = false; this.lastDiscovery = -Infinity; this.discoveryAbort?.abort(); if (!this.closed) this.set('offline'); clearTimeout(this.timer); this.timer = null; const ws = this.socket; this.socket = null; ws?.terminate(); }
  /** Answers one forwarded tool request with the phone's own supervisor, on loopback. */
  async local({ method, path, headers = {}, body = '' }) {
    if (!TUNNEL_PATHS.includes(path) || !['GET', 'POST', 'DELETE'].includes(method)) return { status: 403, headers: {}, body: '' };
    try {
      const response = await fetch(`http://127.0.0.1:${this.port()}${path}`, { method, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(145000),
        headers: Object.fromEntries(HEADERS.filter(name => typeof headers[name] === 'string').map(name => [name, headers[name]])) });
      return { status: response.status, body: await response.text(), headers: Object.fromEntries(['content-type', 'mcp-session-id'].filter(name => response.headers.get(name)).map(name => [name, response.headers.get(name)])) };
    } catch { return { status: 502, headers: {}, body: '' }; }
  }
  /** A request from the MyBots window on the computer, answered by the phone's supervisor like the app's own. */
  async desktop({ method, params }) {
    if (!DESKTOP_METHODS.includes(method) || !this.rpc) return { error: 'Isto só pode ser feito no celular.' };
    try { return { result: await this.rpc(method, params && typeof params === 'object' && !Array.isArray(params) ? params : {}) }; }
    catch (error) { return { error: error.code ? 'Não foi possível gravar ou ler os dados do supervisor.' : error.message }; }
  }
  /** Supervisor events, for the window on the computer to refresh. */
  event(event, data) { if (DESKTOP_EVENTS.includes(event) && this.socket?.readyState === 1 && this.state === 'online') this.socket.send(JSON.stringify({ type: 'event', event, data })); }
  /** Starts or stops the live view of a bot's Chrome on the computer. */
  view(botId, on) {
    if (on) this.watching.add(botId); else this.watching.delete(botId);
    this.post({ type: 'browser_view', botId, on: Boolean(on), browserMode: browserMode(this.db.bot(botId)) });
  }
  /** Who controls each bot's browser: the computer takes the person's taps only for a browser taken over here. */
  control(controls) { this.controls = { ...controls }; this.post({ type: 'browser_control', control: this.controls, modes: Object.fromEntries(this.db.bots().map(bot => [bot.id, browserMode(bot)])) }); }
  /** A tap, key or address from the person, already checked against "Assumir" on the phone. */
  input(botId, input) {
    if (!this.post({ type: 'browser_input', botId, input })) throw new Error('O computador está desconectado.');
  }
  post(value) { if (this.socket?.readyState !== 1 || this.state !== 'online') return false; this.socket.send(JSON.stringify(value)); return true; }
  /** An action already authorized on the phone, only for its currently running turn on this connection. */
  command(run, op, args) {
    const entry = [...this.runs.entries()].find(([, item]) => item.taskId === run.taskId);
    if (!entry || run.signal?.aborted || this.socket?.readyState !== 1) return Promise.reject(new Error('A resposta no computador já foi interrompida.'));
    return new Promise((resolve, reject) => {
      const rid = randomUUID();
      const stop = () => done({ error: 'Ação interrompida.' });
      const done = ({ result, error }) => { clearTimeout(timer); this.commands.delete(rid); run.signal?.removeEventListener('abort', stop); error ? reject(new Error(error)) : resolve(result || {}); };
      const timer = setTimeout(() => done({ error: 'O computador demorou para executar a ferramenta.' }), 135000);
      this.commands.set(rid, done); run.signal?.addEventListener('abort', stop, { once: true });
      this.socket.send(JSON.stringify({ type: 'pc_command', rid, id: entry[0], op, args }));
    });
  }
  /** One turn on the computer: same contract as the local runner (resolves the reply, rejects with output). */
  run(send, bot, prompt, { signal, tools, onSession, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const id = randomUUID(); let timer;
      const end = () => { clearTimeout(timer); this.runs.delete(id); };
      this.runs.set(id, { taskId: tools?.taskId, onSession, onProgress, resolve: value => { end(); resolve(value); }, reject: error => { end(); reject(error); } });
      const { messages, ...settings } = bot;
      send({ type: 'run', id, bot: settings, prompt, tools: tools ? { token: tools.token, desktop: Boolean(tools.desktop), browser: Boolean(tools.browser), connectors: tools.connectors, connectorDeny: tools.connectorDeny, connectorWrites: tools.connectorWrites, computer: tools.computer ? { folders: tools.computer.folders || [], full: Boolean(tools.computer.full) } : false } : null });
      signal?.addEventListener('abort', () => {
        send({ type: 'cancel', id });
        timer = setTimeout(() => this.runs.get(id)?.reject(new Error('Pedido cancelado.')), 8000);
      }, { once: true });
    });
  }
  /** Shutting down: the turns still waiting on the computer end now (the queue records them as interrupted). */
  close() { this.closed = true; this.drop(); for (const done of this.commands.values()) done({ error: 'Supervisor reiniciado.' }); for (const run of this.runs.values()) run.reject(new Error('Supervisor reiniciado.')); }
}
