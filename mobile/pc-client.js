import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { clientChannel, b64 } from './pc-channel.js';

/**
 * The phone app's way to the computer when there is no Termux: the computer's MyBots is the whole backend. Everything here
 * is plain JavaScript on top of WebSocket, so it runs in React Native and in the tests alike (`WebSocketClass` is the global
 * WebSocket in the app and the `ws` package in tests). Security is in the channel (pc-channel.js), not in the transport.
 */
const DIRECT_MS = 5000, RELAY_MS = 8000, RELAY_DELAY_MS = 1500, PING_MS = 20000, SILENT_MS = 60000;

// The app only talks over TLS (Android has no cleartext exception for the relay any more): a pairing made when the relay was
// ws://IP:3240 is moved to its wss:// name, which is the same relay behind Caddy.
const OLD_RELAY = 'ws://136.248.104.150:3240', SECURE_RELAY = 'wss://mybots-rele.duckdns.org';
export const secureRelay = relay => relay === OLD_RELAY ? SECURE_RELAY : relay;

/** The room both sides use at the relay: the same name pc/server.mjs derives from the pairing secret. */
export const relayRoom = secret => b64(hmac(sha256, utf8ToBytes(String(secret)), utf8ToBytes('mybots-relay-room')));

/** What the computer's QR carries (mybots://computador?...): who it is, where, the relay and the one-use code. */
export function parseQr(text) {
  // The iPhone opens a link (https://…/app/#p=<the same text>): the QR's text rides in the fragment, which never goes to a server.
  let raw = String(text || '').trim(); const hashed = /#p=([^&\s]+)/.exec(raw); if (/^https?:\/\//i.test(raw) && hashed) { try { raw = decodeURIComponent(hashed[1]); } catch {} }
  const match = /^mybots:\/\/computador\?(.*)$/.exec(raw);
  if (!match) throw new Error('Este QR não é de um computador com o MyBots.');
  const query = {}; for (const part of match[1].split('&')) { const at = part.indexOf('='); if (at > 0) query[decodeURIComponent(part.slice(0, at))] = decodeURIComponent(part.slice(at + 1).replace(/\+/g, ' ')); }
  const tlsPort = Number(query.p); const port = Number(query.q) || tlsPort; const addresses = String(query.a || '').split(',').filter(item => /^[0-9a-z.:-]{1,253}$/i.test(item)).slice(0, 6);
  const relay = /^wss?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?\/?$/.test(query.r || '') ? query.r.replace(/\/$/, '') : '';
  if (query.v !== '1' || !/^[A-Za-z0-9_-]{1,64}$/.test(query.id || '') || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(tlsPort) || tlsPort < 1 || !/^[A-Za-z0-9_-]{8,64}$/.test(query.c || '') || !addresses.length) throw new Error('Este QR não é de um computador com o MyBots.');
  return { id: query.id, name: String(query.n || 'Computador').slice(0, 40), port, addresses, code: query.c, ...(relay ? { relay } : {}) };
}

/** One byte pipe over a WebSocket: resolves when it is open, handing the channel's handshake what arrives. */
function open(WebSocketClass, url, options, timeout) {
  return new Promise((resolve, reject) => {
    let ws, endpoint, finished = false;
    const fail = error => { if (finished) return; finished = true; clearTimeout(timer); try { ws?.close(); } catch {} reject(error); };
    const timer = setTimeout(() => fail(new Error('Sem resposta.')), timeout);
    try { ws = new WebSocketClass(url); } catch (error) { fail(error); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      endpoint = clientChannel({ send: bytes => ws.send(bytes), close: () => { try { ws.close(); } catch {} } }, options, timeout);
      endpoint.done.then(channel => { if (finished) { channel.close(); return; } finished = true; clearTimeout(timer); channel.ws = ws; resolve(channel); }, fail);
    };
    ws.onmessage = event => { if (typeof event.data !== 'string') endpoint?.deliver(new Uint8Array(event.data)); };
    ws.onerror = () => fail(new Error('Não consegui conectar.'));
    ws.onclose = () => { endpoint?.ended(); fail(new Error('Conexão encerrada.')); };
  });
}

