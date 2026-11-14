import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { WebSocket } from '../supervisor/node_modules/ws/wrapper.mjs';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode } from '../pc/server.mjs';
import { createRelay } from '../relay/server.mjs';
import { parsePairing, pairingLink } from '../supervisor/link.mjs';
import { roomFor, validRelay, relayFromEnvironment, relayCandidates, dialRelay, hostRelay, DEFAULT_RELAY, LEGACY_RELAY } from '../supervisor/relay.mjs';
import { pathOf } from '../supervisor/discovery.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const model = { ...selection, provider: 'codex', displayName: 'Teste', efforts: ['low'], defaultEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Estado esperado não chegou.'); }
const freePort = () => new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

async function setup(t) {
  const phoneDir = await mkdtemp(join(tmpdir(), 'mybots-phone-')); const pcDir = await mkdtemp(join(tmpdir(), 'mybots-pc-'));
  const relay = createRelay({ port: 0, host: '127.0.0.1' }); const relayPort = await relay.listen(); const url = `ws://127.0.0.1:${relayPort}`;
  const app = await createSupervisor({ directory: phoneDir, port: 0, codex, execute: async bot => ({ text: `${bot.name} no celular`, ...selection, codexSessionId: randomUUID() }) });
  const turns = [];
  const options = { directory: pcDir, port: await freePort(), uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, relay: url, log: () => {},
    execute: async (bot, prompt) => { turns.push(prompt); return { text: `${bot.name} no computador`, ...selection, codexSessionId: randomUUID() }; },
    status: async () => ({ connections: { codex: { available: true, loggedIn: true, message: '' } }, models: [model] }) };
  const node = await createNode(options);
  const extra = [];
  t.after(async () => { await app.close(); for (const item of [node, ...extra]) await item.close().catch(() => {}); await relay.close(); await rm(phoneDir, { recursive: true, force: true }); await rm(pcDir, { recursive: true, force: true }); });
  return { app, node, relay, url, pcDir, turns, options, extra };
}

test('the relay is only a pipe: rooms are unguessable names, unknown rooms and bad requests are refused, nothing is stored', async t => {
  const relay = createRelay({ port: 0, host: '127.0.0.1' }); const port = await relay.listen(); t.after(() => relay.close());
  const base = `ws://127.0.0.1:${port}`; const room = roomFor('um segredo qualquer');
  assert.equal(room.length, 43); assert.notEqual(room, roomFor('outro segredo'));
  const closed = url => new Promise(resolve => { const ws = new WebSocket(url); ws.on('error', error => resolve({ error: error.message })); ws.on('close', code => resolve({ code })); });
  assert.equal((await closed(`${base}/?role=guest&room=${room}`)).code, 4404);               // nobody is waiting there
  assert.match((await closed(`${base}/?role=guest&room=curta`)).error, /400/);                 // not a room name
  assert.match((await closed(`${base}/?role=other&room=${room}`)).error, /400/);
  assert.match((await closed(`${base}/?role=accept&room=${room}`)).error, /400/);             // accept needs a session
  assert.equal((await closed(`${base}/?role=accept&room=${room}&sid=desconhecida1`)).code, 4404);
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); assert.deepEqual(health, { ok: true, rooms: 0 });
  assert.equal((await fetch(`http://127.0.0.1:${port}/qualquer`)).status, 404);
});

