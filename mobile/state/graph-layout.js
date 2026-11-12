// Force-directed layout for the memory map: pure functions, no React, so the tests run it in Node.
// Velocity Verlet in the style of d3-force: many-body repulsion (exact below BARNES_HUT nodes, Barnes-Hut quadtree above),
// springs on the links, weak gravity to the origin, velocity decay as friction and an alpha that cools every tick.

export const LAYOUT = {
  linkDistance: 46, linkStrength: 1, charge: -150, gravity: 0.045, decay: 0.42, alphaDecay: 0.028, alphaMin: 0.002,
  // Mean squared speed (px²/tick) under which the drawing counts as still.
  restEnergy: 0.004, theta: 0.9, distanceMax: 520, barnesHut: 150
};

// FNV-1a, so the same path lands on the same spot on every visit and on every device.
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seeded(id, spread) {
  const h = hash(id), u = (h & 0xffff) / 0x10000, v = (h >>> 16) / 0x10000;
  const r = spread * Math.sqrt(0.05 + 0.95 * u), a = 2 * Math.PI * v;
  return [r * Math.cos(a), r * Math.sin(a)];
}

export function degrees(edges) {
  const count = new Map();
  for (const { from, to } of edges) {
    count.set(from, (count.get(from) || 0) + 1);
    count.set(to, (count.get(to) || 0) + 1);
  }
  return count;
}

export const RADIUS = { min: 5, max: 17 };
// The person's own note, the center of the memory: always drawn larger, always named.
export const PERSON_PATH = 'chefe/voce.md';
export function nodeRadius(degree) {
  return Math.min(RADIUS.max, RADIUS.min + 2.1 * Math.sqrt(Math.max(0, degree || 0)));
}

export function neighbors(edges, id) {
  const near = new Set();
  for (const { from, to } of edges) {
    if (from === id && to !== id) near.add(to);
    else if (to === id && from !== id) near.add(from);
  }
  return near;
}

// The closest node whose circle (plus `slop`, for fingers) contains the point. Nodes: [{ id, x, y, r }].
export function hitTest(nodes, x, y, slop = 0) {
  let best = null, bestDistance = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d <= node.r + slop && d < bestDistance) { best = node.id; bestDistance = d; }
  }
  return best;
}

// The box around every node and the view (scale k, translation x/y) that shows it whole inside width × height.
export function fitBox(nodes, width, height, { padding = 24, minScale = 0.05, maxScale = 2.5 } = {}) {
  if (!nodes.length || !(width > 0) || !(height > 0)) return { box: null, k: 1, x: (width || 0) / 2, y: (height || 0) / 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y, r = 0 } of nodes) {
    minX = Math.min(minX, x - r); minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r);
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const room = [Math.max(1, width - 2 * padding), Math.max(1, height - 2 * padding)];
  const k = Math.min(maxScale, Math.max(minScale, Math.min(room[0] / w, room[1] / h)));
  return { box: { minX, minY, maxX, maxY }, k, x: width / 2 - k * (minX + w / 2), y: height / 2 - k * (minY + h / 2) };
}

// Barnes-Hut quadtree, rebuilt every tick. Each cell keeps its point count and centre of mass.
function buildTree(xs, ys, n) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
    if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
  }
  const size = Math.max(x1 - x0, y1 - y0, 1) * 1.0001;
  const cell = (x, y, s) => ({ x, y, s, mass: 0, cx: 0, cy: 0, points: [], kids: null });
  const root = cell(x0, y0, size);
  const insert = (node, i, depth) => {
    for (;;) {
      node.mass++; node.cx += xs[i]; node.cy += ys[i];
      if (!node.kids) {
        // Leaves split while they hold more than one point, unless the points sit on top of each other.
        if (!node.points.length || depth > 24 || node.s < 1e-3) { node.points.push(i); return; }
        const h = node.s / 2;
        node.kids = [cell(node.x, node.y, h), cell(node.x + h, node.y, h), cell(node.x, node.y + h, h), cell(node.x + h, node.y + h, h)];
        for (const j of node.points) {
          const kid = node.kids[(xs[j] >= node.x + h ? 1 : 0) + (ys[j] >= node.y + h ? 2 : 0)];
          kid.mass++; kid.cx += xs[j]; kid.cy += ys[j]; kid.points.push(j);
        }
        node.points = [];
      }
      const h = node.s / 2;
      node = node.kids[(xs[i] >= node.x + h ? 1 : 0) + (ys[i] >= node.y + h ? 2 : 0)];
      depth++;
    }
  };
  for (let i = 0; i < n; i++) insert(root, i, 0);
  const finish = node => {
    if (node.mass) { node.cx /= node.mass; node.cy /= node.mass; }
    if (node.kids) node.kids.forEach(finish);
  };
  finish(root);
  return root;
}

