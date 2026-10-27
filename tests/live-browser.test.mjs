import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from '../supervisor/node_modules/ws/wrapper.mjs';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode } from '../pc/server.mjs';
import { BrowserSession } from '../pc/browser-worker.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 800; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

/** A client speaking the supervisor's protocol (the app on the phone, or the window on the computer). */
async function client(url, token, origin) {
  const ws = new WebSocket(url, origin ? { origin } : {}); const frames = []; const waiting = new Map(); let serial = 0;
  ws.on('message', raw => { const message = JSON.parse(raw); if (message.event === 'browser.frame') frames.push(message.data); else waiting.get(message.id)?.(message); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = String(++serial); waiting.set(id, message => { waiting.delete(id); message.error ? reject(new Error(message.error)) : resolve(message.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await call('auth', { token });
  return { ws, frames, call };
}

test('live view: frames reach only the app watching that bot; taps need Assumir; the computer window sees the same Chrome', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-live-'));
  const app = await createSupervisor({ directory: join(directory, 'phone'), port: 0, codex });
  const ops = [];
  const browser = { command: async (botId, op, args) => {
    ops.push({ botId, op, args });
    if (op === 'view' && args.on) setTimeout(() => browser.onFrame(botId, { image: Buffer.from('img'), seq: 1, width: 1280, height: 800, url: 'https://example.com/' }), 5);
    return { url: 'https://example.com/' };
  }, stop: () => {}, close: () => {} };
  const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], browser,
    status: async () => ({ connections: { codex: { loggedIn: true } }, models: [] }), desktop: { indicate: async () => async () => {} } });
  const sockets = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); await app.close(); await node.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('computer.pair', { link: node.pairing().link }); await until(() => app.state().computer.state === 'online');
  const bot = await app.rpc('bot.create', { name: 'Navega', home: 'pc', access: 'full', ...selection });
  const other = await app.rpc('bot.create', { name: 'Outro', home: 'pc', access: 'full', ...selection });

  const watcher = await client(`ws://127.0.0.1:${app.port}`, app.token); const idle = await client(`ws://127.0.0.1:${app.port}`, app.token);
  sockets.push(watcher.ws, idle.ws);
  assert.deepEqual(await watcher.call('browser.view', { botId: bot.id, on: true, maxWidth: 640, maxHeight: 400 }), { watching: true, online: true });
  await until(() => watcher.frames.length);
  assert.deepEqual(watcher.frames[0], { botId: bot.id, image: 'aW1n', seq: 1, width: 1280, height: 800, url: 'https://example.com/' });
  assert.equal(idle.frames.length, 0);
  assert.ok(ops.some(item => item.botId === bot.id && item.op === 'view' && item.args.on && item.args.maxWidth === 640 && item.args.maxHeight === 400 && !item.args.interactive));

  // Before "Assumir", the page is only watched; the computer refuses taps even if the phone's check were skipped.
  await assert.rejects(watcher.call('browser.input', { botId: bot.id, input: { type: 'tap', x: 0.5, y: 0.5 } }), /Assumir/);
  app.link.input(bot.id, { type: 'tap', x: 0.5, y: 0.5 });
  await until(() => watcher.frames.some(frame => /Assumir/.test(frame.error || '')));
  assert.ok(!ops.some(item => item.op === 'input'));
  await watcher.call('browser.control', { botId: bot.id, who: 'person' });
  await until(() => ops.some(item => item.op === 'view' && item.args.interactive));
  await watcher.call('browser.input', { botId: bot.id, input: { type: 'tap', x: 0.25, y: 0.75, extra: 'ignorado' } });
  await until(() => ops.some(item => item.op === 'input'));
  assert.deepEqual(ops.find(item => item.op === 'input'), { botId: bot.id, op: 'input', args: { type: 'tap', x: 0.25, y: 0.75, dx: 0, dy: 0, text: '', key: '', url: '' } });
  await assert.rejects(watcher.call('browser.input', { botId: bot.id, input: { type: 'shell' } }), /inválida/);
  // Another bot's browser was not taken over.
  await assert.rejects(watcher.call('browser.input', { botId: other.id, input: { type: 'tap', x: 0, y: 0 } }), /Assumir/);

  // The window on the computer watches locally and types after the takeover made on the phone.
  const token = (await readFile(join(directory, 'pc', 'ui-token'), 'utf8')).trim();
  const window = await client(`ws://127.0.0.1:${node.uiPort}`, token, `http://127.0.0.1:${node.uiPort}`); sockets.push(window.ws);
  await window.call('browser.view', { botId: bot.id, on: true });
  await until(() => window.frames.length);
  await window.call('browser.input', { botId: bot.id, input: { type: 'text', text: 'olá' } });
  await until(() => ops.some(item => item.op === 'input' && item.args.type === 'text'));
  await watcher.call('browser.control', { botId: bot.id, who: 'bot' });
  await until(() => window.call('browser.input', { botId: bot.id, input: { type: 'key', key: 'Enter' } }).then(() => false, () => true));

  // When nobody watches any more, the screencast stops.
  watcher.ws.close(); window.ws.close();
  await until(() => ops.filter(item => item.op === 'view' && !item.args.on).length >= 1 && ops.at(-1).op === 'view' && !ops.at(-1).args.on);
});

