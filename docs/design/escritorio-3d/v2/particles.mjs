// A bot as a real 3D object made of particles: a lit shell with the shape of the app's creature (same seed, colors,
// ears, eyes and mouth), with the face fixed on the front of the body, so it turns, walks and sleeps in the room.
import * as T from 'three';
import { specFromFace, buildParticles, EYE_STYLES, rng, hashStr } from '/lib/mimo.mjs';

const TAU = Math.PI * 2;
const smoothstep = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const angleLerp = (a, b, k) => { const d = ((b - a + Math.PI * 3) % TAU) - Math.PI; return a + d * k; };
// Kinds of particle: body, eye, mouth, eye glint, teeth, cheek.
const BODY = 0, EYE = 1, MOUTH = 2, GLINT = 3, TEETH = 4, CHEEK = 5;

function shape(spec) {
  // Very square bodies are softened a little: in 3D a perfect cube reads as a box, not a creature.
  const p = Math.min(spec.squar, 4.4), sx = spec.sx, sy = spec.sy, sz = spec.sz || 0.95;
  // A point on the unit superellipsoid along a direction, and its normal.
  const radius = (x, y, z) => Math.pow(Math.abs(x) ** p + Math.abs(y) ** p + Math.abs(z) ** p, -1 / p);
  const normal = (x, y, z) => { const n = new T.Vector3(Math.sign(x) * Math.abs(x) ** (p - 1) / sx, Math.sign(y) * Math.abs(y) ** (p - 1) / sy, Math.sign(z) * Math.abs(z) ** (p - 1) / sz); return n.lengthSq() ? n.normalize() : new T.Vector3(0, 0, 1); };
  // Depth of the front face at (x, y) in body units, or null outside the silhouette.
  const front = (x, y) => { const v = 1 - Math.abs(x / sx) ** p - Math.abs(y / sy) ** p; return v > 0 ? sz * v ** (1 / p) : null; };
  return { p, sx, sy, sz, radius, normal, front };
}

// The face as regions of the front (x right, y up, body units), from the spec the 2D app uses.
function face(spec) {
  const st = EYE_STYLES[spec.eyeStyle] || EYE_STYLES.oval, rx = st[1] * 1.3 * spec.sx, ry = st[2] * 1.25 * spec.sy;
  const gap = 0.36 * spec.eyeGap * spec.sx, ey = -spec.eyeY * spec.sy + 0.04;
  const xs = spec.eyes === 1 ? [0] : spec.eyes === 3 ? [-gap * 1.15, 0, gap * 1.15] : [-gap, gap];
  const eyes = xs.map((x, i) => ({ x, y: spec.eyes === 3 && i === 1 ? ey + 0.12 : ey, rx: spec.eyes === 3 ? rx * 0.8 : rx, ry: spec.eyes === 3 ? ry * 0.8 : ry }));
  const my = ey - ry - 0.2 * spec.sy, kind = spec.mouth;
  // Mouth test returns null outside, else the local coords used for teeth and closing.
  const mouth = (x, y) => {
    const dx = x, dy = y - my;
    if (kind === 'nenhuma') return null;
    if (kind === 'pequena') return (dx / 0.09) ** 2 + (dy / 0.035) ** 2 < 1 ? [dx / 0.09, dy / 0.035] : null;
    if (kind === 'redonda') return (dx / 0.075) ** 2 + (dy / 0.085) ** 2 < 1 ? [dx / 0.075, dy / 0.085] : null;
    if (kind === 'sorriso' || kind === 'larga') { const w = kind === 'larga' ? 0.26 : 0.17, curve = 0.08 * (1 - (dx / w) ** 2), c = dy + curve; return Math.abs(dx) < w && Math.abs(c) < 0.032 ? [dx / w, c / 0.032] : null; }
    if (kind === 'dentes') return Math.abs(dx) < 0.17 && Math.abs(dy) < 0.06 ? [dx / 0.17, dy / 0.06] : null;
    if (kind === 'gato') { const w = 0.15, u = Math.abs(dx) / w, c = dy - 0.05 * Math.abs(Math.sin(u * Math.PI)); return u < 1 && Math.abs(c) < 0.026 ? [dx / w, c / 0.026] : null; }
    return null;
  };
  const cheeks = spec.blush ? xs.length > 1 ? [[-gap - 0.08, my + 0.02], [gap + 0.08, my + 0.02]] : [] : [];
  return { eyes, mouth, cheeks, my };
}

