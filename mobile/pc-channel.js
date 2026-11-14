import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes, randomBytes as nobleRandom } from '@noble/hashes/utils.js';

/**
 * The secure channel between the MyBots app (phone, no Termux) and the computer's node.
 *
 * It runs over any pipe of bytes: a WebSocket straight to the computer (home network) or through the relay.
 * It does not rely on TLS (React Native cannot pin a self-signed certificate), so everything is protected here:
 *
 *  - Pairing: the QR carries a one-use code (96 bits). Both sides derive a key from it; the phone proves it holds the code,
 *    the computer proves it too, and the computer hands over a new 256-bit secret inside the encrypted session.
 *  - Every connection: fresh X25519 keys (forward secrecy), each side proves it knows the secret with an HMAC over the whole
 *    handshake, and the traffic is ChaCha20-Poly1305 with a counter per direction (no replay, no reorder).
 *
 * A relay or anyone on the network sees only the magic bytes, the phone's id and ciphertext.
 * Used by the app (React Native) and by pc/app-channel.mjs, so both sides speak exactly the same thing.
 */
export const MAGIC = utf8ToBytes('MBC1');
export const MAX_FRAME = 8 * 1024 * 1024;
const MAX_HANDSHAKE = 2048;
export const TEXT = 1, BINARY = 2, PING = 3, PONG = 4;

let random = nobleRandom;
/** React Native has no global crypto: the app gives a source of random bytes (the platform's SecureRandom) here. */
export const setRandom = fn => { random = fn; };

