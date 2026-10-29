import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisor } from '../supervisor/index.mjs';
import { validFace } from '../supervisor/tool-policy.mjs';
import { stillOf, botColor, botSeed, HUES, specFromFace, moodFor } from '../lib/mimo.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };

test('validFace aceita semente, cor e escolhas do corpo e recusa o resto', () => {
  assert.ok(validFace({ seed: 'Clara' }));
  assert.ok(validFace({ seed: 'Clara-x1y2', color: '#34C9A8', mimo: { squar: 4.5, sx: 1.1, sy: 0.9, eyes: 3, eyeStyle: 'barra', eyeGap: 1.2, mouth: 'larga', top: 'gato', blush: true } }));
  assert.ok(validFace({ seed: 'Velho', color: '#34C9A8', pieces: { head: 'ghost', eye: 'ring' } }), 'bots dos rostos de caracteres continuam válidos');
  for (const bad of [null, [], {}, { seed: '' }, { seed: 'x'.repeat(41) }, { seed: 'a\nb' }, { seed: 'a', color: 'verde' }, { seed: 'a', color: '#12345' },
    { seed: 'a', mimo: { top: 'chifres' } }, { seed: 'a', mimo: { eyes: 4 } }, { seed: 'a', mimo: { squar: 99 } }, { seed: 'a', mimo: { eyeStyle: 'x' } }, { seed: 'a', mimo: { mouth: 'y' } },
    { seed: 'a', mimo: { blush: 'sim' } }, { seed: 'a', mimo: { extra: 1 } }, { seed: 'a', mimo: [] }, { seed: 'a', pieces: [] }, { seed: 'a', pieces: { head: 5 } }, { seed: 'a', extra: 1 }]) assert.ok(!validFace(bad), JSON.stringify(bad));
});

test('o bot guarda o rosto, troca de rosto e recusa rosto inválido', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-face-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Clara', face: { seed: 'Clara', color: '#FF8FB1' }, ...selection });
  assert.deepEqual(bot.face, { seed: 'Clara', color: '#FF8FB1' });
  await assert.rejects(app.rpc('bot.create', { name: 'Zeca', face: { seed: '' }, ...selection }), /rosto válido/);
  await app.rpc('bot.update', { botId: bot.id, face: { seed: 'Clara-9k2', mimo: { mouth: 'larga', top: 'redonda' } } });
  assert.deepEqual((await app.rpc('state.get')).bots[0].face, { seed: 'Clara-9k2', mimo: { mouth: 'larga', top: 'redonda' } });
  await assert.rejects(app.rpc('bot.update', { botId: bot.id, face: { seed: 'a', mimo: { top: 'chifres' } } }), /rosto válido/);
  const old = await app.rpc('bot.create', { name: 'Antigo', color: 'blue', ...selection });
  assert.equal(old.face, undefined); // bots from before faces keep working without one
});

test('bot sem rosto usa o nome como semente e as cores antigas continuam', () => {
  assert.equal(botSeed({ name: 'Atlas' }), 'Atlas');
  assert.equal(botSeed({ name: 'Atlas', face: { seed: 'Atlas-2' } }), 'Atlas-2');
  assert.equal(botColor({ color: 'blue' }), HUES.blue);
  assert.equal(botColor({ color: 'blue', face: { seed: 'a', color: '#FFB27A' } }), '#FFB27A');
  assert.match(botColor({ id: 'abc', name: 'X' }), /^#[0-9A-F]{6}$/i);
  assert.equal(specFromFace({ seed: 'a', pieces: { head: 'ghost' } }).seed, 'a'); // the old pieces are ignored
});

test('o quadro parado do widget e da notificação leva o corpo, a expressão e o tamanho', () => {
  const bot = { name: 'Clara', face: { seed: 'Clara', color: '#34C9A8', mimo: { mouth: 'larga' } } };
  const still = stillOf(bot, 'sleeping', { px: 112, dp: 44 });
  assert.equal(still.spec.seed, 'Clara'); assert.equal(still.spec.mouth, 'larga'); assert.equal(still.mood, 'dormindo'); assert.deepEqual([still.px, still.dp], [112, 44]);
  assert.deepEqual(stillOf(bot, 'idle', { px: 112, dp: 44 }), stillOf({ ...bot }, 'idle', { px: 112, dp: 44 }));
  assert.ok(stillOf(bot, 'idle', { px: 192, dp: 78 }).n > stillOf(bot, 'idle', { px: 112, dp: 44 }).n);
  for (const [state, mood] of [['idle', 'normal'], ['working', 'trabalhando'], ['waiting', 'esperando'], ['error', 'erro'], ['done', 'concluido'], ['inventado', 'normal']]) assert.equal(moodFor(state), mood);
});

test('o resumo do widget leva os bichos dos bots e da marca', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-face-widget-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('bot.create', { name: 'Clara', face: { seed: 'Clara', color: '#34C9A8' }, ...selection });
  const summary = await fetch(`http://127.0.0.1:${app.port}/device/widget`, { headers: { Authorization: 'Bearer ' + app.token } }).then(r => r.json());
  const bot = summary.bots[0];
  assert.equal(bot.still.spec.seed, 'Clara'); assert.equal(bot.still.mood, 'normal'); assert.equal(bot.big.dp, 78); assert.ok(bot.big.n > bot.still.n);
  assert.equal(summary.brand.spec.seed, 'MyBots'); assert.equal(summary.brand.mood, 'normal');
});

test('o assistente de novo bot cria com o corpo escolhido, nível e onde vive', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-newbot-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const face = { seed: 'Zeca-ab12', color: '#FFB27A', mimo: { squar: 6, sx: 1.1, sy: 0.95, eyes: 3, eyeStyle: 'oval', eyeGap: 1.1, mouth: 'dentes', top: 'gato', blush: true } };
  for (const access of ['basic', 'ask', 'full']) for (const home of ['phone', 'pc', 'any']) {
    const bot = await app.rpc('bot.create', { name: `Zeca ${access}${home}`, instructions: 'Seja direto.', color: 'green', avatar: 'orbit', autonomy: 'ask', access, home, face, ...selection });
    assert.deepEqual([bot.access, bot.home, bot.face], [access, home, face]);
  }
  // the level Livre is applied after creation (the app shows its warning first), never in the same call as the face
  const bot = await app.rpc('bot.create', { name: 'Livre', access: 'ask', face, ...selection });
  await app.rpc('bot.update', { botId: bot.id, access: 'free' });
  assert.equal((await app.rpc('state.get')).bots.find(item => item.id === bot.id).access, 'free');
});
