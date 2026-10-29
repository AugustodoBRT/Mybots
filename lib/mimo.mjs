// Bots as a cloud of particles (the "Mimo" style): a dense body whose eyes and mouth are empty spaces opened by force fields.
// Pure (no DOM, no canvas): `Mimo.update` moves the expression and the clock, `Mimo.compute` gives the screen position of every
// particle, grouped in color buckets, ready for a painter (lib/mimo-canvas.mjs on the web, MimoPaint.kt on the phone).
// The same seed always gives the same body, at any particle count. Written to be ported to Kotlin line by line (MimoSim.kt).
export const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, k) => a + (b - a) * k, smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };

export function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let s = (seed >>> 0) % 2147483646 + 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/* ---------- the catalogue: colors, eyes, mouths, tops ---------- */
// The colors a bot can wear (what the app stores is the hex); the old four color names still map to them.
export const FACE_COLORS = [['#8FA6FF', 'Pervinca'], ['#34C9A8', 'Água'], ['#B58CFF', 'Violeta'], ['#FFB27A', 'Pêssego'], ['#FF8FB1', 'Rosa'], ['#B7C86A', 'Oliva'], ['#F2C14E', 'Sol'], ['#FF7B67', 'Coral']];
export const HUES = { green: '#34C9A8', blue: '#8FA6FF', purple: '#B58CFF', orange: '#FFB27A' };
export const PALETTE = FACE_COLORS.map(([hex, name]) => [name, hueOfHex(hex)]);
export const EYE_STYLES = { oval: ['Oval', 0.17, 0.27], redondo: ['Redondo', 0.21, 0.21], barra: ['Barra', 0.25, 0.085], pequeno: ['Pequeno', 0.10, 0.13], grande: ['Grande', 0.25, 0.34] };
export const MOUTHS = { nenhuma: 'Sem boca', pequena: 'Pequena', sorriso: 'Sorriso', larga: 'Sorrisão', redonda: 'Redonda', dentes: 'Dentuça', gato: 'De gato' };
export const TOPS = { nada: 'Sem enfeite', gato: 'Orelhas de gato', redonda: 'Orelhas redondas' };
const TOP_FRAC = { nada: 0, gato: 0.09, redonda: 0.09 }, TOP_EXT = { nada: [1, 1], gato: [0.95, 1.62], redonda: [0.95, 1.28] };
// what a face may override (ranges are what the pickers offer)
export const LIMITS = { squar: [2.4, 8], sx: [0.8, 1.3], sy: [0.8, 1.25], eyeGap: [0.7, 1.35] };