const text = value => typeof value === 'string' ? utf8ToBytes(value) : value;
export const b64 = bytes => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64 = value => { const padded = String(value).replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(padded + '==='.slice((padded.length + 3) % 4)); const out = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i); return out; };
const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; };
// Hermes may not have TextDecoder: a small UTF-8 decoder (what JSON text needs).
const decoder = { decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if (a >= 0xc0 && a < 0xe0) out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (a >= 0xe0 && a < 0xf0) { out += String.fromCharCode(((a & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)); }
    else { const point = (((a & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000; out += String.fromCharCode(0xd800 + (point >> 10), 0xdc00 + (point & 0x3ff)); }
  }
  return out;
} };

const codeKey = code => hkdf(sha256, utf8ToBytes(String(code)), utf8ToBytes('mbc1'), utf8ToBytes('code'), 32);
const transcript = ({ cpub, spub, cn, sn, id, nodeId }) => sha256(concatBytes(utf8ToBytes('mbc1'), cpub, spub, cn, sn, utf8ToBytes(id), utf8ToBytes('|'), utf8ToBytes(nodeId)));
const sessionKeys = (shared, key, hash) => {
  const salt = hmac(sha256, key, utf8ToBytes('mbc1-salt'));
  const material = hkdf(sha256, shared, salt, concatBytes(hash, utf8ToBytes('keys')), 64);
  return { c2s: material.slice(0, 32), s2c: material.slice(32) };
};
const tag = (key, label, ...parts) => hmac(sha256, key, concatBytes(utf8ToBytes(label), ...parts));
const nonce = counter => { const out = new Uint8Array(12); new DataView(out.buffer).setBigUint64(4, BigInt(counter)); return out; };

const join = (chunks, size) => { const out = new Uint8Array(size); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out; };

/** Splits the byte stream into frames: 4 bytes of length, then the body. Chunks are joined once per frame, not once per read. */
class Frames {
  constructor(limit) { this.chunks = []; this.size = 0; this.limit = limit; }
  push(bytes) {
    if (bytes.length) { this.chunks.push(bytes); this.size += bytes.length; }
    const out = [];
    for (;;) {
      if (this.size < 4) break;
      if (this.chunks[0].length < 4) this.chunks = [join(this.chunks, this.size)];
      const head = this.chunks[0];
      const length = new DataView(head.buffer, head.byteOffset, 4).getUint32(0);
      if (length > this.limit) throw new Error('Quadro grande demais.');
      if (this.size < 4 + length) break;
      const all = this.chunks.length === 1 ? this.chunks[0] : join(this.chunks, this.size);
      out.push(all.slice(4, 4 + length)); const rest = all.slice(4 + length);
      this.chunks = rest.length ? [rest] : []; this.size = rest.length;
    }
    return out;
  }
}
const frame = body => { const out = new Uint8Array(4 + body.length); new DataView(out.buffer).setUint32(0, body.length); out.set(body, 4); return out; };

/**
 * An open, authenticated channel. Messages are text (JSON) or binary; ping/pong keep it alive. Not created directly.
 */
class Channel {
  constructor(pipe, frames, outgoing, incoming, peer) {
    Object.assign(this, { pipe, frames, peer }); this.sendKey = outgoing; this.receiveKey = incoming; this.sent = 0; this.received = 0; this.closed = false;
    this.listeners = { message: [], close: [] }; this.lastSeen = Date.now(); this.pending = [];
  }
  on(event, fn) { this.listeners[event].push(fn); return this; }
  emit(event, ...args) { for (const fn of this.listeners[event]) try { fn(...args); } catch {} }
  write(type, payload) {
    if (this.closed) return false;
    const body = chacha20poly1305(this.sendKey, nonce(this.sent++)).encrypt(concatBytes(Uint8Array.of(type), payload));
    this.pipe.send(frame(body)); return true;
  }
  sendText(value) { return this.write(TEXT, utf8ToBytes(value)); }
  sendBinary(bytes) { return this.write(BINARY, bytes); }
  ping() { return this.write(PING, new Uint8Array(0)); }
  /** Bytes from the pipe after the handshake. A bad frame (forged, replayed or out of order) closes the channel. */
  data(bytes) {
    let list;
    try { list = this.frames.push(bytes); } catch { this.close(); return; }
    for (const body of list) {
      let plain;
      try { plain = chacha20poly1305(this.receiveKey, nonce(this.received++)).decrypt(body); } catch { this.close(); return; }
      this.lastSeen = Date.now();
      const type = plain[0]; const payload = plain.slice(1);
      if (type === PING) this.write(PONG, new Uint8Array(0));
      else if (type === TEXT) this.emit('message', decoder.decode(payload), false);
      else if (type === BINARY) this.emit('message', payload, true);
    }
  }
  close() { if (this.closed) return; this.closed = true; try { this.pipe.close(); } catch {} this.emit('close'); }
}

/** Adapts a pipe ({ send(bytes), close() } plus the owner calling `deliver(bytes)` and `ended()`) so handshakes can await frames. */
function reader(pipe) {
  // Frames stay small until the peer has proved itself; MAX_FRAME after.
  const frames = new Frames(MAX_HANDSHAKE * 2); let magic = pipe.role === 'server' ? 0 : 4; let waiting = null, queue = [], channel = null, failed = null;
  const state = {
    frames,
    deliver(bytes) {
      if (channel) { channel.data(bytes); return; }
      if (magic < 4) {   // the server checks the 4 magic bytes first
        state.head = state.head ? concatBytes(state.head, bytes) : bytes;
        if (state.head.length < 4) return;
        if (!same(state.head.slice(0, 4), MAGIC)) { state.fail(new Error('Protocolo desconhecido.')); return; }
        bytes = state.head.slice(4); state.head = null; magic = 4;
      }
      let list; try { list = frames.push(bytes); } catch (error) { state.fail(error); return; }
      queue.push(...list); state.wake();
    },
    wake() { if (waiting && queue.length) { const resolve = waiting; waiting = null; resolve(queue.shift()); } },
    next(timeout = 10000) {
      if (failed) return Promise.reject(failed);
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting = null; reject(new Error('O outro lado não respondeu.')); }, timeout);
        waiting = value => { clearTimeout(timer); resolve(value); }; state.reject = error => { clearTimeout(timer); reject(error); };
      });
    },
    fail(error) { failed = error; state.reject?.(error); },
    ended() { state.fail(new Error('Conexão encerrada.')); channel?.close(); },
    take(next) { channel = next; frames.limit = MAX_FRAME; const rest = queue.splice(0); for (const body of rest) next.data(frame(body)); }
  };
  return state;
}
const json = body => { if (body.length > MAX_HANDSHAKE) throw new Error('Mensagem grande demais.'); return JSON.parse(decoder.decode(body)); };
const encrypt = (key, counter, type, payload) => chacha20poly1305(key, nonce(counter)).encrypt(concatBytes(Uint8Array.of(type), payload));
const decrypt = (key, counter, body) => { const plain = chacha20poly1305(key, nonce(counter)).decrypt(body); return { type: plain[0], payload: plain.slice(1) }; };

