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
  const globals = new Set(['undefined','require','console','setTimeout','clearTimeout','setInterval','clearInterval','fetch','AbortController','globalThis','process','window','navigator','URL','WebSocket','FileReader','requestAnimationFrame','cancelAnimationFrame','__DEV__']);
  for (const file of ['App.js','BotProfile.js','components/NewBot.js','components/ChiefTeam.js','components/Settings.js','components/GoogleAccounts.js','styles.js','components/shared.js','components/Message.js','components/MessageActions.js','components/QueuePanel.js','components/Office.web.js','components/OfficeTasks.js','components/Search.js','screens/Chat.js','screens/Room.js','screens/Home.js','screens/Memory.js','screens/MemoryGraph.js','RichMessage.js']) {
    const ast = parser.parse(readFileSync(new URL('../mobile/' + file, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx'] }); const missing = new Set();
    traverse(ast, { ReferencedIdentifier(path) { if (!path.scope.hasBinding(path.node.name) && !globals.has(path.node.name)) missing.add(path.node.name); } });
    assert.deepEqual([...missing], [], file);
  }
});

test('memory rows render authorship, highlights, orphan badges and accessible backlink targets', async () => {
  const { runInNewContext } = await import('node:vm');
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const source = readFileSync(new URL('../mobile/screens/Memory.js', import.meta.url), 'utf8');
  const babel = require('@babel/core');
  const { code } = babel.transformSync(source, { babelrc: false, configFile: false, plugins: [
    [require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] });
  const element = tag => ({ children, accessibilityRole, accessibilityLabel, disabled }) => React.createElement(tag,
    { role: accessibilityRole, 'aria-label': accessibilityLabel, disabled }, children);
  const deps = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: element('div'), Text: element('span'), Pressable: element('button') },
    '../components/shared': { Avatar: ({ bot }) => React.createElement('img', { alt: bot.name }) }, '../RichMessage': {},
    '../state/note-view': {}, '../styles': {}, '../theme': { themed: () => ({}) }, './MemoryGraph': {} };
  const exports = {};
  runInNewContext(code, { exports, require: name => deps[name] });
  const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
  const row = render(exports.NoteRow, { note: { title: 'Revisão', path: 'entregas/revisao.md', botId: 'sol', botName: 'Sol',
    snippet: 'Uma decisão', snippetMatch: [4, 11], updatedAt: new Date().toISOString(), incomingCount: 0, outgoingCount: 0 }, bot: { name: 'Sol' } });
  assert.match(row, /aria-label="Ler Revisão"/);
  assert.match(row, /alt="Sol"/);
  assert.match(row, /<span>decisão<\/span>/);
  assert.match(row, /Órfã/);
  const section = render(exports.References, { label: 'Quem aponta para esta', items: [
    { path: 'chefe/projeto.md', title: 'Projeto' }, { path: 'chefe/falta.md', title: 'Falta', exists: false }] });
  assert.match(section, /Quem aponta para esta/);
  assert.equal(section.match(/role="link"/g)?.length, 1);
  assert.match(section, /disabled/);
  assert.match(section, /Nota ainda não criada/);
});

