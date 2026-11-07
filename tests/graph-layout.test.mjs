import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, degrees, fitBox, graphModel, hitTest, labelIds, neighbors, nodeRadius, RADIUS } from '../mobile/state/graph-layout.js';
import { fakeGraph } from './helpers/fake-notes.mjs';

const path = i => `chefe/n${i}.md`;
const ring = n => ({ nodes: Array.from({ length: n }, (_, i) => ({ path: path(i) })), edges: Array.from({ length: n }, (_, i) => ({ from: path(i), to: path((i + 1) % n) })) });
const distance = (p, a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
const finite = layout => Object.values(layout.positions()).every(p => Number.isFinite(p.x) && Number.isFinite(p.y));

test('same notes give the same drawing; it stops by itself without NaN', () => {
  const graph = { nodes: [...ring(12).nodes, { path: 'chefe/so.md' }, { path: 'chefe/so2.md' }], edges: ring(12).edges };
  const a = createLayout(graph), b = createLayout({ nodes: [...graph.nodes].reverse(), edges: graph.edges });
  assert.deepEqual(a.positions(), b.positions(), 'seeded by path, not by order');
  a.run(); b.run();
  assert.equal(a.done, true);
  assert.ok(a.ticks < 1000);
  assert.ok(finite(a));
  for (const id of Object.keys(a.positions())) {
    assert.ok(Math.abs(a.positions()[id].x - b.positions()[id].x) < 1e-6);
  }
  assert.equal(a.tick(), false, 'a stopped layout stays stopped');
  // Two notes on the very same spot and an empty graph do not break it.
  const twin = createLayout({ nodes: [{ path: 'chefe/a.md' }, { path: 'chefe/b.md' }], edges: [], previous: { 'chefe/a.md': { x: 0, y: 0 }, 'chefe/b.md': { x: 0, y: 0 } } });
  twin.run();
  assert.ok(finite(twin));
  assert.ok(distance(twin.positions(), 'chefe/a.md', 'chefe/b.md') > 1);
  const empty = createLayout({ nodes: [], edges: [] });
  assert.equal(empty.done, true);
  assert.equal(empty.run(), 0);
});

test('linked notes end closer than unlinked ones, on both repulsion paths', () => {
  for (const options of [{}, { barnesHut: 0 }]) {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ path: path(i) }));
    // Pairs (0,1), (2,3)... are linked; the rest are loose.
    const edges = Array.from({ length: 10 }, (_, i) => ({ from: path(2 * i), to: path(2 * i + 1) }));
    const layout = createLayout({ nodes, edges, options });
    layout.run();
    const p = layout.positions();
    const linked = edges.reduce((sum, e) => sum + distance(p, e.from, e.to), 0) / edges.length;
    let loose = 0, count = 0;
    for (let i = 20; i < 40; i++) for (let j = i + 1; j < 40; j++) { loose += distance(p, path(i), path(j)); count++; }
    assert.ok(linked * 2 < loose / count, `${linked} vs ${loose / count}`);
    assert.ok(finite(layout));
  }
});

test('a new note settles near its neighbour without moving the rest much', () => {
  const graph = ring(30);
  const first = createLayout(graph);
  first.run();
  const before = first.positions();
  const next = { nodes: [...graph.nodes, { path: 'chefe/nova.md' }], edges: [...graph.edges, { from: 'chefe/nova.md', to: path(5) }] };
  const second = createLayout({ ...next, previous: before });
  assert.ok(second.alpha < 0.2, 'starts cool');
  const start = second.positions()['chefe/nova.md'];
  assert.ok(Math.hypot(start.x - before[path(5)].x, start.y - before[path(5)].y) < 60, 'placed beside its neighbour');
  second.run();
  const after = second.positions();
  const moved = graph.nodes.reduce((sum, n) => sum + Math.hypot(after[n.path].x - before[n.path].x, after[n.path].y - before[n.path].y), 0) / graph.nodes.length;
  assert.ok(moved < 8, 'mean drift ' + moved);
  assert.ok(distance(after, 'chefe/nova.md', path(5)) < 90);
});

test('radius by links, neighbours, hit-test and fit', () => {
  assert.equal(nodeRadius(0), RADIUS.min);
  assert.ok(nodeRadius(4) > nodeRadius(1));
  assert.equal(nodeRadius(10000), RADIUS.max);
  assert.equal(nodeRadius(-3), RADIUS.min);
  const edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }, { from: 'b', to: 'c' }, { from: 'a', to: 'a' }];
  assert.deepEqual([...neighbors(edges, 'a')].sort(), ['b', 'c']);
  assert.deepEqual([...neighbors(edges, 'z')], []);
  assert.equal(degrees(edges).get('b'), 2);
  const nodes = [{ id: 'a', x: 0, y: 0, r: 5 }, { id: 'b', x: 8, y: 0, r: 5 }, { id: 'c', x: 100, y: 100, r: 10 }];
  assert.equal(hitTest(nodes, 1, 0), 'a');
  assert.equal(hitTest(nodes, 6, 0), 'b', 'nearest centre wins on overlap');
  assert.equal(hitTest(nodes, 50, 50), null);
  assert.equal(hitTest(nodes, 100, 113), null);
  assert.equal(hitTest(nodes, 100, 113, 4), 'c');
  const view = fitBox(nodes, 400, 300, { padding: 20 });
  for (const n of nodes) {
    const x = n.x * view.k + view.x, y = n.y * view.k + view.y;
    assert.ok(x - n.r * view.k >= 19.9 && x + n.r * view.k <= 380.1 && y - n.r * view.k >= 19.9 && y + n.r * view.k <= 280.1, JSON.stringify({ x, y }));
  }
  assert.deepEqual(fitBox([], 400, 300), { box: null, k: 1, x: 200, y: 150 });
  assert.ok(fitBox([{ x: 0, y: 0, r: 1 }], 400, 300).k <= 2.5, 'one note is not blown up');
});