/* Each name becomes a body: the shape (ball to cube), the proportions, the eyes, the mouth, the top and the color. */
export function specFromSeed(seed) {
  seed = String(seed || 'bot'); const r = rng(hashStr(seed + '#mimo')), pick = a => a[Math.floor(r() * a.length)], fix = (v, n = 2) => +v.toFixed(n);
  const eyes = r() < 0.72 ? 2 : (r() < 0.55 ? 1 : 3);
  return { seed, hue: PALETTE[Math.floor(r() * PALETTE.length)][1], squar: fix(lerp(2.6, 7.4, r())), sx: fix(lerp(0.86, 1.24, r())), sy: fix(lerp(0.84, 1.2, r())), sz: fix(lerp(0.8, 1.05, r())),
    eyes, eyeStyle: pick(Object.keys(EYE_STYLES)), eyeGap: fix(lerp(0.82, 1.22, r())), eyeY: fix(lerp(-0.23, -0.07, r())),
    mouth: pick(['nenhuma', 'nenhuma', 'pequena', 'sorriso', 'larga', 'redonda', 'dentes', 'gato']), top: pick(['nada', 'nada', 'gato', 'redonda']), blush: r() < 0.35, dot: fix(lerp(0.92, 1.2, r())) };
}
export function hueOfHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null; const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return Math.round((h * 60 + 360) % 360);
}
// A bot's face as the app keeps it ({ seed, color: '#rrggbb', mimo: { squar, sx, sy, eyes, eyeStyle, eyeGap, mouth, top, blush } }, all but seed optional) → a full spec.
export function specFromFace(face, fallbackName) {
  const spec = specFromSeed(face?.seed || fallbackName || 'bot'); const hue = hueOfHex(face?.color); if (hue != null) spec.hue = hue;
  const o = face?.mimo; if (o && typeof o === 'object') {
    for (const k of ['squar', 'sx', 'sy', 'eyeGap']) if (Number.isFinite(o[k])) spec[k] = clamp(o[k], LIMITS[k][0], LIMITS[k][1]);
    if ([1, 2, 3].includes(o.eyes)) spec.eyes = o.eyes; if (EYE_STYLES[o.eyeStyle]) spec.eyeStyle = o.eyeStyle; if (MOUTHS[o.mouth]) spec.mouth = o.mouth; if (TOPS[o.top]) spec.top = o.top; if (typeof o.blush === 'boolean') spec.blush = o.blush;
  }
  return spec;
}
export const botSeed = bot => String(bot?.face?.seed || bot?.name || bot?.id || 'bot');
export const botColor = bot => bot?.face?.color || HUES[bot?.color] || FACE_COLORS[[...String(bot?.id || bot?.name || '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % FACE_COLORS.length][0];
export const moodFor = state => STATE_MOOD[state] || 'normal';
// A still bot for places that cannot animate it (widget, notification, share shortcuts): the body, the mood, how many particles and the sizes
// (`dp` is how large it looks, `px` the bitmap side). The phone paints it itself (MimoStill).
export function stillOf(bot, state, { px, dp }) { return { spec: specFromFace(bot?.face, bot?.name || bot?.id), mood: moodFor(state), n: particleCount(dp, false), px, dp }; }
// How many particles a face of `px` pixels is worth: enough to read the eyes, few enough to stay light in a list.
export function particleCount(px, heavy = true) { return px >= 250 ? (heavy ? 7000 : 3500) : px >= 150 ? 2400 : px >= 100 ? 1500 : px >= 70 ? 800 : px >= 50 ? 420 : px >= 36 ? 260 : 170; }

/* ---------- the particles of a body ---------- */
const cache = new Map();
function cone(r, cx, baseY, tipX, tipY, baseR, flat = 0.7) { const t = r(), rad = baseR * (1 - t) * Math.sqrt(r()), a = r() * TAU; return [lerp(cx, tipX, t) + Math.cos(a) * rad, lerp(baseY, tipY, t), Math.sin(a) * rad * flat]; }
function blob(r, cx, cy, cz, rx, ry, rz) { let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1); return [cx + x * rx, cy + y * ry, cz + z * rz]; }
function topPoint(kind, r) { const side = r() < 0.5 ? -1 : 1; return kind === 'gato' ? cone(r, side * 0.62, -0.82, side * 0.74, -1.62, 0.3) : blob(r, side * 0.64, -0.98, 0, 0.27, 0.27, 0.18); }
export function buildParticles(spec, N) {
  const key = spec.seed + '|' + spec.squar + '|' + spec.top + '|' + N; if (cache.has(key)) return cache.get(key);
  const r = rng(hashStr(spec.seed + '#corpo')), p = spec.squar, Nt = spec.top === 'nada' ? 0 : Math.round(N * TOP_FRAC[spec.top]), Nb = N - Nt, dustEvery = Math.max(1, Math.round(N / 180));
  const A = { N, Nb }; for (const k of ['x', 'y', 'z', 'bx', 'by', 'bz', 'ph', 'size', 'speed', 'ex', 'ey', 'ez', 'light']) A[k] = new Float32Array(N); A.dust = new Uint8Array(N);
  const put = (i, x, y, z, bx, by, bz) => { A.x[i] = x; A.y[i] = y; A.z[i] = z; A.bx[i] = bx; A.by[i] = by; A.bz[i] = bz; A.ph[i] = r() * TAU; A.size[i] = 0.85 + r() * 1.1; A.speed[i] = 0.5 + r() * 1.2; A.ex[i] = (r() - 0.5) * 6; A.ey[i] = (r() - 0.5) * 4.7; A.ez[i] = (r() - 0.5) * 5; A.light[i] = r(); A.dust[i] = i % dustEvery === 0 ? 1 : 0; };
  for (let i = 0; i < Nb; i++) {
    let x, y, z, m; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; m = Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p) + Math.pow(Math.abs(z), p); } while (m > 1);
    const rr = Math.hypot(x, y, z) || 1, mx = Math.pow(m, 1 / p); put(i, x, y, z, x / rr * mx * 1.1, y / rr * mx * 1.1, z / rr * mx * 1.1);
  }
  for (let i = Nb; i < N; i++) { const [x, y, z] = topPoint(spec.top, r); put(i, x, y, z, x * 0.5, y * 0.5, z * 0.5); }
  if (cache.size > 40) cache.delete(cache.keys().next().value); cache.set(key, A); return A;
}

