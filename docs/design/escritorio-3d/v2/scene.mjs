// The "Escritório" scene: a floating isometric office with the app's particle bots.
// Everything visible is a pure function of the time t (window.renderAt), so a recorder can capture frames one by one.
import * as T from 'three';
import { Mimo, specFromFace, rng } from '/lib/mimo.mjs';
import { paintFrame } from '/lib/mimo-canvas.mjs';
import { makeWorld } from './world.mjs';
import { createBot } from './particles.mjs';
import { createTimeline, NAMES, smooth, clamp, mix } from './timeline.mjs';

const params = new URLSearchParams(location.search);
const recording = params.has('record'), square = params.has('square');
const quality = params.get('q') === 'low' ? 'low' : 'high';
if (recording) document.body.classList.add('recording');
if (square) document.body.classList.add('square');
const DURATION = 30;

// The whole app is laid out at 1920×1080 (or 1080×1080) and scaled to the window, so the recorder sees exact pixels.
const app = document.getElementById('app');
const fit = () => { const w = square ? 1080 : 1920, h = 1080, k = Math.min(innerWidth / w, innerHeight / h); app.style.transform = `scale(${k})`; };
fit(); addEventListener('resize', fit);

const host = document.getElementById('canvas-host'), sceneEl = document.getElementById('scene');
const W = sceneEl.clientWidth, H = sceneEl.clientHeight;
const dpr = recording ? Number(params.get('dpr') || 1) : Math.min(devicePixelRatio || 1, quality === 'low' ? 1 : 2);
const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: recording });
renderer.setPixelRatio(dpr); renderer.setSize(W, H); renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = quality === 'high'; renderer.shadowMap.type = T.PCFSoftShadowMap;
host.append(renderer.domElement);

const scene = new T.Scene();
// Orthographic isometric camera; the push-in only changes zoom and a small drift, never the angle.
const aspect = W / H, half = square ? 6.4 : 5.9;
const camera = new T.OrthographicCamera(-half * aspect, half * aspect, half, -half, -60, 120);
const camBase = new T.Vector3(14, 12.2, 14), target = new T.Vector3(0.2, 0.55, 0.15);

// Light: cool sky, warm ground, a soft key light with shadows.
scene.add(new T.HemisphereLight('#a9acd6', '#3b2c20', 1.25));
const key = new T.DirectionalLight('#ffe3bf', 2.1); key.position.set(-7, 14, 9); key.castShadow = quality === 'high';
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new T.DirectionalLight('#8f8cff', 0.35); fill.position.set(10, 6, -6); scene.add(fill);

// Stars all around, on a large shell: a seeded field with a gentle twinkle computed from t.
const STARS = quality === 'low' ? 900 : 2200;
const starGeo = new T.BufferGeometry(), starPos = new Float32Array(STARS * 3), starSeed = new Float32Array(STARS);
{ const r = rng(4411); for (let i = 0; i < STARS; i++) { const rad = 34 + r() * 30, a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1); starPos.set([rad * Math.sin(b) * Math.cos(a), rad * Math.cos(b) * 0.9, rad * Math.sin(b) * Math.sin(a)], i * 3); starSeed[i] = r(); } }
starGeo.setAttribute('position', new T.BufferAttribute(starPos, 3)); starGeo.setAttribute('seed', new T.BufferAttribute(starSeed, 1));
const starMat = new T.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uPixel: { value: dpr } }, transparent: true, depthWrite: false,
  vertexShader: `attribute float seed;uniform float uTime,uPixel;varying float vA;varying float vWarm;void main(){vA=.35+.65*(.5+.5*sin(uTime*(.6+seed*1.8)+seed*40.));vWarm=step(.86,seed);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=uPixel*(seed>.97?2.6:1.4);}`,
  fragmentShader: `varying float vA;varying float vWarm;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(mix(vec3(.92,.93,1.),vec3(1.,.82,.55),vWarm),(1.-smoothstep(.1,.5,d))*vA);}` });
const stars = new T.Points(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);

const world = makeWorld(scene, quality);
const timeline = createTimeline();
const bots = NAMES.map((name, i) => createBot(name, scene, world, quality, i));

// ---- labels over the scene (DOM, follow the bots in 3D)
const labelsEl = document.getElementById('labels');
const labels = new Map(NAMES.map(name => {
  const tag = Object.assign(document.createElement('div'), { className: 'tag', textContent: name });
  const bubble = Object.assign(document.createElement('div'), { className: 'bubble' });
  const sleep = Object.assign(document.createElement('div'), { className: 'sleep', textContent: 'z z' });
  labelsEl.append(tag, bubble, sleep); return [name, { tag, bubble, sleep }];
}));
const project = v => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
const BUBBLE = new Set(['trabalhando', 'esperando', 'erro']);

