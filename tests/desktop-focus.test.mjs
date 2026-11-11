import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { returnsFocus } = createRequire(import.meta.url)('../desktop/electron/focus-rules.js');

test('a page taking the keyboard gives it back only to someone writing who did not click on the page or choose its tab', () => {
  const now = 100000;
  assert.equal(returnsFocus({ typedAt: now - 500, now }), true, 'escrevendo, e a página pegou o foco sozinha');
  assert.equal(returnsFocus({ typedAt: now - 60000, now }), false, 'não estava escrevendo');
  assert.equal(returnsFocus({ typedAt: now - 500, pressedAt: now - 100, now }), false, 'clicou na página');
  assert.equal(returnsFocus({ typedAt: now - 500, chosenAt: now - 100, now }), false, 'escolheu a aba');
});
