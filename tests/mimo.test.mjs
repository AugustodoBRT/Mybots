import test from 'node:test';
import assert from 'node:assert/strict';
import { Mimo, specFromSeed, specFromFace, hueOfHex, buildParticles, MOODS, MOOD_NAMES, STATE_MOOD, TOPS, PALETTE, EYE_STYLES, MOUTHS, particleCount, bucketColor } from '../lib/mimo.mjs';

const snapshot = f => Array.from(f.SX.slice(0, 40)).map((x, i) => [x, f.SY[i]].map(v => Math.round(v * 100) / 100).join(',')).join(';');
const run = (spec, mood, steps = 60, n = 900) => { const m = new Mimo(spec, { n }); m.setMood(mood); let f; for (let i = 0; i < steps; i++) { m.update(0.033, { x: 0, y: 0 }); f = m.compute(300, 300, { dt: 0.033, light: false, energy: 0.6 }); } return { m, f }; };

test('a mesma semente dá o mesmo bicho, em qualquer quantidade de partículas', () => {
  assert.deepEqual(specFromSeed('Clara'), specFromSeed('Clara'));
  assert.notDeepEqual(specFromSeed('Clara'), specFromSeed('Atlas'));
  assert.equal(snapshot(run(specFromSeed('Clara'), 'normal').f), snapshot(run(specFromSeed('Clara'), 'normal').f));
  // the first particles are the same ones whatever the total (a smaller list shows the same body, thinner)
  const a = buildParticles(specFromSeed('Clara'), 600), b = buildParticles(specFromSeed('Clara'), 3000), body = Math.min(a.Nb, 500);
  for (let i = 0; i < body; i++) assert.equal(a.x[i], b.x[i]);
});

test('os topos são só sem enfeite, orelha de gato e orelha redonda; as 16 expressões existem', () => {
  assert.deepEqual(Object.keys(TOPS), ['nada', 'gato', 'redonda']);
  const tops = new Set(Array.from({ length: 300 }, (_, i) => specFromSeed('bot' + i).top)); assert.deepEqual([...tops].sort(), ['gato', 'nada', 'redonda']);
  assert.equal(MOOD_NAMES.length, 16); assert.ok(!MOOD_NAMES.includes('apaixonado'));
  for (const m of ['normal', 'feliz', 'curioso', 'surpreso', 'triste', 'piscadela', 'pensando', 'estressado', 'sonolento', 'falando', 'trabalhando', 'esperando', 'dormindo', 'erro', 'concluido', 'domal']) assert.ok(MOODS[m], m);
  for (const state of ['idle', 'working', 'waiting', 'sleeping', 'error', 'done', 'evil']) assert.ok(MOODS[STATE_MOOD[state]], state);
});

test('o corpo varia: formatos, olhos, bocas e cores diferentes entre os nomes', () => {
  const specs = Array.from({ length: 80 }, (_, i) => specFromSeed(['Atlas', 'Clara', 'Nico', 'Sora', 'Lia'][i % 5] + i));
  assert.ok(new Set(specs.map(s => s.eyes)).size === 3); assert.ok(new Set(specs.map(s => s.eyeStyle)).size === Object.keys(EYE_STYLES).length);
  assert.ok(new Set(specs.map(s => s.mouth)).size >= 6 && Object.keys(MOUTHS).length === 7); assert.ok(new Set(specs.map(s => s.hue)).size >= 6);
  assert.ok(Math.max(...specs.map(s => s.squar)) - Math.min(...specs.map(s => s.squar)) > 3);
});

test('a face do app vira o corpo: cor em hex, ajustes limitados e valores inválidos ignorados', () => {
  assert.equal(hueOfHex('#34C9A8'), 167); assert.equal(hueOfHex('nope'), null);
  const spec = specFromFace({ seed: 'Clara', color: '#FFB27A', mimo: { squar: 99, sx: 1.1, eyes: 3, eyeStyle: 'barra', mouth: 'larga', top: 'gato', blush: true, eyeGap: -4 } });
  assert.equal(spec.hue, hueOfHex('#FFB27A')); assert.equal(spec.squar, 8); assert.equal(spec.eyeGap, 0.7); assert.equal(spec.sx, 1.1);
  assert.deepEqual([spec.eyes, spec.eyeStyle, spec.mouth, spec.top, spec.blush], [3, 'barra', 'larga', 'gato', true]);
  const junk = specFromFace({ seed: 'Clara', mimo: { eyes: 9, eyeStyle: 'x', mouth: 'y', top: 'chifres' } }); assert.deepEqual([junk.eyes, junk.eyeStyle, junk.mouth, junk.top], [specFromSeed('Clara').eyes, specFromSeed('Clara').eyeStyle, specFromSeed('Clara').mouth, specFromSeed('Clara').top]);
  assert.equal(specFromFace(null, 'Zeca').seed, 'Zeca');
});