/**
 * nodes: [{ path }] (or { id }); edges: [{ from, to }] between those ids (others are ignored);
 * previous: { [id]: { x, y } } from an earlier drawing. Known nodes keep their place, new ones start beside their placed
 * neighbours and the simulation starts cool, so a new note settles in without shaking the rest.
 */
export function createLayout({ nodes, edges, previous = null, options = {} }) {
  const o = { ...LAYOUT, ...options };
  const ids = nodes.map(node => node.id ?? node.path), n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = [];
  for (const { from, to } of edges) {
    const s = index.get(from), t = index.get(to);
    if (s !== undefined && t !== undefined && s !== t) links.push([s, t]);
  }
  const count = new Float64Array(n);
  for (const [s, t] of links) { count[s]++; count[t]++; }
  const xs = new Float64Array(n), ys = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  const spread = 14 * Math.sqrt(n + 1) + 30;
  const placed = new Uint8Array(n);
  let known = 0;
  for (let i = 0; i < n; i++) {
    const old = previous?.[ids[i]];
    if (old && Number.isFinite(old.x) && Number.isFinite(old.y)) { xs[i] = old.x; ys[i] = old.y; placed[i] = 1; known++; }
  }
  if (known) {
    // Beside the centroid of placed neighbours, a little outward; nodes with none go to their seeded spot.
    const sums = new Map();
    for (const [s, t] of links) for (const [a, b] of [[s, t], [t, s]]) {
      if (placed[a] || !placed[b]) continue;
      const sum = sums.get(a) || [0, 0, 0];
      sum[0] += xs[b]; sum[1] += ys[b]; sum[2]++; sums.set(a, sum);
    }
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
      const [jx, jy] = seeded(ids[i], 1);
      const sum = sums.get(i);
      if (sum) { xs[i] = sum[0] / sum[2] + jx * o.linkDistance * 0.8; ys[i] = sum[1] / sum[2] + jy * o.linkDistance * 0.8; }
      else { const [sx, sy] = seeded(ids[i], spread); xs[i] = sx; ys[i] = sy; }
    }
  } else {
    for (let i = 0; i < n; i++) { const [sx, sy] = seeded(ids[i], spread); xs[i] = sx; ys[i] = sy; }
  }
  // A keep-out disc at the centre (the Chefe's face on his home screen): nothing rests inside it, and new notes begin on its edge.
  const hole = o.hole || 0;
  const outside = (x, y) => { const d = Math.hypot(x, y) || 1e-6; return d < hole ? [x / d * hole, y / d * hole] : [x, y]; };
  if (hole) for (let i = 0; i < n; i++) if (!placed[i]) { const [x, y] = seeded(ids[i], 1); const d = Math.hypot(x, y) || 1; xs[i] = x / d * hole * 1.02; ys[i] = y / d * hole * 1.02; }
  const fresh = n ? (n - known) / n : 0;
  const state = {
    ids, index, links, xs, ys, vx, vy, n, ticks: 0, energy: Infinity, done: n === 0,
    alpha: o.alpha ?? (known ? Math.min(1, 0.06 + 0.9 * fresh) : 1), target: 0,
    tick, run, positions, nodes: list, pin, unpin, warm
  };
  // Nodes held by a finger or the mouse: they stay where they are put, like d3's fx/fy. While dragging, only the held node,
  // the notes linked to it and the ones it passes close to move (`moving`); everything else stays exactly where it was.
  const pinned = new Map();
  let moving = null, around = null;
  const reach = Math.max(40, o.linkDistance * 0.9);
  function wakeAround() {
    if (!around) {
      around = Array.from({ length: n }, () => []);
      for (const [s, t] of links) { around[s].push(t); around[t].push(s); }
    }
    for (const [i, [x, y]] of pinned) {
      moving[i] = 1;
      for (const j of around[i]) moving[j] = 1;
      for (let j = 0; j < n; j++) if (!moving[j] && Math.abs(xs[j] - x) < reach && Math.abs(ys[j] - y) < reach && Math.hypot(xs[j] - x, ys[j] - y) < reach) moving[j] = 1;
    }
  }

  function repulse(alpha) {
    const strength = o.charge * alpha, max2 = o.distanceMax * o.distanceMax;
    if (n <= o.barnesHut) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = xs[j] - xs[i], dy = ys[j] - ys[i], l = dx * dx + dy * dy;
        if (l > max2) continue;
        if (l < 1e-9) { dx = ((i * 7 + j) % 5 - 2) * 0.01 + 0.005; dy = ((i + j * 3) % 5 - 2) * 0.01 - 0.005; l = dx * dx + dy * dy; }
        if (l < 1) l = Math.sqrt(l);
        const f = strength / l;
        vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
      }
      return;
    }
    const root = buildTree(xs, ys, n), theta2 = o.theta * o.theta, stack = [];
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      let fx = 0, fy = 0;
      stack.push(root);
      while (stack.length) {
        const node = stack.pop();
        if (!node.mass) continue;
        const dx = node.cx - x, dy = node.cy - y;
        let l = dx * dx + dy * dy;
        if (node.kids && node.s * node.s / theta2 < l) {
          if (l < max2) { if (l < 1) l = Math.sqrt(l); fx += dx * strength * node.mass / l; fy += dy * strength * node.mass / l; }
          continue;
        }
        if (node.kids) { for (const kid of node.kids) stack.push(kid); continue; }
        for (const j of node.points) {
          if (j === i) continue;
          let px = xs[j] - x, py = ys[j] - y, d = px * px + py * py;
          if (d > max2) continue;
          if (d < 1e-9) { px = ((i * 7 + j) % 5 - 2) * 0.01 + 0.005; py = ((i + j * 3) % 5 - 2) * 0.01 - 0.005; d = px * px + py * py; }
          if (d < 1) d = Math.sqrt(d);
          fx += px * strength / d; fy += py * strength / d;
        }
      }
      vx[i] += fx; vy[i] += fy;
    }
  }

  function tick() {
    if (state.done) return false;
    if (moving) wakeAround();
    const alpha = state.alpha;
    repulse(alpha);
    for (const [s, t] of links) {
      let dx = xs[t] + vx[t] - xs[s] - vx[s], dy = ys[t] + vy[t] - ys[s] - vy[s];
      const l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const k = (l - o.linkDistance) / l * alpha * o.linkStrength / Math.min(count[s], count[t]);
      const bias = count[s] / (count[s] + count[t]);
      dx *= k; dy *= k;
      vx[t] -= dx * bias; vy[t] -= dy * bias; vx[s] += dx * (1 - bias); vy[s] += dy * (1 - bias);
    }
    let energy = 0, fastest = 0, free = 0;
    for (let i = 0; i < n; i++) {
      // A drag leaves the rest of the drawing still, so the pull to the centre would only make the moving part creep.
      if (!moving) { vx[i] -= xs[i] * o.gravity * alpha; vy[i] -= ys[i] * o.gravity * alpha; }
      vx[i] *= 1 - o.decay; vy[i] *= 1 - o.decay;
      const held = pinned.get(i);
      if (held || (moving && !moving[i])) { if (held) { xs[i] = held[0]; ys[i] = held[1]; } vx[i] = vy[i] = 0; continue; }
      xs[i] += vx[i]; ys[i] += vy[i];
      if (hole) [xs[i], ys[i]] = outside(xs[i], ys[i]);
      const v2 = vx[i] * vx[i] + vy[i] * vy[i];
      energy += v2; free++; if (v2 > fastest) fastest = v2;
    }
    state.energy = moving ? (free ? energy / free : 0) : n ? energy / n : 0;
    state.alpha += (state.target - alpha) * o.alphaDecay;
    state.ticks++;
    // Stops by itself: cold enough, or nothing moves any more (never while something is being dragged).
    // After a drag it eases out until even the fastest dot moves less than a twentieth of a pixel per frame.
    const still = moving ? fastest < 0.0025 : state.energy < o.restEnergy;
    if (!state.target && (state.alpha < o.alphaMin || (state.ticks > 15 && still))) { state.done = true; moving = null; }
    state.local = Boolean(moving);
    return !state.done;
  }

  // Ticks until still, or until `budget` ms pass (then call again on the next frame). Returns the ticks done.
  function run({ maxTicks = 1000, budget = Infinity, now = () => Date.now() } = {}) {
    const start = budget === Infinity ? 0 : now();
    let done = 0;
    while (!state.done && done < maxTicks) {
      tick(); done++;
      if (budget !== Infinity && (done & 3) === 0 && now() - start >= budget) break;
    }
    return done;
  }

  // Dragging: pin a node at a point, keep the simulation warm while it moves, and let go (it cools down by itself).
  function pin(id, x, y) {
    const i = index.get(id);
    if (i === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (hole) [x, y] = outside(x, y);
    pinned.set(i, [x, y]); xs[i] = x; ys[i] = y; vx[i] = vy[i] = 0;
    return true;
  }
  function unpin(id) { const i = index.get(id); if (i !== undefined) pinned.delete(i); }
  // `local`: only what the drag touches moves (Obsidian-like); without it the whole drawing reheats (a change of forces).
  function warm(target, { local = false } = {}) {
    state.target = target;
    if (local && !moving && state.done) moving = new Uint8Array(n);
    if (!local) moving = null;
    if (target) { state.alpha = Math.max(state.alpha, target); state.done = n === 0; state.ticks = 0; }
    else if (moving) { state.done = false; state.ticks = 0; }
    state.local = Boolean(moving);
  }

  function positions() {
    const out = {};
    for (let i = 0; i < n; i++) out[ids[i]] = { x: xs[i], y: ys[i] };
    return out;
  }

  function list() {
    return ids.map((id, i) => ({ id, x: xs[i], y: ys[i] }));
  }

  return state;
}

