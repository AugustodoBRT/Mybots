import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../../mobile/package.json', import.meta.url));
const babel = require('@babel/core');

// A native element tree with deterministic time and named styles, captured before memoization.
export function messageTree(source, props) {
  const jsx = (type, props) => ({ type, props: Object.fromEntries(Object.entries(props || {}).filter(([key, value]) => typeof value !== 'function' && !(type === 'RichText' && key === 'id'))) });
  const react = { useState: () => [false, () => {}], memo: component => component };
  const shared = { Avatar: 'Avatar', EFFORT_NAMES: { low: 'Baixo' }, tokensLabel: String, claudeName: () => null, findModel: models => models?.[0] };
  const deps = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View', Pressable: 'Pressable', Text: 'Text' },
    '../styles': { styles: new Proxy({}, { get: (_, key) => String(key) }) }, '../theme': { C: { sky: 'sky', faint: 'faint', red: 'red', text: 'text' }, Icon: 'Icon' },
    './shared': shared, '../RichMessage': { RichText: 'RichText', FileChip: 'FileChip', FileCard: 'FileCard' }, '../message-cache': { sameMessage: () => false } };
  const exports = {};
  const result = babel.transformSync(source, { babelrc: false, configFile: false, plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] });
  class FixedDate extends Date { toLocaleTimeString() { return '12:00'; } }
  runInNewContext(result.code, { exports, require: id => { if (!deps[id]) throw new Error(id); return deps[id]; }, Date: FixedDate });
  return JSON.parse(JSON.stringify((exports.Message || exports.MessageView)(props)));
}

export const cases = ['assistant', 'user', 'routine', 'error', 'files'].map(kind => ({ message: {
  id: 'm', role: kind === 'user' ? 'user' : 'assistant', text: '**Olá**, você!\n\n| a | b |\n|---|---|\n| 1 | 2 |', createdAt: '2026-10-27T12:00:00Z', status: kind === 'error' ? 'error' : 'complete',
  ...(kind === 'routine' ? { origin: 'routine', routineTitle: 'Lembrete' } : {}), ...(kind === 'error' ? { error: 'Sem rede' } : {}),
  ...(kind === 'files' ? { attachments: [{ id: 'f', name: 'relatório.pdf', mime: 'application/pdf', size: 1000 }], model: 'test', reasoningEffort: 'low', usage: { input: 8, output: 2 } } : {})
}, bot: { id: 'a', name: 'A', color: 'green' }, models: [{ displayName: 'Modelo' }], onFile() {}, onRetry() {} }));