/* ---------- expressions: each is a set of numbers that blend smoothly into one another ---------- */
export const NEUTRAL = { eo: 1, ew: 1, et: 0, ec: 0, ey: 0, look: 1, scan: 0, ax: 0, up: 0, x: 0, wink: 0, asym: 0, rest: 1, mo: 0, mw: 0.1, mh: 0.03, mc: 0, my: 0.4, talk: 0, shake: 0, hm: 0, dim: 0, en: 1, rise: 0, blush: 0, lean: 0, squash: 1, glitch: 0, hue: 0 };
const M = (label, group, over, extra = {}) => ({ label, group, p: { ...NEUTRAL, ...over }, ...extra });
export const MOODS = {
  normal: M('Parado', 'app', {}, { say: 'Só existindo.', app: 'parado' }),
  feliz: M('Feliz', 'feel', { eo: 0.16, ew: 1.1, ec: 0.13, rest: 0, mo: 1, mw: 0.24, mh: 0.05, mc: -0.105, my: 0.4, blush: 0.55 }, { say: 'Alegria que não cabe num quadrado.' }),
  curioso: M('Curioso', 'feel', { asym: 0.22, lean: 0.12, look: 1.4 }, { say: 'O que é aquilo ali?', spr: 'duvida' }),
  surpreso: M('Surpreso', 'feel', { eo: 1.3, ew: 1.25, rest: 0, mo: 1, mw: 0.105, mh: 0.14, my: 0.41 }, { say: 'Ué! Como assim?', spr: 'exclama' }),
  triste: M('Triste', 'feel', { eo: 0.7, et: -0.3, ey: 0.02, rest: 0, mo: 1, mw: 0.2, mh: 0.035, mc: 0.1, my: 0.44, dim: 0.12, squash: 0.97 }, { say: 'Hoje não foi um dia bom.', spr: 'gota' }),
  piscadela: M('Piscadela', 'feel', { wink: 1, rest: 0, mo: 1, mw: 0.2, mh: 0.04, mc: -0.1, my: 0.4, blush: 0.25 }, { say: 'Fica entre nós.' }),
  pensando: M('Pensando', 'feel', { eo: 0.8, ax: -0.55, up: -0.7, asym: 0.08, rest: 0, mo: 0.8, mw: 0.09, mh: 0.025, mc: 0, my: 0.43, lean: -0.06 }, { say: 'Deixa eu ver…', spr: 'reticencias' }),
  estressado: M('Estressado', 'feel', { eo: 0.35, et: 0.32, shake: 0.015, rest: 0, mo: 0.9, mw: 0.17, mh: 0.02, mc: 0.05, my: 0.43, en: 1.2 }, { say: 'Preciso de um minutinho…', spr: 'gota' }),
  sonolento: M('Sonolento', 'feel', { eo: 0.1, rest: 0, mo: 0.6, mw: 0.06, mh: 0.035, my: 0.42, en: 0.45, dim: 0.2, lean: 0.08 }, { say: 'Só mais cinco minutinhos.', spr: 'zzz' }),
  falando: M('Falando', 'feel', { rest: 0, mo: 1, mw: 0.12, mh: 0.05, my: 0.41, talk: 1, look: 0.6 }, { say: 'Então, deixa eu te contar…' }),
  trabalhando: M('Trabalhando', 'app', { scan: 1, look: 0.3, en: 1.9, rise: 0.9 }, { say: 'Mexendo nas coisas.', app: 'trabalhando' }),
  esperando: M('Esperando você', 'app', { eo: 1.2, ew: 1.15, rest: 0, mo: 0.85, mw: 0.08, mh: 0.08, my: 0.42, hm: 0.6, hue: 40, en: 0.9 }, { say: 'Preciso da sua decisão.', app: 'esperando você', spr: 'exclama' }),
  dormindo: M('Dormindo', 'app', { eo: 0.06, rest: 0, mo: 0.45, mw: 0.06, mh: 0.03, my: 0.42, en: 0.3, dim: 0.4, lean: 0.1, squash: 0.97, look: 0.2 }, { say: 'Zzz… o computador está desligado.', app: 'dormindo', spr: 'zzz' }),
  erro: M('Erro', 'app', { x: 1, eo: 1, shake: 0.02, glitch: 1, hm: 0.7, hue: 6, rest: 0, mo: 1, mw: 0.22, mh: 0.028, my: 0.43 }, { say: 'Algo deu errado.', app: 'erro' }),
  concluido: M('Concluído', 'app', { eo: 0.16, ew: 1.1, ec: 0.13, rest: 0, mo: 1, mw: 0.22, mh: 0.095, mc: -0.1, my: 0.4, blush: 0.5, en: 1.3 }, { say: 'Pronto! Deu certo.', app: 'concluído', spr: 'estrela', bounce: 1 }),
  domal: M('Do mal', 'app', { eo: 0.55, ew: 1.1, et: 0.52, rest: 0, mo: 1, mw: 0.31, mh: 0.075, mc: 0.13, my: 0.42, hm: 1, hue: 4, shake: 0.008, en: 1.5 }, { say: 'Eu vou me vingar. Brincadeira.', app: 'do mal' })
};
export const MOOD_NAMES = Object.keys(MOODS), FEEL = MOOD_NAMES.filter(k => MOODS[k].group === 'feel'), APPS = MOOD_NAMES.filter(k => MOODS[k].group === 'app');
// the states the app already knows → the expression that shows them
export const STATE_MOOD = { idle: 'normal', working: 'trabalhando', waiting: 'esperando', sleeping: 'dormindo', sleep: 'dormindo', error: 'erro', done: 'concluido', evil: 'domal' };