function build(spec, quality) {
  const s = shape(spec), f = face(spec), r = rng(hashStr(spec.seed + '#3d'));
  const pos = [], nor = [], kind = [], feat = [], seed = [];
  const push = (x, y, z, n, k, fx = 0, fy = 0) => { pos.push(x, y, z); nor.push(n.x, n.y, n.z); kind.push(k); feat.push(fx, fy); seed.push(r(), r()); };
  const inFace = (x, y) => f.eyes.some(e => ((x - e.x) / e.rx) ** 2 + ((y - e.y) / e.ry) ** 2 < 1) || f.mouth(x, y);
  // Shell: most particles on the surface, a few just under it so the edge reads soft.
  const shell = quality === 'low' ? 5200 : 10500;
  for (let i = 0; i < shell; i++) {
    let x, y, z, l; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < 0.05);
    const k = s.radius(x / l, y / l, z / l), depth = 1 - (r() ** 4) * 0.05, ux = x / l * k * depth, uy = y / l * k * depth, uz = z / l * k * depth;
    const px = ux * s.sx, py = uy * s.sy, pz = uz * s.sz;
    if (pz > 0 && inFace(px, py)) continue;
    const cheek = f.cheeks.find(([cx, cy]) => ((px - cx) / 0.12) ** 2 + ((py - cy) / 0.07) ** 2 < 1 && pz > 0);
    push(px, py, pz, s.normal(ux, uy, uz), cheek ? CHEEK : BODY);
  }
  // Ears or round ears on top come from the app's own particles (y up in 3D).
  const P = buildParticles(spec, 1600);
  for (let i = P.Nb; i < P.N; i++) { const x = P.x[i] * spec.sx, y = -P.y[i] * spec.sy, z = P.z[i] * (spec.sz || 0.95); push(x, y, z, new T.Vector3(x, Math.max(0.2, y - 0.8), z).normalize(), BODY); }
  // The face: filled regions laid on the front surface, slightly sunk in so the eyes have depth.
  const fill = (count, test, x0, x1, y0, y1, make) => { for (let n = 0, guard = 0; n < count && guard < count * 40; guard++) { const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), q = test(x, y); if (!q) continue; const z = s.front(x, y); if (z == null) continue; make(x, y, z, q); n++; } };
  for (const e of f.eyes) {
    const count = Math.round((quality === 'low' ? 260 : 520) * (e.rx * e.ry) / 0.05);
    fill(count, (x, y) => { const fx = (x - e.x) / e.rx, fy = (y - e.y) / e.ry; return fx * fx + fy * fy < 1 ? [fx, fy] : null; }, e.x - e.rx, e.x + e.rx, e.y - e.ry, e.y + e.ry,
      (x, y, z, [fx, fy]) => { const glint = (fx + 0.32) ** 2 + (fy - 0.4) ** 2 < 0.075; push(x, y, z - 0.008, new T.Vector3(0, 0, 1), glint ? GLINT : EYE, fx, fy); });
  }
  fill(quality === 'low' ? 160 : 320, f.mouth, -0.3, 0.3, f.my - 0.12, f.my + 0.12, (x, y, z, [fx, fy]) => push(x, y, z - 0.006, new T.Vector3(0, 0, 1), spec.mouth === 'dentes' && fy > 0.05 ? TEETH : MOUTH, fx, fy));
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('aKind', new T.Float32BufferAttribute(kind, 1)); g.setAttribute('aFeat', new T.Float32BufferAttribute(feat, 2)); g.setAttribute('aSeed', new T.Float32BufferAttribute(seed, 2));
  return g;
}