test('real Chrome without a window: screencast frames, scroll, keys, typing; local addresses stay blocked', { skip: !existsSync('/usr/bin/google-chrome-stable') || process.env.MYBOTS_SKIP_CHROME }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chrome-live-'));
  const session = new BrowserSession(directory); const frames = []; session.frame = frame => frames.push(frame);
  t.after(async () => { await session.close(); await rm(directory, { recursive: true, force: true }); });
  const view = await session.view(true);
  assert.equal(view.watching, true);
  await until(() => frames.some(frame => frame.image));
  const first = frames.find(frame => frame.image);
  assert.ok(first.image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), 'quadro JPEG');
  assert.equal(first.width, 1280); assert.equal(first.height, 800);
  // A second viewer gets the current page at once.
  const before = frames.length; await session.view(true); await until(() => frames.length >= before + 1);
  for (const input of [{ type: 'scroll', x: 0.5, y: 0.5, dx: 0, dy: 300 }, { type: 'key', key: 'Tab' }, { type: 'text', text: 'abc' }, { type: 'tap', x: 0.5, y: 0.5 }]) await session.input(input);
  await assert.rejects(session.input({ type: 'key', key: 'Control+W' }), /inválida/);
  await assert.rejects(session.input({ type: 'open', url: 'http://127.0.0.1:3219/' }), /celular|endereço/i);
  await session.view(false);
  assert.equal((await session.view(false)).watching, false);
});

