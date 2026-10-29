import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, resolveTheme } from '../mobile/palettes.js';

const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('escolha do tema: escuro, claro ou o do sistema', () => {
  assert.equal(resolveTheme(undefined, 'light'), 'dark'); // before a choice exists, the app stays dark
  assert.equal(resolveTheme('dark', 'light'), 'dark');
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.equal(resolveTheme('system', 'light'), 'light');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('system', null), 'dark');
});

test('o escuro é preto de verdade e os dois temas têm as mesmas cores', () => {
  assert.equal(PALETTES.dark.bg, '#000000');
  assert.deepEqual(Object.keys(PALETTES.dark).sort(), Object.keys(PALETTES.light).sort());
  assert.ok(!('mint' in PALETTES.dark), 'o verde menta deixou de ser a cor de tudo');
});

test('contraste AA (4,5:1) dos textos nos dois temas', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const surface of ['bg', 'bg2', 'surface', 'surface2', 'elevated']) {
      for (const ink of ['text', 'text2', 'muted', 'faint', 'accent', 'good', 'red', 'amber']) {
        assert.ok(ratio(p[ink], p[surface]) >= 4.5, `${name}: ${ink} sobre ${surface} = ${ratio(p[ink], p[surface]).toFixed(2)}`);
      }
    }
    assert.ok(ratio(p.accentInk, p.accent) >= 4.5, `${name}: texto do botão = ${ratio(p.accentInk, p.accent).toFixed(2)}`);
    assert.ok(ratio(p.amber, p.amberSoft) >= 4.5, `${name}: aviso âmbar`);
  }
});

test('os bichos de partículas têm contraste de elemento gráfico (3:1) sobre o fundo nos dois temas', async () => {
  const { FACE_COLORS, hueOfHex, Mimo, specFromSeed, bucketColor } = await import('../lib/mimo.mjs');
  const rgb = ([h, s, l]) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); };
  for (const mode of ['dark', 'light']) for (const [hex, name] of FACE_COLORS) {
    const m = new Mimo(specFromSeed('x'), { n: 200 }); m.hue = hueOfHex(hex); const frame = m.compute(200, 200, { light: mode === 'light' });
    // the middle of the depth range is what most of the body looks like
    const color = rgb(bucketColor(frame, 15)); assert.ok(ratio(color, PALETTE_BG[mode].bg) >= 3, `${mode}: ${name} = ${ratio(color, PALETTE_BG[mode].bg).toFixed(2)}`);
    assert.ok(ratio(color, PALETTE_BG[mode].surface) >= 3, `${mode}: ${name} sobre o cartão`);
  }
});
const PALETTE_BG = PALETTES;
