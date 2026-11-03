import test from 'node:test';
import assert from 'node:assert/strict';
import { clientChannel, serverChannel, b64, unb64, setRandom } from '../mobile/pc-channel.js';
import { randomBytes } from 'node:crypto';

const NODE = 'noDeId123';
const CODE = 'codigo-de-pareamento-12345';

/** Two ends joined in memory; every chunk is also given to `tap` (what a relay or a network observer would see), and can be cut small. */
function wire({ chunk = 0, tap = () => {}, mutate = null } = {}) {
  const ends = { client: null, server: null }; const seen = [];
  const make = (name, other) => ({ send(bytes) {
    seen.push(Buffer.from(bytes)); tap(bytes);
    let data = mutate ? mutate(name, bytes) : bytes; if (!data) return;
    const parts = chunk ? Array.from({ length: Math.ceil(data.length / chunk) }, (_, i) => data.slice(i * chunk, (i + 1) * chunk)) : [data];
    for (const part of parts) queueMicrotask(() => ends[other]?.deliver(part));
  }, close() { queueMicrotask(() => { ends[name]?.ended(); ends[other]?.ended(); }); } });
  return { ends, seen, clientPipe: make('client', 'server'), serverPipe: make('server', 'client') };
}
function context(overrides = {}) {
  const devices = new Map(); const codes = new Set([CODE]); const log = [];
  return { devices, codes, log, nodeId: NODE, name: 'Meu PC', info: { x: 1 },
    device: id => devices.get(id) || null,
    code: check => [...codes].find(code => check(code)) || null,
    paired: ({ id, name, secret, code }) => { devices.set(id, { id, name, secret }); codes.delete(code); log.push(['paired', id]); }, ...overrides };
}
async function open(options, ctx, tune) {
  const w = wire(tune); const server = serverChannel(w.serverPipe, ctx); const client = clientChannel(w.clientPipe, options);
  w.ends.client = client; w.ends.server = server;
  const [channel, accepted] = await Promise.all([client.done, server.done]);
  return { ...w, channel, accepted, server: accepted.channel };
}
async function pairOnce(ctx, tune) { return open({ id: 'tel-1', name: 'Meu celular', code: CODE, nodeId: NODE }, ctx, tune); }

test('pairing hands the phone a new secret, spends the code, and later connections need only that secret', async () => {
  const ctx = context(); const first = await pairOnce(ctx);
  assert.ok(first.channel.secret && unb64(first.channel.secret).length === 32);
  assert.equal(ctx.devices.get('tel-1').secret, first.channel.secret); assert.equal(ctx.codes.size, 0); assert.equal(first.accepted.device.name, 'Meu celular');
  assert.equal(first.channel.peer.name, 'Meu PC'); assert.deepEqual(first.channel.peer.info, { x: 1 });
  first.channel.close();
  const again = await open({ id: 'tel-1', secret: first.channel.secret, nodeId: NODE }, ctx);
  assert.equal(again.accepted.device.id, 'tel-1'); again.channel.close();
});

