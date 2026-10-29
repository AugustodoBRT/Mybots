// Bot faces as a grid of characters, pure (no DOM, no canvas). Ported from docs/design/laboratorio-de-bots.html
// ("Rostos"): the same seed always gives the same face, and frameFace gives the grid for a state at a time `t` (ms).
export const FW = 70, FH = 40, FCX = 35, FCY = 25;
const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];
export function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const h2 = (x, y, z = 0) => { let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263) ^ Math.imul(z + 13, 2147483647); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const TIDY = ' .:-=+*#%@';
const FSTATES = ['idle', 'working', 'waiting', 'sleep', 'error', 'done', 'evil'];
export const STATES = FSTATES;
export const PIECES = {
  head: ['circle', 'squircle', 'rbox', 'bell', 'ghost', 'blob', 'drop', 'skull', 'tall', 'spiky'],
  tex: ['tidy', 'ramp', 'binary', 'dither', 'hatch', 'noise'],
  eye: ['dot', 'oval', 'rect', 'cut', 'ring'],
  mouth: ['smile', 'cat', 'flat', 'o', 'lens', 'teeth', 'sharp'],
  top: ['none', 'cat', 'bear', 'pods', 'antenna']
};
export const PIECE_NAMES = {
  head: { circle: 'círculo', squircle: 'quadrado redondo', rbox: 'caixa', bell: 'sino', ghost: 'fantasma', blob: 'bolha', drop: 'gota', skull: 'caveira', tall: 'alto', spiky: 'espinhoso' },
  tex: { tidy: 'rampa limpa', ramp: 'letras', binary: '0 e 1', dither: 'pontilhado', hatch: 'hachura', noise: 'ruído de letras' },
  eye: { dot: 'bolinha', oval: 'oval', rect: 'barra', cut: 'quadrado cortado', ring: 'anel' },
  mouth: { smile: 'sorriso', cat: 'bico de gato', flat: 'reta', o: 'redonda', lens: 'aberta', teeth: 'com dentes', sharp: 'dentes afiados' },
  top: { none: 'nada', cat: 'orelhas de gato', bear: 'orelhas de urso', pods: 'fones laterais', antenna: 'antena' }
};

// How odd a face is, 0..1, from the seed alone (not a control: it picks which pieces the seed draws from).
export const weirdOf = seed => Math.pow(mulberry(hashStr(seed + '#esquisitice'))(), 1.6);

