// The Escritório (PC window): one floor floating in space, built from the app's rooms (office/rooms.js): rooms of
// different sizes joined by doors and halls, each decorated by its bots; bots not in any room live in the central "Escritório". Each bot is the app's particle creature in
// 3D (office/bot.js) and acts on its real state: working → its desk, waiting for you → the door, disconnected → asleep
// on its beanbag, free → it wanders and chats with the others. There is no limit of bots: particles per bot shrink
// as the team grows. Drag to move around, scroll to zoom, double-click a room to go to it, click a bot to open it.
import * as T from './vendor/three.module.js';
import { createBot } from './bot.js';
import { buildBuilding } from './rooms.js';
import { rng } from '../../lib/mimo.mjs';

const TAU = Math.PI * 2, HOP = 0.7, SPEED = 1.15;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const angleLerp = (a, b, k) => { const d = ((b - a + Math.PI * 3) % TAU) - Math.PI; return a + d * k; };
const SEEN = 'mybots.office.seen';
const seenRooms = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')); } catch { return new Set(); } };
const markSeen = id => { try { const s = seenRooms(); s.add(id); localStorage.setItem(SEEN, JSON.stringify([...s].slice(-300))); } catch {} };

export function createOffice(container, { onBotClick = () => {} } = {}) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(dpr); renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', cursor: 'grab' });
  container.append(renderer.domElement);
  const labels = document.createElement('div'); Object.assign(labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' }); container.append(labels);
  const scene = new T.Scene(); scene.background = new T.Color('#121c29');
  scene.add(new T.HemisphereLight('#d1e4ff', '#84735d', 2.2));
  const key = new T.DirectionalLight('#ffe7cc', 3.0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; scene.add(key, key.target);
  // Stars on a far shell around everything.
  { const r = rng(4411), n = 650, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const rad = 70 + r() * 50, a = r() * TAU, b = Math.acos(2 * r() - 1); p.set([rad * Math.sin(b) * Math.cos(a), rad * Math.cos(b) * 0.9, rad * Math.sin(b) * Math.sin(a)], i * 3); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); const stars = new T.Points(g, new T.PointsMaterial({ color: '#e8e6ff', size: 1.5 * dpr, sizeAttenuation: false, transparent: true, opacity: 0.8 })); stars.frustumCulled = false; scene.add(stars); }

  // Isometric camera; the view (center + zoom) is what the person drags and scrolls.
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, -200, 400), dir = new T.Vector3(14, 12.2, 14).normalize();
  const view = { center: new T.Vector3(), zoom: 1, moved: false, target: null };
  let W = 1, H = 1;
  const resize = () => { const rect = container.getBoundingClientRect(); W = Math.max(1, rect.width); H = Math.max(1, rect.height); renderer.setSize(W, H, false); };
  const placeCamera = () => { const half = 7 / view.zoom, a = W / H; Object.assign(camera, { left: -half * a, right: half * a, top: half, bottom: -half }); camera.position.copy(view.center).addScaledVector(dir, 60); camera.lookAt(view.center); camera.updateProjectionMatrix();
    key.position.copy(view.center).add(new T.Vector3(-8, 16, 10)); key.target.position.copy(view.center); const s = 14 / view.zoom; Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 60 }); key.shadow.camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(() => { resize(); if (!view.moved && typeof fit === 'function') fit(); }); ro.observe(container); resize();

  const rooms = new Map(), agents = new Map(), roomLabels = new Map();
  let snapshot = { bots: [], rooms: [] }, layoutKey = '', building = null;
  const now = () => performance.now() / 1000;

  function islands(snap) {
    const inRoom = new Set(snap.rooms.flatMap(room => room.botIds));
    const list = snap.rooms.map(room => ({ id: room.id, name: room.name, members: room.botIds.map(id => snap.bots.find(b => b.id === id)).filter(Boolean) })).filter(room => room.members.length);
    const loose = snap.bots.filter(b => !inRoom.has(b.id));
    if (loose.length || !list.length) list.unshift({ id: 'lobby', name: 'Escritório', members: loose, lobby: true });
    return list;
  }
  // Where each bot is: the room it is working in, else its first room, else the central office.
  const homeOf = (bot, snap) => { const busy = snap.rooms.find(r => r.botIds.includes(bot.id) && r.active?.includes(bot.id)); const first = snap.rooms.find(r => r.botIds.includes(bot.id)); const id = (busy || first)?.id; return id && rooms.has(id) ? id : rooms.has('lobby') ? 'lobby' : [...rooms.keys()][0]; };

  function rebuild(snap) {
    const list = islands(snap), seen = seenRooms();
    const keyNow = list.map(r => r.id + ':' + r.members.map(m => m.id + (m.face?.seed || '') + (m.instructions || '').length).join(',')).join('|');
    if (keyNow === layoutKey) return; layoutKey = keyNow;
    building?.dispose(); rooms.clear(); for (const el of roomLabels.values()) el.remove(); roomLabels.clear();
    const t = now(); building = buildBuilding(scene, list);
    for (const room of building.rooms) {
      rooms.set(room.id, room);
      // A room seen for the first time is decorated in front of you, one thing at a time, each brought by its bot.
      if (!room.lobby && !seen.has(room.id)) { room.building = { order: room.items.map((item, i) => ({ ...item, at: t + 0.6 + i * 0.55 })) }; room.items.forEach(item => item.group.scale.setScalar(0.001)); markSeen(room.id); }
      const el = document.createElement('div'); el.textContent = room.name; Object.assign(el.style, { position: 'absolute', left: 0, top: 0, padding: '5px 12px', borderRadius: '999px', background: '#0b0c0ed9', border: '1px solid #34343a', color: '#f6f3ed', font: '600 12px Inter,system-ui,sans-serif', whiteSpace: 'nowrap' }); labels.append(el); roomLabels.set(room.id, el);
    }
    for (const a of agents.values()) { a.path = null; a.wander = null; a.talk = null; a.home = null; }
    if (!view.moved) fit();
  }
  function fit() {
    if (!building) return; const [x0, z0, x1, z1] = building.bounds; view.center.set((x0 + x1) / 2, 0.6, (z0 + z1) / 2);
    // The isometric diamond is about 0.71·(w+d) wide and 0.41·(w+d) tall on screen; fit both with a margin.
    const sum = (x1 - x0) + (z1 - z0), halfH = Math.max(0.41 * sum * 0.5 + 3, (0.71 * sum * 0.5 + 2) / (W / H));
    view.zoom = Math.max(0.2, Math.min(1.4, 7 / halfH));
  }

  function syncAgents(snap) {
    const budget = Math.max(1200, Math.min(6000, Math.round(160000 / Math.max(1, snap.bots.length))));
    for (const [id, a] of agents) if (!snap.bots.some(b => b.id === id)) { a.visual.dispose(); a.tag.remove(); a.bubble.remove(); agents.delete(id); }
    snap.bots.forEach((bot, i) => {
      let a = agents.get(bot.id);
      if (!a || a.faceKey !== JSON.stringify(bot.face || null) + bot.name) {
        if (a) { a.visual.dispose(); a.tag.remove(); a.bubble.remove(); }
        const tag = document.createElement('button'), bubble = document.createElement('div');
        Object.assign(tag.style, { position: 'absolute', left: 0, top: 0, padding: '3px 10px', borderRadius: '999px', background: '#0a0b0ee8', border: '1px solid #6d6c733f', color: '#f6f3ed', font: '650 11px Inter,system-ui,sans-serif', whiteSpace: 'nowrap' });
        Object.assign(bubble.style, { position: 'absolute', left: 0, top: 0, maxWidth: '240px', padding: '7px 11px', borderRadius: '12px', background: '#f6f3ed', color: '#202126', font: '650 11px/15px Inter,system-ui,sans-serif', boxShadow: '0 3px 15px #0004', opacity: 0, transition: 'opacity .25s' });
        tag.type = 'button'; tag.style.pointerEvents = 'auto'; tag.style.cursor = 'pointer'; tag.onclick = () => onBotClick(bot.id);
        labels.append(tag, bubble); tag.textContent = bot.name;
        const home = rooms.get(homeOf(bot, snap)) || [...rooms.values()][0];
        a = { id: bot.id, faceKey: JSON.stringify(bot.face || null) + bot.name, visual: createBot(bot, scene, { particles: budget, index: i }), tag, bubble, index: i, pos: home ? home.wander[i % home.wander.length].slice() : [0, 0, 0], path: null, seg: 0, segT: 0, yaw: Math.PI / 4, state: 'idle', next: 0, r: rng(i * 31 + 7), lastState: 'idle', since: now() };
        agents.set(bot.id, a);
      }
      a.bot = bot; a.tag.textContent = bot.name; a.tag.setAttribute('aria-label', `Selecionar bot ${bot.name}`); a.home = homeOf(bot, snap);
      if (building.blocked(a.pos[0], a.pos[2])) a.pos = building.nearestFree(a.pos) || a.pos;
      if (bot.state !== a.state) { a.lastState = a.state; a.state = bot.state; a.since = now(); a.path = null; a.talk = null; if (a.lastState === 'working' && bot.state === 'idle') a.doneUntil = now() + 4; }
      a.text = bot.text || '';
    });
  }

  // Where the agent wants to be now. Everything is in world coordinates and the bots walk between rooms through the doors.
  function goalOf(a, t) {
    const room = rooms.get(a.home) || [...rooms.values()][0];
    if (a.state === 'working' && room.desks.has(a.id)) return { spot: room.desks.get(a.id), kind: 'desk', room };
    if (a.state === 'waiting') return { spot: { pos: [room.door.pos[0] + ((a.index % 3) - 1) * 0.7, 0, room.door.pos[2] - 0.2 * (a.index % 2)], yaw: 0 }, kind: 'door', room };
    if (a.state === 'sleeping' && room.beds.has(a.id)) return { spot: room.beds.get(a.id), kind: 'bed', room };
    if (a.talk && t < a.talk.until) return { spot: { pos: a.talk.spot }, kind: 'talk', room };
    if (room.building) { const item = room.building.order.find(it => it.author === a.id && it.at > t - 0.2); if (item) return { spot: { pos: [item.x + 0.9, 0, item.z + 0.6] }, kind: 'build', room }; }
    // A free spot to stroll to, in its own room most of the time and sometimes in another one; never where another bot stands or is heading.
    if (!a.wander || t > a.next) {
      const taken = p => [...agents.values()].some(o => o !== a && (Math.hypot((o.goal || o.pos)[0] - p[0], (o.goal || o.pos)[2] - p[2]) < 1.1 || Math.hypot(o.pos[0] - p[0], o.pos[2] - p[2]) < 1.1));
      const pool = a.r() < 0.18 ? [...rooms.values()][Math.floor(a.r() * rooms.size)] : room; let pick = null;
      for (let k = 0; k < 8 && !pick; k++) { const p = pool.wander[Math.floor(a.r() * pool.wander.length)]; if (!taken(p)) pick = p; }
      a.wander = pick || pool.wander[Math.floor(a.r() * pool.wander.length)]; a.next = t + 5 + a.r() * 7;
    }
    return { spot: { pos: a.wander }, kind: 'wander', room };
  }

  function step(a, dt, t) {
    if (!building) return {};
    const goal = goalOf(a, t), target = building.nearestFree(goal.spot.pos), here = building.roomAt(a.pos[0], a.pos[2]);
    if (!target) return {};
    const dist = Math.hypot(target[0] - a.pos[0], target[2] - a.pos[2]);
    if (!a.path && dist > 0.08 && t >= (a.retryAt || 0)) { a.path = building.findPath([a.pos[0], 0, a.pos[2]], [target[0], 0, target[2]]); a.seg = 1; a.segT = 0; a.goal = target; if (!a.path) a.retryAt = t + 1; }
    if (a.path && Math.hypot(a.goal[0] - target[0], a.goal[2] - target[2]) > 0.05) a.path = null;
    let jump = 0, squash = 1, moving = false;
    if (a.path) {
      // Hops: anticipation, flight, landing; the body moves only in the air.
      a.segT += dt; const phase = (a.segT % HOP) / HOP, air = phase > 0.14 && phase < 0.84, k = (phase - 0.14) / 0.7;
      const p = a.path[Math.min(a.seg, a.path.length - 1)], dx = p[0] - a.pos[0], dz = p[2] - a.pos[2], d = Math.hypot(dx, dz);
      if (air && d > 0.001) { const m = Math.min(d, SPEED * dt * 1.4); const x = a.pos[0] + dx / d * m, z = a.pos[2] + dz / d * m; if (!building.blocked(x, z)) { a.pos[0] = x; a.pos[2] = z; } a.yaw = angleLerp(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * 12)); }
      jump = air ? Math.sin(k * Math.PI) * 0.19 : 0;
      squash = phase < 0.14 ? 1 - 0.12 * Math.sin(phase / 0.14 * Math.PI) : air ? 1 + 0.09 * Math.sin(k * Math.PI) : 1 - 0.10 * Math.sin((phase - 0.84) / 0.16 * Math.PI);
      moving = true; a.pos[1] = 0;
      if (d < 0.05) { a.pos[0] = p[0]; a.pos[2] = p[2]; a.seg++; if (a.seg >= a.path.length) { a.path = null; a.pos = [p[0], 0, p[2]]; } }
    } else { const height = dist < 0.12 ? goal.spot.pos[1] || 0 : 0; a.pos[1] += (height - a.pos[1]) * Math.min(1, dt * 8); }
    // Free bots in the same room meet now and then for a little chat.
    if (a.state === 'idle' && !moving && !a.talk && here && a.r() < dt * 0.06) {
      const other = [...agents.values()].find(b => b !== a && b.state === 'idle' && !b.talk && !b.path && building.roomAt(b.pos[0], b.pos[2]) === here);
      if (other) { const until = t + 9, mid = here.wander[Math.floor(a.r() * here.wander.length)]; a.talk = { with: other.id, until, spot: [mid[0] - 0.55, 0, mid[2]] }; other.talk = { with: a.id, until, spot: [mid[0] + 0.55, 0, mid[2]] }; }
    }
    if (a.talk && t > a.talk.until) a.talk = null;
    if (!moving) {
      let want = Math.PI / 4 + Math.sin(t * 0.37 + a.index) * 0.55;
      if (goal.kind === 'desk') want = Math.PI - 1.1 * Math.max(0, Math.sin(t * 0.45 + a.index * 2.3)) ** 10;
      else if (goal.kind === 'door') want = angleLerp(0, Math.PI / 4, smooth(Math.sin(t * 0.7 + a.index) * 1.4));
      else if (goal.kind === 'bed') want = Math.PI / 2;
      else if (goal.kind === 'talk') { const o = agents.get(a.talk.with); if (o) want = Math.atan2(o.pos[0] - a.pos[0], o.pos[2] - a.pos[2]); }
      a.yaw = angleLerp(a.yaw, want, Math.min(1, dt * 4));
    }
    a.world = a.pos; a.goalKind = goal.kind;
    return { moving, jump, squash, lying: goal.kind === 'bed' && !moving && dist < 0.12, warm: goal.kind === 'desk' && !moving && dist < 0.12, talking: goal.kind === 'talk' && !moving };
  }

  const project = v => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H, p.z]; };
  let raf = 0, last = now(), running = true;
  function frame() {
    raf = requestAnimationFrame(frame); if (!running) return;
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    // Ease the camera toward a room picked with a double click.
    if (view.target) { view.center.lerp(view.target.center, Math.min(1, dt * 4)); view.zoom += (view.target.zoom - view.zoom) * Math.min(1, dt * 4); if (view.center.distanceTo(view.target.center) < 0.02) view.target = null; }
    placeCamera();
    const pixel = dpr * view.zoom * 1.6, working = new Set(), boxes = [];
    const waiting = new Set(); for (const a of agents.values()) { if (a.state === 'working' && a.goalKind === 'desk' && !a.path) working.add(a.id); if (a.state === 'waiting') waiting.add(a.home); }
    building?.update(t, working, waiting);
    for (const room of rooms.values()) {
      if (room.building) { let left = 0; for (const item of room.building.order) { const k = (t - item.at) / 0.45; if (k < 1) left++; const s = k <= 0 ? 0.001 : k >= 1 ? 1 : 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2); item.group.scale.setScalar(Math.max(0.001, s)); } if (!left) room.building = null; }
      const el = roomLabels.get(room.id), [x, y] = project(new T.Vector3(room.rect[0] + 0.2, 0, room.rect[1] + 0.2));
      el.style.transform = `translate(${x}px,${y - 30}px)`;
    }
    for (const a of agents.values()) {
      const s = step(a, dt, t); if (!a.world) continue;
      const mood = a.doneUntil > t && !s.moving ? 'concluido' : s.moving ? 'normal' : s.talking ? 'falando' : { working: 'trabalhando', waiting: 'esperando', sleeping: 'dormindo', error: 'erro' }[a.state] || 'normal';
      const lean = s.moving && !s.flying ? 0.2 * Math.min(1, s.jump / 0.3) : 0;
      const cy = a.visual.update({ pos: a.world, floor: 0, yaw: a.yaw, jump: s.jump, squash: s.squash, mood, lying: s.lying, warm: s.warm, moving: s.moving, lean, roll: a.state === 'waiting' && !s.moving ? Math.sin(t * 5) * 0.05 : 0 }, t, pixel);
      // Name below, a bubble above for work steps and approvals.
      const base = project(new T.Vector3(a.world[0], a.world[1], a.world[2])), head = project(new T.Vector3(a.world[0], cy + a.visual.height * 0.5 + 0.15, a.world[2]));
      const tw = a.tag.offsetWidth, th = a.tag.offsetHeight; let tx = base[0] - tw / 2, ty = base[1] + 10;
      for (let k = 0; k < agents.size + 1; k++) { const hit = boxes.find(b => tx < b[2] && tx + tw > b[0] && ty < b[3] && ty + th > b[1]); if (!hit) break; ty = hit[3] + 2; }
      boxes.push([tx, ty, tx + tw, ty + th]);
      const visible = base[0] > -60 && base[0] < W + 60 && base[1] > -60 && base[1] < H + 60;
      a.tag.style.transform = `translate(${tx}px,${ty}px)`; a.tag.style.opacity = visible && view.zoom > 0.35 ? 1 : 0; a.tag.style.visibility = visible && view.zoom > 0.35 ? 'visible' : 'hidden';
      const say = s.talking ? '…' : a.state === 'waiting' ? 'Preciso da sua aprovação' : a.state === 'working' && !s.moving ? (a.text || 'Trabalhando…') : a.state === 'sleeping' && s.lying ? 'z z' : '';
      if (a.bubble.textContent !== say) a.bubble.textContent = say;
      const bw = a.bubble.offsetWidth, bh = a.bubble.offsetHeight; let bx = head[0] - bw / 2, by = head[1] - bh - 8;
      for (let k = 0; k < agents.size + 1; k++) { const hit = boxes.find(b => bx < b[2] && bx + bw > b[0] && by < b[3] && by + bh > b[1]); if (!hit) break; by = hit[1] - bh - 3; }
      if (say) boxes.push([bx, by, bx + bw, by + bh]);
      a.bubble.style.transform = `translate(${bx}px,${by}px)`; a.bubble.style.opacity = say && visible && view.zoom > 0.45 ? (say === 'z z' ? 0.75 : 1) : 0;
      a.bubble.style.background = say === 'z z' ? 'transparent' : '#f6f3ed'; a.bubble.style.color = say === 'z z' ? '#c4b8fa' : '#202126'; a.bubble.style.boxShadow = say === 'z z' ? 'none' : '0 3px 15px #0004';
      a.screen = [head[0], (head[1] + base[1]) / 2];
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  const visibility = () => { running = !document.hidden; last = now(); }; document.addEventListener('visibilitychange', visibility);

  // Pointer: drag pans, wheel zooms around the pointer, double click goes to a room, click opens a bot.
  const canvas = renderer.domElement; let drag = null;
  const groundAt = (x, y) => { const ndc = new T.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), ray = new T.Raycaster(); ray.setFromCamera(ndc, camera); const p = new T.Vector3(); return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p) ? p : null; };
  const local = e => { const r = container.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drag = { start: local(e), center: view.center.clone(), moved: false }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => { if (!drag) return; const [x, y] = local(e), a = groundAt(...drag.start), b = groundAt(x, y); if (Math.hypot(x - drag.start[0], y - drag.start[1]) > 4) drag.moved = true; if (a && b && drag.moved) { view.center.copy(drag.center).add(a.sub(b).setY(0)); drag.center = view.center.clone(); drag.start = [x, y]; view.moved = true; view.target = null; } });
  canvas.addEventListener('pointerup', e => { canvas.style.cursor = 'grab'; const was = drag; drag = null; if (!was || was.moved) return; const [x, y] = local(e); let best = null, bd = 40; for (const a of agents.values()) { if (!a.screen) continue; const d = Math.hypot(a.screen[0] - x, a.screen[1] - y); if (d < bd) { bd = d; best = a; } } if (best) onBotClick(best.id); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e), before = groundAt(x, y); view.zoom = Math.max(0.2, Math.min(3, view.zoom * Math.exp(-e.deltaY * 0.0012))); placeCamera(); const after = groundAt(x, y); if (before && after) view.center.add(before.sub(after).setY(0)); view.moved = true; view.target = null; }, { passive: false });
  canvas.addEventListener('dblclick', e => { const p = groundAt(...local(e)); if (!p) return; let best = null, bd = Infinity; for (const room of rooms.values()) { const d = Math.hypot(room.origin[0] - p.x, room.origin[1] - p.z); if (d < bd) { bd = d; best = room; } } if (best) { view.target = { center: new T.Vector3(best.origin[0], 0.6, best.origin[1]), zoom: Math.min(1.3, 11 / Math.max(...best.size)) }; view.moved = true; } });

  return {
    update(next) { snapshot = next; rebuild(next); syncAgents(next); },
    fit() { view.moved = false; view.target = null; fit(); },
    debug() { return [...agents.values()].map(a => ({ id: a.id, room: a.home, state: a.state, goal: a.goalKind, pos: a.pos.map(v => +v.toFixed(2)), path: a.path?.length || 0 })); },
    focus(roomId) { const room = rooms.get(roomId); if (!room) return; view.target = { center: new T.Vector3(room.origin[0], 0.6, room.origin[1]), zoom: Math.min(1.3, 11 / Math.max(...room.size)) }; view.moved = true; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', visibility); for (const a of agents.values()) a.visual.dispose(); building?.dispose(); renderer.dispose(); canvas.remove(); labels.remove(); }
  };
}
