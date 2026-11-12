import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG, KIND_LABEL, unseenVersions } from '../mobile/changelog.js';

test('a primeira novidade é a versão do app, e toda entrega escreve a sua', () => {
  const gradle = readFileSync(new URL('../mobile/android/app/build.gradle', import.meta.url), 'utf8');
  const app = JSON.parse(readFileSync(new URL('../mobile/app.json', import.meta.url), 'utf8'));
  assert.equal(CHANGELOG[0].version, gradle.match(/versionName "([^"]+)"/)[1]);
  assert.equal(CHANGELOG[0].version, app.expo.version);
  for (const entry of CHANGELOG) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(entry.items.length);
    for (const [kind, text] of entry.items) { assert.ok(KIND_LABEL[kind], kind); assert.ok(text.length > 10); }
  }
});

test('depois de atualizar aparece o que ainda não foi visto, e só uma vez', () => {
  const list = [{ version: '3' }, { version: '2' }, { version: '1' }, { version: '0' }];
  assert.deepEqual(unseenVersions('3', list), []);
  assert.deepEqual(unseenVersions('1', list).map(item => item.version), ['3', '2']);
  assert.deepEqual(unseenVersions(null, list).map(item => item.version), ['3']);
  assert.deepEqual(unseenVersions('velha', list).map(item => item.version), ['3']);
  assert.equal(unseenVersions('0', [...list, { version: '-1' }].slice(0, 5)).length, 3);
});