// `pieces` pins single parts (head, tex, eye, mouth, top); everything else keeps coming from the seed.
export function makeFace(seed, pieces = {}) {
  seed = String(seed || 'bot'); const w = weirdOf(seed);
  const rnd = mulberry(hashStr(seed + '#rosto')); const R = Array.from({ length: 80 }, rnd);
  const cute = ['circle', 'squircle', 'rbox', 'bell', 'ghost', 'squircle'], mid = ['blob', 'drop', 'skull', 'ghost', 'bell', 'tall'], wild = ['spiky', 'skull', 'blob', 'drop', 'tall'];
  const fam = w < 0.3 ? pick(cute, R[0]) : w < 0.62 ? pick([...cute, ...mid], R[0]) : pick([...mid, ...wild], R[0]);
  let rx = lerp(22, 28, R[1]), ry = lerp(10.5, 12.5, R[2]);
  if (fam === 'tall') { rx *= 0.78; ry = 12.8; } if (fam === 'ghost') ry = 11.8; if (fam === 'bell') ry = 11.8;
  const texPool = w < 0.3 ? ['tidy', 'dither', 'ramp', 'tidy'] : w < 0.65 ? ['ramp', 'hatch', 'dither', 'binary'] : ['binary', 'noise', 'hatch', 'ramp'];
  const eyePool = w < 0.35 ? ['dot', 'oval', 'rect', 'cut', 'ring', 'dot', 'rect'] : ['ring', 'rect', 'oval', 'cut', 'dot', 'ring'];
  const mouthPool = w < 0.25 ? ['smile', 'cat', 'flat', 'smile', 'o'] : w < 0.6 ? ['smile', 'lens', 'cat', 'teeth'] : ['teeth', 'sharp', 'lens', 'sharp'];
  const earPool = w < 0.5 ? ['cat', 'bear', 'none', 'antenna', 'pods', 'none', 'cat'] : ['none', 'antenna', 'pods', 'cat', 'none'];
  const face = {
    fam, rx, ry, cy: FCY - (fam === 'ghost' || fam === 'bell' ? 1 : 0), nsp: 6 + Math.floor(R[13] * 4), p1: R[14] * 6.28, p2: R[15] * 6.28, skew: (R[16] - 0.5) * w * 0.5,
    tex: pick(texPool, R[17]), eye: pick(eyePool, R[3]), eb: Math.round(lerp(2, 3.4, R[4])), ed: Math.round(lerp(8, 13, R[5])), neon: R[6] > 0.45,
    mouth: pick(mouthPool, R[7]), mw: Math.round(lerp(5, 9, R[18])), ears: pick(earPool, R[8]),
    horns: w > 0.42 + R[19] * 0.1, brow: w > 0.5, cheeks: w < 0.5 && R[10] > 0.3, freckles: R[12] > 0.7 && w < 0.5, stitches: w > 0.55 && R[9] > 0.4,
    t3: 0.45 + R[20] * 0.15, t5: 0.75 + R[21] * 0.1, smoke: R[11] > 0.55 || w > 0.7,
    evilPeriod: lerp(14000, 7000, w) + R[22] * 4000, evilOff: R[23] * 9000, grinPeriod: 5200 + R[24] * 3000, grinOff: R[25] * 5000,
    blink: 2600 + R[26] * 2600, blinkOff: R[27] * 5000, dbl: R[28] < 0.3, sx: R[29] > 0.5 ? 7 : -7
  };
  for (const [part, key] of [['head', 'fam'], ['tex', 'tex'], ['eye', 'eye'], ['mouth', 'mouth'], ['top', 'ears']]) {
    const value = pieces[part]; if (value && PIECES[part].includes(value)) face[key] = value;
  }
  if (pieces.head === 'tall') { face.rx = lerp(22, 28, R[1]) * 0.78; face.ry = 12.8; } else if (pieces.head === 'ghost' || pieces.head === 'bell') { face.ry = 11.8; face.cy = FCY - 1; }
  else if (pieces.head) { face.ry = lerp(10.5, 12.5, R[2]); face.rx = lerp(22, 28, R[1]); face.cy = FCY; }
  const bot = { kind: 'face', seed, w, R, face };
  const g1 = frameFace(bot, 'idle', 0), g2 = frameFace(bot, 'working', 400), g3 = frameFace(bot, 'sleep', 0);
  let x0 = FW, x1 = -1, y0 = FH, y1 = -1;
  for (const g of [g1, g2, g3]) for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const c = g[y][x]; if (c && !c.s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  bot.cropTight = { x0: Math.max(0, x0 - 1), x1: Math.min(FW - 1, x1 + 1), y0: Math.max(0, y0 - 1), y1: Math.min(FH - 1, y1 + 1) };
  bot.crop = { ...bot.cropTight, y0: Math.max(0, bot.cropTight.y0 - 9) };
  return bot;
}

const LETTERS = 'ZOXqkNBjPEMW8GRDQ';
function headRho(F, x, y, rx, ry, cy, cx, t) {
  let dx = (x - cx) / rx, dy = (y - cy) / ry; dx += F.skew * dy;
  const sup = (n) => Math.pow(Math.pow(Math.abs(dx), n) + Math.pow(Math.abs(dy), n), 1 / n);
  let rho;
  switch (F.fam) {
    case 'squircle': rho = sup(3.4); break;
    case 'rbox': rho = sup(6); break;
    case 'ghost': rho = dy < 0 ? sup(2.2) : Math.max(Math.abs(dx) * 0.999, dy / (1 + 0.07 * Math.sin(x * 0.5 + t / 350))); break;
    case 'bell': rho = dy < 0 ? sup(2.6) : sup(9); break;
    case 'drop': { const k = 0.62 + 0.38 * (dy + 1) / 2; dx /= k; rho = Math.hypot(dx, dy); break; }
    case 'skull': { if (dy > 0.25) dx /= 1 - 0.38 * (dy - 0.25) / 0.75; rho = sup(2.5); break; }
    case 'blob': { const th = Math.atan2(dy, dx); rho = Math.hypot(dx, dy) / (1 + 0.12 * Math.sin(3 * th + F.p1 + t / 1400) + 0.09 * Math.sin(5 * th + F.p2)); break; }
    case 'spiky': { const th = Math.atan2(dy, dx); rho = Math.hypot(dx, dy) / (1 + 0.16 * Math.abs(Math.sin(F.nsp * th / 2 + F.p1)) - 0.06); break; }
    default: rho = Math.hypot(dx, dy);
  }
  return [rho, dx, dy];
}

const LIGHT = (() => { const l = [-0.45, -0.6, 0.66], m = Math.hypot(...l); return l.map(v => v / m); })();
function texChar(style, L, x, y, rimmed) {
  const hh = h2(x, y, 31);
  if (rimmed) return [style === 'dither' ? '▓' : style === 'binary' ? (hh < 0.5 ? '1' : '0') : style === 'tidy' ? '@' : pick(['#', '@', '8', '%', 'W', 'M'], hh), 1];
  switch (style) {
    case 'tidy': { const i = Math.min(9, Math.floor(L * 10)); return [TIDY[i], i / 9]; }
    case 'ramp': { const i = clamp(Math.floor((L + (hh - 0.5) * 0.12) * RAMP.length), 0, RAMP.length - 1); return [RAMP[i], i / (RAMP.length - 1)]; }
    case 'binary': return L < 0.18 ? [' ', 0] : hh < 0.07 ? ['.', 0.4] : [hh < 0.53 ? '1' : '0', 0.3 + 0.7 * L];
    case 'dither': return L < 0.2 ? [' ', 0] : L < 0.4 ? ['░', L] : L < 0.62 ? [(x + y) % 2 ? '░' : '▒', L] : L < 0.82 ? [(x + y) % 2 ? '▒' : '▓', L] : ['▓', L];
    case 'hatch': return L < 0.15 ? [' ', 0] : L < 0.3 ? ['.', L] : L < 0.45 ? [':', L] : L < 0.62 ? ['/', L] : L < 0.75 ? [(x + y) % 3 ? '/' : '\\', L] : L < 0.88 ? ['X', L] : ['#', L];
    default: return L < 0.28 ? [pick(['.', ':', ',', ';', "'"], hh), 0.25 + L * 0.5] : [LETTERS[Math.floor(hh * LETTERS.length)], 0.3 + 0.7 * L];
  }
}

function eyeShape(style, dx, dy, a, b, side, angry) {
  // returns 0 outside, 1 fill, 2 highlight
  const ex = dx / a, ey = dy / b;
  let inside;
  switch (style) {
    case 'rect': inside = Math.pow(Math.abs(ex), 6) + Math.pow(Math.abs(ey), 6) <= 1; break;
    case 'cut': inside = Math.pow(Math.abs(ex), 8) + Math.pow(Math.abs(ey), 8) <= 1 && !(ex > 0 && ey < 0 && ex - ey > 1.25); break;
    case 'ring': { const o = ex * ex + ey * ey; inside = o <= 1 && (o >= 0.32 || (Math.abs(ex) < 0.28 && Math.abs(ey) < 0.34)); break; }
    default: inside = ex * ex + ey * ey <= 1;
  }
  if (!inside) return 0;
  if (angry && dy < -b * 0.45 + (b * 0.95) * ((-side * dx) / a + 1) / 2) return 0;
  if (style !== 'ring' && ex < -0.2 && ey < -0.25 && ex > -0.75 && ey > -0.8 && !angry) return 2;
  return 1;
}

export function frameFace(bot, state, t) {
  const g = Array.from({ length: FH }, () => Array(FW).fill(null));
  const put = (x, y, c, k, a, extra) => { x = Math.round(x); y = Math.round(y); if (x < 0 || x >= FW || y < 0 || y >= FH) return; g[y][x] = { c, k, a: a == null ? 1 : a, f: true, ...extra }; };
  const clear = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < FW && y >= 0 && y < FH) g[y][x] = null; };
  const { face: F, w, R } = bot;
  const sleep = state === 'sleep', work = state === 'working', waiting = state === 'waiting', err = state === 'error', done = state === 'done';
  // evil: asked for, or by itself from time to time (while idle or working)
  const calm = state === 'idle' || work;
  const eph = (t + F.evilOff) % F.evilPeriod;
  const evil = state === 'evil' || (calm && t > 3000 && eph < 1500);
  const grin = !evil && state === 'idle' && ((t + F.grinOff) % F.grinPeriod) < 900;
  const happy = done || grin;
  const cx = FCX + (evil ? (Math.floor(t / 70) % 2 ? 1 : -1) : 0), cy = F.cy + (sleep ? 1 : 0);
  const sc = 1 + (sleep ? 0.015 * Math.sin(t / 800) : 0.01 * Math.sin(t / 1100));
  const rx = F.rx * sc, ry = F.ry * sc, top = Math.round(cy - ry);
  const dimA = sleep ? 0.55 : 1;
  // ---- accessories behind the head
  if (F.ears === 'cat') for (const s of [-1, 1]) { const ex = cx + s * rx * 0.62, h = 6; for (let yy = top - h + 2; yy <= top + 2; yy++) { const half = (yy - (top - h + 2)) / h * 5.2; for (let xx = Math.round(ex - half); xx <= Math.round(ex + half); xx++) { const edge = Math.abs(xx - ex) > half - 1.1 || yy === top - h + 2; const inner = !edge && Math.abs(xx - ex) < half - 2.2 && yy > top - h + 4; put(xx, yy, inner ? '▒' : edge ? '#' : texChar(F.tex, 0.5, xx, yy)[0], inner ? 'blush' : edge ? 'rim' : 'tex', 0.9 * dimA); } } }
  if (F.ears === 'bear') for (const s of [-1, 1]) { const ex = cx + s * rx * 0.66, ey = top + 1; for (let yy = ey - 4; yy <= ey + 2; yy++) for (let xx = Math.round(ex - 8); xx <= Math.round(ex + 8); xx++) { const o = ((xx - ex) / 7) ** 2 + ((yy - ey) / 3.6) ** 2; if (o <= 1) put(xx, yy, o > 0.62 ? '#' : texChar(F.tex, 0.55, xx, yy)[0], o > 0.62 ? 'rim' : 'tex', 0.9 * dimA); } }
  if (F.ears === 'pods') for (const s of [-1, 1]) { const ex = cx + s * (rx + 2.5), ey = cy; for (let yy = Math.round(ey - 6); yy <= ey + 6; yy++) for (let xx = Math.round(ex - 6); xx <= ex + 6; xx++) { const o = ((xx - ex) / 5) ** 2 + ((yy - ey) / 5.6) ** 2; if (o <= 1) put(xx, yy, o > 0.6 ? '▓' : (xx + yy) % 2 ? '▒' : '░', o > 0.6 ? 'rim' : 'tex', 0.85 * dimA); } }
  if (F.horns && !sleep) for (const s of [-1, 1]) for (let i = 0; i < 9; i++) { const yy = top + 1 - i, xx = cx + s * (rx * 0.5 + i * 1.7 - (i > 5 ? (i - 5) * 2.4 : 0)); const ch = i > 5 ? (s > 0 ? '\\' : '/') : (s > 0 ? '/' : '\\'); put(xx, yy, ch, 'rim', 1); put(xx + s, yy, ch === '/' ? '/' : '\\', 'rim', 1); if (i < 3) put(xx - s, yy, '#', 'rim', 1); }
  if (F.ears === 'antenna') { for (let i = 1; i <= 4; i++) put(cx, top - i + 1, '|', 'rim', 1); put(cx, top - 5, '@', waiting && Math.floor(t / 450) % 2 ? 'warn' : 'acc', 1); put(cx - 1, top - 5, '(', 'acc', 0.8); put(cx + 1, top - 5, ')', 'acc', 0.8); }
  // ---- head
  const x0 = Math.max(0, Math.floor(cx - rx * 1.3) - 2), x1 = Math.min(FW - 1, Math.ceil(cx + rx * 1.3) + 2), y0 = Math.max(0, Math.floor(cy - ry * 1.3) - 1), y1 = Math.min(FH - 1, Math.ceil(cy + ry * 1.3) + 3);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const [rho, dx, dy] = headRho(F, x, y, rx, ry, cy, cx, t); if (rho > 1) continue;
    const z = Math.sqrt(Math.max(0, 1 - rho * rho)), nx = dx * 0.9, ny = dy * 0.9, m = Math.hypot(nx, ny, z) || 1;
    let L = clamp(0.34 + 0.8 * Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + z * LIGHT[2]) / m) + (h2(x, y, 5) - 0.5) * 0.1, 0, 1);
    const rim = rho > 0.9;
    const [c, d] = texChar(F.tex, L, x, y, rim);
    if (c === ' ') continue;
    put(x, y, c, rim ? (evil ? 'warn' : 'rim') : 'tex', (rim ? 1 : clamp(0.42 + 0.58 * d, 0.3, 1)) * dimA);
  }
  // ---- eyes
  const gaze = work ? [0, -3, 0, 3][Math.floor(t / 500) % 4] : (Math.floor(t / 1700) % 5 === 0 ? (Math.floor(t / 1700) % 2 ? 2 : -2) : 0);
  const cyc = (t + F.blinkOff) % F.blink, blinking = cyc < 120 || (F.dbl && cyc > 240 && cyc < 360);
  const ey0 = cy - 2 + (sleep ? 1 : 0), eb = F.eb + (waiting ? 1 : 0) - (evil ? 0 : 0);
  const eyeCols = { dot: 2, oval: 1.4, rect: 0.95, cut: 2.1, ring: 2.1 };
  let style = F.eye, ea = eb * (eyeCols[style] || 2.2), erb = eb;
  const ek = evil || err ? 'warn' : F.neon ? 'neon' : 'eye';
  const eyes = [[-1, cx - F.ed + gaze], [1, cx + F.ed + gaze]];
  for (const [side, ex] of eyes) {
    // socket: a dark area around the eye so it pops
    const sa = ea + 1.7, sb = erb + 1;
    for (let yy = Math.floor(ey0 - sb); yy <= ey0 + sb; yy++) for (let xx = Math.floor(ex - sa); xx <= ex + sa; xx++) if (((xx - ex) / sa) ** 2 + ((yy - ey0) / sb) ** 2 <= 1) clear(xx, yy);
    let cells = [];
    if (sleep) for (let xx = Math.round(ex - ea * 0.9); xx <= ex + ea * 0.9; xx++) cells.push([xx, Math.round(ey0 + 1), 1]);
    else if (blinking && !evil) for (let xx = Math.round(ex - ea); xx <= ex + ea; xx++) cells.push([xx, Math.round(ey0), 1]);
    else if (happy) for (let xx = Math.round(ex - ea); xx <= ex + ea; xx++) { const u = (xx - ex) / ea; for (const th of [0, 1]) cells.push([xx, Math.round(ey0 + erb * 0.5 - (1 - u * u) * erb * 1.0 + th), 1]); }
    else if (err) for (let yy = Math.floor(ey0 - erb); yy <= ey0 + erb; yy++) for (let xx = Math.floor(ex - ea * 0.8); xx <= ex + ea * 0.8; xx++) { const ux = Math.abs(xx - ex) / (ea * 0.8), uy = Math.abs(yy - ey0) / erb; if (Math.abs(ux - uy) < 0.28) cells.push([xx, yy, 1]); }
    else {
      const useStyle = evil ? (style === 'ring' ? 'oval' : style) : style, aa = evil ? ea * 1.05 : ea, bb = evil ? erb * 0.95 : erb;
      for (let yy = Math.floor(ey0 - bb - 1); yy <= ey0 + bb + 1; yy++) for (let xx = Math.floor(ex - aa - 1); xx <= ex + aa + 1; xx++) { const s = eyeShape(useStyle, xx - ex, yy - ey0, aa, bb, side, evil); if (s) cells.push([xx, yy, s]); }
    }
    for (const [xx, yy, s] of cells) put(xx, yy, '█', s === 2 && !evil ? 'hi' : ek, 1);
    if (evil) { // heavy brow over each eye
      for (let i = -Math.round(ea) - 1; i <= Math.round(ea) + 1; i++) { const yy = ey0 - erb - 1 + Math.round(((-side * i) / ea + 1) * 1.6); put(ex + i, yy, '▀', 'warn', 1); put(ex + i, yy - 1, '▀', 'warn', 0.8); }
    }
  }
  // third and extra eyes
  if (w > F.t3 && !sleep) { const ex = cx + gaze * 0.5, ey = ey0 - eb - 4, a = 3, b = 1.6; for (let yy = Math.floor(ey - 3); yy <= ey + 3; yy++) for (let xx = Math.floor(ex - 8); xx <= ex + 8; xx++) { const o = ((xx - ex) / 5.5) ** 2 + ((yy - ey) / 2.4) ** 2; if (o <= 1) clear(xx, yy); } for (let yy = Math.floor(ey - b); yy <= ey + b; yy++) for (let xx = Math.floor(ex - a); xx <= ex + a; xx++) if (((xx - ex) / a) ** 2 + ((yy - ey) / b) ** 2 <= 1) put(xx, yy, '█', ek, 1); }
  if (w > F.t5 && !sleep) for (const s of [-1, 1]) { const ex = cx + s * rx * 0.66, ey = cy + 4; for (let yy = Math.floor(ey - 2); yy <= ey + 2; yy++) for (let xx = Math.floor(ex - 5); xx <= ex + 5; xx++) if (((xx - ex) / 5) ** 2 + ((yy - ey) / 2.2) ** 2 <= 1) clear(xx, yy); for (let yy = ey - 1; yy <= ey + 1; yy++) for (let xx = ex - 2; xx <= ex + 2; xx++) if (((xx - ex) / 2) ** 2 + ((yy - ey) / 1) ** 2 <= 1) put(xx, yy, '█', ek, 1); }
  // cheeks and freckles
  if (F.cheeks && !evil && !err) for (const s of [-1, 1]) { const bx = cx + s * (F.ed + 6), by = ey0 + eb + 4; for (let yy = by - 1; yy <= by + 1; yy++) for (let xx = bx - 4; xx <= bx + 4; xx++) if (((xx - bx) / 4) ** 2 + ((yy - by) / 1.4) ** 2 <= 1) put(xx, yy, '▒', 'blush', 0.9 * dimA); }
  if (F.freckles) for (const s of [-1, 1]) for (let k = 0; k < 4; k++) put(cx + s * (F.ed + 2 + (k % 2) * 3), ey0 + eb + 3 + Math.floor(k / 2) * 2, '·', 'eye', 0.7);
  // ---- mouth
  const my = Math.round(cy + ry * 0.48 + (sleep ? 0 : 0)), mw = F.mw;
  let ms = F.mouth;
  if (evil) ms = 'evil'; else if (happy) ms = w > 0.45 ? 'teeth' : 'open'; else if (sleep) ms = 'tiny'; else if (waiting) ms = 'o'; else if (err) ms = 'wavy'; else if (work) ms = Math.floor(t / 700) % 3 === 2 ? 'o' : 'flat';
  const lens = (a, b, topCurve, teethTop, teethBottom, tongue) => {
    for (let dx = -a; dx <= a; dx++) { const u = dx / a, yT = my - Math.round(topCurve * u * u), yB = yT + Math.max(1, Math.round(b * Math.pow(Math.max(0, 1 - u * u), 0.7)) + 1);
      for (let yy = yT; yy <= yB; yy++) clear(cx + dx, yy);
      put(cx + dx, yT - 1, '▄', evil ? 'warn' : 'eye', 1);
      if (teethTop && (dx % 2 === 0)) put(cx + dx, yT, '▼', 'tooth', 1); if (teethBottom && ((dx + 1) % 4 === 0)) put(cx + dx, yB, '▲', 'tooth', 1);
      if (tongue && Math.abs(dx) <= a * 0.45) put(cx + dx, yB, '█', 'tongue', 1); }
  };
  if (ms === 'smile') for (let dx = -mw; dx <= mw; dx++) { const u = dx / mw; put(cx + dx, my + 1 - Math.round(2.4 * u * u), '▄', 'eye', 1); if (Math.abs(dx) === mw) put(cx + dx, my - 2, '▀', 'eye', 1); }
  else if (ms === 'flat') for (let dx = -Math.round(mw * 0.7); dx <= mw * 0.7; dx++) put(cx + dx, my, '▄', 'eye', 1);
  else if (ms === 'cat') for (let dx = -mw; dx <= mw; dx++) { const lobe = (Math.abs(dx) - mw * 0.5) / (mw * 0.5); put(cx + dx, my - 1 + Math.round(1.4 * (1 - lobe * lobe)), '▄', 'eye', 1); }
  else if (ms === 'o' || ms === 'tiny') { const a = ms === 'o' ? 3.5 : 2, b = ms === 'o' ? 2 : 1; for (let yy = my - 2; yy <= my + 2; yy++) for (let xx = Math.floor(cx - 5); xx <= cx + 5; xx++) { const o = ((xx - cx) / a) ** 2 + ((yy - my) / b) ** 2; if (o <= 1.6) clear(xx, yy); if (o <= 1.6 && o > 0.7) put(xx, yy, '▓', 'eye', 1); } }
  else if (ms === 'wavy') for (let dx = -mw; dx <= mw; dx++) put(cx + dx, my + (Math.floor((dx + t / 90) / 2) % 2 ? 0 : 1), '▄', 'warn', 1);
  else if (ms === 'open') lens(mw, 3, 1, false, false, true);
  else if (ms === 'lens') lens(mw + 2, 3, 1, false, false, false);
  else if (ms === 'teeth') lens(mw + 4, 3, 1, true, false, false);
  else if (ms === 'sharp') lens(mw + 6, 4, 2, true, true, false);
  else if (ms === 'evil') lens(mw + 9, 4, 3, true, true, false);
  // ---- extras: brow ridge, stitches
  if (F.brow && !evil && w > 0.6) for (const [side, ex] of eyes) for (let i = -Math.round(ea); i <= ea; i++) put(ex + i, ey0 - eb - 2, '▀', 'rim', 0.9);
  if (F.stitches) for (let i = 0; i < 6; i++) { const yy = top + 4 + i * 2, xx = cx + rx * 0.5; put(xx - 1, yy, '\\', 'eye', 0.8); put(xx, yy, '|', 'eye', 0.8); put(xx + 1, yy, '/', 'eye', 0.8); }
  // ---- smoke
  const smoking = work || (F.smoke && !sleep && !err) || sleep;
  if (smoking) {
    const nW = work ? 3 : sleep ? 3 : 2, P = work ? 3000 : 4200, sy = top - 1;
    for (let i = 0; i < nW; i++) {
      const ph = ((t / P) + i / nW) % 1, yy = sy - 2 - ph * 8, xx = cx + F.sx + Math.sin(ph * 9 + i * 2.1) * 3 * (ph + 0.2);
      if (sleep) { const z = (i + Math.floor(t / P)) % 2 ? 'Z' : 'z'; put(xx, yy, z, 'smoke', clamp(1.2 - ph, 0, 1), { s: true }); put(xx + 1, yy + 1, z === 'Z' ? 'z' : '.', 'smoke', clamp(1 - ph, 0, 1), { s: true }); continue; }
      // a puff of smoke: a small cloud of characters that grows and thins as it rises
      const rr = 0.9 + ph * 2.4;
      for (let py = -Math.ceil(rr); py <= Math.ceil(rr); py++) for (let px = -Math.ceil(rr * 2.2); px <= Math.ceil(rr * 2.2); px++) {
        const dd = Math.hypot(px / 2.2, py) / rr; if (dd > 1) continue; const hh = h2(Math.round(xx) + px, Math.round(yy) + py, 77);
        if (dd > 0.55 && hh < 0.35 + ph * 0.3) continue;
        put(xx + px, yy + py, dd < 0.4 ? 'O' : dd < 0.75 ? (hh < 0.5 ? 'o' : '0') : (hh < 0.5 ? '.' : '~'), 'smoke', clamp((1 - ph) * (1 - dd * 0.5) * 1.1, 0, 1), { s: true });
      }
    }
  }
  // ---- state overlays
  if (waiting) { const p = Math.floor(t / 450) % 2; for (const [i, ch] of ['(', '!', ')'].entries()) put(cx - 1 + i, top - 5, ch, p ? 'warn' : 'acc', 1, { s: true }); }
  if (done) [[-rx - 3, -3], [rx + 3, -1], [rx * 0.4, -top + 3 - 4]].forEach(([dx, dyy], i) => { if (Math.floor(t / 300 + i) % 2 === 0) put(cx + dx, cy + dyy + (i === 2 ? top - 3 : 0), '*', 'acc', 1, { s: true }); });
  if (err) {
    const burst = t % 900 < 240;
    for (let y = 0; y < FH; y++) { const s = burst && h2(y, Math.floor(t / 110), 9) < 0.3 ? (h2(y, Math.floor(t / 110), 10) > 0.5 ? 2 : -2) : 0; if (s) { const row = g[y].slice(); for (let x = 0; x < FW; x++) g[y][x] = row[x - s] || null; } }
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const c = g[y][x]; if (c && (c.k === 'tex' || c.k === 'rim') && h2(x, y, Math.floor(t / 130)) < 0.05) c.k = 'warn'; }
  }
  if (work) { const scn = (t / 45) % (FW + 2 * FH); for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const c = g[y][x]; if (c && (c.k === 'tex' || c.k === 'rim') && Math.abs(x + y * 1.4 - scn) <= 1.6) c.k = 'bright'; } }
  return g;
}