test('the relay limits connections per address', async t => {
  const relay = createRelay({ port: 0, host: '127.0.0.1', limits: { perAddress: 2 } }); const port = await relay.listen(); t.after(() => relay.close());
  const room = roomFor('limite'); const open = () => new Promise(resolve => { const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=host&room=${room}`); ws.on('open', () => resolve(ws)); ws.on('error', error => resolve(error)); });
  const first = await open(), second = await open(); const third = await open();
  assert.ok(first instanceof WebSocket && second instanceof WebSocket); assert.match(third.message, /429/);
  first.terminate(); second.terminate();
});

test('QR and settings: the relay address travels with the pairing and only plain host:port is accepted', () => {
  const link = pairingLink({ id: 'abc', name: 'PC', port: 3230, fingerprint: 'AA:'.repeat(31) + 'AA', code: 'codigo123', addresses: ['192.168.0.2'], relay: 'ws://136.248.104.150:3240' });
  assert.equal(parsePairing(link).relay, 'ws://136.248.104.150:3240');
  assert.equal(parsePairing(pairingLink({ id: 'abc', name: 'PC', port: 3230, fingerprint: 'AA:'.repeat(31) + 'AA', code: 'codigo123', addresses: ['192.168.0.2'] })).relay, undefined);
  for (const bad of ['ws://a.b:3240/caminho', 'http://x:1', 'ws://x y:1', 'ws://[::1]:3240', 'javascript:alert(1)', '']) assert.equal(validRelay(bad), false, bad);
  assert.equal(relayFromEnvironment({}), DEFAULT_RELAY); assert.equal(relayFromEnvironment({ MYBOTS_RELAY: '0' }), null); assert.equal(relayFromEnvironment({ MYBOTS_RELAY: 'ws://meu.relay:9' }), 'ws://meu.relay:9');
});

test('phone and computer talk through the relay when they cannot reach each other, and go back to the direct way', async t => {
  const f = await setup(t);
  // Paired the usual way (the QR carries the relay), then the computer's direct address stops working.
  await f.app.rpc('computer.pair', { link: f.node.pairing().link });
  await until(() => f.app.state().computer.state === 'online');
  assert.equal(f.app.state().computer.via, 'direct'); assert.equal(f.app.state().computer.path, 'local'); assert.equal(f.app.link.saved().relay, f.url);
  await until(() => f.node.relay().online() === 1);
  const good = f.app.link.saved();
  f.app.link.save({ ...good, addresses: ['127.0.0.1'], port: 1 }); f.app.link.drop(); f.app.link.kick();
  await until(() => f.app.state().computer.state === 'online', 15000);
  assert.equal(f.app.state().computer.via, 'relay'); assert.equal(f.app.state().computer.path, 'relay');
  // A turn of a computer bot runs there and comes back through the tunnel.
  const bot = await f.app.rpc('bot.create', { name: 'Longe', home: 'pc', access: 'ask', ...selection });
  const sent = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi de longe' });
  await until(() => f.app.db.task(sent.taskId).state === 'done', 15000);
  assert.deepEqual(f.turns.length, 1); assert.match(f.app.db.page({ botId: bot.id }).messages.at(-1).text, /no computador/);
  // The direct way works again: the link notices and moves to it by itself.
  f.app.link.directEvery = 100; f.app.link.save({ ...good }); f.app.link.watchDirect();
  await until(() => f.app.state().computer.state === 'online' && f.app.state().computer.via === 'direct', 15000);
});

test('a relay cannot pose as the computer: the pinned certificate refuses another machine in the room', async t => {
  const f = await setup(t);
  await f.app.rpc('computer.pair', { link: f.node.pairing().link });
  await until(() => f.app.state().computer.state === 'online' && f.node.relay().online() === 1);
  const saved = f.app.link.saved(); const phones = JSON.parse(await readFile(join(f.pcDir, 'phones.json'), 'utf8'));
  // Another computer (other identity) takes the same room, as a hostile relay or room-squatter would.
  const impostorDir = await mkdtemp(join(tmpdir(), 'mybots-impostor-')); t.after(() => rm(impostorDir, { recursive: true, force: true }));
  await writeFile(join(impostorDir, 'phones.json'), JSON.stringify(phones), { mode: 0o600 });
  f.node.relay().close(); // the real computer leaves the room (otherwise it would take its place back after a pause)
  const impostor = await createNode({ ...f.options, directory: impostorDir, port: await freePort() }); f.extra.push(impostor);
  await until(() => impostor.relay().online() === 1);
  f.app.link.save({ ...saved, addresses: ['127.0.0.1'], port: 1 }); f.app.link.drop(); f.app.link.kick();
  await until(() => /Outro aparelho/.test(f.app.state().computer.error || ''), 15000);
  assert.notEqual(f.app.state().computer.state, 'online');
});

test('the way two devices reach each other is named for the connection screen', () => {
  assert.equal(pathOf(undefined), 'relay'); assert.equal(pathOf('127.0.0.1'), 'local'); assert.equal(pathOf('::1'), 'local'); assert.equal(pathOf('::ffff:127.0.0.1'), 'local');
  assert.equal(pathOf('192.168.0.103'), 'lan'); assert.equal(pathOf('10.0.0.5'), 'lan'); assert.equal(pathOf('::ffff:192.168.1.2'), 'lan');
  assert.equal(pathOf('100.70.166.116'), 'internet'); assert.equal(pathOf('200.128.150.13'), 'internet');
});

test('without a relay configured nothing changes: the node does not dial out and the QR has no relay', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-norelay-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const node = await createNode({ directory: dir, port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, log: () => {}, status: async () => ({ connections: {}, models: [] }) });
  t.after(() => node.close());
  assert.equal(node.relay(), null); assert.equal(parsePairing(node.pairing().link).relay, undefined);
});

// ---- wss:// (Etapa 0 da distribuição) ----
function testCertificate(directory) {
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { key, cert };
}
async function withUntrusted(run) { // the test certificate is self-signed: trust it only while the test runs
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try { return await run(); } finally { if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before; }
}

test('wss:// relay: addresses are accepted, the default is the secure name with the old ws:// as spare', () => {
  assert.equal(validRelay('wss://mybots-rele.duckdns.org'), true); assert.equal(validRelay('wss://a.b:8443/'), true); assert.equal(validRelay('wss://x y'), false);
  assert.equal(DEFAULT_RELAY, 'wss://mybots-rele.duckdns.org');
  assert.equal(relayFromEnvironment({ MYBOTS_RELAY: 'wss://meu.relay' }), 'wss://meu.relay');
  assert.deepEqual(relayCandidates(DEFAULT_RELAY), [DEFAULT_RELAY, LEGACY_RELAY]);
  assert.deepEqual(relayCandidates('wss://meu.relay'), ['wss://meu.relay']);
  assert.equal(parsePairing(pairingLink({ id: 'abc', name: 'PC', port: 3230, fingerprint: 'AA:'.repeat(31) + 'AA', code: 'codigo123', addresses: ['192.168.0.2'], relay: DEFAULT_RELAY })).relay, DEFAULT_RELAY);
});

test('wss:// relay: the computer and the phone meet through TLS and bytes flow both ways', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-tls-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { key, cert } = testCertificate(directory);
  const relay = createRelay({ port: 0, host: '127.0.0.1', tls: { key: await readFile(key), cert: await readFile(cert) } }); const port = await relay.listen(); t.after(() => relay.close());
  await withUntrusted(async () => {
    const url = `wss://localhost:${port}`; const room = roomFor('segredo do wss');
    const streams = []; const host = hostRelay({ relay: url, rooms: () => [room], onStream: stream => streams.push(stream) }); t.after(() => host.close());
    await until(() => host.online() === 1);
    const phone = await dialRelay(url, room); await until(() => streams.length === 1);
    const received = new Promise(resolve => streams[0].once('data', resolve)); phone.write('do celular'); assert.equal((await received).toString(), 'do celular');
    const back = new Promise(resolve => phone.once('data', resolve)); streams[0].write('do computador'); assert.equal((await back).toString(), 'do computador');
    phone.destroy(); streams[0].destroy();
  });
});