// What the screen draws from a notes.graph result: real notes, optional ghost nodes for links to notes that do not exist,
// a radius from the links shown and the neighbour sets used for highlighting. Orphans use the server counts, like the list badge.
export function graphModel({ nodes, edges }, { ghosts = true, orphans = true } = {}) {
  const list = nodes.map(node => ({ ...node, id: node.path, ghost: false, orphan: !node.outgoingCount && !node.incomingCount }))
    .filter(node => orphans || !node.orphan);
  const byId = new Map(list.map(node => [node.id, node])), links = [];
  for (const edge of edges) {
    if (!byId.has(edge.from)) continue;
    if (edge.exists) { if (byId.has(edge.to)) links.push({ from: edge.from, to: edge.to, broken: false }); continue; }
    if (!ghosts) continue;
    if (!byId.has(edge.to)) {
      const ghost = { id: edge.to, path: edge.to, title: edge.title || edge.to.split('/').at(-1).replace(/\.md$/, ''), kind: 'ghost', ghost: true, orphan: false };
      list.push(ghost); byId.set(ghost.id, ghost);
    }
    links.push({ from: edge.from, to: edge.to, broken: true });
  }
  const count = degrees(links), adjacency = new Map(list.map(node => [node.id, new Set()]));
  for (const { from, to } of links) { adjacency.get(from).add(to); adjacency.get(to).add(from); }
  for (const node of list) { node.degree = count.get(node.id) || 0; node.person = node.id === PERSON_PATH; node.r = node.person ? RADIUS.max + 4 : node.orphan ? RADIUS.min + 2 : nodeRadius(node.degree); }
  return { nodes: list, edges: links, byId, adjacency };
}

// Which titles to print: every one in a small map; otherwise the most linked notes (more as the zoom grows) plus the
// highlighted note and its neighbours.
export function labelIds(model, k, active) {
  const real = model.nodes.filter(node => !node.ghost);
  if (model.nodes.length <= 40 || k >= 2.4) return new Set(model.nodes.map(node => node.id));
  const room = k >= 1.6 ? 80 : k >= 1 ? 30 : k >= 0.6 ? 14 : 6;
  const ids = new Set([...real].sort((a, b) => b.degree - a.degree || (a.id > b.id) - (a.id < b.id)).slice(0, room).filter(node => node.degree > 1).map(node => node.id));
  if (model.byId.has(PERSON_PATH)) ids.add(PERSON_PATH);
  if (active && model.byId.has(active)) { ids.add(active); for (const id of model.adjacency.get(active)) ids.add(id); }
  return ids;
}