/** The computer's addresses first, with the relay joining when they fail or take more than a moment; the first one in wins. */
function reach(WebSocketClass, target, options, room) {
  // A page served over https cannot open the computer's plain ws:// address (mixed content): in the browser only the relay is possible.
  if (globalThis.location?.protocol === 'https:' && target.relay) return open(WebSocketClass, `${secureRelay(target.relay)}/?role=guest&room=${encodeURIComponent(room)}`, options, RELAY_MS).then(channel => { channel.path = 'relay'; channel.via = 'relay'; return channel; });
  const first = direct(WebSocketClass, target, options).then(channel => ({ channel, via: 'direct' }));
  if (!target.relay) return first.then(({ channel }) => channel);
  return new Promise((resolve, reject) => {
    let done = false, failures = 0, started = false; const errors = []; let timer = null;
    const win = ({ channel, via }) => { if (done) { channel.close(); return; } done = true; clearTimeout(timer); channel.via = via; resolve(channel); };
    const lose = (index, error) => { errors[index] = error; if (++failures === 2 && !done) reject(errors.find(item => /Este não é o computador|inválido ou vencido|não está pareado/.test(item?.message || '')) || errors[0]); };
    const startRelay = () => {
      if (started || done) return; started = true; clearTimeout(timer);
      open(WebSocketClass, `${secureRelay(target.relay)}/?role=guest&room=${encodeURIComponent(room)}`, options, RELAY_MS).then(channel => { channel.path = 'relay'; win({ channel, via: 'relay' }); }, error => lose(1, error));
    };
    first.then(win, error => { lose(0, error); startRelay(); });
    timer = setTimeout(startRelay, RELAY_DELAY_MS);
  });
}

/** Tries the computer's addresses one after the other. */
async function direct(WebSocketClass, target, options) {
  let last = new Error('Sem endereço.');
  for (const address of target.addresses) {
    try { const channel = await open(WebSocketClass, `ws://${address.includes(':') ? `[${address}]` : address}:${target.port}/`, options, DIRECT_MS); channel.path = 'direct'; return channel; }
    catch (error) { last = error; if (/Este não é o computador/.test(error.message)) throw error; }
  }
  throw last;
}

/**
 * Connects to the paired computer: its addresses first (home network), with the relay joining when that fails
 * or takes more than a moment. The first to be in wins; the other is closed.
 */
export function connectToComputer(WebSocketClass, target, phone) {
  return reach(WebSocketClass, target, { id: phone.id, secret: target.secret, nodeId: target.id }, relayRoom(target.secret));
}

/**
 * First pairing, from the QR. The computer's addresses first and the relay with them: while the QR is valid the computer waits
 * in a relay room named from the QR's code, so pairing works even when the phone cannot reach its address (Android only lets the
 * app talk without TLS to the relay).
 */
export async function pairWithComputer(WebSocketClass, qr, phone) {
  const target = typeof qr === 'string' ? parseQr(qr) : qr;
  const channel = await reach(WebSocketClass, target, { id: phone.id, name: phone.name, code: target.code, nodeId: target.id }, relayRoom(target.code));
  const info = channel.peer.info || {};
  const saved = { id: target.id, name: channel.peer.name || target.name, port: Number.isInteger(info.port) ? info.port : target.port, addresses: [...new Set([...(Array.isArray(info.addresses) ? info.addresses : []), ...target.addresses])].slice(0, 8),
    ...((info.relay || target.relay) ? { relay: info.relay || target.relay } : {}), secret: channel.secret, pairedAt: new Date().toISOString() };
  return { target: saved, channel };
}

/** Keeps a channel alive and drops it when the computer goes quiet. */
export function keepAlive(channel, { ping = PING_MS, silent = SILENT_MS } = {}) {
  const timer = setInterval(() => { if (Date.now() - channel.lastSeen > silent) channel.close(); else channel.ping(); }, ping);
  channel.on('close', () => clearInterval(timer)); return channel;
}

/**
 * A WebSocket look-alike for the app's SupervisorClient: it opens the channel to the computer, answers the client's `auth`
 * itself (the channel already authenticated) and passes everything else through. `session()` gives the saved target and the phone's id.
 */
export function remoteSocketClass(WebSocketClass, session) {
  return class RemoteSocket {
    constructor() {
      this.readyState = 0; this.binaryType = 'arraybuffer'; this.channel = null;
      const { target, phone, update = () => {} } = session();
      connectToComputer(WebSocketClass, target, phone).then(channel => {
        if (this.readyState === 3) { channel.close(); return; }
        this.channel = keepAlive(channel); this.readyState = 1;
        // What the computer says about itself each time (its addresses and relay) is kept for the next connection.
        if (channel.peer.info) update(channel.peer.info, channel.via);
        channel.on('message', (data, binary) => this.onmessage?.({ data: binary ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data }));
        channel.on('close', () => { if (this.readyState !== 3) { this.readyState = 3; this.onclose?.({}); } });
        this.onopen?.({});
      }, error => { this.readyState = 3; this.onerror?.(error); this.onclose?.({}); });
    }
    send(data) {
      if (this.readyState !== 1) throw new Error('Sem conexão com o computador.');
      let message; try { message = typeof data === 'string' ? JSON.parse(data) : null; } catch { message = null; }
      if (message?.method === 'auth') { queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result: { authenticated: true } }) })); return; }
      this.channel.sendText(typeof data === 'string' ? data : String(data));
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.channel?.close(); this.onclose?.({}); }
  };
}