test('wss:// relay: without TLS trust the connection fails (the certificate is really checked)', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-tls-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { key, cert } = testCertificate(directory);
  const relay = createRelay({ port: 0, host: '127.0.0.1', tls: { key: await readFile(key), cert: await readFile(cert) } }); const port = await relay.listen(); t.after(() => relay.close());
  await assert.rejects(dialRelay(`wss://localhost:${port}`, roomFor('x'), { timeout: 3000 }), /self.signed|certificate|unable/i);
});

test('dialing the relay tries the spare address when the first does not answer (closed port, name that does not resolve)', async t => {
  const relay = createRelay({ port: 0, host: '127.0.0.1' }); const port = await relay.listen(); t.after(() => relay.close());
  const room = roomFor('reserva'); const streams = []; const host = hostRelay({ relay: `ws://127.0.0.1:${port}`, rooms: () => [room], onStream: stream => streams.push(stream) }); t.after(() => host.close());
  await until(() => host.online() === 1);
  const closed = await freePort();
  const phone = await dialRelay(`ws://127.0.0.1:${closed}`, room, { candidates: [`ws://127.0.0.1:${closed}`, 'ws://nome-que-nao-existe.invalid', `ws://127.0.0.1:${port}`] });
  await until(() => streams.length === 1); phone.destroy(); streams[0].destroy();
  await assert.rejects(dialRelay(`ws://127.0.0.1:${closed}`, room, { candidates: [`ws://127.0.0.1:${closed}`] }));
});

test('behind the proxy the per-address limit counts the client written in X-Forwarded-For, not the proxy', async t => {
  const relay = createRelay({ port: 0, host: '127.0.0.1', limits: { perAddress: 1 } }); const port = await relay.listen(); t.after(() => relay.close());
  const open = (ip, room) => new Promise(resolve => { const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=host&room=${roomFor(room)}`, { headers: { 'X-Forwarded-For': ip } }); ws.once('open', () => resolve({ ws, ok: true })); ws.once('error', () => resolve({ ok: false })); ws.once('unexpected-response', () => resolve({ ok: false })); });
  const a = await open('203.0.113.1', 'a'), b = await open('203.0.113.2', 'b'), again = await open('203.0.113.1', 'c');
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(again.ok, false);
  a.ws.terminate(); b.ws.terminate();
});
