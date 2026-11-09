// The Android app's opening screen: one 3D bot (the same body as everywhere else) in a visible WebView, drawn at the screen's frame rate.
// It drops in, then hops in a loop while the app wakes up; when the app is ready it gives one happy spinning jump and says "done", and
// the app fades the screen away. Inspired by the usual guidance for launch screens: a short looping animation while loading, a clear
// ending, and a short fade (no artificial wait). Built by scripts/build-avatar3d.mjs into assets/splash3d.html.
import * as T from './vendor/three.module.js';
import { createBot } from './bot.js';

const bridge = globalThis.MyBotsSplash;
const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'; document.body.appendChild(canvas);
const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1)); renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92; renderer.setClearColor(0x000000, 0);
const scene = new T.Scene();
scene.add(new T.HemisphereLight('#d1e4ff', '#84735d', 1.6));
const key = new T.DirectionalLight('#ffe7cc', 2.4); key.position.set(-8, 16, 10); scene.add(key);
const params = new URLSearchParams(location.search);
const visual = createBot({ id: params.get('id') || 'mybots', name: params.get('name') || 'MyBots', face: (() => { try { return JSON.parse(params.get('face') || 'null'); } catch { return null; } })() }, scene, { particles: 8000 });
visual.grainAlpha(0.55);
const tall = visual.height, half = tall * 1.25;
const camera = new T.OrthographicCamera(-half, half, half, -half, -50, 50);
camera.position.set(0, tall * 0.5 + 12.2, 19.8); camera.lookAt(0, tall * 0.85, 0);
let pixel = 2;
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  const aspect = w / h; camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
  pixel = Math.max(1.6, (h * renderer.getPixelRatio()) / (2 * half) * 0.032);
}
addEventListener('resize', resize); resize();

const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const HOP = 1.5, DROP = 0.7, FINALE = 1.1;
let start = null, finishAt = null, finished = false, shown = false;
// One hop: crouch (anticipation), up stretched, down, land squashed, settle. Every third hop it spins around in the air.
function hop(t, n, height, spin) {
  const p = t / HOP, view = { jump: 0, squash: 1, spin: 0, air: false };
  if (p < 0.16) view.squash = 1 - 0.14 * Math.sin(Math.PI * p / 0.16);
  else if (p < 0.66) { const q = (p - 0.16) / 0.5; view.jump = height * Math.sin(Math.PI * q); view.squash = 1 + 0.08 * Math.sin(Math.PI * q); view.air = true; if (spin) view.spin = Math.PI * 2 * ease(q); }
  else if (p < 0.82) view.squash = 1 - 0.12 * Math.sin(Math.PI * (p - 0.66) / 0.16);
  return view;
}
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000; if (start === null) start = t; const s = t - start;
  const view = { pos: [0, 0, 0], floor: 0, yaw: 0.35 * Math.sin(s * 0.9), mood: 'normal', moving: false, jump: 0, squash: 1 };
  if (s < DROP) {   // falls in from above and lands with a squash
    const q = s / DROP; view.jump = tall * 2.4 * (1 - q * q); view.squash = q > 0.85 ? 1 - 0.18 * Math.sin(Math.PI * (q - 0.85) / 0.15) : 1.06; view.moving = true;
  } else if (finishAt === null || s < finishAt) {
    const k = s - DROP, n = Math.floor(k / HOP), h = hop(k - n * HOP, n, tall * 0.5, n % 3 === 2);
    view.jump = h.jump; view.squash = h.squash; view.yaw += h.spin; view.moving = h.air; view.mood = n % 4 === 1 ? 'trabalhando' : 'normal';
  } else {   // ready: one big happy spinning jump, then "done"
    const q = Math.min(1, (s - finishAt) / FINALE), h = hop(q * HOP, 0, tall * 0.9, true);
    view.jump = h.jump; view.squash = h.squash; view.yaw = h.spin; view.moving = h.air; view.mood = 'concluido';
    if (q >= 1 && !finished) { finished = true; try { bridge?.done(); } catch {} }
  }
  visual.update(view, s, pixel); renderer.render(scene, camera);
  if (!shown) { shown = true; try { bridge?.shown(); } catch {} }
}
requestAnimationFrame(frame);
// The app is ready: finish the hop under way (so the bot is on the ground), then the finale.
globalThis.mybotsSplash = {
  finish() {
    if (finishAt !== null || start === null) { if (start === null) try { bridge?.done(); } catch {} return; }
    const s = performance.now() / 1000 - start; if (s < DROP) { finishAt = DROP; return; }
    const k = s - DROP; finishAt = DROP + Math.ceil(k / HOP) * HOP;
    if (finishAt - s > HOP * 0.7) finishAt -= HOP; if (finishAt < s) finishAt = s;
  }
};
