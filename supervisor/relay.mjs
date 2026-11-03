import { createHmac } from 'node:crypto';
import WebSocket, { createWebSocketStream } from 'ws';

// The relay (relay/server.mjs) joins two devices that cannot see each other. It only forwards bytes: the TLS and the
// HMAC proof of the direct link run inside the tunnel, so the relay never sees anything but ciphertext.
// Default for the beta; MYBOTS_RELAY changes it ("0" turns the relay off). The default is wss:// (Caddy with a Let's Encrypt
// certificate on port 443, forwarding to the relay); the old ws:// address stays as a spare for when the name does not resolve.
export const DEFAULT_RELAY = 'wss://mybots-rele.duckdns.org';
export const LEGACY_RELAY = 'ws://136.248.104.150:3240';
const URL_FORMAT = /^wss?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?\/?$/;
export const validRelay = value => typeof value === 'string' && value.length <= 300 && URL_FORMAT.test(value);
export function relayFromEnvironment(env = process.env) {
  const value = env.MYBOTS_RELAY;
  if (value === '0') return null;
  return validRelay(value) ? value.replace(/\/$/, '') : DEFAULT_RELAY;
}

/** The room of a pairing: a name only the two devices can work out (it comes from the pairing secret). */
export const roomFor = secret => createHmac('sha256', String(secret)).update('mybots-relay-room').digest('base64url');

/** The addresses to try for a relay: the default one falls back to the old ws:// address; any other (set by hand) stands alone. */
export const relayCandidates = relay => relay === DEFAULT_RELAY ? [DEFAULT_RELAY, LEGACY_RELAY] : [relay];

const endpoint = (relay, role, room, session) => `${relay.replace(/\/$/, '')}/?role=${role}&room=${encodeURIComponent(room)}${session ? `&sid=${encodeURIComponent(session)}` : ''}`;

// The byte stream is made before the connection opens: the relay may send its first bytes (the other side's TLS hello)
// together with the handshake, and ws delivers them right after "open", before any later listener could be attached.
function connect(url, { timeout = 6000, stream: wanted = false } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: timeout, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
    const stream = wanted ? createWebSocketStream(ws) : null;
    if (stream) { stream.on('error', () => {}); ws.on('close', () => stream.destroy()); }
    const fail = error => { ws.removeAllListeners('open'); ws.on('error', () => {}); ws.terminate(); stream?.destroy(); reject(error); };
    ws.once('error', error => fail(new Error(error.message || 'Relé inacessível.')));
    ws.once('close', code => fail(Object.assign(new Error(code === 4404 ? 'O computador está desconectado.' : 'O relé fechou a conexão.'), code === 4404 ? { answered: true } : {})));
    ws.once('open', () => { ws.removeAllListeners('error'); ws.removeAllListeners('close'); if (stream) ws.on('close', () => stream.destroy()); ws.on('error', () => {}); resolve(stream || ws); });
  });
}

// Tries each address of the relay in turn; an answer from the relay itself (the computer is offline) is final.
async function viaRelay(relay, make, candidates = relayCandidates(relay)) {
  let last;
  for (const candidate of candidates) {
    try { return await make(candidate); } catch (error) { last = error; if (error.answered) break; }
  }
  throw last;
}

/** The phone's side: a byte stream to the computer waiting in the room (the relay tells the computer to accept it). */
export const dialRelay = (relay, room, options) => viaRelay(relay, candidate => connect(endpoint(candidate, 'guest', room), { ...options, stream: true }), options?.candidates);

/** The computer's side of one session: the data connection the relay joins to the waiting phone. */
export const acceptRelay = (relay, room, session, options) => viaRelay(relay, candidate => connect(endpoint(candidate, 'accept', room, session), { ...options, stream: true }), options?.candidates);

/**
 * The computer waits in each room (one per paired phone) and hands every phone that arrives to `onStream`.
 * It reconnects by itself, with a growing pause, and picks up rooms added or removed by `rooms()`.
 */
export function hostRelay({ relay, rooms, onStream, log = () => {}, timers = { first: 2000, max: 60000 } }) {
  const hosts = new Map(); let closed = false;
  function wait(room) {
    const entry = hosts.get(room) || { attempt: 0, ws: null, timer: null }; hosts.set(room, entry);
    viaRelay(relay, candidate => connect(endpoint(candidate, 'host', room))).then(ws => {
      if (closed || hosts.get(room) !== entry) { ws.terminate(); return; }
      entry.ws = ws; entry.attempt = 0; ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      entry.ping = setInterval(() => { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }, 25000);
      ws.on('error', () => {});
      ws.on('message', raw => {
        let message; try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message?.type !== 'incoming' || typeof message.sid !== 'string') return;
        acceptRelay(relay, room, message.sid).then(stream => onStream(stream, room), () => {});
      });
      ws.on('close', () => { clearInterval(entry.ping); entry.ws = null; again(room, entry); });
    }, () => again(room, entry));
  }
  function again(room, entry) {
    if (closed || hosts.get(room) !== entry) return;
    entry.timer = setTimeout(() => wait(room), Math.min(timers.max, timers.first * 2 ** Math.min(entry.attempt++, 6)));
    entry.timer.unref?.();
  }
  const sync = () => {
    const wanted = new Set(rooms());
    for (const room of wanted) if (!hosts.has(room)) wait(room);
    for (const [room, entry] of hosts) if (!wanted.has(room)) { hosts.delete(room); clearTimeout(entry.timer); clearInterval(entry.ping); entry.ws?.terminate(); }
  };
  sync();
  return { sync, rooms: () => [...hosts.keys()], online: () => [...hosts.values()].filter(entry => entry.ws?.readyState === 1).length,
    close() { closed = true; for (const entry of hosts.values()) { clearTimeout(entry.timer); clearInterval(entry.ping); entry.ws?.terminate(); } hosts.clear(); } };
}