const mix = (hex, to, a) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(hex), B = p(to); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], a)).toString(16).padStart(2, '0')).join(''); };
export const PAL = {
  dark: { eye: '#F3EFE6', hi: '#FFFFFF', acc: '#FFB23F', warn: '#FF4A3D', good: '#7BD88F', tooth: '#F6F2E8', tongue: '#FF7A9A', smoke: '#C2BEB2', fill: 0.3, dim: 0.5 },
  light: { eye: '#1D1B17', hi: '#F7F4EE', acc: '#B86100', warn: '#D1301F', good: '#2E8B4A', tooth: '#FFFFFF', tongue: '#D9486D', smoke: '#5E5A52', fill: 0.34, dim: 0.5 }
};
// Color and opacity for a cell kind, given the bot's color and the theme ('dark' | 'light').
export function tone(k, c, mode = 'dark') {
  const P = PAL[mode], base = mode === 'dark' ? c : mix(c, '#000000', 0.28), hiC = mode === 'dark' ? mix(c, '#FFFFFF', 0.6) : mix(c, '#000000', 0.55);
  switch (k) {
    case 'edge': case 'rim': case 'tex': return [base, 1]; case 'fill': return [base, P.fill]; case 'bright': return [hiC, 1]; case 'dim': return [base, P.dim];
    case 'neon': return [hiC, 1]; case 'blush': return [mix(base, mode === 'dark' ? '#FF7A9A' : '#D9486D', 0.65), 1];
    case 'eye': case 'hi': case 'acc': case 'warn': case 'good': case 'tooth': case 'tongue': case 'smoke': return [P[k], 1]; default: return [P.good, 1];
  }
}
export const ALPHA = { '░': 0.5, '▒': 0.75, '·': 0.7, '∙': 0.8, '◦': 0.7 };
export const PART = { '▀': [0, 0, 1, 0.5], '▄': [0, 0.5, 1, 0.5], '▁': [0, 0.875, 1, 0.125], '▂': [0, 0.75, 1, 0.25], '▃': [0, 0.625, 1, 0.375], '▔': [0, 0, 1, 0.125], '▌': [0, 0, 0.5, 1], '▐': [0.5, 0, 0.5, 1] };

