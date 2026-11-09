// One live 3D bot for a visible native view (Bot3dView in the Android app): the same body and framing as the avatars (avatar.js), but
// drawn straight to the screen at the display's frame rate instead of as pictures sent to the app. Used for the big bot of the Chefe's
// empty conversation. The app changes its mood with mybotsLive.set({ mood }). Built by scripts/build-avatar3d.mjs into assets/live3d.html.
import * as T from './vendor/three.module.js';
import { createBot } from './bot.js';

const bridge = globalThis.MyBotsLive;
const params = new URLSearchParams(location.search);
const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'; document.body.appendChild(canvas);
const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1)); renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92; renderer.setClearColor(0x000000, 0);
const scene = new T.Scene();
scene.add(new T.HemisphereLight('#d1e4ff', '#84735d', 1.6));
const key = new T.DirectionalLight('#ffe7cc', 2.4); key.position.set(-8, 16, 10); scene.add(key);
let face = null; try { face = JSON.parse(params.get('face') || 'null'); } catch {}
const visual = createBot({ id: params.get('id') || 'bot', name: params.get('name') || 'Bot', face }, scene, { particles: 9000 });
visual.grainAlpha(0.55); visual.hideShadow();
// The avatar's framing (avatar.js), so the live bot sits exactly where its still picture was.
const tall = visual.height, half = tall * 0.74;
const camera = new T.OrthographicCamera(-half, half, half, -half, -50, 50);
camera.position.set(0, tall * 0.5 + 12.2, 19.8); camera.lookAt(0, tall * 0.56, 0); camera.updateProjectionMatrix();
let pixel = 2;
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); pixel = Math.max(1.6, (Math.min(w, h) * renderer.getPixelRatio()) / (2 * half) * 0.032); }
addEventListener('resize', resize); resize();
const state = { mood: params.get('mood') || 'normal' };
globalThis.mybotsLive = { set({ mood }) { if (typeof mood === 'string') state.mood = mood; } };
let shown = false;
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  visual.update({ pos: [0, 0, 0], floor: 0, yaw: Math.sin(t * 0.7) * 0.32, mood: state.mood, moving: false }, t, pixel);
  renderer.render(scene, camera);
  if (!shown) { shown = true; try { bridge?.shown(); } catch {} }
}
requestAnimationFrame(frame);
