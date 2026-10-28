import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { messageTree, cases } from './helpers/message-render.mjs';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));

test('Message keeps the native rendering snapshot from before memoization', () => {
  const source = readFileSync(new URL('../mobile/components/Message.js', import.meta.url), 'utf8');
  const expected = JSON.parse(readFileSync(new URL('./fixtures/message-tree.json', import.meta.url), 'utf8'));
  assert.deepEqual(cases.map(props => messageTree(source, props)), expected);
});

test('extracted screens and app have no loose references', () => {
  const parser = require('@babel/parser'), traverse = require('@babel/traverse').default;
  const globals = new Set(['undefined','console','setTimeout','clearTimeout','setInterval','clearInterval','fetch','AbortController','globalThis','process','window','navigator','URL','WebSocket','requestAnimationFrame','cancelAnimationFrame','__DEV__']);
  for (const file of ['App.js','styles.js','components/shared.js','components/Message.js','components/MessageActions.js','components/QueuePanel.js','components/Search.js','screens/Chat.js','screens/Room.js','screens/Home.js']) {
    const ast = parser.parse(readFileSync(new URL('../mobile/' + file, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx'] }); const missing = new Set();
    traverse(ast, { ReferencedIdentifier(path) { if (!path.scope.hasBinding(path.node.name) && !globals.has(path.node.name)) missing.add(path.node.name); } });
    assert.deepEqual([...missing], [], file);
  }
});