const vertexShader = `
attribute float aKind; attribute vec2 aFeat; attribute vec2 aSeed;
uniform float uTime, uPixel, uBlink, uMouthOpen, uError;
uniform vec3 uLightW;
varying vec3 vColorMix; varying float vKind; varying float vLight; varying float vRim;
void main(){
  vec3 p = position;
  // A faint shimmer keeps it alive as particles; errors shake it.
  float t = uTime * (0.7 + aSeed.y * 0.6);
  p += 0.006 * vec3(sin(t + aSeed.x * 40.), cos(t * 1.1 + aSeed.x * 31.), sin(t * 0.9 + aSeed.x * 17.));
  p.x += sin(uTime * 38. + aSeed.x * 9.) * uError * 0.025;
  float k = aKind;
  // Eyelids: eye particles outside the open part take the body color (blink, sleep, squint).
  if ((k == 1. || k == 3.) && abs(aFeat.y) > uBlink) k = 0.;
  if ((k == 1. || k == 3.) && uBlink < 0.3 && aFeat.y > 0.) k = 0.;
  // A closed mouth keeps only its middle line.
  if ((k == 2. || k == 4.) && abs(aFeat.y) > max(0.28, uMouthOpen)) k = 0.;
  vKind = k;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vec3 n = normalize(normalMatrix * normal);
  vec3 L = normalize((viewMatrix * vec4(uLightW, 0.)).xyz);
  vLight = 0.5 + 0.62 * max(dot(n, L), 0.) + 0.12 * n.y;
  vRim = pow(1. - max(n.z, 0.), 2.2);
  vColorMix = vec3(aSeed, 0.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * (k > 0.5 ? 1.25 : 1.0 + aSeed.y * 0.45);
}`;
const fragmentShader = `
uniform vec3 uColor, uDeep; uniform float uWarm, uError, uTime;
varying vec3 vColorMix; varying float vKind; varying float vLight; varying float vRim;
void main(){
  vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard;
  vec3 body = mix(uDeep, uColor, 0.55 + 0.45 * vColorMix.x);
  body = mix(body, vec3(1., 0.72, 0.38), uWarm * 0.18);
  body = mix(body, vec3(1., 0.22, 0.16), uError * (0.55 + 0.25 * sin(uTime * 20.)));
  vec3 col = body * vLight + uColor * vRim * 0.55 + 0.05 * vColorMix.y;
  // A few grains sparkle, like the app's particles.
  col += vec3(1.0, 0.95, 0.85) * step(0.988, vColorMix.y) * (0.18 + 0.18 * sin(uTime * 3. + vColorMix.x * 50.));
  if (vKind == 1.) col = vec3(0.035, 0.035, 0.05) + 0.06 * vRim;
  else if (vKind == 2.) col = vec3(0.06, 0.035, 0.04);
  else if (vKind == 3.) col = vec3(0.95, 0.95, 1.0);
  else if (vKind == 4.) col = vec3(0.93, 0.9, 0.84);
  else if (vKind == 5.) col = mix(body * vLight, vec3(1., 0.55, 0.62), 0.55);
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}`;

