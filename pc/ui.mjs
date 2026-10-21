import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, extname, parse } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from '../supervisor/node_modules/ws/wrapper.mjs';

export const DEFAULT_UI_PORT = 3232;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const OFFLINE = 'O celular está fora de alcance. Confira se ele está ligado e no mesmo Wi-Fi (ou na Tailscale).';

/**
 * The MyBots window on the computer: the same interface as the phone (react-native-web, built into pc/ui), served
 * only on 127.0.0.1. The page carries a token made at each start; the WebSocket speaks the supervisor's protocol
 * and each request goes to the phone over the link, which answers only the window's list of methods.
 */
export function createUi({ port = DEFAULT_UI_PORT, root = fileURLToPath(new URL('./ui/', import.meta.url)), phone, downloads = join(homedir(), 'Downloads'), log = () => {} }) {
  const token = randomBytes(32).toString('hex');
  const clients = new Set();
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
    // The page gets the window's connection; the token never goes to disk.
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
        else if (method === 'desktop.status') reply(id, { result: { phone: phone.online() } });
        else {
          if (!phone.online()) throw new Error(OFFLINE);
          reply(id, { result: await phone.call(method, params || {}) });
        }
      } catch (error) { reply(id, { error: error.message }); }
    });
    ws.on('close', () => { clearTimeout(timer); clients.delete(ws); });
  });
  /** A bot's file, saved in ~/Downloads (and opened with the desktop's default app when asked). */
  async function saveFile({ id, name, action }) {
    if (typeof id !== 'string' || typeof name !== 'string' || !['save', 'open'].includes(action)) throw new Error('Arquivo inválido.');
    if (!phone.online()) throw new Error(OFFLINE);
    const chunks = []; let offset = 0;
    do { const part = await phone.call('file.read', { id, offset }); chunks.push(Buffer.from(part.chunk, 'base64')); offset = part.next; } while (offset !== null && offset !== undefined);
    mkdirSync(downloads, { recursive: true });
    const clean = parse(name.replace(/[\u0000-\u001f/\\]/g, ' ').trim() || 'arquivo');
    let target = join(downloads, clean.base); for (let n = 2; existsSync(target); n++) target = join(downloads, `${clean.name} (${n})${clean.ext}`);
    writeFileSync(target, Buffer.concat(chunks));
    if (action === 'open') spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    log(`Arquivo salvo em ${target}.`);
    return { path: target };
  }
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }),
    /** An event from the phone, or a change of the link itself, for every open window. */
    broadcast(event, data = {}) { for (const ws of clients) if (ws.readyState === 1) ws.send(JSON.stringify({ event, data })); },
    close: () => { for (const ws of clients) ws.terminate(); return new Promise(resolve => server.close(resolve)); }
  };
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