test('graph model: ghost nodes for broken links, orphans from server counts, labels by size and zoom', () => {
  const data = { nodes: [
    { path: 'chefe/a.md', title: 'A', outgoingCount: 2, incomingCount: 0 }, { path: 'chefe/b.md', title: 'B', outgoingCount: 0, incomingCount: 1 },
    { path: 'chefe/so.md', title: 'Só', outgoingCount: 0, incomingCount: 0 }],
  edges: [{ from: 'chefe/a.md', to: 'chefe/b.md', exists: true }, { from: 'chefe/a.md', to: 'chefe/falta.md', exists: false }, { from: 'chefe/x.md', to: 'chefe/a.md', exists: true }] };
  const model = graphModel(data);
  assert.deepEqual(model.nodes.map(n => [n.id, n.ghost, n.orphan, n.degree]), [['chefe/a.md', false, false, 2], ['chefe/b.md', false, false, 1], ['chefe/so.md', false, true, 0], ['chefe/falta.md', true, false, 1]]);
  assert.equal(model.byId.get('chefe/falta.md').title, 'falta');
  assert.deepEqual([...model.adjacency.get('chefe/a.md')].sort(), ['chefe/b.md', 'chefe/falta.md']);
  assert.ok(model.byId.get('chefe/so.md').r > RADIUS.min, 'orphans are drawn a little larger');
  const plain = graphModel(data, { ghosts: false });
  assert.deepEqual(plain.nodes.map(n => n.id), ['chefe/a.md', 'chefe/b.md', 'chefe/so.md']);
  assert.equal(plain.edges.length, 1);
  assert.equal(labelIds(model, 1, null).size, 4, 'small maps label everything');
  const big = graphModel(fakeGraph({ notes: 300, links: 600, seed: 3 }));
  const far = labelIds(big, 0.5, null), close = labelIds(big, 1.7, null), all = labelIds(big, 3, null);
  assert.ok(far.size < close.size && close.size < all.size && all.size === big.nodes.length);
  const hub = big.nodes.find(n => !n.ghost && n.degree > 2 && !far.has(n.id)) || big.nodes.find(n => !far.has(n.id) && big.adjacency.get(n.id).size);
  const focused = labelIds(big, 0.5, hub.id);
  assert.ok(focused.has(hub.id));
  for (const id of big.adjacency.get(hub.id)) assert.ok(focused.has(id));
});

test('300 and 1000 notes settle within a reasonable time', () => {
  for (const [notes, links, limit] of [[300, 600, 2500], [1000, 2000, 8000]]) {
    const model = graphModel(fakeGraph({ notes, links, seed: notes }));
    const start = performance.now();
    const layout = createLayout({ nodes: model.nodes, edges: model.edges });
    layout.run();
    const ms = performance.now() - start;
    assert.equal(layout.done, true);
    assert.ok(finite(layout));
    assert.ok(ms < limit, `${notes} notas em ${ms.toFixed(0)} ms`);
    console.log(`# layout ${notes} notas, ${layout.links.length} ligações: ${ms.toFixed(0)} ms, ${layout.ticks} passos`);
  }
});

test('a dragged node stays where it is put, pulls its neighbours along and the layout settles after letting go', () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id })), edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  const layout = createLayout({ nodes, edges });
  layout.run();
  assert.ok(layout.done);
  const before = layout.positions();
  assert.equal(layout.pin('nada', 0, 0), false);
  assert.equal(layout.pin('a', NaN, 0), false);
  // Holding "a" far away for a while: it does not move, "b" follows, the unlinked "d" barely does.
  layout.warm(0.3);
  assert.equal(layout.done, false);
  for (let i = 0; i < 300; i++) { layout.pin('a', 400, 300); layout.tick(); }
  assert.equal(layout.done, false, 'never stops while dragging');
  const held = layout.positions();
  assert.deepEqual(held.a, { x: 400, y: 300 });
  const gain = id => Math.hypot(before[id].x - 400, before[id].y - 300) - Math.hypot(held[id].x - 400, held[id].y - 300);
  assert.ok(gain('b') > 100, 'the neighbour came closer: ' + gain('b'));
  assert.ok(gain('b') > gain('d'));
  layout.unpin('a'); layout.warm(0);
  const ticks = layout.run();
  assert.ok(layout.done && ticks < 1000, 'settles by itself after letting go');
});
