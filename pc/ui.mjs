import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, chmodSync, appendFileSync, unlinkSync } from 'node:fs';
import { join, normalize, extname, parse } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from '../supervisor/node_modules/ws/wrapper.mjs';

export const DEFAULT_UI_PORT = 3232;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const OFFLINE = 'O celular está fora de alcance. No mesmo Wi-Fi, ele procura o computador sozinho. Para conectar de outra rede, use o Tailscale.';

/**
 * The MyBots window on the computer: the same interface as the phone (react-native-web, built into pc/ui), served
 * only on 127.0.0.1. The page carries a token kept in the node's folder (so an open window reconnects after the node
 * restarts); the WebSocket speaks the supervisor's protocol
 * and each request goes to the phone over the link, which answers only the window's list of methods.
 */
export function createUi({ port = DEFAULT_UI_PORT, root = fileURLToPath(new URL('./ui/', import.meta.url)), phone, downloads = join(homedir(), 'Downloads'), tokenFile = null, pairing = null, phones = () => [], network = () => ({ tailscale: false }), browser = null, dictation = null, log = () => {} }) {
  let token = null;
  try { token = tokenFile && /^[0-9a-f]{64}$/.test(readFileSync(tokenFile, 'utf8').trim()) ? readFileSync(tokenFile, 'utf8').trim() : null; } catch {}
  if (!token) { token = randomBytes(32).toString('hex'); if (tokenFile) { writeFileSync(tokenFile, token, { mode: 0o600 }); chmodSync(tokenFile, 0o600); } }
  const clients = new Set(); let offlineSince = Date.now();
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
    const reply = (id, value) => { if (ws.readyState === 1) ws.send(JSON.stringify({ id, ...value })); };
    const timer = setTimeout(() => { if (!ws.authenticated) ws.terminate(); }, 10000);
    ws.on('message', async raw => {
      let message; try { message = JSON.parse(raw); } catch { ws.terminate(); return; }
      const { id, method, params } = message || {};
      if (!ws.authenticated) {
        const given = typeof params?.token === 'string' ? params.token : '';
        if (method !== 'auth' || Buffer.byteLength(given) !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) { reply(id, { error: 'Acesso negado.' }); ws.close(); return; }
        clearTimeout(timer); ws.authenticated = true; clients.add(ws); reply(id, { result: { ok: true } }); return;
      }
      if (typeof method !== 'string') return;
      try {
        if (method === 'desktop.file') reply(id, { result: await saveFile(params || {}) });
        // The bots' Chrome runs here: the window watches it and, after "Assumir" on the phone's side, uses it directly.
        else if (method === 'browser.view') {
          if (!browser || typeof params?.botId !== 'string') throw new Error('Navegador indisponível.');
          ws.views ||= new Map();
          const on = Boolean(params.on);
          if (on && !ws.views.has(params.botId)) ws.views.set(params.botId, paced(frame => { if (ws.readyState !== 1) return; if (Buffer.isBuffer(frame.image)) ws.send(windowFrame(params.botId, frame)); else ws.send(JSON.stringify({ event: 'browser.frame', data: { botId: params.botId, ...frame } })); }, () => ws.bufferedAmount > 1_000_000));
          const sink = ws.views.get(params.botId);
          if (sink) { sink.bufferedAmount = () => ws.bufferedAmount; sink.direct = true; }
          if (!on) ws.views.delete(params.botId);
          if (sink) await browser.watch(params.botId, sink, on, undefined, params);
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
        // The real Chrome window: laid over the area the window asks for, or sent away again.
        else if (method === 'browser.dock') {
          const dock = browser?.dock; if (!dock) { reply(id, { result: { real: false } }); return; }
          if (params?.on) { ws.docked = true; reply(id, { result: { real: true, box: await dock.dock(Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, Number.isFinite(params.inset?.[side]) ? Math.max(0, Math.min(4000, params.inset[side])) : 0]))) } }); }
          else { ws.docked = false; await dock.undock(); reply(id, { result: { real: true } }); }
        }
        else if (method === 'browser.input') {
          if (!browser || typeof params?.botId !== 'string') throw new Error('Navegador indisponível.');
          reply(id, { result: await browser.input(params.botId, params.input) });
        }
        else if (method === 'desktop.status') reply(id, { result: { phone: phone.online(), offlineSince, ...network(), lastPaired: phones().map(item => item.pairedAt).sort().at(-1) || null } });
        // The pairing QR, drawn here so the window shows it (one use, 10 minutes, like `node pc/node.mjs pair`).
        else if (method === 'desktop.pair') {
          if (!pairing) throw new Error('O pareamento não está disponível.');
          const { link, name } = pairing();
          const { default: QRCode } = await import('qrcode');
          reply(id, { result: { name, svg: await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'L', color: { dark: '#0B0E14', light: '#FFFFFF' } }), expiresAt: Date.now() + 10 * 60000 } });
        }
        else {
          if (!phone.online()) throw new Error(OFFLINE);
          reply(id, { result: await phone.call(method, params || {}) });
        }
      } catch (error) { reply(id, { error: error.message }); }
    });
    ws.on('close', () => { clearTimeout(timer); clients.delete(ws); if (ws.docked) browser?.dock?.undock().catch(() => {}); if (ws.dictation) dictation?.cancel(ws.dictation); for (const [botId, sink] of ws.views || []) browser?.watch(botId, sink, false).catch(() => {}); });
  });
  /** A bot's file, saved in ~/Downloads (and opened with the desktop's default app when asked). */
  async function saveFile({ id, name, action }) {
    if (typeof id !== 'string' || typeof name !== 'string' || !['save', 'open'].includes(action)) throw new Error('Arquivo inválido.');
    if (!phone.online()) throw new Error(OFFLINE);
    mkdirSync(downloads, { recursive: true });
    const clean = parse(name.replace(/[\u0000-\u001f/\\]/g, ' ').trim() || 'arquivo');
    let target = join(downloads, clean.base); for (let n = 2; existsSync(target); n++) target = join(downloads, `${clean.name} (${n})${clean.ext}`);
    // Written part by part as it arrives, so a big file (a video) never sits whole in memory.
    let offset = 0;
    try {
      do { const part = await phone.call('file.read', { id, offset }); const bytes = Buffer.from(part.chunk, 'base64'); if (offset === 0) writeFileSync(target, bytes); else appendFileSync(target, bytes); offset = part.next; } while (offset !== null && offset !== undefined);
    } catch (error) { try { unlinkSync(target); } catch {} throw error; }
    if (action === 'open') spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    log(`Arquivo salvo em ${target}.`);
    return { path: target };
  }
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }),
    /** An event from the phone, or a change of the link itself, for every open window. */
    broadcast(event, data = {}) { if (event === 'desktop.phone') offlineSince = data.online ? null : Date.now(); for (const ws of clients) if (ws.readyState === 1) ws.send(JSON.stringify({ event, data })); },
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
