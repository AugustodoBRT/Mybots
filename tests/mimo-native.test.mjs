import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mimo, specFromSeed, nativeData, bucketColor } from '../lib/mimo.mjs';

const root = new URL('..', import.meta.url).pathname;
const classes = join(root, 'mobile/modules/termux-bridge/android/build/tmp/kotlin-classes/release');
const find = (dir, ext) => { const out = []; const walk = d => { try { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(ext) && out.push(join(d, e.name)); } catch {} }; walk(dir); return out; };
const json = find(join(root, '.build-tools/gradle/caches/modules-2/files-2.1/org.json/json'), '.jar')[0];
const stdlib = find(join(root, '.build-tools/gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib'), '.jar').find(file => !/sources|common/.test(file));
const ready = existsSync(join(classes, 'expo/modules/termuxbridge/MimoSim.class')) && json && stdlib;

test('o arquivo mimo-data.json do celular é gerado a partir do JavaScript e está em dia', () => {
  const file = join(root, 'mobile/modules/termux-bridge/android/src/main/assets/mimo-data.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), JSON.parse(JSON.stringify(nativeData())));
});

// The Kotlin port (MimoSim.kt) must put every particle where the JavaScript does. Needs the project's Gradle to have compiled the module.
test('o Kotlin do celular posiciona as partículas como o JavaScript', { skip: !ready && 'compile :mybots-termux-bridge:compileReleaseKotlin antes' }, () => {
  const cases = [['Clara', 'normal', false], ['Atlas', 'feliz', false], ['Nico', 'domal', false], ['Sora', 'erro', true], ['Lia', 'esperando', false], ['Teo', 'trabalhando', false], ['Mimi', 'falando', true], ['Bruma', 'dormindo', false], ['Zeca', 'surpreso', false]]
    .map(([seed, mood, light]) => ({ spec: specFromSeed(seed), mood, steps: 70, n: 900, w: 300, h: 260, light }));
  const dir = mkdtempSync(join(tmpdir(), 'mimo-parity-'));
  try {
    writeFileSync(join(dir, 'cases.json'), JSON.stringify(cases));
    const classpath = [dir, classes, json, stdlib].join(':');
    execFileSync('javac', ['-cp', classpath, '-d', dir, join(root, 'tests/native-mimo/ParityTest.java')], { stdio: 'pipe' });
    const kotlin = JSON.parse(execFileSync('java', ['-cp', classpath, 'ParityTest', join(root, 'mobile/modules/termux-bridge/android/src/main/assets/mimo-data.json'), join(dir, 'cases.json')], { encoding: 'utf8' }));
    cases.forEach((c, index) => {
      const m = new Mimo(c.spec, { n: c.n }); m.setMood(c.mood); let f; for (let i = 0; i < c.steps; i++) { m.update(0.033, { x: 0, y: 0 }); f = m.compute(c.w, c.h, { dt: 0.033, light: c.light, energy: 0.6 }); }
      const name = `${c.spec.seed}/${c.mood}`, k = kotlin[index];
      for (let i = 0; i < 40; i++) { assert.ok(Math.abs(f.SX[i] - k.xy[i * 2]) < 0.06, `${name} x[${i}]: ${f.SX[i]} contra ${k.xy[i * 2]}`); assert.ok(Math.abs(f.SY[i] - k.xy[i * 2 + 1]) < 0.06, `${name} y[${i}]`); }
      const buckets = f.buckets.map(list => list.length), off = buckets.reduce((sum, v, b) => sum + Math.abs(v - k.buckets[b]), 0);
      assert.ok(off <= Math.max(6, c.n * 0.01), `${name}: baldes diferem em ${off} partículas`);
      [0, 7, 15, 22, 29, 30, 31].forEach((b, j) => { const want = bucketColor(f, b); want.forEach((v, q) => assert.ok(Math.abs(v - k.colors[j][q]) < 0.11, `${name}: cor do balde ${b}`)); });
      assert.equal(f.sprites.length, k.sprites, `${name}: desenhos que sobem`); assert.ok(Math.abs(m.hue - k.hue) < 0.05, `${name}: cor`);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