test('os olhos e a boca são vazios: as partículas saem de perto da abertura', () => {
  const spec = { ...specFromSeed('Clara'), eyes: 2, eyeStyle: 'redondo', mouth: 'nenhuma', top: 'nada', sx: 1, sy: 1 };
  const { f } = run(spec, 'normal', 90, 4000); const s = f.s, eyeX = 0.34 * spec.eyeGap, eyeY = spec.eyeY;
  // count particles inside the left eye's opening (screen space) against the same region of a body with no face at all
  const inEye = frame => { let n = 0; const ex = f.cx + (-eyeX * spec.sx) * s, ey = f.cy0 + (-0.06 + 0) * 0 + (eyeY + 0) * s + 0; for (let i = 0; i < frame.N; i++) if (Math.hypot(frame.SX[i] - ex, frame.SY[i] - (ey + 0.0)) < s * 0.1) n++; return n; };
  const plain = new Mimo({ ...spec }, { n: 4000 }); plain.setMood('normal'); plain.cur.eo = 0; plain.def = { ...plain.def, p: { ...plain.def.p, eo: 0, ew: 0.01 } }; let g; for (let i = 0; i < 90; i++) { plain.update(0.033); g = plain.compute(300, 300, { dt: 0.033 }); }
  assert.ok(inEye(f) < inEye(g) * 0.5 + 3, `${inEye(f)} contra ${inEye(g)}`);
});

test('cada expressão muda o rosto e as partículas se reorganizam de uma para outra', () => {
  const spec = specFromSeed('Clara'), shots = new Map();
  for (const mood of MOOD_NAMES) shots.set(mood, snapshot(run(spec, mood, 90, 1200).f));
  assert.equal(new Set(shots.values()).size, MOOD_NAMES.length, 'duas expressões ficaram iguais');
  const m = new Mimo(spec, { n: 1200 }); m.setMood('feliz'); for (let i = 0; i < 60; i++) m.update(0.033); m.setMood('domal'); for (let i = 0; i < 90; i++) m.update(0.033);
  assert.ok(Math.abs(m.cur.et - MOODS.domal.p.et) < 0.02 && m.hue < 30, 'a mistura chega na expressão nova (e na cor)');
});

test('trabalhando solta partículas que sobem; erro mostra pontos vermelhos; dormindo escurece', () => {
  const spec = specFromSeed('Clara');
  const work = run(spec, 'trabalhando', 120, 1500).f, calm = run(spec, 'normal', 120, 1500).f; const top = f => { let ys = []; for (let i = 0; i < f.N; i++) if (f.dust[i]) ys.push(f.SY[i]); return Math.min(...ys); };
  assert.ok(top(work) < top(calm) - 20, 'a poeira sobe quando trabalha');
  assert.ok(run(spec, 'erro', 120, 1500).f.buckets[30].length > 0, 'glitch vermelho');
  assert.ok(bucketColor(run(spec, 'dormindo', 200, 600).f, 12)[2] < bucketColor(run(spec, 'normal', 200, 600).f, 12)[2], 'escurece');
});

test('os desenhos que sobem aparecem só onde dá para ler e as ações de transformar terminam', () => {
  const spec = specFromSeed('Clara'); const { m } = run(spec, 'esperando', 40, 800); const big = m.compute(300, 300, { dt: 0.03 }), small = m.compute(48, 48, { dt: 0.03 });
  assert.ok(big.sprites.length > 0 && small.sprites.length === 0);
  const a = new Mimo(spec, { n: 600 }); a.act('jump'); for (let i = 0; i < 80; i++) { a.update(0.033); a.compute(200, 200, { dt: 0.033 }); } assert.equal(a.action, null);
  const b = new Mimo(spec, { n: 600 }); b.act('ball'); for (let i = 0; i < 120; i++) b.update(0.033); assert.ok(b.ball > 0.99);
});

test('quantidade de partículas por tamanho e paleta', () => {
  assert.ok(particleCount(330) > particleCount(120) && particleCount(120) > particleCount(54) && particleCount(54) > particleCount(30));
  assert.ok(particleCount(330, false) < particleCount(330, true)); assert.equal(PALETTE.length, 8);
});
