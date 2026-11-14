import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, chmodSync, appendFileSync, unlinkSync } from 'node:fs';
import { join, normalize, extname, parse } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from '../supervisor/node_modules/ws/wrapper.mjs';
import { DESKTOP_METHODS } from '../supervisor/link.mjs';

export const PWA_URL = process.env.MYBOTS_PWA_URL || 'https://mybots-rele.duckdns.org/';
/** The link the iPhone opens: the web app, with the computer's pairing text in the fragment. */
export const iphoneLink = (link, base = PWA_URL) => `${base}#p=${encodeURIComponent(link)}`;
import { openCommand } from './platform.mjs';

export const DEFAULT_UI_PORT = 3232;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const OFFLINE = 'O celular está fora de alcance. Ele se conecta sozinho quando estiver ligado e com internet. Se preferir, use só este computador em Ajustes → Celular.';
const STARTING = 'O MyBots deste computador ainda está iniciando. Tente de novo em instantes.';

/**
 * The MyBots window on the computer: the same interface as the phone (react-native-web, built into pc/ui), served
 * only on 127.0.0.1. The page carries a token kept in the node's folder (so an open window reconnects after the node
 * restarts); the WebSocket speaks the supervisor's protocol
 * and each request goes to the phone over the link, which answers only the window's list of methods.
 */