// Loads a mobile module in a sandbox with mocked native pieces. Pressables register their onPress by accessible name.
async function loadMobile(file, extra = {}) {
  const { runInNewContext } = await import('node:vm');
  const React = require('react'), babel = require('@babel/core');
  const { code } = babel.transformSync(readFileSync(new URL('../mobile/' + file, import.meta.url), 'utf8'), { babelrc: false, configFile: false, plugins: [
    [require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] });
  const presses = {}, gestures = {};
  const host = tag => ({ children, accessibilityRole, accessibilityLabel, accessibilityState, style, onPress, panHandlers, ...rest }) => {
    if (onPress && accessibilityLabel) presses[accessibilityLabel] = onPress;
    const flat = [].concat(style || []).filter(Boolean).reduce((all, one) => ({ ...all, ...one }), {});
    const attrs = { role: accessibilityRole, 'aria-label': accessibilityLabel, 'data-display': flat.display,
      'aria-selected': accessibilityState?.selected, 'aria-checked': accessibilityState?.checked };
    for (const [key, value] of Object.entries(rest)) if (['cx', 'cy', 'r', 'opacity', 'strokeDasharray', 'stroke', 'fill', 'd', 'transform', 'x', 'y'].includes(key)) attrs[key] = value;
    return React.createElement(tag, attrs, children);
  };
  const Pressable = props => host('button')({ ...props, children: props.children });
  const { graphModel, createLayout, fitBox, hitTest, labelIds } = await import('../mobile/state/graph-layout.js');
  const deps = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: host('div'), Text: host('span'), Pressable, ScrollView: host('main'), TextInput: host('input'),
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 400, height: 800 }),
      PanResponder: { create: config => { Object.assign(gestures, config); return { panHandlers: {} }; } } },
    'react-native-svg': { __esModule: true, default: host('svg'), G: host('g'), Circle: host('circle'), Path: host('path'), Text: host('text') },
    '../state/graph-layout': { graphModel, createLayout, fitBox, hitTest, labelIds },
    '../components/shared': { Avatar: () => null, IconButton: ({ label }) => React.createElement('button', { 'aria-label': label }) },
    '../RichMessage': {}, '../state/note-view': { noteChanged: () => false }, '../styles': { TOP: 0 },
    '../theme': { themed: () => new Proxy({}, { get: () => ({}) }), C: new Proxy({}, { get: (_, key) => '#' + String(key) }), F: {}, hueOf: bot => bot.face?.color || '#bot' },
    ...extra };
  const exports = {};
  runInNewContext(code, { exports, require: name => deps[name], setTimeout, clearTimeout, globalThis: {} });
  return { exports, presses, gestures, render: (component, props) => require('react-dom/server').renderToStaticMarkup(React.createElement(component, props)) };
}

