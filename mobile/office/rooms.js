// Procedural rooms of the Escritório: every room of the app becomes a small office floating in space, built from its
// members. Each bot brings its desk, a beanbag in its color (where it sleeps) and things that match what it does
// (its name and instructions): a bookshelf for studies, a camera for videos, a server rack for code… The room's id is
// the seed, so a room always looks the same, and no two rooms look alike.
import * as T from './vendor/three.module.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { specFromFace, rng, hashStr } from '../../lib/mimo.mjs';

const TAU = Math.PI * 2;
const mats = new Map();
const mat = (color, extra = {}) => { const k = color + JSON.stringify(extra); if (!mats.has(k)) mats.set(k, new T.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.05, ...extra })); return mats.get(k); };
const geos = new Map();
const rbox = (w, h, d, r) => { const k = [w, h, d, r].join(); if (!geos.has(k)) geos.set(k, r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)) : new T.BoxGeometry(w, h, d)); return geos.get(k); };

// What a bot does → what it brings. First match wins; bots with nothing recognizable bring something of their own seed.
const THEMES = [
  [/estud|faculdade|aula|prova|livro|sigaa|matem|álgebra|algebra|escola|tcc|pesquis/i, 'bookshelf'],
  [/e-?mail|gmail|mensag|correio|inbox/i, 'mailbox'],
  [/v[íi]deo|filme|terror|youtube|tiktok|reels|roteiro|edi[çc][ãa]o/i, 'camera'],
  [/m[úu]sica|spotify|playlist|guitarra|banda/i, 'guitar'],
  [/c[óo]digo|program|dev|github|site|app|servidor|deploy/i, 'server'],
  [/finan|dinheiro|carteira|compra|pagamento|banco|pix|invest/i, 'safe'],
  [/not[íi]cia|news|web|navega|busca|internet/i, 'globe'],
  [/arte|design|desenho|imagem|foto|logo/i, 'easel'],
  [/rotina|agenda|lembrete|calend|tarefa|organiz/i, 'clock'],
  [/jogo|game|divers|meme/i, 'arcade']
];
const EXTRAS = ['plant', 'aquarium', 'telescope', 'lamp', 'plant', 'arcade', 'globe'];

function themeOf(bot, r) {
  const text = `${bot.name || ''} ${bot.instructions || ''} ${bot.role || ''}`;
  const found = THEMES.find(([re]) => re.test(text));
  return found ? found[1] : EXTRAS[Math.floor(r() * EXTRAS.length)];
}