/**
 * The phone's side. `pipe` is { send(bytes), close() }; the caller feeds what arrives into the returned `deliver` and calls
 * `ended` when the pipe closes. Resolves with the open Channel.
 *  - connect: { id, secret (base64url), nodeId }
 *  - pair:    { id, name, code, nodeId } (resolves with the new secret in `channel.secret`)
 */
export function clientChannel(pipe, options, timeout = 10000) {
  const state = reader({ ...pipe, role: 'client' });
  const done = (async () => {
    const { id, nodeId } = options; const pairing = typeof options.code === 'string';
    const priv = x25519.utils.randomSecretKey ? x25519.utils.randomSecretKey(random(32)) : random(32); const cpub = x25519.getPublicKey(priv); const cn = random(16);
    const key = pairing ? codeKey(options.code) : unb64(options.secret);
    pipe.send(concatBytes(MAGIC, frame(utf8ToBytes(JSON.stringify(pairing
      ? { t: 'pair', id, name: String(options.name || 'Celular').slice(0, 40), cpub: b64(cpub), cn: b64(cn), proof: b64(tag(key, 'mbc1-pair', cpub, cn, utf8ToBytes(id))) }
      : { t: 'hello', id, cpub: b64(cpub), cn: b64(cn) })))));
    const reply = json(await state.next(timeout));
    if (reply.t === 'refused') throw new Error(String(reply.error || 'O computador recusou a conexão.').slice(0, 200));
    if (reply.t !== (pairing ? 'paired' : 'welcome')) throw new Error('Resposta inesperada do computador.');
    const spub = unb64(reply.spub), sn = unb64(reply.sn);
    if (spub.length !== 32 || sn.length !== 16) throw new Error('Resposta inválida do computador.');
    const hash = transcript({ cpub, spub, cn, sn, id, nodeId });
    // The computer proves it holds the secret (or the code) before anything else is trusted.
    if (!same(unb64(reply.tag), tag(key, pairing ? 'mbc1-paired' : 'mbc1-server', hash))) throw new Error('Este não é o computador pareado.');
    const keys = sessionKeys(x25519.getSharedSecret(priv, spub), key, hash);
    let secret = null; let received = 0;
    if (pairing) {
      const first = decrypt(keys.s2c, received++, await state.next(timeout)); const message = JSON.parse(decoder.decode(first.payload));
      if (message.t !== 'secret' || typeof message.secret !== 'string') throw new Error('O computador não entregou o segredo do pareamento.');
      secret = message.secret;
    }
    const proof = pairing ? unb64(secret) : key;
    pipe.send(frame(encrypt(keys.c2s, 0, TEXT, utf8ToBytes(JSON.stringify({ t: 'ready', tag: b64(tag(proof, 'mbc1-client', hash)) })))));
    const ready = decrypt(keys.s2c, received++, await state.next(timeout)); const hello = JSON.parse(decoder.decode(ready.payload));
    if (hello.t !== 'ready') throw new Error('O computador não confirmou a conexão.');
    const channel = new Channel(pipe, state.frames, keys.c2s, keys.s2c, { id: nodeId, name: hello.name, info: hello.info || null });
    channel.sent = 1; channel.received = received; if (secret) channel.secret = secret;
    state.take(channel); return channel;
  })();
  const guarded = done.catch(error => { try { pipe.close(); } catch {} throw error; });
  guarded.catch(() => {});
  return { deliver: bytes => state.deliver(bytes), ended: () => state.ended(), done: guarded };
}

