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
    if (op === 'view' && args.on) setTimeout(() => browser.onFrame(botId, { image: 'aW1n', width: 1280, height: 800, url: 'https://example.com/' }), 5);
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
  assert.deepEqual(await watcher.call('browser.view', { botId: bot.id, on: true }), { watching: true, online: true });
  await until(() => watcher.frames.length);
  assert.deepEqual(watcher.frames[0], { botId: bot.id, image: 'aW1n', width: 1280, height: 800, url: 'https://example.com/' });
  assert.equal(idle.frames.length, 0);
  assert.ok(ops.some(item => item.botId === bot.id && item.op === 'view' && item.args.on));

  // Before "Assumir", the page is only watched; the computer refuses taps even if the phone's check were skipped.
  await assert.rejects(watcher.call('browser.input', { botId: bot.id, input: { type: 'tap', x: 0.5, y: 0.5 } }), /Assumir/);
  app.link.input(bot.id, { type: 'tap', x: 0.5, y: 0.5 });
  await until(() => watcher.frames.some(frame => /Assumir/.test(frame.error || '')));
  assert.ok(!ops.some(item => item.op === 'input'));
  await watcher.call('browser.control', { botId: bot.id, who: 'person' });
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
  assert.ok(Buffer.from(first.image, 'base64').subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), 'quadro JPEG');
  assert.equal(first.width, 1280); assert.equal(first.height, 800);
  // A second viewer gets the current page at once.
  const before = frames.length; await session.view(true); assert.equal(frames.length, before + 1);
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
  t.after(async () => { browser.close(); await rm(directory, { recursive: true, force: true }); });
  await browser.command(botId, 'view', { on: true });
  await until(() => frames.some(frame => frame.image));
  await assert.rejects(browser.command(botId, 'input', { type: 'open', url: 'localhost:3219' }), /celular/);
  browser.stop(botId);
  await until(() => frames.some(frame => frame.closed));
});

test('Claude bots use their own Chrome unless the person picks the main Chrome', async t => {
  const { mainChrome, validateProfile } = await import('../supervisor/tool-policy.mjs');
  assert.equal(mainChrome({ provider: 'claude' }), false);
  assert.equal(mainChrome({ provider: 'claude', mainChrome: true }), true);
  assert.equal(mainChrome({ provider: 'codex', mainChrome: true }), false);
  assert.throws(() => validateProfile({ mainChrome: 'sim' }), /Chrome principal/);
  const directory = await mkdtemp(join(tmpdir(), 'mybots-main-chrome-'));
  const app = await createSupervisor({ directory, port: 0, codex });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Claude', home: 'pc', ...selection });
  const updated = await app.rpc('bot.update', { botId: bot.id, mainChrome: true });
  assert.equal(updated.mainChrome, true); assert.equal(app.db.requireBot(bot.id).mainChrome, true);
});