// Each builder adds meshes to `g` (local, floor at y = 0) and returns its footprint [w, d].
const BUILD = {
  bookshelf(g, c) { const wood = mat('#5a4430'); add(g, rbox(1.3, 2.1, 0.45, 0.03), wood, 0, 1.05, 0); for (let row = 0; row < 4; row++) { add(g, rbox(1.25, 0.05, 0.42, 0), mat('#3d2e20'), 0, 0.22 + row * 0.5, 0.02); for (let j = 0; j < 6; j++) { const h = 0.28 + ((row * 6 + j) * 37 % 10) / 70; add(g, rbox(0.15, h, 0.3, 0.01), mat(['#885654', '#697d7a', '#c09b64', '#52607b', c, '#928869'][(j + row) % 6]), -0.48 + j * 0.19, 0.25 + row * 0.5 + h / 2, 0.04); } } return [1.3, 0.45]; },
  mailbox(g, c) { add(g, rbox(0.8, 0.9, 0.5, 0.04), mat('#3b3e46'), 0, 0.45, 0); for (let i = 0; i < 4; i++) add(g, rbox(0.5, 0.05, 0.34, 0.01), mat(i % 2 ? '#efe6d4' : '#d9cdb5'), 0.02 * i, 0.93 + i * 0.055, 0, 0, i * 0.15); add(g, rbox(0.3, 0.2, 0.02, 0.005), mat(c, { emissive: c, emissiveIntensity: 0.4 }), 0, 0.6, 0.26); return [0.8, 0.5]; },
  camera(g, c) { for (let i = 0; i < 3; i++) { const a = i * TAU / 3, leg = add(g, rbox(0.04, 1.3, 0.04, 0), mat('#2a2c32'), Math.cos(a) * 0.22, 0.62, Math.sin(a) * 0.22); leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); } add(g, rbox(0.42, 0.28, 0.3, 0.05), mat('#1d1f24'), 0, 1.35, 0); add(g, new T.CylinderGeometry(0.1, 0.12, 0.2, 18), mat('#2c2f36'), 0, 1.35, 0.24, Math.PI / 2); add(g, new T.SphereGeometry(0.035, 10, 8), mat('#ff4d4d', { emissive: '#ff3b3b', emissiveIntensity: 2 }), 0.15, 1.52, 0.1); return [0.7, 0.7]; },
  guitar(g, c) { add(g, rbox(0.3, 0.06, 0.3, 0.02), mat('#2a2c32'), 0, 0.03, 0); add(g, new T.SphereGeometry(0.26, 18, 12), mat(c), 0, 0.42, 0, 0, 0, 0, [1, 1.1, 0.35]); add(g, new T.SphereGeometry(0.2, 18, 12), mat(c), 0, 0.72, 0, 0, 0, 0, [1, 1, 0.35]); add(g, rbox(0.06, 0.75, 0.04, 0.01), mat('#5a4430'), 0, 1.15, 0); add(g, new T.CylinderGeometry(0.06, 0.06, 0.02, 16), mat('#111'), 0, 0.5, 0.09, Math.PI / 2); return [0.5, 0.4]; },
  server(g, c) { add(g, rbox(0.7, 1.9, 0.7, 0.03), mat('#1b1d22', { metalness: 0.4, roughness: 0.4 }), 0, 0.95, 0); const leds = []; for (let i = 0; i < 7; i++) { add(g, rbox(0.6, 0.18, 0.02, 0.01), mat('#2a2d34'), 0, 0.3 + i * 0.23, 0.36); for (let j = 0; j < 3; j++) leds.push(add(g, rbox(0.03, 0.03, 0.02, 0), new T.MeshStandardMaterial({ color: '#000', emissive: j === 0 ? c : '#5dff9a', emissiveIntensity: 1.5 }), 0.2 + j * 0.06, 0.3 + i * 0.23, 0.37)); } g.userData.tick = t => leds.forEach((led, i) => { led.material.emissiveIntensity = (Math.sin(t * (3 + (i % 5)) + i * 1.7) > 0.2) ? 2 : 0.15; }); return [0.7, 0.7]; },
  safe(g, c) { add(g, rbox(0.75, 0.8, 0.7, 0.05), mat('#3b3e46', { metalness: 0.6, roughness: 0.35 }), 0, 0.4, 0); add(g, new T.CylinderGeometry(0.12, 0.12, 0.05, 24), mat('#eabb75', { metalness: 0.8, roughness: 0.3 }), 0.08, 0.45, 0.36, Math.PI / 2); add(g, rbox(0.06, 0.25, 0.05, 0.02), mat('#eabb75', { metalness: 0.8 }), -0.22, 0.42, 0.37); for (let i = 0; i < 3; i++) add(g, new T.CylinderGeometry(0.08, 0.08, 0.03, 18), mat('#eabb75', { metalness: 0.8, roughness: 0.3 }), -0.1 + i * 0.05, 0.82 + i * 0.03, 0); return [0.75, 0.7]; },
  globe(g, c) { add(g, new T.CylinderGeometry(0.18, 0.22, 0.08, 20), mat('#5a4430'), 0, 0.04, 0); add(g, rbox(0.05, 0.75, 0.05, 0.01), mat('#eabb75', { metalness: 0.7 }), 0, 0.42, 0); const globe = add(g, new T.SphereGeometry(0.3, 24, 16), mat(c, { roughness: 0.5 }), 0, 1.05, 0); add(g, new T.TorusGeometry(0.34, 0.015, 8, 40), mat('#eabb75', { metalness: 0.7 }), 0, 1.05, 0, 0, 0, 0.4); g.userData.tick = t => { globe.rotation.y = t * 0.4; }; return [0.6, 0.6]; },
  easel(g, c) { for (const x of [-0.25, 0.25]) { const leg = add(g, rbox(0.04, 1.6, 0.04, 0), mat('#7a5c3a'), x, 0.8, 0); leg.rotation.z = -x * 0.25; } add(g, rbox(0.04, 1.4, 0.04, 0), mat('#7a5c3a'), 0, 0.7, -0.3, 0.35); add(g, rbox(0.75, 0.6, 0.03, 0.01), mat('#efe6d4'), 0, 1.2, 0.05, -0.12); add(g, new T.CircleGeometry(0.16, 20), mat(c), -0.1, 1.24, 0.08, -0.12); add(g, rbox(0.3, 0.06, 0.02, 0.01), mat('#3f6b4c'), 0.12, 1.08, 0.08, -0.12); return [0.8, 0.7]; },
  clock(g, c) { add(g, rbox(0.55, 2, 0.4, 0.04), mat('#4a3a28'), 0, 1, 0); add(g, new T.CircleGeometry(0.2, 32), mat('#efe6d4'), 0, 1.55, 0.21); const hand = add(g, rbox(0.015, 0.16, 0.01, 0), mat('#222'), 0, 1.55, 0.22); const pendulum = add(g, rbox(0.03, 0.5, 0.02, 0), mat('#eabb75', { metalness: 0.7 }), 0, 0.85, 0.2); g.userData.tick = t => { hand.rotation.z = -t * 0.5; pendulum.rotation.z = Math.sin(t * 3) * 0.25; }; return [0.55, 0.4]; },
  arcade(g, c) { add(g, rbox(0.7, 1.7, 0.6, 0.04), mat('#25212e'), 0, 0.85, 0); const screen = add(g, rbox(0.52, 0.42, 0.02, 0), new T.MeshStandardMaterial({ color: '#111', emissive: c, emissiveIntensity: 1.1 }), 0, 1.25, 0.31, -0.2); add(g, rbox(0.6, 0.06, 0.25, 0.02), mat('#3a3346'), 0, 0.95, 0.38); add(g, new T.SphereGeometry(0.04, 10, 8), mat('#ff4d4d'), -0.12, 1.0, 0.42); g.userData.tick = t => { screen.material.emissiveIntensity = 0.8 + Math.sin(t * 7) * 0.3; }; return [0.7, 0.75]; },
  plant(g, c) { add(g, new T.CylinderGeometry(0.28, 0.22, 0.45, 18), mat('#8a6c54'), 0, 0.22, 0); for (let i = 0; i < 9; i++) { const a = i * 2.399, h = 0.6 + (i % 4) * 0.15; const leaf = add(g, new T.SphereGeometry(0.2, 12, 8), mat(i % 3 ? '#3d674d' : '#62896a'), Math.cos(a) * 0.25, h, Math.sin(a) * 0.25, 0.3, a, -Math.cos(a) * 0.5, [0.6, 1.4, 0.2]); leaf.castShadow = true; } return [0.6, 0.6]; },
  aquarium(g, c) { add(g, rbox(1.1, 0.6, 0.5, 0.03), mat('#2a2c32'), 0, 0.3, 0); add(g, rbox(1.05, 0.55, 0.45, 0.02), new T.MeshStandardMaterial({ color: '#3d7fa6', transparent: true, opacity: 0.45, roughness: 0.1, emissive: '#14435c', emissiveIntensity: 0.6 }), 0, 0.88, 0); const fish = [0, 1, 2].map(i => add(g, new T.SphereGeometry(0.05, 8, 6), mat(i ? c : '#ffb27a', { emissive: c, emissiveIntensity: 0.3 }), 0, 0.85, 0, 0, 0, 0, [1.6, 1, 0.6])); g.userData.tick = t => fish.forEach((f, i) => { f.position.set(Math.sin(t * 0.6 + i * 2) * 0.38, 0.8 + i * 0.08, Math.cos(t * 0.9 + i) * 0.12); f.rotation.y = Math.cos(t * 0.6 + i * 2) > 0 ? 0 : Math.PI; }); return [1.1, 0.5]; },
  telescope(g, c) { for (let i = 0; i < 3; i++) { const a = i * TAU / 3, leg = add(g, rbox(0.035, 1.1, 0.035, 0), mat('#2a2c32'), Math.cos(a) * 0.2, 0.52, Math.sin(a) * 0.2); leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); } add(g, new T.CylinderGeometry(0.09, 0.07, 0.9, 18), mat('#efe6d4'), 0.1, 1.25, -0.05, 0.7, 0, -0.5); add(g, new T.CylinderGeometry(0.1, 0.1, 0.05, 18), mat(c), 0.32, 1.45, -0.3, 0.7, 0, -0.5); return [0.6, 0.6]; },
  lamp(g, c) { add(g, new T.CylinderGeometry(0.2, 0.22, 0.04, 20), mat('#24272e'), 0, 0.02, 0); add(g, rbox(0.03, 1.7, 0.03, 0), mat('#eabb75', { metalness: 0.7 }), 0, 0.85, 0); add(g, new T.ConeGeometry(0.3, 0.32, 24, 1, true), mat('#cfb68a', { side: T.DoubleSide }), 0, 1.75, 0); const bulb = add(g, new T.SphereGeometry(0.08, 10, 8), new T.MeshStandardMaterial({ color: '#ffe3b0', emissive: '#ffcf8a', emissiveIntensity: 2 }), 0, 1.65, 0); bulb.castShadow = false; const l = new T.PointLight('#ffc886', 3, 4, 2); l.position.set(0, 1.6, 0); g.add(l); return [0.5, 0.5]; }
};
function add(g, geometry, material, x, y, z, rx = 0, ry = 0, rz = 0, scale) { const m = new T.Mesh(geometry, material); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); if (scale) m.scale.set(...scale); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }

function desk(g, c) {
  const wood = mat('#8a6a48', { roughness: 0.5 });
  add(g, rbox(1.9, 0.12, 0.9, 0.04), wood, 0, 1.0, 0); for (const x of [-0.85, 0.85]) add(g, rbox(0.08, 0.98, 0.8, 0.02), mat('#3a2e22'), x, 0.49, 0);
  add(g, rbox(0.1, 0.32, 0.1, 0.02), mat('#3a3d44'), 0, 1.22, -0.25);
  add(g, rbox(1.05, 0.62, 0.07, 0.04), mat('#16181d'), 0, 1.62, -0.27);
  const screen = add(g, new T.PlaneGeometry(0.95, 0.52), new T.MeshStandardMaterial({ color: '#0e0f12', emissive: c, emissiveIntensity: 0.05 }), 0, 1.62, -0.232);
  add(g, rbox(0.7, 0.03, 0.22, 0.01), mat('#44434a'), 0, 1.08, 0.12);
  // Chair, on the open side, where the bot sits.
  add(g, new T.CylinderGeometry(0.06, 0.06, 0.45, 12), mat('#3a3d44'), 0, 0.3, 0.95); add(g, rbox(0.66, 0.14, 0.62, 0.06), mat('#4b4754'), 0, 0.6, 0.95); add(g, rbox(0.62, 0.4, 0.12, 0.05), mat('#45424d'), 0, 0.88, 1.27);
  return screen;
}
function beanbag(g, c) { const m = add(g, new T.SphereGeometry(0.55, 24, 16), mat(c, { roughness: 0.95 }), 0, 0.32, 0, 0, 0, 0, [1.15, 0.6, 1.05]); add(g, new T.SphereGeometry(0.35, 18, 12), mat(c, { roughness: 0.95 }), 0, 0.52, -0.32, 0, 0, 0, [1.3, 0.9, 0.6]); return m; }

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * The whole floor, built from the app's rooms: rooms of different sizes (they grow with their members), side by side in
 * rows, joined by doors in the shared walls and by a hall below each row and a corridor along the west side, all on one
 * floating slab. `infos` are { id, name, members, lobby } in the order the rooms were made. The room's id is its seed.
 */
