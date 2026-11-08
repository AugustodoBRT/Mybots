// The Escritório's 3D bot (office/bot.js) as an avatar anywhere in the computer's window: one shared WebGL renderer draws
// every avatar in turn and copies the picture into that avatar's own 2D canvas, so a list of fifty bots still uses a
// single GPU context (browsers allow only a few). Animated avatars are redrawn together at 30 frames a second.
import * as T from './vendor/three.module.js';
import { createBot } from './bot.js';

// Drawn at twice the size it is shown and scaled down (smooth edges, fine grains), on a canvas at least 2x the CSS size
// so it is sharp on ordinary screens too.
const MAX = 1024, SHOWN = 512, SS = 2, live = new Set();
let renderer = null, raf = 0, last = 0;

function gl() {
  if (renderer) return renderer;
  renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(1); renderer.setSize(MAX, MAX, false);
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.setClearColor(0x000000, 0); renderer.setScissorTest(true);
  return renderer;
}

function loop(now) {
  raf = live.size ? requestAnimationFrame(loop) : 0;
  if (now - last < 33) return;
  last = now;
  for (const avatar of live) avatar.draw(now / 1000);
}

/** Draws `bot` into `canvas` (CSS size × size). Returns { set({ mood, animated }), dispose() }. */
export function mountAvatar(canvas, bot, { size, mood = 'normal', animated = false, index = 0, manual = false, dpr: forced }) {
  const dpr = forced || Math.max(2, Math.min(3, globalThis.devicePixelRatio || 1)), px = Math.min(SHOWN, Math.round(size * dpr)), rp = Math.min(MAX, px * SS);
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d'), scene = new T.Scene();
  scene.add(new T.HemisphereLight('#d1e4ff', '#84735d', 1.6));
  const key = new T.DirectionalLight('#ffe7cc', 2.4); key.position.set(-8, 16, 10); scene.add(key);
  const visual = createBot(bot, scene, { particles: px >= 300 ? 11000 : px >= 160 ? 8000 : 5000, index });
  visual.grainAlpha(0.55); visual.hideShadow();
  // The room's camera height (~32° down), so the face opens the same way; seen from the front instead of the corner.
  const tall = visual.height, half = tall * 0.74, camera = new T.OrthographicCamera(-half, half, half, -half, -50, 50);
  camera.position.set(0, tall * 0.5 + 12.2, 19.8); camera.lookAt(0, tall * 0.56, 0); camera.updateProjectionMatrix();
  // Point size follows the pixels per world unit, a bit coarser than in the room so the grains (and ears, horns, hair
  // made only of grains) still read at avatar size.
  const pixel = Math.max(1.6, rp / (2 * half) * 0.032);
  const state = { mood, animated, t: index * 0.7 };
  const draw = t => {
    state.t = t ?? state.t;
    const sway = state.animated ? Math.sin(state.t * 0.7 + index) * 0.32 : 0.18, view = { pos: [0, 0, 0], floor: 0, yaw: sway, mood: state.mood, moving: false };
    // A still avatar is drawn once: let its expression reach the mood first (the bot eases between moods over time).
    if (!state.animated) { for (let i = 0; i < 40; i++) visual.update(view, state.t + i * 0.05, pixel); state.t += 2; }
    else visual.update(view, state.t, pixel);
    const r = gl();
    r.setViewport(0, 0, rp, rp); r.setScissor(0, 0, rp, rp); r.clear(); r.render(scene, camera);
    ctx.clearRect(0, 0, px, px); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(r.domElement, 0, MAX - rp, rp, rp, 0, 0, px, px);
  };
  // `manual`: the caller draws each frame itself (the Android app asks for pictures), so no loop of its own.
  const run = () => { if (manual) return; if (state.animated) { live.add(api); if (!raf) raf = requestAnimationFrame(loop); } else { live.delete(api); draw(); } };
  const api = {
    draw,
    set({ mood: nextMood = state.mood, animated: nextAnimated = state.animated }) {
      const changed = nextMood !== state.mood || nextAnimated !== state.animated;
      state.mood = nextMood; state.animated = nextAnimated;
      if (changed) run();
    },
    dispose() { live.delete(api); visual.dispose(); }
  };
  draw(index * 0.7); run();
  return api;
}