test('the bot\'s Chrome process streams frames to the node over IPC and reports when it closes', { skip: !existsSync('/usr/bin/google-chrome-stable') || process.env.MYBOTS_SKIP_CHROME }, async t => {
  const { PcBrowser } = await import('../pc/browser.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chrome-ipc-'));
  const frames = []; const browser = new PcBrowser(directory, { onFrame: (botId, frame) => frames.push({ botId, ...frame }) });
  const botId = '00000000-0000-4000-8000-000000000001';
  t.after(async () => { browser.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  await browser.command(botId, 'view', { on: true });
  await until(() => frames.some(frame => frame.image));
  await assert.rejects(browser.command(botId, 'input', { type: 'open', url: 'localhost:3219' }), /celular/);
  browser.stop(botId);
  await until(() => frames.some(frame => frame.closed));
});

test('Claude bots use their own Chrome unless the person picks the main Chrome', async t => {
  const { browserMode, validateProfile } = await import('../supervisor/tool-policy.mjs');
  assert.equal(browserMode({ provider: 'claude' }), 'own');
  assert.equal(browserMode({ provider: 'claude', mainChrome: true }), 'claude');
  assert.equal(browserMode({ provider: 'codex', mainChrome: true }), 'own');
  assert.throws(() => validateProfile({ mainChrome: 'sim' }), /Chrome principal/);
  const directory = await mkdtemp(join(tmpdir(), 'mybots-main-chrome-'));
  const app = await createSupervisor({ directory, port: 0, codex });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Claude', home: 'pc', ...selection });
  const updated = await app.rpc('bot.update', { botId: bot.id, mainChrome: true });
  assert.equal(updated.browserMode, 'own'); assert.equal(app.db.requireBot(bot.id).browserMode, 'own');
});

test('binary frames retain JPEG bytes and send URL/tabs only when changed; malformed headers are refused', async () => {
  const { encodeFrame, decodeFrame, frameMetadata } = await import('../supervisor/browser-frame.mjs');
  const frame = { botId: '00000000-0000-4000-8000-000000000001', width: 640, height: 400, seq: 1, image: Buffer.from([255,216,255,217]), url: 'https://example.com/á', title: 'Página', tabs: [{ tab: 1, active: true, title: 'Página' }] };
  const first = encodeFrame(frame); assert.deepEqual(decodeFrame(first), frame);
  const next = { ...frame, seq: 2 }; const delta = encodeFrame(next, frameMetadata(frame));
  assert.equal(delta.length, 34 + frame.image.length); assert.equal(decodeFrame(delta).url, undefined);
  assert.deepEqual(decodeFrame(delta, frameMetadata(frame)), next);
  assert.throws(() => decodeFrame(first.subarray(0, 33)), /inválido/);
  const broken = Buffer.from(first); broken.writeUInt16BE(65000, 28); assert.throws(() => decodeFrame(broken), /inválido/);
});

test('paced binary frames discard intermediate frames while bufferedAmount is high', async () => {
  const { paced } = await import('../pc/ui.mjs');
  let bufferedAmount = 2_000_000; const sent = [];
  const sink = paced(bytes => sent.push(bytes), () => bufferedAmount > 1_000_000);
  const frames = [Buffer.from([1]), Buffer.from([2]), Buffer.from([3])];
  frames.forEach(sink); assert.equal(sent.length, 0);
  bufferedAmount = 0; await until(() => sent.length);
  assert.deepEqual(sent, [frames[2]]);
});

test('/frames authenticates the app token and relays binary JPEG only for the selected bot, without RPC pixels', async t => {
  const { decodeFrame } = await import('../supervisor/browser-frame.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-native-frames-'));
  const app = await createSupervisor({ directory, port: 0, codex }); const sockets = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await app.rpc('bot.create', { name: 'A', ...selection }); const b = await app.rpc('bot.create', { name: 'B', ...selection });
  const endpoint = id => `ws://127.0.0.1:${app.port}/frames?bot=${id}`;
  const rejected = new WebSocket(endpoint(a.id), { headers: { Authorization: 'Bearer errado' } }); sockets.push(rejected); rejected.on('error', () => {});
  const status = await new Promise(resolve => rejected.once('unexpected-response', (request, response) => { resolve(response.statusCode); response.resume(); rejected.terminate(); }));
  assert.equal(status, 401);
  const connect = async id => { const ws = new WebSocket(endpoint(id), { headers: { Authorization: `Bearer ${app.token}` } }); sockets.push(ws); const frames = []; ws.on('message', (bytes, binary) => { assert.ok(binary); frames.push(decodeFrame(bytes)); }); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return { ws, frames }; };
  const first = await connect(a.id); const second = await connect(b.id);
  const rpc = await client(`ws://127.0.0.1:${app.port}`, app.token); sockets.push(rpc.ws);
  await rpc.call('browser.view', { botId: a.id, on: true, native: true });
  const frame = { botId: a.id, width: 320, height: 200, seq: 1, image: Buffer.from([255,216,255,217]), url: 'https://example.com/', title: 'Teste', tabs: [] };
  app.link.onFrame(frame); await until(() => first.frames.length);
  assert.equal(first.frames[0].botId, a.id); assert.deepEqual(first.frames[0].image, frame.image);
  assert.equal(second.frames.length, 0); assert.equal(rpc.frames.length, 0);
  first.ws.close(); await until(() => first.ws.readyState === 3);
  await rpc.call('browser.view', { botId: a.id, on: false }); await until(() => !app.link.watching.has(a.id));
  assert.ok(app.link.watching.has(b.id));
});

