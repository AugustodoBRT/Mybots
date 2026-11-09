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
  for (const file of ['App.js','BotProfile.js','components/NewBot.js','components/ChiefTeam.js','components/Settings.js','components/GoogleAccounts.js','styles.js','components/shared.js','components/Message.js','components/MessageActions.js','components/QueuePanel.js','components/Canvas.js','state/canvas-layout.js','components/Search.js','screens/Chat.js','screens/Room.js','screens/Home.js','screens/Memory.js','screens/MemoryGraph.js','screens/NoteReader.js','screens/memory-look.js','RichMessage.js']) {
    const ast = parser.parse(readFileSync(new URL('../mobile/' + file, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx'] }); const missing = new Set();
    traverse(ast, { ReferencedIdentifier(path) { if (!path.scope.hasBinding(path.node.name) && !globals.has(path.node.name)) missing.add(path.node.name); } });
    assert.deepEqual([...missing], [], file);
  }
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
    for (const [key, value] of Object.entries(rest)) if (['cx', 'cy', 'r', 'opacity', 'strokeDasharray', 'stroke', 'fill', 'd', 'transform', 'x', 'y', 'accessibilityHint', 'viewBox'].includes(key)) attrs[key] = value;
    if (flat.color) attrs['data-color'] = flat.color;
    if (flat.textDecorationLine) attrs['data-decoration'] = flat.textDecorationLine;
    return React.createElement(tag, attrs, children);
  };
  const Pressable = props => host('button')({ ...props, children: props.children });
  const layout = await import('../mobile/state/graph-layout.js'), view = await import('../mobile/state/note-view.js'), markdown = await import('../mobile/markdown.js');
  const LOOK = new Proxy({}, { get: (_, key) => '#' + String(key) });
  const deps = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: host('div'), Text: host('span'), Pressable, ScrollView: host('main'), TextInput: host('input'),
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: { openURL() {} }, Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 400, height: 800 }),
      PanResponder: { create: config => { Object.assign(gestures, config); return { panHandlers: {} }; } } },
    'react-native-svg': { __esModule: true, default: host('svg'), G: host('g'), Circle: host('circle'), Path: host('path'), Text: host('text') },
    '../state/graph-layout': layout, '../markdown': markdown, '../RichMessage': { Chart: () => null },
    './memory-look': { look: () => LOOK, botHues: bots => new Map(bots.map((bot, i) => [bot.id, '#hue' + i])), kindHues: () => ({ chefe: '#chefe', entrega: '#entrega', arquivo: '#arquivo' }), KIND_NAMES: { chefe: 'Chefe', entrega: 'Entregas', arquivo: 'Arquivo' } },
    '../components/shared': { Avatar: () => null, IconButton: ({ label }) => React.createElement('button', { 'aria-label': label }) },
    '../state/note-view': view, '../styles': { TOP: 0 },
    '../theme': { themed: () => new Proxy({}, { get: () => ({}) }), F: {}, Icon: () => null, currentTheme: () => 'dark' },
    ...extra };
  const exports = {};
  runInNewContext(code, { exports, require: name => deps[name], setTimeout, clearTimeout, globalThis: {} });
  return { exports, presses, gestures, render: (component, props) => require('react-dom/server').renderToStaticMarkup(React.createElement(component, props)) };
}


test('memory list rows: bot colour, highlights, orphan badge; references keep missing notes inert', async () => {
  const { exports, render } = await loadMobile('screens/Memory.js', { './MemoryGraph': {}, './NoteReader': {} });
  const row = render(exports.NoteRow, { note: { title: 'Revisão', path: 'entregas/revisao.md', botId: 'sol', botName: 'Sol',
    snippet: 'Uma decisão', snippetMatch: [4, 11], updatedAt: new Date().toISOString(), incomingCount: 0, outgoingCount: 0 }, hue: '#hue0', onOpen() {} });
  assert.match(row, /aria-label="Ler Revisão"/);
  assert.match(row, /Sol · agora/);
  assert.match(row, /<span data-color="#accent">decisão<\/span>/);
  assert.match(row, /Órfã/);
  const section = render(exports.References, { label: 'Quem aponta para esta', items: [
    { path: 'chefe/projeto.md', title: 'Projeto' }, { path: 'chefe/falta.md', title: 'Falta', exists: false }], onOpen() {} });
  assert.equal(section.match(/role="link"/g)?.length, 1);
  assert.match(section, /Nota ainda não criada/);
});