// ---- side panel and dashboards
const STATUS = { trabalhando: ['trabalhando', '#eabb75'], esperando: ['esperando', '#ff9f7a'], normal: ['livre', '#9a9ca3'], dormindo: ['dormindo', '#b9b2ff'], concluido: ['concluído', '#75d7aa'], erro: ['com erro', '#ff6b5e'] };
const MOOD = { trabalhando: 'trabalhando', esperando: 'esperando', normal: 'normal', dormindo: 'dormindo', concluido: 'concluido', erro: 'erro' };
const DETAIL = { Lucas: 'há 12 min · 3 passos', Maniaco: 'há 4 min · navegador', Clara: 'há 2 min', Nina: 'há 6 min', 'Produtor de Terror': 'há 18 min · 5 passos', Teo: 'há 9 min' };
const list = document.getElementById('bot-list');
const cards = new Map(NAMES.map(name => {
  const card = document.createElement('article'); card.className = 'bot-card';
  card.innerHTML = `<canvas class="avatar" width="128" height="136"></canvas><div><div class="bot-title"><strong></strong><span class="status"><i class="dot"></i><b></b></span></div><div class="description"></div><div class="detail"></div></div>`;
  card.querySelector('strong').textContent = name; list.append(card);
  const mimo = new Mimo(specFromFace(null, name), { n: 3000, fill: 0.96, vfill: 0.9 });
  return [name, { card, mimo, ctx: card.querySelector('canvas').getContext('2d'), key: '' }];
}));
const drawAvatar = (c, mood) => { c.mimo.snap(mood); c.ctx.setTransform(2, 0, 0, 2, 0, 0); c.ctx.clearRect(0, 0, 64, 68); paintFrame(c.ctx, c.mimo.compute(64, 68, { light: false, energy: 0.6, dt: 1, minR: 0.32 })); };

const RANK = [['Lucas', 148], ['Maniaco', 118], ['Produtor de Terror', 88], ['Nina', 54], ['Clara', 32], ['Teo', 12]];
const barsEl = document.getElementById('bars');
const fills = RANK.map(([name, value]) => { const row = document.createElement('div'); row.className = 'bar-row'; row.innerHTML = `<span></span><div class="bar-track"><div class="bar-fill"></div></div><span class="bar-value">${value} mil</span>`; row.firstChild.textContent = name; barsEl.append(row); return [row.querySelector('.bar-fill'), value / 160]; });
const $ = id => document.getElementById(id);
const CHAPTERS = [[0, 'Um lugar para fazer acontecer.'], [5, 'Clara travou num passo e pediu sua aprovação.'], [12, 'Produtor de Terror entregou o roteiro.'], [18, 'Teo foi descansar até a próxima rotina.'], [24, 'Cada um no seu ritmo. Todos com você.']];

function updateUI(t, states) {
  const working = states.filter(s => s.state === 'trabalhando').length, waiting = states.filter(s => s.state === 'esperando');
  $('team-count').textContent = `${NAMES.length} bots · ${working} trabalhando`;
  $('tokens').textContent = `${412 + Math.floor(t * 1.4)} mil`;
  $('tasks').textContent = String(26 + (states.find(s => s.name === 'Produtor de Terror').state === 'concluido' ? 1 : 0));
  $('approvals').textContent = String(waiting.length);
  $('approval-detail').textContent = waiting.length ? `${waiting[0].name} espera você` : 'Tudo em dia';
  document.querySelector('.approval').classList.toggle('pending', waiting.length > 0);
  const chapter = CHAPTERS.filter(([at]) => at <= t).at(-1)[1]; $('chapter').lastChild.textContent = chapter;
  const grow = smooth(t / 1.8); fills.forEach(([el, k], i) => { el.style.transform = `scaleX(${k * smooth(clamp(grow * 1.4 - i * 0.08))})`; });
  for (const s of states) {
    const c = cards.get(s.name), [label, color] = STATUS[s.state];
    const key = s.state + '|' + s.text;
    if (c.key !== key) { c.key = key; c.card.querySelector('.status b').textContent = label; c.card.querySelector('.status').style.color = color; c.card.querySelector('.description').textContent = s.text; c.card.classList.toggle('hot', s.state === 'trabalhando'); c.card.classList.toggle('alert', s.state === 'esperando' || s.state === 'erro'); }
    c.card.querySelector('.detail').textContent = s.at > 0 ? (s.age < 2 ? 'agora mesmo' : `há ${Math.floor(s.age)} s`) : DETAIL[s.name];
    // The avatar is the bot's 2D face in its current mood, redrawn when the state changes.
    if (c.mood !== s.state) { c.mood = s.state; drawAvatar(c, MOOD[s.state]); }
  }
}