test('messages cross both ways: text with accents and emoji, binary, a megabyte, in tiny pieces', async () => {
  const ctx = context(); const { channel, server } = await pairOnce(ctx, { chunk: 7 });
  const got = { client: [], server: [] };
  channel.on('message', (data, binary) => got.client.push([data, binary])); server.on('message', (data, binary) => got.server.push([data, binary]));
  const big = randomBytes(1024 * 1024); const frame = Uint8Array.from([9, 8, 7]);
  channel.sendText('olá, ação — 😀 {"a":1}'); channel.sendBinary(big); server.sendText('resposta do computador'); server.sendBinary(frame);
  for (let i = 0; i < 400 && (got.server.length < 2 || got.client.length < 2); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(got.server[0], ['olá, ação — 😀 {"a":1}', false]); assert.ok(Buffer.from(got.server[1][0]).equals(big)); assert.equal(got.server[1][1], true);
  assert.deepEqual(got.client[0], ['resposta do computador', false]); assert.deepEqual([...got.client[1][0]], [9, 8, 7]);
  channel.close();
});

test('what crosses the network is not readable: no plaintext, no secret, no code', async () => {
  const ctx = context(); const { channel, server, seen } = await pairOnce(ctx);
  channel.sendText('SEGREDO-DA-CONVERSA-123'); server.sendText('RESPOSTA-PRIVADA-456'); await new Promise(resolve => setTimeout(resolve, 20));
  const wire = Buffer.concat(seen).toString('latin1');
  for (const secret of ['SEGREDO-DA-CONVERSA-123', 'RESPOSTA-PRIVADA-456', CODE, channel.secret]) assert.equal(wire.includes(secret), false, secret);
  assert.ok(wire.startsWith('MBC1'));
  channel.close();
});

test('a wrong secret is refused on both sides, and an unknown phone learns nothing', async () => {
  const ctx = context(); const paired = await pairOnce(ctx); paired.channel.close();
  const wrong = b64(randomBytes(32));
  const w = wire(); const server = serverChannel(w.serverPipe, ctx); const client = clientChannel(w.clientPipe, { id: 'tel-1', secret: wrong, nodeId: NODE });
  w.ends.client = client; w.ends.server = server;
  await assert.rejects(client.done, /Este não é o computador pareado|Conexão encerrada/); await assert.rejects(server.done, /Prova do celular inválida|Conexão encerrada|inválida/);
  // Unknown id: the refusal says nothing about why.
  const u = wire(); const s2 = serverChannel(u.serverPipe, ctx); const c2 = clientChannel(u.clientPipe, { id: 'desconhecido', secret: wrong, nodeId: NODE });
  u.ends.client = c2; u.ends.server = s2;
  await assert.rejects(c2.done, /não está pareado/); await assert.rejects(s2.done, /desconhecido/);
});

test('a computer that does not know the secret cannot pass for the paired one (a man in the middle)', async () => {
  const ctx = context(); const paired = await pairOnce(ctx); paired.channel.close();
  const impostor = context(); impostor.devices.set('tel-1', { id: 'tel-1', name: 'x', secret: b64(randomBytes(32)) });
  const w = wire(); const server = serverChannel(w.serverPipe, impostor); const client = clientChannel(w.clientPipe, { id: 'tel-1', secret: paired.channel.secret, nodeId: NODE });
  w.ends.client = client; w.ends.server = server;
  await assert.rejects(client.done, /Este não é o computador pareado/); await server.done.catch(() => {});
});

test('the pairing code works once, a wrong code is refused, and a code spent by someone else does not pair again', async () => {
  const ctx = context();
  const w = wire(); const server = serverChannel(w.serverPipe, ctx); const client = clientChannel(w.clientPipe, { id: 'tel-x', name: 'x', code: 'codigo-errado-000000000', nodeId: NODE });
  w.ends.client = client; w.ends.server = server;
  await assert.rejects(client.done, /inválido ou vencido/); await server.done.catch(() => {}); assert.equal(ctx.devices.size, 0); assert.equal(ctx.codes.size, 1);
  (await pairOnce(ctx)).channel.close();
  const w2 = wire(); const s2 = serverChannel(w2.serverPipe, ctx); const c2 = clientChannel(w2.clientPipe, { id: 'tel-2', name: 'y', code: CODE, nodeId: NODE });
  w2.ends.client = c2; w2.ends.server = s2; await assert.rejects(c2.done, /inválido ou vencido/); await s2.done.catch(() => {}); assert.equal(ctx.devices.has('tel-2'), false);
});

test('tampering, replay and reordering close the channel', async () => {
  for (const attack of ['flip', 'replay', 'swap']) {
    const ctx = context(); let armed = false; let held = null; let count = 0;
    const mutate = (from, bytes) => {
      if (!armed || from !== 'client') return bytes;
      if (attack === 'flip') { const copy = Uint8Array.from(bytes); copy[copy.length - 1] ^= 1; return copy; }
      if (attack === 'replay') { queueMicrotask(() => {}); return bytes; }
      if (++count === 1) { held = bytes; return null; }      // swap: the second message goes before the first
      if (count === 2) { return Uint8Array.from([...bytes, ...held]); }
      return bytes;
    };
    const { channel, server } = await pairOnce(ctx, { mutate });
    let closed = false; server.on('close', () => { closed = true; }); const received = []; server.on('message', data => received.push(data));
    armed = true;
    if (attack === 'replay') {
      // The same encrypted frame arrives twice.
      const first = channel.write.bind(channel); let copy = null; const send = channel.pipe.send; channel.pipe = { ...channel.pipe, send(bytes) { copy = bytes; send(bytes); } };
      channel.sendText('uma vez'); await new Promise(resolve => setTimeout(resolve, 20)); channel.pipe = { ...channel.pipe, send }; send(copy);
    } else { channel.sendText('primeira'); channel.sendText('segunda'); }
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(closed, true, attack); assert.ok(received.length <= 1, attack);
    if (attack === 'replay') assert.deepEqual(received, ['uma vez']);
    if (attack !== 'replay') assert.equal(received.length, 0, attack);
  }
});

test('a stranger that does not speak the protocol, or sends a huge frame before proving itself, is dropped', async () => {
  const ctx = context();
  const w = wire(); const server = serverChannel(w.serverPipe, ctx); w.ends.server = server; w.ends.client = { deliver() {}, ended() {} };
  server.deliver(Uint8Array.from(Buffer.from('GET / HTTP/1.1\r\n\r\n'))); await assert.rejects(server.done, /Protocolo desconhecido/);
  const w2 = wire(); const s2 = serverChannel(w2.serverPipe, ctx); w2.ends.server = s2; w2.ends.client = { deliver() {}, ended() {} };
  s2.deliver(Uint8Array.from([...Buffer.from('MBC1'), 0x00, 0x7f, 0xff, 0xff])); await assert.rejects(s2.done, /Quadro grande demais/);
  const w3 = wire(); const s3 = serverChannel(w3.serverPipe, ctx, 60); w3.ends.server = s3; w3.ends.client = { deliver() {}, ended() {} };
  await assert.rejects(s3.done, /não respondeu/);
});

test('the random source can be supplied (React Native has no global crypto) and base64url round-trips', async () => {
  let used = 0; setRandom(count => { used++; return Uint8Array.from(randomBytes(count)); });
  try { const ctx = context(); (await pairOnce(ctx)).channel.close(); assert.ok(used >= 4); } finally { setRandom(count => Uint8Array.from(randomBytes(count))); }
  for (const size of [0, 1, 2, 3, 31, 32, 33]) { const bytes = Uint8Array.from(randomBytes(size)); assert.deepEqual([...unb64(b64(bytes))], [...bytes]); }
});