// ---- Transport: a frame as one short string, for places that only paint (native view, widget, notification).
export const KINDS = ['edge', 'rim', 'tex', 'fill', 'bright', 'dim', 'neon', 'blush', 'eye', 'hi', 'acc', 'warn', 'good', 'tooth', 'tongue', 'smoke'];
const PARTS = Object.keys(PART); // part code 2.. = index in PARTS + 2; 1 = whole cell; 0 = a glyph

// The color and opacity of every kind, in KINDS order: [[hex, alpha], ...].
export const faceTones = (color, mode = 'dark') => KINDS.map(kind => tone(kind, color, mode));

// A frame a calm moment of: no blink, no grin, no evil. Used for still faces (lists, widget, notification).
export function calmTime(bot) {
  for (let t = 1000; t < 3000; t += 50) {
    const cyc = (t + bot.face.blinkOff) % bot.face.blink;
    if (cyc > 400 && ((t + bot.face.grinOff) % bot.face.grinPeriod) >= 900) return t;
  }
  return 1000;
}

/**
 * The cells of `grid` inside `crop`, six characters each: x, y, kind, opacity (0..100), part, glyph; every number plus 32.
 * `text` draws real characters; without it every cell is a block (pixels), as the lab does below 8 px per cell.
 */
export function encodeFrame(grid, crop, text) {
  const out = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const cell = grid[y][x]; if (!cell || cell.c === ' ') continue;
    const block = cell.c === '█' || PART[cell.c];
    const part = text && !block ? 0 : cell.c === '█' || !PART[cell.c] ? 1 : PARTS.indexOf(cell.c) + 2;
    const kind = Math.max(0, KINDS.indexOf(cell.k)); const alpha = Math.round(clamp(cell.a, 0, 1) * 100);
    out.push(String.fromCharCode(x - crop.x0 + 32, y - crop.y0 + 32, kind + 32, alpha + 32, part + 32), part === 0 ? cell.c : ' ');
  }
  return out.join('');
}