export function buildBuilding(scene, infos) {
  const SPINE = 2.4, HALL = 2.4, STEP = 0.25, DOOR = 1.8;
  const rooms = infos.map(info => { const r = rng(hashStr('sala#' + info.id)), n = Math.max(1, info.members.length);
    const W = clamp(8 + n * 0.8, 9, 17), perRow = Math.max(1, Math.floor((W - 3.2) / 2.6));
    return { ...info, n, r, W, D: Math.max(9, 3.3 * Math.ceil(n / perRow) + 5.6) }; });
  // Rows: left to right until the row gets as wide as a loose square of all the rooms.
  const area = rooms.reduce((s, r) => s + r.W * r.D, 0), target = Math.max(15, Math.sqrt(area) * 1.55), rows = []; let row = null;
  for (const room of rooms) { if (!row || (row.w + room.W > target && row.rooms.length)) rows.push(row = { rooms: [], w: 0, d: 0 }); row.rooms.push(room); row.w += room.W; row.d = Math.max(row.d, room.D); }
  let z0 = 0; const rects = [];   // walkable rectangles [x0, z0, x1, z1]
  for (const rw of rows) {
    let x = SPINE; rw.z0 = z0;
    for (const room of rw.rooms) { room.x0 = x; room.z0 = z0; room.x1 = x + room.W; room.z1 = z0 + room.D; room.cx = x + room.W / 2; room.cz = z0 + room.D / 2; x += room.W; rects.push([room.x0, room.z0, room.x1, room.z1]); rects.push([room.x0, room.z1, room.x1, z0 + rw.d + HALL]); }
    rw.bottom = z0 + rw.d + HALL; z0 = rw.bottom;
  }
  const bottom = z0, right = Math.max(...rows.map(rw => SPINE + rw.w)); rects.push([0, 0, SPINE, bottom]);
  // Doors: one in each room's south wall (into the hall) and one in every shared wall between neighbors.
  for (const rw of rows) rw.rooms.forEach((room, i) => {
    const r = room.r; room.southDoor = clamp(room.cx + (r() - 0.5) * (room.W - 4), room.x0 + 1.6, room.x1 - 1.6); room.doors = [];
    const next = rw.rooms[i + 1]; if (next) { const zc = Math.min(room.z1, next.z1) - 1.7 - r() * 1.2; room.eastDoor = next.westDoor = zc; }
  });
  const root = new T.Group(); scene.add(root);
  const wood = mat('#6a4f36', { roughness: 0.55 });

  // ---- floor slab under every walkable rectangle, with a warm rim, and rocks floating below
  const floorTex = (a, b, rep) => { const c = document.createElement('canvas'); c.width = c.height = 256; const q = c.getContext('2d'); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { q.fillStyle = j % 2 ? a : b; q.fillRect(i * 64, j * 64, 64, 64); } q.strokeStyle = 'rgba(255,255,255,.05)'; q.lineWidth = 2; for (let i = 0; i <= 4; i++) { q.beginPath(); q.moveTo(i * 64, 0); q.lineTo(i * 64, 256); q.moveTo(0, i * 64); q.lineTo(256, i * 64); q.stroke(); } const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.colorSpace = T.SRGBColorSpace; return t; };
  const textures = [];
  const slab = (x0, z0, x1, z1, tex, tint) => { const w = x1 - x0, d = z1 - z0; add(root, rbox(w + 0.1, 0.55, d + 0.1, 0.1), mat('#22242b'), (x0 + x1) / 2, -0.3, (z0 + z1) / 2);
    const f = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshStandardMaterial({ map: tex, roughness: 0.6, color: tint || '#fff' })); f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2); f.receiveShadow = true; root.add(f); };
  for (const room of rooms) { const r = room.r, a = ['#797e79', '#878074', '#76818a', '#817d8a'][Math.floor(r() * 4)], b = new T.Color(a).offsetHSL(0, 0, -0.008).getStyle(); const tex = floorTex(a, b, [room.W / 3.2, room.D / 3.2]); textures.push(tex); room.floorTex = tex; slab(room.x0, room.z0, room.x1, room.z1, tex); }
  const hallTex = floorTex('#34363e', '#2f3138', [1, 1]); textures.push(hallTex);
  for (const rw of rows) for (const room of rw.rooms) { hallTex.repeat.set(room.W / 3.2, 0.8); slab(room.x0, room.z1, room.x1, rw.bottom, hallTex, '#cfd2da'); }
  slab(0, 0, SPINE, bottom, hallTex, '#cfd2da');
  // Warm rim along the outer edge of the whole slab (south and east, the visible sides).
  const rim = mat('#ffd393', { emissive: '#ffb55b', emissiveIntensity: 1.2 });
  add(root, rbox(right, 0.05, 0.08, 0.01), rim, right / 2, -0.52, bottom + 0.05); add(root, rbox(0.08, 0.05, bottom, 0.01), rim, right + 0.05, -0.52, bottom / 2);
  { const r = rng(7731); for (let i = 0; i < 6 + rooms.length * 2; i++) { const o = add(root, new T.DodecahedronGeometry(0.5 + r() * 1.1, 0), mat(i % 2 ? '#25262e' : '#39343b', { roughness: 1 }), r() * right, -1 - r() * 1.4, r() * bottom, r(), r(), r()); o.scale.y = 0.9 + r() * 1.4; } }

  // ---- walls: north (tall) and west (tall) of every room, south (low) with a door, and a short wall between the hall and the spine
  const solids = [];   // [x0, z0, x1, z1] wall rectangles, for the walking grid
  const T_ = 0.2;
  const wall = (x0, z0, x1, z1, height, color, gaps = [], axis) => {
    // axis 'x': wall runs along x at z = z0; axis 'z': along z at x = x0. gaps: [center, width] along the wall.
    const a = axis === 'x' ? x0 : z0, b = axis === 'x' ? x1 : z1, sorted = gaps.slice().sort((p, q) => p[0] - q[0]); let cur = a;
    const piece = (s, e) => { if (e - s < 0.02) return; const len = e - s, c = (s + e) / 2; if (axis === 'x') { add(root, rbox(len, height, T_, 0.02), mat(color), c, height / 2, z0); solids.push([s, z0 - T_ / 2, e, z0 + T_ / 2]); } else { add(root, rbox(T_, height, len, 0.02), mat(color), x0, height / 2, c); solids.push([x0 - T_ / 2, s, x0 + T_ / 2, e]); } };
    for (const [c, w] of sorted) { piece(cur, c - w / 2); cur = c + w / 2; } piece(cur, b);
    // trim along the top
    if (height > 2) { const len = b - a; if (axis === 'x') add(root, rbox(len, 0.1, T_ + 0.1, 0.01), wood, (a + b) / 2, height + 0.05, z0); else add(root, rbox(T_ + 0.1, 0.1, len, 0.01), wood, x0, height + 0.05, (a + b) / 2); }
  };
  const frames = [];
  const doorFrame = (x, z, axis, lit) => { const m = new T.MeshStandardMaterial({ color: '#ffd393', emissive: '#ffb55b', emissiveIntensity: 0.4, roughness: 0.5 }); if (lit) frames.push({ m, room: lit });
    if (axis === 'x') { for (const dx of [-DOOR / 2, DOOR / 2]) add(root, rbox(0.08, 2.3, 0.28, 0.01), m, x + dx, 1.15, z); add(root, rbox(DOOR + 0.1, 0.08, 0.28, 0.01), m, x, 2.3, z); } else { for (const dz of [-DOOR / 2, DOOR / 2]) add(root, rbox(0.28, 2.3, 0.08, 0.01), m, x, 1.15, z + dz); add(root, rbox(0.28, 0.08, DOOR + 0.1, 0.01), m, x, 2.3, z); } };
  for (const rw of rows) rw.rooms.forEach((room, i) => {
    const r = room.r, wallC = new T.Color().setHSL((specHue(room) % 360) / 360, 0.08 + r() * 0.08, 0.36 + r() * 0.04).getStyle(); room.wallC = wallC;
    wall(room.x0, room.z0, room.x1, room.z0, 3.2, wallC, [], 'x');                                       // north
    wall(room.x0, room.z0, room.x0, room.z1, 3.2, wallC, room.westDoor != null ? [[room.westDoor, DOOR]] : [], 'z');   // west
    wall(room.x0, room.z1, room.x1, room.z1, 0.95, wallC, [[room.southDoor, DOOR]], 'x');               // south, low
    wall(room.x0, room.z1 - 0.05, room.x1, room.z1 - 0.05, 0.05, '#4a3a28', [[room.southDoor, DOOR]], 'x');
    doorFrame(room.southDoor, room.z1, 'x', room);
    if (room.westDoor != null) doorFrame(room.x0, room.westDoor, 'z', null);
    // a window on the north wall, looking at the stars, tinted by the room's color
    const win = document.createElement('canvas'); win.width = 256; win.height = 128; { const q = win.getContext('2d'), h = specHue(room); q.fillStyle = '#080b16'; q.fillRect(0, 0, 256, 128); const gr = q.createRadialGradient(190, 30, 4, 190, 30, 150); gr.addColorStop(0, `hsl(${h},35%,26%)`); gr.addColorStop(1, '#0b0d19'); q.fillStyle = gr; q.fillRect(0, 0, 256, 128); for (let k = 0; k < 50; k++) { q.fillStyle = `rgba(235,232,255,${0.3 + r() * 0.7})`; q.fillRect(r() * 256, r() * 128, 1.5, 1.5); } }
    const wt = new T.CanvasTexture(win); wt.colorSpace = T.SRGBColorSpace; textures.push(wt); const wx = room.x1 - 2.2 - r() * Math.max(0, room.W - 6) * 0.4;
    add(root, rbox(2.6, 1.4, 0.1, 0.04), mat('#1b1d22'), wx, 2.2, room.z0 + 0.16); const pane = new T.Mesh(new T.PlaneGeometry(2.4, 1.2), new T.MeshBasicMaterial({ map: wt })); pane.position.set(wx, 2.2, room.z0 + 0.23); root.add(pane);
  });
  function specHue(room) { const hs = room.members.map(b => specFromFace(b.face, b.name || b.id).hue); return hs.length ? hs[Math.floor(room.r() * hs.length)] : 35; }
  // the corridor's west wall and the hall's south edge stay open (the camera looks at them)
  wall(0, 0, 0, bottom, 3.2, '#2c2e35', [], 'z'); wall(0, 0, SPINE, 0, 3.2, '#2c2e35', [], 'x');

  // ---- the walking grid of the whole floor
  const gx0 = -1, gz0 = -1, nx = Math.ceil((right + 2) / STEP), nz = Math.ceil((bottom + 2) / STEP), free = new Uint8Array(nx * nz), solid = new Uint8Array(nx * nz);
  const cellOf = (x, z) => [Math.round((x - gx0) / STEP), Math.round((z - gz0) / STEP)];
  for (const [a, b, c, d] of rects) { const [i0, j0] = cellOf(a, b), [i1, j1] = cellOf(c, d); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && j >= 0 && i < nx && j < nz) free[j * nx + i] = 1; }
  const stamp = (x0, z0, x1, z1) => { const [i0, j0] = cellOf(x0, z0), [i1, j1] = cellOf(x1, z1); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && j >= 0 && i < nx && j < nz) solid[j * nx + i] = 1; };
  for (const s of solids) stamp(...s);

  // ---- each room's furniture (the decoration is a function of the room's seed and who is in it)
  const entries = new Map();
  for (const room of rooms) {
    const r = room.r, g = new T.Group(); g.position.set(room.cx, 0, room.cz); root.add(g);
    const W = room.W, D = room.D, members = room.members, hues = members.map(b => specFromFace(b.face, b.name || b.id).hue), accent = hues.length ? hues[Math.floor(r() * hues.length)] : 35;
    const gapsS = [room.southDoor - room.cx], gapsW = room.westDoor != null ? [room.westDoor - room.cz] : [], gapsE = room.eastDoor != null ? [room.eastDoor - room.cz] : [];
    const obstacles = [], items = [], desks = new Map(), beds = new Map(), screens = new Map(), ticks = [];
    // rug
    const rug = new T.Mesh(new T.CircleGeometry(Math.min(W, D) * 0.2, 48), mat(new T.Color().setHSL(accent / 360, 0.24, 0.32).getStyle(), { roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0.4, 0.012, D * 0.08); rug.receiveShadow = true; g.add(rug);
    const block = (x, z, w, d) => obstacles.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
    const place = (build, x, z, ry, author, color) => { const gg = new T.Group(); gg.position.set(x, 0, z); gg.rotation.y = ry; g.add(gg); const out = build(gg, color); if (gg.userData.tick) ticks.push(gg.userData.tick); items.push({ group: gg, author, x: room.cx + x, z: room.cz + z }); return out; };
    const perRow = Math.max(1, Math.floor((W - 3.2) / 2.6)), deskZ = [];
    members.forEach((bot, i) => { const row = Math.floor(i / perRow), col = i % perRow, cols = Math.min(perRow, members.length - row * perRow), x = -((cols - 1) * 2.6) / 2 + col * 2.6 - 0.3, z = -D / 2 + 1.05 + row * 3.3, color = new T.Color().setHSL(hues[i] / 360, 0.6, 0.55).getStyle();
      screens.set(bot.id, place(desk, x, z, 0, bot.id, color)); block(x, z, 2.0, 0.95); desks.set(bot.id, { pos: [room.cx + x, 0.66, room.cz + z + 0.95], yaw: Math.PI }); deskZ.push(z); });
    const deskBack = Math.max(...deskZ, -D / 2) + 1.7, slots = [], nearGap = (v, gaps, span) => gaps.some(gp => Math.abs(v - gp) < span);
    for (let x = -W / 2 + 1.1; x <= W / 2 - 1; x += 1.45) if (!nearGap(x, gapsS, 1.5)) slots.push({ x, z: D / 2 - 0.75, ry: Math.PI, edge: 'south' });
    for (let z = deskBack + 0.4; z <= D / 2 - 1.6; z += 1.4) if (!nearGap(z, gapsE, 1.4)) slots.push({ x: W / 2 - 0.75, z, ry: -Math.PI / 2, edge: 'east' });
    for (let z = deskBack + 0.2; z <= D / 2 - 1.6; z += 1.4) if (!nearGap(z, gapsW, 1.4)) slots.push({ x: -W / 2 + 0.75, z, ry: Math.PI / 2, edge: 'west' });
    const take = prefer => { const i = slots.findIndex(s => !s.used && (!prefer || s.edge === prefer)), k = i >= 0 ? i : slots.findIndex(s => !s.used); if (k < 0) return null; slots[k].used = true; return slots[k]; };
    members.forEach((bot, i) => { const s = take('south') || take(); if (!s) return; place(beanbag, s.x, s.z, s.ry, bot.id, new T.Color().setHSL(hues[i] / 360, 0.35, 0.42).getStyle()); beds.set(bot.id, { pos: [room.cx + s.x, 0.42, room.cz + s.z - 0.05], yaw: Math.PI / 2 }); });
    const things = members.map((bot, i) => ({ kind: themeOf(bot, r), author: bot.id, color: new T.Color().setHSL(hues[i] / 360, 0.55, 0.55).getStyle() }));
    for (let i = 0; i < 5; i++) things.push({ kind: ['plant', 'lamp', 'plant'][i % 3], author: null, color: '#62896a' });
    for (const thing of things) { const s = take(thing.kind === 'lamp' ? 'west' : 'east'); if (!s) break; const [w, d] = place(BUILD[thing.kind], s.x, s.z, s.ry, thing.author, thing.color); block(s.x, s.z, Math.max(w, d) + 0.1, Math.max(w, d) + 0.1); }
    // A furnished lounge in the clear band behind the workstations.
    const loungeZ = deskBack + 0.65;
    place((gg) => {
      add(gg, rbox(2.2, 0.45, 0.85, 0.14), mat('#607b78'), 0, 0.4, 0);
      add(gg, rbox(2.2, 0.65, 0.18, 0.08), mat('#6f918a'), 0, 0.85, -0.38);
      for (const x of [-1, 1]) add(gg, rbox(0.2, 0.5, 0.85, 0.08), mat('#78978e'), x, 0.65, 0);
      for (const x of [-0.55, 0.55]) add(gg, rbox(0.55, 0.32, 0.16, 0.07), mat('#e1bd83'), x, 0.85, -0.2);
    }, -W / 2 + 2.1, loungeZ, 0, null);
    block(-W / 2 + 2.1, loungeZ, 2.2, 0.9);
    place((gg) => {
      add(gg, rbox(1.25, 0.1, 0.7, 0.08), mat('#be9870'), 0, 0.5, 0);
      for (const x of [-0.45, 0.45]) add(gg, rbox(0.07, 0.45, 0.5, 0.02), mat('#384b50'), x, 0.23, 0);
      add(gg, rbox(0.32, 0.04, 0.24, 0.01), mat('#d2c7ad'), 0.2, 0.58, 0);
    }, -W / 2 + 2.1, loungeZ + 1.25, 0, null);
    block(-W / 2 + 2.1, loungeZ + 1.25, 1.25, 0.7);
    // Broad, soft room fill and architectural lighting rather than isolated hot spots.
    const fill = new T.PointLight('#ffe3bc', 14, Math.max(W, D) * 1.4, 2);
    fill.position.set(0, 4.5, 0); g.add(fill);
    add(g, rbox(W - 0.8, 0.045, 0.07, 0.01), mat('#fff0cf', { emissive: '#ffe0a4', emissiveIntensity: 1.4 }), 0, 2.95, -D / 2 + 0.15);
    add(g, rbox(1.8, 0.9, 0.08, 0.03), mat('#d2c7ad'), -W / 2 + 1.4, 2.05, -D / 2 + 0.16);
    for (let k = 0; k < 3; k++) add(g, rbox(0.28, 0.3 + k * 0.12, 0.025, 0.01), mat(['#698c89', '#d0a364', '#b47969'][k]), -W / 2 + 0.9 + k * 0.5, 2.05, -D / 2 + 0.21);
    place(BUILD.plant, W / 2 - 0.6, -D / 2 + 0.6, 0, null, '#62896a'); block(W / 2 - 0.6, -D / 2 + 0.6, 0.8, 0.8);
    for (const [a, b, c, d] of obstacles) stamp(room.cx + a, room.cz + c, room.cx + b, room.cz + d);
    entries.set(room.id, { room, items, desks, beds, screens, ticks, door: { pos: [room.southDoor, 0, room.z1 - 1.15], yaw: 0 }, obstacles });
  }
  // Dilate the solids by two cells (the bots' body) and make the grid
  const blockedCell = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let b = !free[j * nx + i] || solid[j * nx + i]; if (!b) for (let dj = -2; dj <= 2 && !b; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || !free[jj * nx + ii] || solid[jj * nx + ii]) { b = true; break; } } blockedCell[j * nx + i] = b ? 1 : 0; }
  const blocked = (x, z) => { const [i, j] = cellOf(x, z); return i < 0 || j < 0 || i >= nx || j >= nz || blockedCell[j * nx + i] === 1; };

  const nearestCache = new Map();
  const nearestFree = p => {
    if (!blocked(p[0], p[2])) return p.slice();
    const cacheKey = `${p[0]},${p[2]}`;
    if (nearestCache.has(cacheKey)) return nearestCache.get(cacheKey)?.slice() || null;
    let best = null, distance = Infinity;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (blockedCell[j * nx + i]) continue;
      const x = gx0 + i * STEP, z = gz0 + j * STEP, d = (x - p[0]) ** 2 + (z - p[2]) ** 2;
      if (d < distance) { best = [x, 0, z]; distance = d; }
    }
    if (nearestCache.size > 2048) nearestCache.clear();
    nearestCache.set(cacheKey, best);
    return best?.slice() || null;
  };
  const out = [];
  for (const [id, e] of entries) {
    const room = e.room, wander = [], r = rng(hashStr('passeio#' + id));
    for (let i = 0; i < 160 && wander.length < 8 + room.n * 3; i++) { const x = room.x0 + 0.6 + r() * (room.W - 1.2), z = room.z0 + 0.6 + r() * (room.D - 1.2); if (!blocked(x, z) && !wander.some(w => Math.hypot(w[0] - x, w[2] - z) < 1.1)) wander.push([x, 0, z]); }
    if (!wander.length) { const p = nearestFree([room.cx, 0, room.cz]); if (p) wander.push(p); }
    out.push({ id, name: room.name, lobby: room.lobby, size: [room.W, room.D], origin: [room.cx, room.cz], rect: [room.x0, room.z0, room.x1, room.z1], desks: e.desks, beds: e.beds, door: e.door, wander, items: e.items, screens: e.screens, ticks: e.ticks, building: null, doorMat: frames.find(f => f.room === room)?.m });
  }
  const hall = [Math.min(...rects.map(r => r[0])), 0, right, bottom];
  const heap = { push(h, n) { h.push(n); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p].f <= h[i].f) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }, pop(h) { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < h.length && h[l].f < h[m].f) m = l; if (r < h.length && h[r].f < h[m].f) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; } };
  // A* over the whole floor (8 neighbors, no corner cutting), then the straight stretches are pulled tight.
  function findPath(from, to) {
    if (blocked(from[0], from[2]) || blocked(to[0], to[2])) return null;
    const key = (i, j) => j * nx + i, s = cellOf(from[0], from[2]), g = cellOf(to[0], to[2]), gk = key(...g), sk = key(...s);
    const open = [{ i: s[0], j: s[1], g: 0, f: 0 }], best = new Map([[sk, 0]]), parent = new Map(); let found = false, guard = 0;
    while (open.length && guard++ < 60000) {
      const n = heap.pop(open), nk = key(n.i, n.j); if (nk === gk) { found = true; break; } if (n.g > best.get(nk)) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const i = n.i + di, j = n.j + dj, k = key(i, j);
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (blockedCell[k]) continue;
        if (di && dj && (blockedCell[key(n.i + di, n.j)] || blockedCell[key(n.i, n.j + dj)])) continue;
        const gg = n.g + Math.hypot(di, dj); if (gg >= (best.get(k) ?? Infinity)) continue;
        best.set(k, gg); parent.set(k, nk); heap.push(open, { i, j, g: gg, f: gg + Math.hypot(i - g[0], j - g[1]) });
      }
    }
    if (!found) return null;
    const pts = []; let k = gk; while (k != null && k !== sk) { pts.unshift([gx0 + (k % nx) * STEP, 0, gz0 + Math.floor(k / nx) * STEP]); k = parent.get(k); }
    pts.unshift([gx0 + s[0] * STEP, 0, gz0 + s[1] * STEP]); pts.unshift(from); pts.push(to);
    // Check every crossed grid boundary and interval; fixed sampling misses thin corners.
    const clear = (a, b) => {
      const times = [0, 1];
      for (const [axis, origin] of [[0, gx0], [2, gz0]]) {
        const delta = b[axis] - a[axis]; if (Math.abs(delta) < 1e-9) continue;
        const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
        for (let k = Math.ceil((lo - origin) / STEP - 0.5); origin + (k + 0.5) * STEP < hi; k++) {
          const t = (origin + (k + 0.5) * STEP - a[axis]) / delta; if (t > 0 && t < 1) times.push(t);
        }
      }
      times.sort((x, y) => x - y);
      const hit = t => blocked(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t);
      for (let i = 0; i < times.length; i++) if (hit(times[i]) || (i && hit((times[i - 1] + times[i]) / 2))) return false;
      return true;
    };
    const res = [pts[0]]; let a = 0; while (a < pts.length - 1) { let b = pts.length - 1; while (b > a + 1 && !clear(pts[a], pts[b])) b--; res.push(pts[b]); a = b; } return res;
  }
  const roomAt = (x, z) => out.find(r => x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) || null;
  function update(t, working, waiting) {
    for (const room of out) { for (const tick of room.ticks) tick(t); for (const [botId, screen] of room.screens) { const on = working.has(botId); screen.material.emissiveIntensity = on ? 0.55 + Math.sin(t * 9 + botId.length) * 0.06 : 0.04; } if (room.doorMat) room.doorMat.emissiveIntensity = waiting.has(room.id) ? 1.6 + Math.sin(t * 5) * 0.5 : 0.4; }
  }
  function dispose() { scene.remove(root); for (const t of textures) t.dispose(); }
  return { rooms: out, bounds: [0, 0, right, bottom], blocked, nearestFree, findPath, roomAt, update, dispose, root };
}