test('memory map: orphan rings, broken links dashed, neighbours lit and a tap opens the note', async () => {
  const { exports, gestures, render } = await loadMobile('screens/MemoryGraph.js');
  const { graphModel } = await import('../mobile/state/graph-layout.js');
  const model = graphModel({ nodes: [
    { path: 'chefe/a.md', title: 'Projeto', kind: 'chefe', outgoingCount: 2, incomingCount: 0 },
    { path: 'chefe/b.md', title: 'Cliente', kind: 'chefe', outgoingCount: 0, incomingCount: 1 },
    { path: 'entregas/c.md', title: 'Entrega', kind: 'entrega', outgoingCount: 0, incomingCount: 0 },
    { path: 'chefe/d.md', title: 'Longe', kind: 'chefe', outgoingCount: 1, incomingCount: 0 }],
  edges: [{ from: 'chefe/a.md', to: 'chefe/b.md', exists: true }, { from: 'chefe/a.md', to: 'chefe/falta.md', exists: false }] });
  const positions = [{ id: 'chefe/a.md', x: 100, y: 100 }, { id: 'chefe/b.md', x: 160, y: 100 }, { id: 'entregas/c.md', x: 300, y: 300 },
    { id: 'chefe/d.md', x: 20, y: 300 }, { id: 'chefe/falta.md', x: 100, y: 180 }];
  const opened = [];
  const props = { model, positions, matches: null, colorOf: node => node.kind === 'chefe' ? '#chefe' : '#entrega', onOpen: p => opened.push(p), initialView: { k: 1, x: 0, y: 0 } };
  const html = render(exports.GraphCanvas, props);
  assert.match(html, /transform="translate\(0 0\) scale\(1\)"/);
  assert.equal(html.match(/<circle[^>]*stroke-dasharray="3 3"|<circle[^>]*strokeDasharray="3 3"/g)?.length, 1, 'only the orphan gets the dashed ring');
  assert.match(html, /cx="300" cy="300" r="\d+" fill="none"[^>]*stroke="#text"/);
  assert.match(html, /<circle[^>]*cx="100" cy="180"[^>]*fill="#bg"[^>]*stroke="#muted"/, 'ghost node is hollow');
  assert.match(html, /stroke-dasharray="4 3"|strokeDasharray="4 3"/, 'broken link dashed');
  assert.match(html, /Grafo da memória com 5 notas e 2 ligações/);
  assert.ok(!/opacity="0.16"/.test(html), 'nothing dimmed without a highlight');
  // Highlight (hover on the computer, hold on the phone): the note and its neighbours stay, the rest fades, the title shows.
  const lit = render(exports.GraphCanvas, { ...props, initialFocus: 'chefe/a.md' });
  const opacity = (x, y) => lit.match(new RegExp(`<circle cx="${x}" cy="${y}"[^>]*fill="#(?!none)[^"]*"[^>]*opacity="([\\d.]+)"`))?.[1];
  assert.equal(opacity(100, 100), '1'); assert.equal(opacity(160, 100), '1'); assert.equal(opacity(100, 180), '1');
  assert.equal(opacity(20, 300), '0.16');
  assert.match(lit, /M100.0 100.0L160.0 100.0/);
  assert.match(lit, /<span>Projeto<\/span>/);
  assert.match(lit, /2 ligações/);
  // Search matches: the others fade.
  const found = render(exports.GraphCanvas, { ...props, matches: new Set(['entregas/c.md']) });
  assert.ok(/opacity="0.16"/.test(found));
  // A tap on a note opens it; a drag does not; a tap on a ghost or on the background does not.
  const touch = (x, y) => ({ nativeEvent: { pageX: x + 40, pageY: y + 70, locationX: x, locationY: y } });
  gestures.onPanResponderGrant(touch(102, 98)); gestures.onPanResponderRelease(touch(102, 98));
  assert.deepEqual(opened, ['chefe/a.md']);
  gestures.onPanResponderGrant(touch(100, 180)); gestures.onPanResponderRelease(touch(100, 180));
  gestures.onPanResponderGrant(touch(220, 30)); gestures.onPanResponderRelease(touch(220, 30));
  gestures.onPanResponderGrant(touch(160, 100)); gestures.onPanResponderMove(touch(200, 140)); gestures.onPanResponderRelease(touch(200, 140));
  assert.deepEqual(opened, ['chefe/a.md']);
});

test('memory screen: list is the default, the graph view has unique accessible names and is remembered', async () => {
  const React = require('react');
  const { exports, presses, render } = await loadMobile('screens/Memory.js', { './MemoryGraph': { MemoryGraph: () => React.createElement('figure', null, 'mapa') } });
  const props = { bots: [], call: async () => ({ notes: [] }), version: 0, onClose() {} };
  const first = render(exports.MemoryScreen, props);
  assert.match(first, /aria-label="Ver como lista" data-display="[^"]*" aria-selected="true"|aria-label="Ver como lista"[^>]*aria-selected="true"/);
  assert.match(first, /aria-label="Ver como grafo"[^>]*aria-selected="false"/);
  assert.ok(!first.includes('<figure>'), 'the map is not built until chosen');
  for (const name of ['Equipe', 'Memória']) assert.ok(!new RegExp(`aria-label="${name}"|<button[^>]*>${name}</button>`).test(first));
  presses['Ver como grafo']();
  const again = render(exports.MemoryScreen, props);
  assert.match(again, /aria-label="Ver como grafo"[^>]*aria-selected="true"/);
  assert.match(again, /<div data-display="flex"><figure>mapa<\/figure>/);
  assert.match(again, /<div data-display="none"><span>Carregando notas…<\/span>/, 'the list stays mounted, hidden');
  presses['Ver como lista']();
  assert.match(render(exports.MemoryScreen, props), /aria-label="Ver como lista"[^>]*aria-selected="true"/);
});