// ---- Bots: which face a bot wears, and how big its grid is on screen.
export const FACE_COLORS = [['#8FA6FF', 'Pervinca'], ['#34C9A8', 'Água'], ['#B58CFF', 'Violeta'], ['#FFB27A', 'Pêssego'], ['#FF8FB1', 'Rosa'], ['#B7C86A', 'Oliva'], ['#F2C14E', 'Sol'], ['#FF7B67', 'Coral']];
// The four colors bots had before faces; they keep their look.
export const HUES = { green: '#34C9A8', blue: '#8FA6FF', purple: '#B58CFF', orange: '#FFB27A' };
export const botSeed = bot => String(bot?.face?.seed || bot?.name || bot?.id || 'bot');
export const botColor = bot => bot?.face?.color || HUES[bot?.color] || FACE_COLORS[[...String(bot?.id || bot?.name || '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % FACE_COLORS.length][0];
export const stateName = state => state === 'sleeping' ? 'sleep' : (state || 'idle');

// Where to cut the grid and how big a cell is so the head fits a size×size box; real characters need cells of 8 px or more.
export function layout(face, size) {
  const crop = size < 90 ? face.cropTight : face.crop;
  const cols = crop.x1 - crop.x0 + 1, rows = crop.y1 - crop.y0 + 1, cellH = Math.min(size / rows, size / (cols * 0.4545)), cellW = cellH * 0.4545;
  return { crop, cols, rows, cellH, cellW, width: Math.ceil(cellW * cols), height: Math.ceil(cellH * rows), text: cellH >= 8 };
}

const stillCache = new Map();
/** A calm frame of a bot's face for a state, ready to paint: { frame, tones: '#rrggbb:alpha,…', cols, rows, text }. */
export function stillOf(bot, state, size, mode = 'dark') {
  const face = makeFace(botSeed(bot), bot?.face?.pieces || {}), l = layout(face, size), color = botColor(bot);
  const key = [botSeed(bot), JSON.stringify(bot?.face?.pieces || null), color, stateName(state), l.text, l.crop.y0, mode].join('|');
  let value = stillCache.get(key);
  if (!value) {
    if (stillCache.size > 400) stillCache.delete(stillCache.keys().next().value);
    value = { frame: encodeFrame(frameFace(face, stateName(state), calmTime(face)), l.crop, l.text), tones: faceTones(color, mode).map(([hex, alpha]) => `${hex}:${alpha}`).join(','), cols: l.cols, rows: l.rows, text: l.text };
    stillCache.set(key, value);
  }
  return value;
}