/**
 * The computer's side of one connection. `ctx`: { nodeId, name, info, device(id) → { secret } | null,
 * code(proofCheck) → the code that matches (and the caller spends it) | null, paired({ id, name, secret }) }.
 * Resolves with { channel, device } when the phone is in, or rejects (the caller closes the pipe).
 */
export function serverChannel(pipe, ctx, timeout = 10000) {
  const state = reader({ ...pipe, role: 'server' });
  const done = (async () => {
    const hello = json(await state.next(timeout)); const { nodeId } = ctx;
    if (typeof hello.id !== 'string' || hello.id.length > 64 || typeof hello.cpub !== 'string' || typeof hello.cn !== 'string') throw new Error('Pedido inválido.');
    const cpub = unb64(hello.cpub), cn = unb64(hello.cn); if (cpub.length !== 32 || cn.length !== 16) throw new Error('Pedido inválido.');
    const pairing = hello.t === 'pair'; if (!pairing && hello.t !== 'hello') throw new Error('Pedido inválido.');
    let key, device = null, usedCode = null;
    if (pairing) {
      const proof = unb64(hello.proof || '');
      usedCode = ctx.code(candidate => same(proof, tag(codeKey(candidate), 'mbc1-pair', cpub, cn, utf8ToBytes(hello.id))));
      if (!usedCode) { pipe.send(frame(utf8ToBytes(JSON.stringify({ t: 'refused', error: 'Código de pareamento inválido ou vencido. Gere outro no computador.' })))); throw new Error('Código inválido.'); }
      key = codeKey(usedCode);
    } else {
      device = ctx.device(hello.id); if (!device) { pipe.send(frame(utf8ToBytes(JSON.stringify({ t: 'refused', error: 'Este celular não está pareado com o computador.' })))); throw new Error('Aparelho desconhecido.'); }
      key = unb64(device.secret);
    }
    const priv = x25519.utils.randomSecretKey ? x25519.utils.randomSecretKey(random(32)) : random(32); const spub = x25519.getPublicKey(priv); const sn = random(16);
    const hash = transcript({ cpub, spub, cn, sn, id: hello.id, nodeId });
    const keys = sessionKeys(x25519.getSharedSecret(priv, cpub), key, hash);
    pipe.send(frame(utf8ToBytes(JSON.stringify({ t: pairing ? 'paired' : 'welcome', spub: b64(spub), sn: b64(sn), tag: b64(tag(key, pairing ? 'mbc1-paired' : 'mbc1-server', hash)) }))));
    let sent = 0; let secret = null;
    if (pairing) {
      secret = random(32);
      pipe.send(frame(encrypt(keys.s2c, sent++, TEXT, utf8ToBytes(JSON.stringify({ t: 'secret', secret: b64(secret) })))));
    }
    // The phone proves it knows the secret; only then does the code count as spent and the phone as paired.
    const first = decrypt(keys.c2s, 0, await state.next(timeout)); const ready = JSON.parse(decoder.decode(first.payload));
    const proofKey = pairing ? secret : key;
    if (ready.t !== 'ready' || !same(unb64(ready.tag || ''), tag(proofKey, 'mbc1-client', hash))) throw new Error('Prova do celular inválida.');
    if (pairing) { ctx.paired({ id: hello.id, name: String(hello.name || 'Celular').slice(0, 40), secret: b64(secret), code: usedCode }); device = { id: hello.id, name: String(hello.name || 'Celular').slice(0, 40) }; }
    pipe.send(frame(encrypt(keys.s2c, sent++, TEXT, utf8ToBytes(JSON.stringify({ t: 'ready', name: ctx.name, info: ctx.info || null })))));
    const channel = new Channel(pipe, state.frames, keys.s2c, keys.c2s, { id: hello.id, name: device.name });
    channel.sent = sent; channel.received = 1;
    state.take(channel); return { channel, device };
  })();
  const guarded = done.catch(error => { try { pipe.close(); } catch {} throw error; });
  guarded.catch(() => {});
  return { deliver: bytes => state.deliver(bytes), ended: () => state.ended(), done: guarded };
}