export function createBot(name, scene, world, quality, index) {
  const spec = specFromFace(null, name), base = 0.6;
  const color = new T.Color(`hsl(${spec.hue},62%,66%)`), deep = new T.Color(`hsl(${spec.hue},55%,42%)`);
  const u = { uTime: { value: 0 }, uPixel: { value: 2 }, uBlink: { value: 1 }, uMouthOpen: { value: 1 }, uError: { value: 0 }, uWarm: { value: 0 }, uColor: { value: color }, uDeep: { value: deep }, uLightW: { value: new T.Vector3(-7, 14, 9).normalize() } };
  const material = new T.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader });
  material.toneMapped = false;
  const pts = new T.Points(build(spec, quality), material); pts.frustumCulled = false;
  // body: the particles; group: position and facing; the body is lifted so its bottom stands on the floor.
  const body = new T.Group(), group = new T.Group(); body.add(pts); group.add(body); group.rotation.order = 'YXZ'; scene.add(group);
  const shadow = world.shadow(0, 0, 1.5, 1.3), halo = world.glow(color, 0, 1, 0, 1.6, 0.06);

  // The trail of glowing particles left by each hop, fading with age (computed from the timeline, so it is deterministic).
  const count = quality === 'low' ? 90 : 220, trailPos = new Float32Array(count * 3), trailAlpha = new Float32Array(count), trailGeo = new T.BufferGeometry();
  trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('alpha', new T.BufferAttribute(trailAlpha, 1));
  const trailMat = new T.ShaderMaterial({ uniforms: { color: { value: color }, pixel: { value: 1 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `attribute float alpha;varying float vAlpha;uniform float pixel;void main(){vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pixel*(1.4+alpha*2.2);}`,
    fragmentShader: `varying float vAlpha;uniform vec3 color;void main(){float d=length(gl_PointCoord-.5);if(d>.5||vAlpha<.01)discard;gl_FragColor=vec4(color,(1.-smoothstep(.1,.5,d))*vAlpha*.8);\n#include <colorspace_fragment>\n}` });
  const trail = new T.Points(trailGeo, trailMat); trail.frustumCulled = false; scene.add(trail);

  // Where it looks when it is not walking.
  const restYaw = (s, t) => {
    const pulse = k => Math.max(0, Math.sin(t * k + index * 2.3)) ** 10;
    if (s.state === 'trabalhando') return Math.PI - 1.15 * pulse(0.45);          // at the monitor, glancing back now and then
    if (s.state === 'erro') return Math.PI - 0.6 + Math.sin(t * 3) * 0.25;
    if (s.state === 'esperando') return angleLerp(-Math.PI / 2, Math.PI / 4, smoothstep(Math.sin(t * 0.7 + index) * 1.4));  // at the door, turning to you
    if (s.state === 'dormindo') return Math.PI / 2;
    if (s.state === 'concluido') return t * 0.9;
    return Math.PI / 4 + Math.sin(t * 0.37 + index) * 0.95;                      // looking around
  };
  const heading = (t, timeline) => { const a = timeline.sample(name, t - 0.09).pos, b = timeline.sample(name, t + 0.09).pos; const dx = b[0] - a[0], dz = b[2] - a[2]; return Math.hypot(dx, dz) > 0.004 ? Math.atan2(dx, dz) : null; };

  function update(s, t, timeline, pixel) {
    const sleepy = s.state === 'dormindo' && !s.moving, working = s.state === 'trabalhando' && !s.moving;
    // Facing: the way it walks; after arriving it turns smoothly to its resting direction.
    let yaw;
    if (s.moving) yaw = heading(t, timeline) ?? restYaw(s, t);
    else {
      let since = null, last = null;
      for (let k = 1; k <= 8; k++) { const back = timeline.sample(name, t - k * 0.1); if (back.moving) { since = k * 0.1; last = heading(t - k * 0.1, timeline); break; } }
      yaw = since != null && last != null ? angleLerp(last, restYaw(s, t), smoothstep(since / 0.8)) : restYaw(s, t);
    }
    const breath = 1 + Math.sin(t * 2.1 + index * 1.7) * 0.02;
    const lean = s.moving ? 0.22 * Math.sin(Math.min(1, s.jump / 0.36) * Math.PI * 0.5) : 0;
    group.rotation.set(sleepy ? -1.2 : lean, yaw, s.state === 'esperando' && !s.moving ? Math.sin(t * 5) * 0.05 : working ? Math.sin(t * 9 + index) * 0.02 : 0);
    // Squash and stretch around the feet.
    const sq = s.squash * breath; body.scale.set(base / Math.sqrt(sq), base * sq, base / Math.sqrt(sq));
    body.position.y = sleepy ? 0 : spec.sy * base * sq;
    const shake = s.state === 'erro' ? Math.sin(t * 31) * 0.04 : 0;
    group.position.set(s.pos[0] + shake, s.pos[1] + s.jump + (sleepy ? 0.36 : 0) + (working ? Math.abs(Math.sin(t * 7 + index)) * 0.015 : 0), s.pos[2]);
    // Eyes: a blink every few seconds; asleep they stay shut; working they squint a little; done, they smile.
    const bc = (t + index * 0.73) % 4.6, blink = bc > 4.38 ? 1 - Math.sin((bc - 4.38) / 0.22 * Math.PI) * 0.95 : 1;
    u.uBlink.value = sleepy ? 0.16 : s.state === 'concluido' ? 0.55 : (working ? 0.82 : 1) * blink;
    u.uMouthOpen.value = sleepy ? 0 : s.state === 'concluido' ? 1 : 0.9;
    u.uTime.value = t; u.uWarm.value = working ? 1 : 0; u.uError.value = s.state === 'erro' ? 1 : 0; u.uPixel.value = pixel * 1.38;
    shadow.position.set(s.pos[0], s.pos[1] + 0.018, s.pos[2]); shadow.scale.setScalar(1 - s.jump * 0.4);
    shadow.material.opacity = s.state === 'concluido' ? Math.max(0, 0.7 - s.age * 0.12) : 0.6 - s.jump * 0.3;
    halo.position.set(group.position.x, group.position.y + spec.sy * base, group.position.z); halo.material.opacity = sleepy ? 0.03 : 0.06; halo.scale.setScalar(1.7);
    trailMat.uniforms.pixel.value = pixel;
    for (let i = 0; i < count; i++) {
      const age = (i / count) * 1.1, old = timeline.sample(name, Math.max(0, t - age)), h = (i * 17.318) % TAU, spread = 0.06 + age * 0.3, p = old.pos;
      trailPos[i * 3] = p[0] + Math.sin(h * 3.1) * spread; trailPos[i * 3 + 1] = p[1] + 0.12 + old.jump * 0.55 + Math.abs(Math.sin(h * 2.1)) * spread * 0.7; trailPos[i * 3 + 2] = p[2] + Math.cos(h * 2.2) * spread;
      trailAlpha[i] = old.moving ? (1 - age / 1.1) * 0.75 : 0;
      if (s.state === 'concluido') { const phase = (t * 0.55 + i / count) % 1, a = i * 2.399 + t * 0.2; trailPos[i * 3] = group.position.x + Math.cos(a) * (0.55 + phase * 0.8); trailPos[i * 3 + 1] = group.position.y + spec.sy * base + Math.sin(a * 1.7) * (0.4 + phase * 0.4); trailPos[i * 3 + 2] = group.position.z + Math.sin(a) * (0.55 + phase * 0.8); trailAlpha[i] = (1 - phase) * 0.85; }
    }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.alpha.needsUpdate = true;
  }
  // `group` keeps the bot's place; labels use its position and the body height.
  return { spec, group, update, name, height: () => spec.sy * base * 2 };
}
