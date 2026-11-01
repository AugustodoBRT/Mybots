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

/** Builds one room. `members` are the app's bots in it. Returns the spots the engine walks the bots to, and the obstacles. */
export function buildRoom(scene, { id, name, members, origin = [0, 0], lobby = false }) {
  const r = rng(hashStr('sala#' + id)), n = Math.max(1, members.length);
  const W = Math.min(17, Math.max(8.5, 6.5 + n * 1.55)), D = Math.min(13, Math.max(7.5, 6 + n * 0.85));
  const root = new T.Group(); root.position.set(origin[0], 0, origin[1]); scene.add(root);
  const hues = members.map(b => specFromFace(b.face, b.name || b.id).hue);
  const accent = hues.length ? hues[Math.floor(r() * hues.length)] : 35;
  const floorA = ['#2b2d33', '#2e2a27', '#272a2e', '#2c2a31'][Math.floor(r() * 4)], floorB = new T.Color(floorA).offsetHSL(0, 0, -0.025).getStyle();
  const wallC = new T.Color().setHSL(accent / 360, 0.08 + r() * 0.08, 0.2 + r() * 0.04).getStyle();
  // Floor slab with an amber rim, checker tiles, and rocks floating under it.
  add(root, rbox(W + 0.4, 0.55, D + 0.4, 0.12), mat('#22242b'), 0, -0.3, 0); add(root, rbox(W + 0.5, 0.04, D + 0.5, 0.01), mat('#ffd393', { emissive: '#ffb55b', emissiveIntensity: 1.2 }), 0, -0.52, 0);
  const tiles = document.createElement('canvas'); tiles.width = tiles.height = 256; { const q = tiles.getContext('2d'); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { q.fillStyle = (i + j) % 2 ? floorA : floorB; q.fillRect(i * 64, j * 64, 64, 64); } q.strokeStyle = 'rgba(255,255,255,.05)'; q.lineWidth = 2; for (let i = 0; i <= 4; i++) { q.beginPath(); q.moveTo(i * 64, 0); q.lineTo(i * 64, 256); q.moveTo(0, i * 64); q.lineTo(256, i * 64); q.stroke(); } }
  const tex = new T.CanvasTexture(tiles); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(W / 3.2, D / 3.2); tex.colorSpace = T.SRGBColorSpace;
  const floor = new T.Mesh(new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ map: tex, roughness: 0.6 })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; floor.receiveShadow = true; root.add(floor);
  for (let i = 0; i < 8; i++) { const o = add(root, new T.DodecahedronGeometry(0.4 + r() * 0.6, 0), mat(i % 2 ? '#25262e' : '#39343b', { roughness: 1 }), (r() - 0.5) * (W - 1), -0.9 - r() * 0.8, (r() - 0.5) * (D - 1), r(), r(), r()); o.scale.y = 0.8 + r(); }
  // Walls (north and west), with wooden rails, and a window to space on the north wall.
  const wood = mat('#6a4f36', { roughness: 0.55 });
  add(root, rbox(W + 0.4, 3.2, 0.18, 0.03), mat(wallC), 0, 1.6, -D / 2 - 0.09); add(root, rbox(0.18, 3.2, D + 0.4, 0.03), mat(wallC), -W / 2 - 0.09, 1.6, 0);
  add(root, rbox(W + 0.4, 0.12, 0.26, 0.02), wood, 0, 3.24, -D / 2 - 0.05); add(root, rbox(0.26, 0.12, D + 0.4, 0.02), wood, -W / 2 - 0.05, 3.24, 0);
  add(root, rbox(W, 0.1, 0.12, 0.01), wood, 0, 0.1, -D / 2 + 0.03); add(root, rbox(0.12, 0.1, D, 0.01), wood, -W / 2 + 0.03, 0.1, 0);
  const win = document.createElement('canvas'); win.width = 256; win.height = 128; { const q = win.getContext('2d'); q.fillStyle = '#080b16'; q.fillRect(0, 0, 256, 128); const gr = q.createRadialGradient(190, 30, 4, 190, 30, 150); gr.addColorStop(0, `hsl(${accent},35%,26%)`); gr.addColorStop(1, '#0b0d19'); q.fillStyle = gr; q.fillRect(0, 0, 256, 128); for (let i = 0; i < 50; i++) { q.fillStyle = `rgba(235,232,255,${0.3 + r() * 0.7})`; q.fillRect(r() * 256, r() * 128, 1.5, 1.5); } }
  const wt = new T.CanvasTexture(win); wt.colorSpace = T.SRGBColorSpace; const wx = W / 2 - 2.2;
  add(root, rbox(2.6, 1.4, 0.1, 0.04), mat('#1b1d22'), wx, 2.2, -D / 2 + 0.02); const pane = new T.Mesh(new T.PlaneGeometry(2.4, 1.2), new T.MeshBasicMaterial({ map: wt })); pane.position.set(wx, 2.2, -D / 2 + 0.08); root.add(pane);
  // The approval door on the west wall: where a bot waits for you.
  const doorZ = D / 2 - 1.6;
  add(root, rbox(0.08, 2.3, 1.1, 0.04), mat('#191d27'), -W / 2 + 0.05, 1.15, doorZ); const frameM = mat('#ffd393', { emissive: '#ffb55b', emissiveIntensity: 0.6 });
  for (const dz of [-0.55, 0.55]) add(root, rbox(0.06, 2.3, 0.05, 0.01), frameM, -W / 2 + 0.1, 1.15, doorZ + dz); add(root, rbox(0.06, 0.05, 1.15, 0.01), frameM, -W / 2 + 0.1, 2.3, doorZ);
  // Rug in the room's color.
  const rug = new T.Mesh(new T.CircleGeometry(Math.min(W, D) * 0.22, 64), mat(new T.Color().setHSL(accent / 360, 0.28, 0.15).getStyle(), { roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0.6, 0.012, D * 0.12); rug.receiveShadow = true; root.add(rug);

  const obstacles = [], items = [], desks = new Map(), beds = new Map(), screens = new Map(), ticks = [];
  const block = (x, z, w, d) => obstacles.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
  const place = (build, x, z, ry, author, color) => { const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; root.add(g); const out = build(g, color); if (g.userData.tick) ticks.push(g.userData.tick); items.push({ group: g, author, x, z }); return out; };
  // Desks along the north wall (two rows if needed), each with its bot's color on the screen.
  const perRow = Math.max(1, Math.floor((W - 3.2) / 2.3)), deskOf = [];
  members.forEach((bot, i) => {
    const row = Math.floor(i / perRow), col = i % perRow, cols = Math.min(perRow, members.length - row * perRow);
    const x = -((cols - 1) * 2.3) / 2 + col * 2.3 - 0.4, z = -D / 2 + 1.05 + row * 2.9;
    const color = new T.Color().setHSL(hues[i] / 360, 0.6, 0.55).getStyle();
    const screen = place(desk, x, z, 0, bot.id, color); screens.set(bot.id, screen);
    block(x, z, 2.0, 0.95); block(x, z + 0.95, 0.75, 0.7); desks.set(bot.id, { pos: [x, 0.66, z + 0.95], yaw: Math.PI });
    deskOf.push(z);
  });
  const deskBack = Math.max(...deskOf, -D / 2) + 1.6;
  // Slots along the edges (west wall south of the desks, east and south edges) for beanbags and decor.
  const slots = [];
  for (let x = -W / 2 + 2.4; x <= W / 2 - 1; x += 1.45) slots.push({ x, z: D / 2 - 0.75, ry: Math.PI, edge: 'south' });
  for (let z = deskBack + 0.4; z <= D / 2 - 1.5; z += 1.4) slots.push({ x: W / 2 - 0.75, z, ry: -Math.PI / 2, edge: 'east' });
  for (let z = deskBack + 0.2; z <= doorZ - 1.2; z += 1.4) slots.push({ x: -W / 2 + 0.75, z, ry: Math.PI / 2, edge: 'west' });
  const take = prefer => { const i = slots.findIndex(s => !s.used && (!prefer || s.edge === prefer)); const k = i >= 0 ? i : slots.findIndex(s => !s.used); if (k < 0) return null; slots[k].used = true; return slots[k]; };
  // A beanbag for each bot, in its color: where it sleeps when it is disconnected.
  members.forEach((bot, i) => { const s = take('south'); if (!s) return; const color = new T.Color().setHSL(hues[i] / 360, 0.35, 0.42).getStyle(); place(beanbag, s.x, s.z, s.ry, bot.id, color); block(s.x, s.z, 1.2, 1.1); beds.set(bot.id, { pos: [s.x, 0.42, s.z - 0.05], yaw: Math.PI / 2 }); });
  // What each bot brings, then a few things of the room's own.
  const things = members.map((bot, i) => ({ kind: themeOf(bot, r), author: bot.id, color: new T.Color().setHSL(hues[i] / 360, 0.55, 0.55).getStyle() }));
  for (let i = 0; i < 2 + Math.floor(r() * 2); i++) things.push({ kind: ['plant', 'lamp', 'plant'][i % 3], author: null, color: '#62896a' });
  for (const thing of things) { const s = take(thing.kind === 'lamp' ? 'west' : 'east'); if (!s) break; const [w, d] = BUILD[thing.kind](new T.Group(), thing.color); place(BUILD[thing.kind], s.x, s.z, s.ry, thing.author, thing.color); block(s.x, s.z, Math.max(w, d) + 0.1, Math.max(w, d) + 0.1); }
  // A plant in the free corner by the window.
  place(BUILD.plant, W / 2 - 0.6, -D / 2 + 0.6, 0, null, '#62896a'); block(W / 2 - 0.6, -D / 2 + 0.6, 0.8, 0.8);

  const bounds = [-W / 2 + 0.45, W / 2 - 0.45, -D / 2 + 0.45, D / 2 - 0.45];
  const blocked = (x, z) => x < bounds[0] || x > bounds[1] || z < bounds[2] || z > bounds[3] || obstacles.some(b => x > b[0] - 0.32 && x < b[1] + 0.32 && z > b[2] - 0.32 && z < b[3] + 0.32);
  const door = { pos: [-W / 2 + 0.95, 0, doorZ], yaw: -Math.PI / 2 };
  const wander = []; for (let i = 0; i < 120 && wander.length < 10 + n * 3; i++) { const x = (r() - 0.5) * (W - 2), z = (r() - 0.5) * (D - 2); if (!blocked(x, z) && !wander.some(w => Math.hypot(w[0] - x, w[2] - z) < 1.1)) wander.push([x, 0, z]); }
  if (!wander.length) wander.push([0, 0, D * 0.12]);
  function update(t, working) { for (const tick of ticks) tick(t); for (const [botId, screen] of screens) { const on = working.has(botId); screen.material.emissiveIntensity = on ? 0.55 + Math.sin(t * 9 + botId.length) * 0.06 : 0.04; } }
  // Shared geometries and materials stay cached for the next rooms; only this room's textures are freed.
  function dispose() { scene.remove(root); tex.dispose(); wt.dispose(); }
  return { id, name, lobby, root, size: [W, D], origin, desks, beds, door, wander, blocked, items, update, dispose };
}

// A* on a 0.25 grid in the room's local coordinates, with corners cut where the straight line is free.
export function findPath(room, from, to) {
  const STEP = 0.25, key = (x, z) => x + ',' + z, cell = p => [Math.round(p[0] / STEP), Math.round(p[2] / STEP)];
  const start = cell(from), goal = cell(to), gk = key(...goal), sk = key(...start);
  const open = [{ x: start[0], z: start[1], g: 0, f: 0 }], best = new Map([[sk, 0]]), parent = new Map(); let found = false, guard = 0;
  while (open.length && guard++ < 6000) {
    open.sort((a, b) => a.f - b.f); const n = open.shift(), nk = key(n.x, n.z); if (nk === gk) { found = true; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = n.x + dx, z = n.z + dz, k = key(x, z);
      if (k !== gk && room.blocked(x * STEP, z * STEP)) continue;
      const g = n.g + Math.hypot(dx, dz); if (g >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g); parent.set(k, nk); open.push({ x, z, g, f: g + Math.hypot(x - goal[0], z - goal[1]) });
    }
  }
  if (!found) return [from, to];
  const pts = []; let k = gk; while (k && k !== sk) { const [x, z] = k.split(',').map(Number); pts.unshift([x * STEP, 0, z * STEP]); k = parent.get(k); }
  pts.unshift(from); pts[pts.length - 1] = to;
  const free = (a, b) => { const d = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.ceil(d / 0.1); for (let i = 1; i < n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, z = a[2] + (b[2] - a[2]) * i / n; if (room.blocked(x, z)) return false; } return true; };
  const out = [pts[0]]; let i = 0; while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !free(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
  return out;
}