export function createUi({ port = DEFAULT_UI_PORT, root = fileURLToPath(new URL('./ui/', import.meta.url)), phone, local: own = () => null, sync: syncOf = () => null, link: linkOf = () => null, apps: appsOf = () => [], forgetApp = () => {}, sourceFile = null, downloads = join(homedir(), 'Downloads'), tokenFile = null, pairing = null, phones = () => [], browser = null, dictation = null, log = () => {} }) {
  let token = null;
  try { token = tokenFile && /^[0-9a-f]{64}$/.test(readFileSync(tokenFile, 'utf8').trim()) ? readFileSync(tokenFile, 'utf8').trim() : null; } catch {}
  if (!token) { token = randomBytes(32).toString('hex'); if (tokenFile) { writeFileSync(tokenFile, token, { mode: 0o600 }); chmodSync(tokenFile, 0o600); } }
  const clients = new Set(); let offlineSince = Date.now();
  // Where the window's data comes from: the paired phone (as before) or this computer's own supervisor. A person who
  // never paired a phone starts on the computer's own; the choice is kept and applies to every window.
  const saved = () => { try { const value = JSON.parse(readFileSync(sourceFile, 'utf8')).source; return value === 'phone' || value === 'local' ? value : null; } catch { return null; } };
  const sourceNow = () => { const choice = saved(); if (choice === 'local' && !own()) return 'phone'; return choice || (own() && (!phones().length || syncOf()?.synced()) ? 'local' : 'phone'); };
  const origins = () => [`http://127.0.0.1:${server.address().port}`, `http://localhost:${server.address().port}`];
  // Only this computer's own pages: a site opened in a browser cannot read the page (DNS rebinding) or use the socket.
  const local = request => origins().map(origin => origin.slice(7)).includes(request.headers.host);
  const server = createServer((request, response) => {
    if (!local(request)) { response.writeHead(403).end(); return; }
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === '/health') { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify({ ok: true, phone: phone.online() })); return; }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(normalize(root)) || !existsSync(file) || !statSync(file).isFile()) {
      if (!existsSync(join(root, 'index.html'))) { response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('A interface do MyBots ainda não foi gerada. Rode scripts/build-desktop.sh.'); return; }
      response.writeHead(404).end(); return;
    }
    let body = readFileSync(file);
    // The page gets the window's connection; the token stays in the node's private folder.
    if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script>window.MYBOTS_DESKTOP=${JSON.stringify({ port: server.address().port, token })}</script>`));
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  });
  const sockets = new WebSocketServer({ server, maxPayload: 4 * 1024 * 1024 });
  sockets.on('connection', (ws, request) => {
    if (!origins().includes(request.headers.origin) || !local(request)) { ws.close(1008); return; }
    serve(ws);
  });
  /**
   * One client of the interface: a window (page token, checked here) or, with `remote`, a phone app that already proved itself
   * on the secure channel (pc/app-channel.mjs). A phone app always reads the computer's own MyBots and cannot use what belongs to
   * this computer's screen: saving files in Downloads, the microphone, showing pairing codes, the choice of source, the sync buttons.
   */
  function serve(ws, { remote = false, device = null } = {}) {
    const reply = (id, value) => { if (ws.readyState === 1) ws.send(JSON.stringify({ id, ...value })); };
    const timer = setTimeout(() => { if (!ws.authenticated) ws.terminate(); }, 10000);
    if (remote) {
      clearTimeout(timer); ws.remote = true; ws.device = device; ws.authenticated = true; ws.source = 'local'; clients.add(ws);
      ws.ready = (async () => { try { ws.session = await own().session(text => { if (ws.readyState === 1) ws.send(text); }, { notices: true }); ws.session.onClose = () => ws.close(); } catch { ws.close(); } })();
    }
    ws.on('message', async raw => {
      let message; try { message = JSON.parse(raw); } catch { ws.terminate(); return; }
      const { id, method, params } = message || {};
      if (ws.ready) await ws.ready;
      if (!ws.authenticated) {
        const given = typeof params?.token === 'string' ? params.token : '';
        if (method !== 'auth' || Buffer.byteLength(given) !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) { reply(id, { error: 'Acesso negado.' }); ws.close(); return; }
        clearTimeout(timer); ws.authenticated = true; ws.source = sourceNow(); clients.add(ws);
        // The computer's own supervisor: this window gets a connection of its own, and its events go straight to the window.
        if (ws.source === 'local') {
          try { ws.session = await own().session(text => { if (ws.readyState === 1) ws.send(text); }); ws.session.onClose = () => { if (ws.readyState === 1) ws.close(1013); }; }
          catch (error) { reply(id, { error: STARTING }); ws.close(); return; }
        }
        reply(id, { result: { ok: true } }); return;
      }
      const backend = (method, params) => {
        // The sync runs between the two supervisors, by the node; a window never starts it.
        if (/^sync\./.test(method)) throw new Error('Isto só pode ser feito pelo MyBots.');
        if (ws.source !== 'local') { if (!phone.online()) throw new Error(OFFLINE); return phone.call(method, params); }
        if (!ws.session || ws.session.closed) throw new Error(STARTING);
        // The same list the phone gives the window; the Livre level is chosen on the phone, with its warning.
        if (!DESKTOP_METHODS.includes(method)) throw new Error('Isto só pode ser feito no celular.');
        if (['bot.create', 'bot.update'].includes(method) && params?.access === 'free') throw new Error('O nível Livre só se escolhe no app do celular.');
        return ws.session.call(method, params);
      };
      if (typeof method !== 'string') return;
      try {
        if (ws.remote && ['desktop.file', 'desktop.dictate', 'desktop.pair', 'desktop.source', 'desktop.sync', 'desktop.forgetApp'].includes(method)) throw new Error('Isto só pode ser feito no computador.');
        if (method === 'desktop.file') reply(id, { result: await saveFile(params || {}, backend) });
        // The bots' Chrome runs here: the window watches it and, after "Assumir" on the phone's side, uses it directly.
        else if (method === 'browser.view') {
          if (!browser || typeof params?.botId !== 'string') throw new Error('Navegador indisponível.');
          ws.views ||= new Map();
          const on = Boolean(params.on);
          if (on && !ws.views.has(params.botId)) ws.views.set(params.botId, paced(frame => { if (ws.readyState !== 1) return; if (Buffer.isBuffer(frame.image)) ws.send(windowFrame(params.botId, frame)); else ws.send(JSON.stringify({ event: 'browser.frame', data: { botId: params.botId, ...frame } })); }, () => ws.bufferedAmount > 1_000_000));
          const sink = ws.views.get(params.botId);
          // The window is on this computer (its pace is never lowered); a phone over the network is paced by how much it can take.
          if (sink) { sink.bufferedAmount = () => ws.bufferedAmount; sink.direct = !ws.remote; }
          if (!on) ws.views.delete(params.botId);
          if (sink) await browser.watch(params.botId, sink, on, undefined, params, () => backend('state.get', {}));
          reply(id, { result: { watching: on, online: true } });
        }
        // Dictation in this window: recorded and transcribed on this computer (see dictation.mjs).
        else if (method === 'desktop.dictate') {
          if (!dictation) throw new Error('O ditado não está disponível neste computador.');
          ws.dictation ||= randomUUID();
          const action = params?.action;
          if (!['start', 'stop', 'cancel'].includes(action)) throw new Error('Ditado inválido.');
          reply(id, { result: await dictation[action](ws.dictation) });
        }
        else if (method === 'browser.input') {
          if (!browser || typeof params?.botId !== 'string') throw new Error('Navegador indisponível.');
          reply(id, { result: await browser.input(params.botId, params.input) });
        }
        // The phone app's saved logins meet this computer's vault: the app sends its own, gets the merged whole back (see supervisor/passwords.mjs).
        else if (method === 'passwords.sync') {
          if (!ws.remote) throw new Error('Isto só pode ser feito pelo celular.');
          if (!ws.session || ws.session.closed) throw new Error(STARTING);
          reply(id, { result: await ws.session.call('passwords.merge', params && typeof params === 'object' && !Array.isArray(params) ? params : {}) });
        }
        else if (method === 'desktop.status' && ws.remote) reply(id, { result: { phone: false, remote: true, source: 'local', localAvailable: true, sync: null } });
        else if (method === 'desktop.status') reply(id, { result: { phone: phone.online(), offlineSince, source: ws.source, localAvailable: Boolean(own()), sync: phones().length ? syncOf()?.status() || null : null, link: phone.online() ? linkOf() : null, apps: appsOf().map(({ id, name, pairedAt }) => ({ id, name, pairedAt })), lastPaired: [...phones(), ...appsOf()].map(item => item.pairedAt).sort().at(-1) || null } });
        // A phone app that is lost or no longer wanted: forgotten here, it is cut off at once and cannot come back without a new QR.
        else if (method === 'desktop.forgetApp') {
          if (typeof params?.id !== 'string') throw new Error('Celular inválido.');
          forgetApp(params.id); reply(id, { result: { forgotten: true } });
        }
        // "Sincronizar agora" in Ajustes: one round between the phone and this computer, answered when it ends.
        else if (method === 'desktop.sync') {
          if (!syncOf()) throw new Error('A sincronização não está disponível.');
          if (!phone.online()) throw new Error('O celular está fora de alcance. A sincronização acontece sozinha quando os dois estiverem ligados.');
          reply(id, { result: params?.reset ? await syncOf().reset() : await syncOf().now() });
        }
        // Choosing where the window's data comes from. The windows reconnect and load the other side's state.
        else if (method === 'desktop.source') {
          const source = params?.source;
          if (source !== 'phone' && source !== 'local') throw new Error('Escolha o celular ou este computador.');
          if (source === 'local' && !own()) throw new Error('O MyBots deste computador não está disponível.');
          if (sourceFile) { writeFileSync(sourceFile, JSON.stringify({ source }), { mode: 0o600 }); chmodSync(sourceFile, 0o600); }
          reply(id, { result: { source } });
          setTimeout(() => { for (const other of clients) other.close(1012); }, 60);
        }
        // The pairing QR, drawn here so the window shows it (one use, 10 minutes, like `node pc/node.mjs pair`).
        else if (method === 'desktop.pair') {
          if (!pairing) throw new Error('O pareamento não está disponível.');
          const { link, name } = pairing();
          // For the iPhone the QR is a link to the web app with the pairing in the fragment (never sent to a server); it only works through the relay.
          const iphone = Boolean(params?.iphone);
          if (iphone && !/[?&]r=/.test(link)) throw new Error('O iPhone precisa do relé do MyBots, que está desligado neste computador.');
          const text = iphone ? iphoneLink(link) : link;
          const { default: QRCode } = await import('qrcode');
          reply(id, { result: { name, svg: await QRCode.toString(text, { type: 'svg', margin: 2, errorCorrectionLevel: 'L', color: { dark: '#0B0E14', light: '#FFFFFF' } }), expiresAt: Date.now() + 10 * 60000, ...(iphone ? { text } : {}) } });
        }
        else {
          if (method.startsWith('notes.') && params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) throw new Error('Parâmetros de notas inválidos.');
          const result = await backend(method, params || {});
          reply(id, { result: method === 'state.get' && result && typeof result === 'object' ? { ...result, source: ws.source, localAvailable: Boolean(own()) } : result });
        }
      } catch (error) { reply(id, { error: error.message }); }
    });
    ws.on('close', () => { clearTimeout(timer); clients.delete(ws); ws.session?.close(); if (ws.dictation) dictation?.cancel(ws.dictation); for (const [botId, sink] of ws.views || []) browser?.watch(botId, sink, false).catch(() => {}); });
  }
  /** A bot's file, saved in ~/Downloads (and opened with the desktop's default app when asked). */
  async function saveFile({ id, name, action }, backend) {
    if (typeof id !== 'string' || typeof name !== 'string' || !['save', 'open'].includes(action)) throw new Error('Arquivo inválido.');
    mkdirSync(downloads, { recursive: true });
    const clean = parse(name.replace(/[\u0000-\u001f/\\]/g, ' ').trim() || 'arquivo');
    let target = join(downloads, clean.base); for (let n = 2; existsSync(target); n++) target = join(downloads, `${clean.name} (${n})${clean.ext}`);
    // Written part by part as it arrives, so a big file (a video) never sits whole in memory.
    let offset = 0;
    try {
      do { const part = await backend('file.read', { id, offset }); const bytes = Buffer.from(part.chunk, 'base64'); if (offset === 0) writeFileSync(target, bytes); else appendFileSync(target, bytes); offset = part.next; } while (offset !== null && offset !== undefined);
    } catch (error) { try { unlinkSync(target); } catch {} throw error; }
    if (action === 'open') { const open = openCommand(target); spawn(open.command, open.args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); }
    log(`Arquivo salvo em ${target}.`);
    return { path: target };
  }
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }),
    /** An event from the phone, or a change of the link itself, for every open window. */
    broadcast(event, data = {}) { if (event === 'desktop.phone') offlineSince = data.online ? null : Date.now(); for (const ws of clients) if (ws.readyState === 1 && (ws.source !== 'local' || event.startsWith('desktop.'))) ws.send(JSON.stringify({ event, data })); },
    source: sourceNow,
    /** A phone app that already proved itself on the secure channel (see app-channel.mjs). */
    serve,
    /** Cuts off every connection of one phone app. */
    dropApp(id) { for (const ws of clients) if (ws.device?.id === id) ws.terminate(); },
    close: () => { for (const ws of clients) ws.terminate(); return new Promise(resolve => server.close(resolve)); }
  };
}

/**
 * A picture of the bot's Chrome for the window, as one binary message (no base64, no JSON around the JPEG):
 * 0x01, u8 id length, id, u32 meta length, meta (JSON without the picture), JPEG.
 */
export function windowFrame(botId, { image, ...meta }) {
  const id = Buffer.from(botId), info = Buffer.from(JSON.stringify(meta)), head = Buffer.alloc(2 + id.length + 4);
  head[0] = 1; head[1] = id.length; id.copy(head, 2); head.writeUInt32BE(info.length, 2 + id.length);
  return Buffer.concat([head, info, image]);
}

/** Sends the newest frame when the connection has room; frames in between are skipped, never queued. */
export function paced(send, busy, pressure = () => {}) {
  let latest = null, timer = null;
  const flush = () => { timer = null; if (!latest) return; pressure(); if (busy()) { timer = setTimeout(flush, 150); timer.unref?.(); return; } const frame = latest; latest = null; send(frame); };
  return frame => { if (!Buffer.isBuffer(frame) && !frame.image) { send(frame); return; } latest = frame; if (!timer) flush(); };
}

/** Requests to the phone over the link, matched by id. */
export function phoneBridge() {
  const waiting = new Map(); let socket = null;
  return {
    attach(ws) { socket = ws; },
    detach(ws) { if (socket !== ws) return; socket = null; for (const done of waiting.values()) done({ error: OFFLINE }); },
    online: () => socket?.readyState === 1,
    answer(message) { waiting.get(message.rid)?.(message); },
    call(method, params) {
      return new Promise((resolve, reject) => {
        const rid = randomUUID();
        const timer = setTimeout(() => { waiting.delete(rid); reject(new Error('O celular demorou para responder. Tente de novo.')); }, 60000);
        waiting.set(rid, value => { clearTimeout(timer); waiting.delete(rid); value.error ? reject(new Error(value.error)) : resolve(value.result); });
        socket.send(JSON.stringify({ type: 'rpc', rid, method, params }));
      });
    }
  };
}