test('worker honors the viewer dimensions, watching/takeover quality and immediate interactive ACK', async () => {
  const { EventEmitter } = await import('node:events');
  const sent = []; const cdp = new EventEmitter(); cdp.detach = async () => {};
  cdp.send = async (method, args) => { sent.push({ method, args }); return { data: Buffer.from([255,216,255,217]).toString('base64') }; };
  const session = new BrowserSession('/unused'); session.start = async () => {}; session.context = { newCDPSession: async () => cdp }; session.page = { frames: () => [{ evaluate: async () => {} }], url: () => 'about:blank' }; session.info = async () => ({}); session.frame = () => {};
  await session.view(true, { maxWidth: 321, maxHeight: 201 });
  assert.deepEqual(sent.find(item => item.method === 'Page.startScreencast').args, { format: 'jpeg', quality: 55, maxWidth: 321, maxHeight: 201 });
  await session.view(true, { interactive: true });
  assert.equal(sent.filter(item => item.method === 'Page.startScreencast').at(-1).args.quality, 70);
  cdp.emit('Page.screencastFrame', { data: '/9j/2Q==', metadata: { deviceWidth: 1280, deviceHeight: 800 }, sessionId: 7 });
  assert.ok(sent.some(item => item.method === 'Page.screencastFrameAck' && item.args.sessionId === 7));
  await session.view(true, { congested: true });
  assert.equal(sent.filter(item => item.method === 'Page.startScreencast').at(-1).args.quality, 50);
  await session.view(false);
});

test('animated real Chrome produces resized JPEG with increasing seq and masks password fields', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-v54-animation-'));
  const session = new BrowserSession(directory); const frames = []; session.frame = frame => frames.push(frame);
  t.after(async () => { await session.close(); await rm(directory, { recursive: true, force: true }); });
  await session.start();
  await session.page.setContent('<style>@keyframes move {to {transform:translateX(600px)}} .box {width:120px;height:120px;background:#08a;animation:move 0.5s infinite alternate linear}</style><div class="box"></div><input type="password" value="segredo-de-teste">');
  await session.view(true, { maxWidth: 480, maxHeight: 300, interactive: true });
  await until(() => frames.length >= 8);
  const jpeg = frames[0].image; let dimensions;
  for (let at = 2; at + 9 < jpeg.length;) { const marker = jpeg[at + 1], length = jpeg.readUInt16BE(at + 2); if ([0xc0, 0xc1, 0xc2].includes(marker)) { dimensions = { width: jpeg.readUInt16BE(at + 7), height: jpeg.readUInt16BE(at + 5) }; break; } if (length < 2) break; at += 2 + length; }
  assert.deepEqual(dimensions, { width: 480, height: 300 });
  assert.ok(frames.every(frame => frame.width <= 480 && frame.height <= 300));
  for (let n = 1; n < frames.length; n++) assert.ok(frames[n].seq > frames[n - 1].seq);
  assert.ok(frames.every(frame => frame.image.subarray(0, 3).equals(Buffer.from([255,216,255]))));
  assert.equal(await session.page.locator('input').evaluate(el => getComputedStyle(el).color), 'rgba(0, 0, 0, 0)');
});

test('paced lowers quality at moderate pressure before discarding binary frames at high pressure', async () => {
  const { paced } = await import('../pc/ui.mjs'); const events = [];
  let bufferedAmount = 300_000;
  const sink = paced(frame => events.push(['sent', frame[0]]), () => bufferedAmount > 1_000_000, () => events.push(['quality', bufferedAmount > 250_000 ? 35 : 55]));
  sink(Buffer.from([1])); assert.deepEqual(events, [['quality', 35], ['sent', 1]]);
  bufferedAmount = 2_000_000; sink(Buffer.from([2])); sink(Buffer.from([3]));
  assert.equal(events.filter(([kind]) => kind === 'sent').length, 1);
  bufferedAmount = 0; await until(() => events.some(([kind, value]) => kind === 'sent' && value === 3));
  assert.equal(events.filter(([kind]) => kind === 'sent').length, 2);
});