/* ---------- little drawings that rise from the head (points in a unit square, centered) ---------- */
const line = (a, b, n) => Array.from({ length: n }, (_, i) => [lerp(a[0], b[0], i / (n - 1)), lerp(a[1], b[1], i / (n - 1))]);
export const SHAPES = {
  exclama: { pts: [...line([0, -0.9], [0, 0.2], 10), ...line([0, 0.62], [0, 0.7], 3)], color: [40, 95, 58], life: 1.5, every: 1.05 },
  duvida: { pts: [...Array.from({ length: 14 }, (_, i) => { const a = lerp(-3.4, 0.9, i / 13); return [Math.cos(a) * 0.45, -0.55 + Math.sin(a) * 0.45]; }), ...line([0, -0.12], [0, 0.15], 4), ...line([0, 0.62], [0, 0.7], 3)], color: [200, 70, 66], life: 1.9, every: 2.2 },
  zzz: { pts: [...line([-0.5, -0.5], [0.5, -0.5], 8), ...line([0.5, -0.5], [-0.5, 0.5], 10), ...line([-0.5, 0.5], [0.5, 0.5], 8)], color: [230, 60, 70], life: 2.6, every: 1.5 },
  estrela: { pts: [...line([0, -0.8], [0, 0.8], 11), ...line([-0.8, 0], [0.8, 0], 11), ...line([-0.3, -0.3], [0.3, 0.3], 4), ...line([-0.3, 0.3], [0.3, -0.3], 4)], color: [48, 95, 62], life: 1.2, every: 0.42 },
  gota: { pts: [...Array.from({ length: 16 }, (_, i) => { const a = i / 16 * TAU; return [Math.cos(a) * 0.34, 0.25 + Math.sin(a) * 0.34]; }), ...line([0, -0.75], [0.3, 0], 5), ...line([0, -0.75], [-0.3, 0], 5)], color: [198, 85, 66], life: 1.7, every: 1.9 },
  reticencias: { pts: [-0.6, 0, 0.6].flatMap(x => [[x, 0], [x + 0.07, 0.04], [x - 0.06, 0.05], [x, 0.1]]), color: [0, 0, 70], life: 1.8, every: 1.9 }
};

