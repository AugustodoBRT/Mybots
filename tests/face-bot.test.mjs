import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisor } from '../supervisor/index.mjs';
import { validFace } from '../supervisor/tool-policy.mjs';
import { stillOf, botColor, botSeed, layout, makeFace, HUES } from '../lib/face.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };

test('validFace aceita semente, cor e peças válidas e recusa o resto', () => {
  assert.ok(validFace({ seed: 'Clara' }));
  assert.ok(validFace({ seed: 'Clara-x1y2', color: '#34C9A8', pieces: { head: 'ghost', eye: 'ring' } }));
  for (const bad of [null, [], {}, { seed: '' }, { seed: 'x'.repeat(41) }, { seed: 'a\nb' }, { seed: 'a', color: 'verde' }, { seed: 'a', color: '#12345' },
    { seed: 'a', pieces: { head: 'cubo' } }, { seed: 'a', pieces: { orelha: 'gato' } }, { seed: 'a', extra: 1 }]) assert.ok(!validFace(bad), JSON.stringify(bad));
});

test('o bot guarda o rosto, troca de rosto e recusa rosto inválido', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-face-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Clara', face: { seed: 'Clara', color: '#FF8FB1' }, ...selection });
  assert.deepEqual(bot.face, { seed: 'Clara', color: '#FF8FB1' });
  await assert.rejects(app.rpc('bot.create', { name: 'Zeca', face: { seed: '' }, ...selection }), /rosto válido/);
  await app.rpc('bot.update', { botId: bot.id, face: { seed: 'Clara-9k2', pieces: { mouth: 'sharp' } } });
  assert.deepEqual((await app.rpc('state.get')).bots[0].face, { seed: 'Clara-9k2', pieces: { mouth: 'sharp' } });
  await assert.rejects(app.rpc('bot.update', { botId: bot.id, face: { seed: 'a', pieces: { head: 'cubo' } } }), /rosto válido/);
  const old = await app.rpc('bot.create', { name: 'Antigo', color: 'blue', ...selection });
  assert.equal(old.face, undefined); // bots from before faces keep working without one
});

test('bot sem rosto usa o nome como semente e as cores antigas continuam', () => {
  assert.equal(botSeed({ name: 'Atlas' }), 'Atlas');
  assert.equal(botSeed({ name: 'Atlas', face: { seed: 'Atlas-2' } }), 'Atlas-2');
  assert.equal(botColor({ color: 'blue' }), HUES.blue);
  assert.equal(botColor({ color: 'blue', face: { seed: 'a', color: '#FFB27A' } }), '#FFB27A');
  assert.match(botColor({ id: 'abc', name: 'X' }), /^#[0-9A-F]{6}$/i);
});

test('o quadro parado do widget e da notificação é o mesmo para o mesmo bot e muda com o estado', () => {
  const bot = { name: 'Clara', face: { seed: 'Clara', color: '#34C9A8' } };
  assert.deepEqual(stillOf(bot, 'idle', 112), stillOf({ ...bot }, 'idle', 112));
  assert.notEqual(stillOf(bot, 'idle', 112).frame, stillOf(bot, 'waiting', 112).frame);
  assert.notEqual(stillOf(bot, 'idle', 112).frame, stillOf(bot, 'sleeping', 112).frame);
  const still = stillOf(bot, 'idle', 112);
  assert.equal(still.text, false); // 112 px is below 8 px per cell: pixels
  assert.equal(still.frame.length % 6, 0);
  assert.equal(still.tones.split(',').length, 16);
  assert.equal(stillOf(bot, 'idle', 330).text, true); // big faces use real characters
  assert.notEqual(stillOf(bot, 'idle', 112, 'dark').tones, stillOf(bot, 'idle', 112, 'light').tones);
});

test('a cabeça cabe na caixa pedida', () => {
  for (const seed of ['Clara', 'Atlas', 'Nico', 'Bruma', 'Zeca']) for (const size of [28, 54, 118, 330]) {
    const l = layout(makeFace(seed), size);
    assert.ok(l.width <= size + 1 && l.height <= size + 1, `${seed} ${size}: ${l.width}x${l.height}`);
  }
});

test('o resumo do widget leva os quadros parados dos bots e da marca', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-face-widget-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('bot.create', { name: 'Clara', face: { seed: 'Clara', color: '#34C9A8' }, ...selection });
  const summary = await fetch(`http://127.0.0.1:${app.port}/device/widget`, { headers: { Authorization: 'Bearer ' + app.token } }).then(r => r.json());
  assert.ok(summary.bots[0].still.frame.length > 600 && summary.bots[0].big.frame.length > 600);
  assert.ok(summary.brand.frame.length > 100);
  assert.equal(summary.bots[0].still.tones.split(',').length, 16);
});

test('o assistente de novo bot cria com rosto montado, nível e onde vive', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-newbot-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const face = { seed: 'Zeca-ab12', color: '#FFB27A', pieces: { head: 'ghost', eye: 'ring', mouth: 'sharp', top: 'antenna', tex: 'binary' } };
  for (const access of ['basic', 'ask', 'full']) for (const home of ['phone', 'pc', 'any']) {
    const bot = await app.rpc('bot.create', { name: `Zeca ${access}${home}`, instructions: 'Seja direto.', color: 'green', avatar: 'orbit', autonomy: 'ask', access, home, face, ...selection });
    assert.deepEqual([bot.access, bot.home, bot.face], [access, home, face]);
  }
  // the level Livre is applied after creation (the app shows its warning first), never in the same call as the face
  const bot = await app.rpc('bot.create', { name: 'Livre', access: 'ask', face, ...selection });
  await app.rpc('bot.update', { botId: bot.id, access: 'free' });
  assert.equal((await app.rpc('state.get')).bots.find(item => item.id === bot.id).access, 'free');
});
