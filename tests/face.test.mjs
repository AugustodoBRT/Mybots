import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFace, frameFace, weirdOf, tone, PIECES, STATES, FW, FH } from '../lib/face.mjs';

// The lab's own code (docs/design/laboratorio-de-bots.html) is the visual spec: load it and compare cell by cell.
function loadLab() {
  const lines = readFileSync(new URL('../docs/design/laboratorio-de-bots.html', import.meta.url), 'utf8').split('\n');
  const body = [...lines.slice(112, 119), ...lines.slice(327, 336), ...lines.slice(336, 529)].join('\n');
  return new Function(`${body}\nreturn { makeFace, frameFace };`)();
}

const SEEDS = ['Clara', 'Atlas', 'Nico', 'Bruma', 'Zeca', 'Otto', 'Vera', 'Beto', 'Lume', 'Kiko', 'robô 7', ''];
const TIMES = [0, 400, 1234, 5000, 9100, 20000];
const grid = g => JSON.stringify(g);

test('o gerador reproduz o resultado do laboratório, célula a célula', () => {
  const lab = loadLab();
  for (const seed of SEEDS) {
    const mine = makeFace(seed), theirs = lab.makeFace(String(seed || 'bot'), weirdOf(String(seed || 'bot')));
    assert.deepEqual(mine.face, theirs.face, `peças de ${seed}`);
    assert.deepEqual(mine.crop, theirs.crop); assert.deepEqual(mine.cropTight, theirs.cropTight);
    for (const state of STATES) for (const t of TIMES) assert.equal(grid(frameFace(mine, state, t)), grid(lab.frameFace(theirs, state, t)), `${seed} ${state} ${t}`);
  }
});

test('mesma semente, mesmo rosto; sementes diferentes, rostos diferentes', () => {
  assert.equal(grid(frameFace(makeFace('Clara'), 'idle', 700)), grid(frameFace(makeFace('Clara'), 'idle', 700)));
  const distinct = new Set(SEEDS.slice(0, 10).map(seed => grid(frameFace(makeFace(seed), 'idle', 0))));
  assert.equal(distinct.size, 10);
});

test('cada peça escolhida muda só o que deve', () => {
  const base = makeFace('Clara');
  for (const [part, key] of [['head', 'fam'], ['tex', 'tex'], ['eye', 'eye'], ['mouth', 'mouth'], ['top', 'ears']]) {
    for (const value of PIECES[part]) {
      const pinned = makeFace('Clara', { [part]: value });
      assert.equal(pinned.face[key], value);
      const changed = Object.keys(base.face).filter(name => JSON.stringify(base.face[name]) !== JSON.stringify(pinned.face[name]));
      const allowed = part === 'head' ? [key, 'rx', 'ry', 'cy'] : [key];
      assert.deepEqual(changed.filter(name => !allowed.includes(name)), [], `${part}=${value} mexeu em outras coisas`);
    }
    // choosing what the seed already drew changes nothing
    const same = makeFace('Clara', { [part]: base.face[key] });
    assert.equal(grid(frameFace(same, 'idle', 300)), grid(frameFace(base, 'idle', 300)));
  }
  assert.equal(makeFace('Clara', { head: 'inventada' }).face.fam, base.face.fam);
});

test('todos os estados existem e são diferentes entre si', () => {
  assert.deepEqual(STATES, ['idle', 'working', 'waiting', 'sleep', 'error', 'done', 'evil']);
  const bot = makeFace('Clara');
  const frames = STATES.map(state => frameFace(bot, state, 1000));
  for (const g of frames) { assert.equal(g.length, FH); assert.equal(g[0].length, FW); }
  assert.equal(new Set(frames.map(grid)).size, STATES.length);
  const kinds = state => new Set(frameFace(bot, state, 1000).flat().filter(Boolean).map(cell => cell.k));
  assert.ok(kinds('waiting').has('warn') || kinds('waiting').has('acc'), 'esperando mostra o ( ! )');
  assert.ok(kinds('evil').has('warn'));
  assert.ok(frameFace(bot, 'working', 1000).flat().some(cell => cell?.s), 'trabalhando solta fumaça');
});

test('o "do mal" aparece sozinho, por cerca de 1,5 s, e sai', () => {
  const bot = makeFace('Atlas'); let evilFrames = 0, samples = 0;
  for (let t = 3100; t < 60000; t += 100) { samples++; const g = frameFace(bot, 'idle', t); if (g.flat().some(cell => cell?.k === 'warn')) evilFrames++; }
  assert.ok(evilFrames > 0 && evilFrames < samples / 2, `${evilFrames}/${samples}`);
});

test('tons: dois temas, cor do bot só no corpo', () => {
  assert.deepEqual(tone('tex', '#34C9A8', 'dark'), ['#34C9A8', 1]);
  assert.notEqual(tone('tex', '#34C9A8', 'light')[0], '#34C9A8');
  assert.notEqual(tone('eye', '#34C9A8', 'dark')[0], tone('eye', '#34C9A8', 'light')[0]);
  assert.equal(tone('warn', '#34C9A8', 'dark')[0], '#FF4A3D');
});