test('memory map: quiet orphan ring, unresolved notes in grey, neighbours lit and a tap opens the note', async () => {
  const { exports, gestures, render } = await loadMobile('screens/MemoryGraph.js');
  const { graphModel } = await import('../mobile/state/graph-layout.js');
  const model = graphModel({ nodes: [
    { path: 'chefe/a.md', title: 'Projeto', kind: 'chefe', outgoingCount: 2, incomingCount: 0 },
    { path: 'chefe/b.md', title: 'Cliente', kind: 'chefe', outgoingCount: 0, incomingCount: 1 },
    { path: 'entregas/c.md', title: 'Entrega', kind: 'entrega', outgoingCount: 0, incomingCount: 0 },
    { path: 'chefe/d.md', title: 'Longe', kind: 'chefe', outgoingCount: 1, incomingCount: 0 }],
  edges: [{ from: 'chefe/a.md', to: 'chefe/b.md', exists: true }, { from: 'chefe/a.md', to: 'chefe/central-de-vagas.md', exists: false, title: 'Central de Vagas' }] });
  const positions = [{ id: 'chefe/a.md', x: 100, y: 100 }, { id: 'chefe/b.md', x: 160, y: 100 }, { id: 'entregas/c.md', x: 300, y: 300 },
    { id: 'chefe/d.md', x: 20, y: 300 }, { id: 'chefe/central-de-vagas.md', x: 100, y: 180 }];
  const opened = [];
  const props = { model, positions, matches: null, colorOf: node => node.kind === 'chefe' ? '#c1' : '#c2', onOpen: p => opened.push(p), initialView: { k: 1, x: 0, y: 0 }, store: { positions: {}, view: null } };
  const html = render(exports.GraphCanvas, props);
  assert.match(html, /<svg viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+">/, 'drawn once into a layer that pan and zoom only move');
  assert.equal(html.match(/<circle[^>]*fill="none" stroke="#faint"/g)?.length, 1, 'only the orphan gets a ring');
  assert.match(html, /<circle cx="100" cy="180" r="[\d.]+" fill="#unresolved"/, 'unresolved note in grey');
  assert.match(html, />Central de Vagas</, 'unresolved note named as written');
  assert.match(html, /Grafo da memória com 5 notas e 2 ligações/);
  assert.ok(!/opacity="0.14"/.test(html), 'nothing dimmed without a highlight');
  // Highlight (hover on the computer, hold on the phone): the note and its neighbours stay, the rest fades.
  const lit = render(exports.GraphCanvas, { ...props, initialFocus: 'chefe/a.md' });
  const opacity = (x, y) => lit.match(new RegExp(`<circle cx="${x}" cy="${y}" r="[\\d.]+" fill="#[^"]+" opacity="([\\d.]+)"`))?.[1];
  assert.equal(opacity(100, 100), '1'); assert.equal(opacity(160, 100), '1'); assert.equal(opacity(100, 180), '1');
  assert.equal(opacity(20, 300), '0.14');
  assert.match(lit, /<path d="M100.0 100.0L160.0 100.0M100.0 100.0L100.0 180.0" stroke="#accent"/);
  assert.match(lit, /stroke="#accent"[^>]*><\/circle>/, 'the highlighted note gets an accent ring');
  assert.match(lit, /aria-label="Abrir Projeto"/);
  const found = render(exports.GraphCanvas, { ...props, matches: new Set(['entregas/c.md']) });
  assert.ok(/opacity="0.14"/.test(found));
  const touch = (x, y) => ({ nativeEvent: { pageX: x + 40, pageY: y + 70, locationX: x, locationY: y } });
  gestures.onPanResponderGrant(touch(102, 98)); gestures.onPanResponderRelease(touch(102, 98));
  assert.deepEqual(opened, ['chefe/a.md']);
  gestures.onPanResponderGrant(touch(100, 180)); gestures.onPanResponderRelease(touch(100, 180));
  gestures.onPanResponderGrant(touch(220, 30)); gestures.onPanResponderRelease(touch(220, 30));
  gestures.onPanResponderGrant(touch(160, 100)); gestures.onPanResponderMove(touch(200, 140)); gestures.onPanResponderRelease(touch(200, 140));
  assert.deepEqual(opened, ['chefe/a.md'], 'ghosts, background and drags do not open anything');
});

test('memory screen: list is the default, the graph view has unique accessible names and is remembered', async () => {
  const React = require('react');
  const { exports, presses, render } = await loadMobile('screens/Memory.js', { './MemoryGraph': { MemoryGraph: () => React.createElement('figure', null, 'mapa') }, './NoteReader': {} });
  const props = { bots: [], call: async () => ({ notes: [] }), version: 0, onClose() {} };
  const first = render(exports.MemoryScreen, props);
  assert.match(first, /aria-label="Ver como lista"[^>]*aria-selected="true"/);
  assert.match(first, /aria-label="Ver como grafo"[^>]*aria-selected="false"/);
  assert.ok(!first.includes('<figure>'), 'the map is not built until chosen');
  for (const name of ['Equipe', 'Memória']) assert.ok(!new RegExp(`aria-label="${name}"`).test(first));
  presses['Ver como grafo']();
  const again = render(exports.MemoryScreen, props);
  assert.match(again, /aria-label="Ver como grafo"[^>]*aria-selected="true"/);
  assert.match(again, /<div data-display="flex"><figure>mapa<\/figure>/);
  assert.match(again, /<div data-display="none"><main>/, 'the list stays mounted, hidden');
  presses['Ver como lista']();
  assert.match(render(exports.MemoryScreen, props), /aria-label="Ver como lista"[^>]*aria-selected="true"/);
});

test('note reader: properties, typeset Markdown, aliases and missing links like Obsidian', async () => {
  const React = require('react');
  const { exports, render } = await loadMobile('screens/NoteReader.js', { './MemoryGraph': { GraphCanvas: () => React.createElement('figure', null, 'local'), useLayout: () => ({ positions: [], fitKey: 0 }) } });
  const note = { path: 'entregas/r.md', title: 'Rastreamento de candidaturas', kind: 'entrega', botId: 'b1', botName: 'RastreadorRH', updatedAt: '2026-11-07T15:53:01.180Z',
    body: 'Bot: RastreadorRH\nData: 2026-11-07T15:53:01.180Z\nAssunto: Candidaturas\n\n## Resumo\n\nPublicado em [[Central de Vagas|o painel]] e [[Candidaturas Augusto]].\n\n- [x] Gupy\n- [ ] LinkedIn\n\n> [!warning] Cuidado\n> Falta acesso.',
    links: [{ path: 'chefe/central-de-vagas.md', title: 'central-de-vagas', exists: true, kind: 'chefe', names: ['Central de Vagas'] },
      { path: 'chefe/candidaturas-augusto.md', title: 'Candidaturas Augusto', exists: false, kind: null, names: ['Candidaturas Augusto'] }],
    backlinks: [{ path: 'chefe/index.md', title: 'Índice', kind: 'chefe', snippet: 'Ver [[Rastreamento|o rastreamento]] **hoje**' }] };
  const opened = [];
  const html = render(exports.NoteReader, { note, bots: [{ id: 'b1', name: 'RastreadorRH' }], hues: new Map([['b1', '#hue0']]), onOpen: p => opened.push(p), width: 1400 });
  assert.match(html, /Propriedades/);
  assert.match(html, />Data<\/span>.*07\/11\/2026 às/s);
  assert.ok(!html.includes('Bot: RastreadorRH'), 'the header lines became properties, not text');
  assert.match(html, /Resumo/);
  assert.match(html, /<span role="link" data-color="#link">o painel<\/span>/, 'alias shown, link clickable');
  assert.match(html, /<span accessibilityHint="Nota ainda não criada" data-color="#link">Candidaturas Augusto<\/span>/);
  assert.ok(!html.includes('[['), 'no raw brackets in the reading view');
  assert.match(html, /data-decoration="line-through"><span>Gupy/, 'done task struck through');
  assert.match(html, /Cuidado/);
  assert.match(html, /<figure>local<\/figure>/);
  assert.match(html, /Links de entrada/);
  assert.match(html, /Índice/);
  assert.match(html, />Ver o rastreamento hoje</, 'snippets read as text');
});
