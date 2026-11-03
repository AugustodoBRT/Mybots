#!/usr/bin/env node
// O relé do MyBots: liga o celular ao computador quando eles não se enxergam (redes diferentes).
//
// Ele NÃO fala o protocolo do MyBots e não guarda nada: só encaminha bytes. Por dentro do túnel passa o mesmo TLS
// (certificado fixado no pareamento) e a mesma prova HMAC que já protegem a conexão direta, então o relé só vê
// dados cifrados e não consegue se passar pelo computador. Sem banco, sem arquivos e sem log de conteúdo.
//
//   host    o computador espera aqui, numa sala (derivada do segredo do pareamento, impossível de adivinhar)
//   guest   o celular chega à sala; o relé avisa o computador ("incoming", com um id de sessão)
//   accept  o computador abre a conexão de dados daquela sessão; o relé liga as duas pontas
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, createWebSocketStream } from '../supervisor/node_modules/ws/wrapper.mjs';

const ROOM = /^[A-Za-z0-9_-]{22,64}$/;
const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
export const LIMITS = { sockets: 400, perAddress: 24, rooms: 200, wait: 10000, idle: 15 * 60000, ping: 25000, payload: 2 * 1024 * 1024 };

// In production Caddy terminates TLS on 443 and forwards to 127.0.0.1:3240 (the address then comes in X-Forwarded-For); `tls`
// ({ key, cert }) lets the relay speak wss:// by itself, which is how the tests exercise it.
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
export function createRelay({ port = 3240, host = '0.0.0.0', limits = {}, log = () => {}, tls = null } = {}) {
  const max = { ...LIMITS, ...limits };
  const hosts = new Map();      // room -> ws of the computer waiting there
  const waiting = new Map();    // session id -> { guest, stream, room, timer }
  const perAddress = new Map();
  const handler = (request, response) => {
    if (request.url === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: hosts.size })); return; }
    response.writeHead(404).end();
  };
  const server = tls ? createSecureServer(tls, handler) : createServer(handler);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: max.payload, perMessageDeflate: false });
  const count = address => perAddress.get(address) || 0;
  const release = address => { const left = count(address) - 1; if (left > 0) perAddress.set(address, left); else perAddress.delete(address); };

  server.on('upgrade', (request, socket, head) => {
    // Behind the local proxy every connection comes from loopback: the real client is the one the proxy wrote down.
    let address = request.socket.remoteAddress || '';
    if (LOOPBACK.test(address)) { const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (/^[0-9a-f.:]{3,45}$/i.test(forwarded)) address = forwarded; }
    const url = new URL(request.url, 'http://relay'); const role = url.searchParams.get('role'); const room = url.searchParams.get('room') || ''; const session = url.searchParams.get('sid') || '';
    const refuse = status => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
    if (url.pathname !== '/' || !['host', 'guest', 'accept'].includes(role) || !ROOM.test(room) || (role === 'accept' && !SESSION.test(session))) { refuse('400 Bad Request'); return; }
    if (sockets.clients.size >= max.sockets || count(address) >= max.perAddress) { refuse('429 Too Many Requests'); return; }
    if (role === 'host' && !hosts.has(room) && hosts.size >= max.rooms) { refuse('429 Too Many Requests'); return; }
    sockets.handleUpgrade(request, socket, head, ws => {
      perAddress.set(address, count(address) + 1); ws.on('close', () => release(address));
      ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {});
      if (role === 'host') host(ws, room);
      else if (role === 'guest') guest(ws, room);
      else accept(ws, room, session);
    });
  });

  function host(ws, room) {
    // One computer per room: a new connection replaces the old one (the computer reconnected).
    const previous = hosts.get(room); hosts.set(room, ws); previous?.close(4000, 'substituído');
    ws.on('close', () => { if (hosts.get(room) === ws) hosts.delete(room); });
    ws.on('message', () => {}); // the host only listens; anything it says here is ignored
  }

  function guest(ws, room) {
    const owner = hosts.get(room);
    if (!owner || owner.readyState !== 1) { ws.close(4404, 'computador fora do ar'); return; }
    let id; do { id = randomBytes(18).toString('base64url'); } while (waiting.has(id));
    // Reading starts now, so what the phone sends before the computer answers waits in the stream instead of being lost.
    const stream = createWebSocketStream(ws); stream.on('error', () => {});
    const entry = { ws, stream, room, timer: setTimeout(() => { waiting.delete(id); ws.close(4408, 'o computador não respondeu'); }, max.wait) };
    waiting.set(id, entry);
    ws.on('close', () => { clearTimeout(entry.timer); if (waiting.get(id) === entry) waiting.delete(id); });
    owner.send(JSON.stringify({ type: 'incoming', sid: id }));
  }

  function accept(ws, room, id) {
    const entry = waiting.get(id);
    if (!entry || entry.room !== room || entry.ws.readyState !== 1) { ws.close(4404, 'sessão desconhecida'); return; }
    waiting.delete(id); clearTimeout(entry.timer);
    const other = createWebSocketStream(ws); other.on('error', () => {});
    // Backpressure comes with pipe(): a slow side slows the other instead of piling up in memory.
    entry.stream.pipe(other); other.pipe(entry.stream);
    const end = () => { entry.ws.terminate(); ws.terminate(); };
    entry.ws.on('close', end); ws.on('close', end);
    // A tunnel that carries nothing for a long time is closed (the apps open a new one when needed).
    let last = Date.now(); const touch = () => { last = Date.now(); };
    entry.stream.on('data', touch); other.on('data', touch);
    const watch = setInterval(() => { if (Date.now() - last > max.idle) end(); }, 30000); watch.unref();
    entry.ws.on('close', () => clearInterval(watch));
  }

  const ping = setInterval(() => { for (const ws of sockets.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, max.ping); ping.unref();
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { log(`Relé do MyBots na porta ${server.address().port}.`); resolve(server.address().port); }); }),
    stats: () => ({ rooms: hosts.size, waiting: waiting.size, sockets: sockets.clients.size }),
    close: () => new Promise(resolve => { clearInterval(ping); for (const ws of sockets.clients) ws.terminate(); server.close(resolve); server.closeAllConnections?.(); })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelay({ port: Number(process.env.MYBOTS_RELAY_PORT) || 3240, log: line => console.log(line) });
  relay.listen().catch(error => { console.error('Não foi possível iniciar o relé:', error.message); process.exit(1); });
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