/* ---------- the living bot ---------- */
export class Mimo {
  constructor(spec, { n = 1500, fill = 0.88, vfill = 0.8, thick = null } = {}) {
    this.spec = spec; this.n = n; this.fill = fill; this.vfill = vfill; this.thickForce = thick; this.mood = 'normal'; this.cur = { ...NEUTRAL }; this.def = MOODS.normal;
    this.t = (hashStr(spec.seed) % 900) / 100; this.hue = spec.hue; this.ball = 0; this.ballTarget = 0; this.look = { x: 0, y: 0 }; this.sprites = []; this.em = 0; this.action = null; this.actionStart = 0; this.rebuild();
  }
  rebuild() { const P = this.P = buildParticles(this.spec, this.n), N = P.N; this.dx = new Float32Array(N); this.dy = new Float32Array(N); this.SX = new Float32Array(N); this.SY = new Float32Array(N); this.SZ = new Float32Array(N); this.SP = new Float32Array(N); this.buckets = Array.from({ length: 32 }, () => []); }
  setSpec(spec) { const old = this.spec; this.spec = spec; if (old.seed !== spec.seed || old.squar !== spec.squar || old.top !== spec.top) this.rebuild(); }
  setN(n) { if (n !== this.n) { this.n = n; this.rebuild(); } }
  setMood(m) { if (MOODS[m] && this.mood !== m) { this.mood = m; this.def = MOODS[m]; this.em = 0.2; } }
  // Applies a mood at once (no blending) at a moment with no blink: for faces that do not move (lists, widget, notification).
  snap(m = 'normal') {
    this.setMood(m); this.cur = { ...NEUTRAL, ...this.def.p }; this.hue = this.def.p.hm > 0 ? this.def.p.hue : this.spec.hue; this.ball = this.ballTarget; this.sprites = [];
    let t = 1; while (((t + this.spec.seed.length * 0.37) % 5.2) > 3.5) t += 0.7; this.t = t; this.action = null; return this;
  }
  act(a) { this.action = a; this.actionStart = this.t; if (a === 'ball') this.ballTarget = 1 - this.ballTarget; }
  // `pointer` is where the bot looks, -1..1 on each axis
  update(dt, pointer = { x: 0, y: 0 }) {
    this.t += dt; const k = 1 - Math.exp(-dt * 7), tg = this.def.p, c = this.cur;
    for (const key in NEUTRAL) if (key !== 'hue') c[key] = lerp(c[key], tg[key], k);
    const th = tg.hm > 0 ? tg.hue : this.spec.hue; const d = ((th - this.hue + 540) % 360) - 180; this.hue = (this.hue + d * k * 0.9 + 360) % 360;
    this.ball = lerp(this.ball, this.ballTarget, k);
    const scan = Math.sin(this.t * 2.2) * 0.9 * c.scan;
    this.look.x = lerp(this.look.x, pointer.x * c.look + scan + c.ax, k); this.look.y = lerp(this.look.y, pointer.y * c.look + c.up, k);
    if (this.def.bounce && !this.action && ((this.t * 1.3) % 3.2) < 0.04) this.act('jump');
    const sp = this.def.spr; this.em -= dt; if (sp && this.em <= 0) { this.sprites.push({ type: sp, age: 0, life: SHAPES[sp].life, ox: (this.sprites.length % 5) / 4 - 0.5 }); this.em = SHAPES[sp].every; }
    for (const s of this.sprites) s.age += dt; this.sprites = this.sprites.filter(s => s.age < s.life);
  }
  // Where every particle is on a W×H canvas. env: { light, energy, dt, paused, maxS }. Returns the frame to paint.
  compute(W, H, env = {}) {
    const sp = this.spec, P = this.P, N = P.N, c = this.cur, t = this.t, light = !!env.light, energy = env.energy ?? 0.6;
    const minDim = Math.min(W, H), thick = this.thickForce != null ? this.thickForce : (minDim < 44 ? 1.7 : minDim < 70 ? 1.2 : minDim < 130 ? 0.7 : minDim < 200 ? 0.4 : 0);
    const el = t - this.actionStart; let spin = 0, explode = 0, jump = 0, squashJ = 1;
    if (this.action === 'spin') { spin = smooth(el / 2.15) * TAU; if (el > 2.2) this.action = null; }
    else if (this.action === 'dissolve') { explode = el < 1.4 ? smooth(el / 1.4) : el < 2.2 ? 1 : 1 - smooth((el - 2.2) / 1.7); if (el > 3.9) this.action = null; }
    else if (this.action === 'jump') { const pr = clamp(el / 1.5); jump = Math.sin(pr * Math.PI); squashJ = 1 + Math.sin(pr * TAU * 2) * 0.09 * (1 - pr); if (el > 1.5) this.action = null; }
    else if (this.action === 'ball' && el > 1.2) this.action = null;
    const te = TOP_EXT[sp.top], extX = Math.max(1.1 * sp.sx, te[0] * sp.sx + 0.15), yTop = -Math.max(1.03 * sp.sy, te[1] * sp.sy), yBot = 1.05 * sp.sy;
    const s = Math.min(W * 0.5 * this.fill / extX, H * this.vfill / (yBot - yTop), env.maxS || 200), u = s / 130;
    const cx = W / 2 + Math.sin(t * 0.7) * 3 * u, cy0 = H * 0.5 - (yTop + yBot) / 2 * s + (H < 120 ? 0 : 4), cy = cy0 + Math.sin(t * 1.7) * 6 * u - jump * 78 * u;
    const ang = spin + Math.sin(t * 0.55) * 0.1 + this.look.x * 0.1 + c.asym * 0.45, tilt = Math.sin(t * 0.75) * 0.035 + c.lean + c.asym * 0.5, ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt);
    const breath = 1 + Math.sin(t * 2 * (0.6 + c.en * 0.4)) * 0.017, squash = squashJ * c.squash, SXs = sp.sx, SYs = sp.sy, SZs = sp.sz;
    const o = [0, 0, 0, 0];
    const proj = (x, y, z) => { x *= SXs; y *= SYs; z *= SZs; const rx = x * ca + z * sa, rz = z * ca - x * sa, ry = y * ct + rx * st, xx = rx * ct - y * st, p = 4.8 / (4.8 - rz * 0.42); o[0] = cx + xx * s * p * breath; o[1] = cy + ry * s * p * breath * squash; o[2] = rz; o[3] = p; return o; };
    const fp = proj(0, -0.06, 1.04).slice(), fs = s * breath, faceVis = smooth(clamp((ca - 0.16) / 0.65)) * (1 - smooth(explode * 2));
    const bc = (t + sp.seed.length * 0.37) % 5.2, blink = bc > 4.9 ? 1 - Math.sin((bc - 4.9) / 0.3 * Math.PI) * 0.96 : 1;
    const holes = [], thk = 1 + 0.75 * thick, minH = 0.013 + 0.03 * thick, [, bw, bh] = EYE_STYLES[sp.eyeStyle], one = sp.eyes === 1, gap = sp.eyeGap, eyePos = one ? [0] : [-0.34 * gap, 0.34 * gap];
    for (const ex of eyePos) {
      const side = one ? 0 : (ex < 0 ? -1 : 1), big = one ? 1.5 : 1, cs = 1 + c.asym * (side === -1 ? 1 : side === 1 ? -0.9 : 0);
      let w = bw * big * c.ew * cs, h = Math.max(minH, bh * big * c.eo * (c.eo > 0.2 ? blink : 1) * cs), curve = c.ec;
      if (side === 1 && c.wink > 0) { h = lerp(h, 0.03, c.wink); curve += c.wink * 0.12; w *= 1 + 0.12 * c.wink; }
      const x = (ex + this.look.x * 0.065) * SXs, y = (sp.eyeY + c.ey + this.look.y * 0.05 + side * c.asym * 0.25) * SYs;
      holes.push({ x, y, w: w * SXs * thk, h: Math.max(minH, h) * SYs * (1 + 0.35 * thick), angle: -side * c.et, curve, amount: 1 - c.x });
      if (c.x > 0.02) for (const a of [Math.PI / 4, -Math.PI / 4]) holes.push({ x, y, w: 0.2 * SXs * thk, h: Math.max(0.032, 0.032 * thk) * SYs, angle: a, curve: 0, amount: c.x });
    }
    if (sp.eyes === 3) holes.push({ x: this.look.x * 0.03 * SXs, y: (sp.eyeY - 0.34) * SYs, w: 0.075 * SXs * thk, h: 0.095 * SYs * thk, angle: 0, curve: 0, amount: 1 - c.x });
    const mouthHoles = (def, amt) => {
      if (amt < 0.01 || def === 'nenhuma') return; const y = (def === 'redonda' ? 0.42 : 0.41) * SYs;
      const add = (x, w, h, cv, ang = 0) => holes.push({ x: x * SXs, y, w: w * SXs * thk, h: Math.max(h, 0.02 + 0.025 * thick) * SYs, angle: ang, curve: cv, amount: amt });
      switch (def) { case 'pequena': add(0, 0.09, 0.022, 0); break; case 'sorriso': add(0, 0.17, 0.035, -0.09); break; case 'larga': add(0, 0.3, 0.05, -0.12); break; case 'redonda': add(0, 0.075, 0.09, 0); break;
        case 'dentes': [-0.13, -0.045, 0.045, 0.13].forEach((x, i) => add(x, 0.03, 0.05, 0, i % 2 ? 0.45 : -0.45)); break; case 'gato': add(-0.075, 0.085, 0.024, -0.1); add(0.075, 0.085, 0.024, -0.1); break; }
    };
    mouthHoles(sp.mouth, smooth(c.rest));
    const mo = (1 - smooth(c.rest)) * c.mo;
    if (mo > 0.01) { const open = c.talk > 0.01 ? (0.3 + Math.abs(Math.sin(t * 9.5)) * 1.4) * c.talk + (1 - c.talk) : 1;
      holes.push({ x: this.look.x * 0.025 * SXs, y: (c.my + this.look.y * 0.02) * SYs, w: c.mw * SXs * thk, h: Math.max(0.02 + 0.025 * thick, c.mh * open) * SYs * (1 + 0.3 * thick), angle: 0, curve: c.mc, amount: smooth(mo) }); }
    for (const h of holes) { h.c = Math.cos(h.angle); h.s = Math.sin(h.angle); h.R = 3.4 * Math.max(h.w, h.h) * 1.08; h.R2 = h.R * h.R; }
    const repel = (x, y, h, out) => {
      const dx = x - h.x, dy = y - h.y; if (dx * dx + dy * dy > h.R2) return false;
      const u2 = dx * h.c + dy * h.s, v = -dx * h.s + dy * h.c, bend = h.curve * (Math.pow(clamp(u2 / h.w, -1.7, 1.7), 2) - 1), vv = v - bend, nx = u2 / h.w, ny = vv / h.h, r = Math.hypot(nx, ny), outer = 3.4;
      if (r >= outer) return false; const edge = 1 + Math.min(0.017 / h.h, 0.65), reach = Math.sqrt(edge * edge + (1 - edge * edge / (outer * outer)) * r * r), force = (reach - r) * h.amount, inv = 1 / Math.max(r, 0.0001), du = nx * inv * force * h.w;
      let dv = ny * inv * force * h.h; dv += h.curve * (Math.pow(clamp((u2 + du) / h.w, -1.7, 1.7), 2) - 1) - bend; out[0] = du * h.c - dv * h.s; out[1] = du * h.s + dv * h.c; return true;
    };
    const dtk = env.dt ?? 0.016, moveK = env.paused ? 0 : 1 - Math.exp(-dtk * 22), faceW = Math.max(0.1, Math.abs(ca)), flow = 0.009 + energy * 0.025, enMul = 0.65 + energy * c.en;
    const buckets = this.buckets; for (let b = 0; b < 32; b++) buckets[b].length = 0;
    const dx = this.dx, dy = this.dy, SX = this.SX, SY = this.SY, SZ = this.SZ, SP = this.SP, glitchOn = c.glitch > 0.3, gseed = Math.floor(t * 12), sft = [0, 0];
    for (let i = 0; i < N; i++) {
      const ph = P.ph[i], spd = P.speed[i], tt = t * spd * enMul;
      let x = lerp(P.x[i], P.bx[i], this.ball), y = lerp(P.y[i], P.by[i], this.ball), z = lerp(P.z[i], P.bz[i], this.ball), fade = 1;
      x += Math.sin(tt + ph + y * 3) * flow + c.shake * Math.sin(t * 33 + ph); y += Math.cos(tt * 1.1 + ph + x * 3) * flow; z += Math.sin(tt * 0.8 + ph) * flow;
      if (P.dust[i]) { const orbit = 0.06 + 0.12 * (1 + Math.sin(tt)); x *= 1 + orbit; y *= 1 + orbit; z *= 1 + orbit; if (c.rise > 0.01) { const fr = (t * 0.26 * spd + ph / TAU) % 1; y -= c.rise * fr * 1.9; fade = 1 - fr * 0.75 * c.rise; } }
      x += P.ex[i] * explode; y += P.ey[i] * explode + Math.sin(t + ph) * explode * 0.3; z += P.ez[i] * explode;
      const q = proj(x, y, z), fx = (q[0] - fp[0]) / fs, fy = (q[1] - fp[1]) / (fs * squash), lx = (fx * ct + fy * st) / faceW, ly = -fx * st + fy * ct;
      let ox = 0, oy = 0;
      if (faceVis > 0.001 && Math.abs(lx) < 1.6 && Math.abs(ly) < 1.5) for (const h of holes) if (repel(lx, ly, h, sft)) { ox += sft[0]; oy += sft[1]; }
      const tX = (ox * faceW * ct - oy * st) * fs * faceVis, tY = (ox * faceW * st + oy * ct) * fs * squash * faceVis;
      dx[i] = lerp(dx[i], tX, moveK); dy[i] = lerp(dy[i], tY, moveK);
      SX[i] = q[0] + dx[i]; SY[i] = q[1] + dy[i]; SZ[i] = q[2]; SP[i] = q[3] * fade;
      const depth = clamp((q[2] + 1.2) / 2.4); let b;
      if (glitchOn && (i * 13 + gseed) % 17 === 0) b = 30; else if (P.dust[i]) b = 31; else b = Math.min(9, Math.floor(depth * 10)) * 3 + (P.light[i] < 0.33 ? 0 : P.light[i] < 0.66 ? 1 : 2);
      buckets[b].push(i);
    }
    // sprites: the little drawings rising beside the head (only where they can be read)
    const sprites = [];
    if (this.sprites.length && minDim >= 70) for (const sprite of this.sprites) {
      const sh = SHAPES[sprite.type], a = sprite.age / sprite.life, vis = smooth(a / 0.12) * (1 - smooth((a - 0.55) / 0.45)); if (vis < 0.02) continue;
      const k = s * 0.26, ax = Math.min(W - k * 0.9, cx + s * extX * 0.72 + sprite.ox * s * 0.12 + Math.sin(sprite.age * 3) * s * 0.04), ay = Math.max(k * 1.1, cy + yTop * s * 0.62 - sprite.age * s * 0.2);
      sprites.push({ pts: sh.pts, color: sh.color, ax, ay, k, vis, r: Math.max(0.9, u * 1.5) });
    }
    return { N, SX, SY, SP, size: P.size, dust: P.dust, buckets, sprites, W, H, s, u, cx, cy0, yBot, hue: this.hue, dim: c.dim, light, alpha: 1 - explode * 0.3, dot: sp.dot, minR: thick > 0.2 ? 0.85 + 0.4 * thick : 0.3, shadow: { y: cy0 + yBot * s * 1.04, s, explode, jump } };
  }
}
// The color of one bucket (shared by every painter so the web and the phone match): [hue, saturation %, lightness %, alpha]
export function bucketColor(frame, b) {
  const { hue, dim, light, alpha } = frame, sat = light ? 64 : 54;
  if (b === 30) return light ? [4, 80, 42, 0.92] : [6, 90, 62, 0.95];
  if (b === 31) return [hue, 76, light ? 36 : 72, 0.6 * alpha];
  const db = Math.floor(b / 3) / 9, lv = [0.17, 0.5, 0.83][b % 3]; let l = light ? 52 - db * 28 - lv * 8 : 34 + db * 36 + lv * 15; l = light ? l + dim * 22 : l * (1 - 0.5 * dim);
  return [hue, sat, l, 0.86 * alpha];
}
export const particleRadius = (frame, i) => Math.max(frame.minR, frame.size[i] * frame.SP[i] * frame.u * frame.dot * (frame.dust[i] ? 0.72 : 1));

// The tables the phone's Kotlin port reads (assets/mimo-data.json), so nothing is typed twice.
export function nativeData() {
  const round = v => Math.round(v * 1e9) / 1e9;
  return { keys: Object.keys(NEUTRAL), neutral: NEUTRAL, topFrac: TOP_FRAC, topExt: TOP_EXT, eyes: Object.fromEntries(Object.entries(EYE_STYLES).map(([k, v]) => [k, [v[1], v[2]]])),
    moods: Object.fromEntries(Object.entries(MOODS).map(([k, v]) => [k, { p: v.p, spr: v.spr || null, bounce: Boolean(v.bounce) }])),
    shapes: Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, { pts: v.pts.map(([x, y]) => [round(x), round(y)]), color: v.color, life: v.life, every: v.every }])) };
}