function placeLabels(states) {
  const boxes = [];
  for (const s of states) {
    const { tag, bubble, sleep } = labels.get(s.name), bot = bots.find(b => b.name === s.name);
    const base = project(new T.Vector3(s.pos[0], s.pos[1], s.pos[2]));
    const head = project(new T.Vector3(bot.group.position.x, bot.group.position.y + bot.height() + 0.12, bot.group.position.z));
    const inside = base[0] > 10 && base[0] < W - 10 && base[1] > 10 && base[1] < H - 10;
    tag.textContent = s.state === 'concluido' ? `${s.name} · concluído` : s.name; tag.classList.toggle('done', s.state === 'concluido');
    const tw = tag.offsetWidth, th = tag.offsetHeight; let tx = base[0] - tw / 2, ty = base[1] + 14;
    // Nudge down while overlapping an earlier label.
    for (let k = 0; k < 6; k++) { const hit = boxes.find(b => tx < b[2] && tx + tw > b[0] && ty < b[3] && ty + th > b[1]); if (!hit) break; ty = hit[3] + 3; }
    boxes.push([tx, ty, tx + tw, ty + th]);
    tag.style.transform = `translate(${tx}px,${ty}px)`; tag.style.opacity = inside ? 1 : 0;
    const showBubble = BUBBLE.has(s.state) && !s.moving && s.age > 0.4;
    bubble.textContent = s.text; const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let bx = head[0] - bw / 2, by = head[1] - bh - 16;
    for (let k = 0; k < 6; k++) { const hit = boxes.find(b => bx < b[2] && bx + bw > b[0] && by < b[3] && by + bh > b[1]); if (!hit) break; by = hit[1] - bh - 4; }
    if (showBubble) boxes.push([bx, by, bx + bw, by + bh]);
    bubble.style.transform = `translate(${bx}px,${by}px) scale(${showBubble ? 1 : 0.92})`; bubble.style.opacity = showBubble ? 1 : 0;
    const zz = s.state === 'dormindo' && !s.moving, rise = (s.age * 0.6) % 1;
    sleep.style.transform = `translate(${head[0] + 18}px,${head[1] - 26 - rise * 22}px)`; sleep.style.opacity = zz ? 0.9 * (1 - rise) : 0;
  }
}

// ---- one frame for time t (seconds)
let current = 0;
function renderAt(t) {
  current = t;
  // Slow push-in with a gentle drift, then a hold for the last seconds.
  const push = smooth(t / 26), drift = Math.sin(t * 0.21) * 0.35;
  camera.zoom = mix(0.94, 1.1, push); camera.position.copy(camBase).add(new T.Vector3(drift, 0, -drift)).add(target);
  camera.lookAt(target.clone().add(new T.Vector3(drift * 0.5, 0, -drift * 0.5))); camera.updateProjectionMatrix();
  const pixel = dpr * camera.zoom * (square ? 1.05 : 1) * 1.6;
  starMat.uniforms.uTime.value = t; stars.rotation.y = t * 0.004;
  world.update(t);
  const states = NAMES.map(name => timeline.sample(name, t));
  states.forEach((s, i) => bots[i].update(s, t, timeline, pixel));
  renderer.render(scene, camera);
  placeLabels(states); updateUI(t, states);
}

// ---- live page: requestAnimationFrame drives renderAt; the real app could call setState
let playing = !recording, start = performance.now(), offset = 0;
window.renderAt = renderAt;
window.setState = (name, state, text) => timeline.setState(name, state, text, current, true);
window.DURATION = DURATION;
const play = $('play');
play.addEventListener('click', () => { playing = !playing; if (playing) start = performance.now() - offset * 1000; play.textContent = playing ? 'Pausar' : 'Continuar'; play.setAttribute('aria-label', playing ? 'Pausar animação' : 'Continuar animação'); });
const qualitySel = $('quality'); qualitySel.value = quality;
qualitySel.addEventListener('change', () => { params.set('q', qualitySel.value); location.search = params.toString(); });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
function loop(now) {
  if (playing) { offset = ((now - start) / 1000) % DURATION; renderAt(reduced ? 8 : offset); }
  requestAnimationFrame(loop);
}
$('loading').remove();
renderAt(0);
if (!recording) requestAnimationFrame(loop);
window.ready = true;
