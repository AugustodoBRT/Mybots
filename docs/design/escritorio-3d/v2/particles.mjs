// A bot in 3D with the app's own creature code (lib/mimo.mjs): the same particles (buildParticles), the same flow, the
// same face made by pushing particles away from the eyes and mouth (Mimo.compute's `repel`), the same mood numbers
// (MOODS via Mimo.snap) and the same colors (bucketColor: lighter in front, darker behind, glowing dust around).
// The only change is that the body is a real object in the room: the face stays on its front and it turns with it.
import * as T from 'three';
import { Mimo, specFromFace, buildParticles, EYE_STYLES } from '/lib/mimo.mjs';

const TAU = Math.PI * 2, MAX_HOLES = 8;
const smoothstep = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const angleLerp = (a, b, k) => { const d = ((b - a + Math.PI * 3) % TAU) - Math.PI; return a + d * k; };

// The same holes Mimo.compute makes (eyes, third eye, mouth), in face units with y pointing down. `thick` is the
// app's widening for small faces (the bots in the room are 70–110 px tall, between the app's small and big faces).
function holesFor(spec, c, blink, thick = 0.45) {
  const holes = [], [, bw, bh] = EYE_STYLES[spec.eyeStyle], one = spec.eyes === 1, gap = spec.eyeGap, SX = spec.sx, SY = spec.sy, thk = 1 + 0.75 * thick, minH = 0.013 + 0.03 * thick;
  for (const ex of one ? [0] : [-0.34 * gap, 0.34 * gap]) {
    const side = one ? 0 : ex < 0 ? -1 : 1, big = one ? 1.5 : 1, cs = 1 + c.asym * (side === -1 ? 1 : side === 1 ? -0.9 : 0);
    let w = bw * big * c.ew * cs, h = Math.max(minH, bh * big * c.eo * (c.eo > 0.2 ? blink : 1) * cs), curve = c.ec;
    if (side === 1 && c.wink > 0) { h = h + (0.03 - h) * c.wink; curve += c.wink * 0.12; w *= 1 + 0.12 * c.wink; }
    const x = ex * SX, y = (spec.eyeY + c.ey + side * c.asym * 0.25) * SY;
    holes.push([x, y, w * SX * thk, Math.max(minH, h) * SY * (1 + 0.35 * thick), -side * c.et, curve, 1 - c.x]);
    if (c.x > 0.02) for (const a of [Math.PI / 4, -Math.PI / 4]) holes.push([x, y, 0.2 * SX * thk, Math.max(0.032, 0.032 * thk) * SY, a, 0, c.x]);
  }
  if (spec.eyes === 3) holes.push([0, (spec.eyeY - 0.34) * SY, 0.075 * SX * thk, 0.095 * SY * thk, 0, 0, 1 - c.x]);
  const rest = smoothstep(c.rest);
  if (rest > 0.01 && spec.mouth !== 'nenhuma') {
    const y = (spec.mouth === 'redonda' ? 0.42 : 0.41) * SY, add = (x, w, h, cv, ang = 0) => holes.push([x * SX, y, w * SX * thk, Math.max(h, 0.02 + 0.025 * thick) * SY, ang, cv, rest]);
    switch (spec.mouth) { case 'pequena': add(0, 0.09, 0.022, 0); break; case 'sorriso': add(0, 0.17, 0.035, -0.09); break; case 'larga': add(0, 0.3, 0.05, -0.12); break; case 'redonda': add(0, 0.075, 0.09, 0); break;
      case 'dentes': [-0.13, -0.045, 0.045, 0.13].forEach((x, i) => add(x, 0.03, 0.05, 0, i % 2 ? 0.45 : -0.45)); break; case 'gato': add(-0.075, 0.085, 0.024, -0.1); add(0.075, 0.085, 0.024, -0.1); break; }
  }
  const mo = (1 - rest) * c.mo;
  if (mo > 0.01) holes.push([0, c.my * SY, c.mw * SX * thk, Math.max(0.02 + 0.025 * thick, c.mh) * SY * (1 + 0.3 * thick), 0, c.mc, smoothstep(mo)]);
  return holes.slice(0, MAX_HOLES);
}

const flowGLSL = `
attribute vec4 aGrain;   // phase, speed, size, light
attribute float aDust;
uniform float uTime, uFlow, uEnergy;
vec3 flowed(vec3 p){
  float ph = aGrain.x, tt = uTime * aGrain.y * uEnergy;
  p.x += sin(tt + ph + p.y * 3.) * uFlow; p.y += cos(tt * 1.1 + ph + p.x * 3.) * uFlow; p.z += sin(tt * .8 + ph) * uFlow;
  if (aDust > .5) { float orbit = .06 + .12 * (1. + sin(tt)); p *= 1. + orbit; }
  return p;
}`;

const vertexShader = `${flowGLSL}
uniform vec3 uScaleXYZ; uniform float uPixel, uShake, uTanE;
uniform vec4 uHoleA[${MAX_HOLES}]; uniform vec4 uHoleB[${MAX_HOLES}]; uniform int uHoles;
uniform vec3 uLightW;
varying float vDepth; varying float vLight; varying float vDust; varying float vShade; varying float vSocket;
float inside(vec2 p, vec4 A, vec4 B){ vec2 d = p - A.xy; float u2 = d.x * B.x + d.y * B.y, v = -d.x * B.y + d.y * B.x; float bend = B.z * (pow(clamp(u2 / A.z, -1.7, 1.7), 2.) - 1.); return length(vec2(u2 / A.z, (v - bend) / A.w)) < 1.25 ? B.w : 0.; }
vec2 repel(vec2 p, vec4 A, vec4 B){
  vec2 d = p - A.xy; float R = 3.4 * max(A.z, A.w) * 1.08; if (dot(d, d) > R * R) return vec2(0.);
  float c = B.x, s = B.y, curve = B.z, amt = B.w;
  float u2 = d.x * c + d.y * s, v = -d.x * s + d.y * c;
  float bend = curve * (pow(clamp(u2 / A.z, -1.7, 1.7), 2.) - 1.), vv = v - bend;
  float nx = u2 / A.z, ny = vv / A.w, r = length(vec2(nx, ny)), outer = 3.4;
  if (r >= outer) return vec2(0.);
  float edge = 1. + min(.017 / A.w, .65), reach = sqrt(edge * edge + (1. - edge * edge / (outer * outer)) * r * r);
  float force = (reach - r) * amt, inv = 1. / max(r, 1e-4), du = nx * inv * force * A.z, dv = ny * inv * force * A.w;
  dv += curve * (pow(clamp((u2 + du) / A.z, -1.7, 1.7), 2.) - 1.) - bend;
  return vec2(du * c - dv * s, du * s + dv * c);
}
void main(){
  vec3 q = flowed(position);
  q.x += uShake * sin(uTime * 33. + aGrain.x);
  // App space (y down) scaled by the body proportions, then the face holes push the front particles aside.
  vec3 p = q * uScaleXYZ;
  // The room's camera looks down (~32°): the face is opened along that line of sight, so the eyes and mouth stay
  // open from above, the way the app's 2D face is opened along the screen.
  vec2 f = vec2(p.x, p.y + .06 * uScaleXYZ.y - (uScaleXYZ.z - p.z) * uTanE);
  vec2 off = vec2(0.);
  float hole = 0.;
  for (int i = 0; i < ${MAX_HOLES}; i++) { if (i >= uHoles) break; off += repel(f, uHoleA[i], uHoleB[i]); hole = max(hole, inside(f, uHoleA[i], uHoleB[i])); }
  // The front of the body opens like in the app; what you see deep inside an eye or mouth is the dark socket
  // (in the app the hole shows the dark background).
  float front = smoothstep(-.3, .05, q.z);
  vSocket = hole * (1. - front) * smoothstep(-.8, -.45, q.z);
  p.xy += off * front;
  vec3 local = vec3(p.x, -p.y, p.z);
  vec4 mv = modelViewMatrix * vec4(local, 1.);
  vec4 center = modelViewMatrix * vec4(0., 0., 0., 1.);
  float scale = length((modelViewMatrix * vec4(1., 0., 0., 0.)).xyz);
  // bucketColor's depth: particles nearer the viewer are lighter.
  vDepth = clamp(((mv.z - center.z) / scale + 1.2) / 2.4, 0., 1.);
  vLight = aGrain.w; vDust = aDust;
  vec3 n = normalize(normalMatrix * (local + vec3(0., 0., 1e-4)));
  vShade = .8 + .28 * max(dot(n, normalize((viewMatrix * vec4(uLightW, 0.)).xyz)), 0.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * aGrain.z * (aDust > .5 ? .72 : 1.);
}`;

// bucketColor, with the bucket steps smoothed: hsl(hue, 54%, 34 + depth·36 + light·15) and alpha .86; dust is hsl(hue, 76%, 72%) at .6.
const fragmentShader = `
uniform float uHue, uDim, uWarm;
varying float vDepth; varying float vLight; varying float vDust; varying float vShade; varying float vSocket;
vec3 hsl(float h, float s, float l){ vec3 k = mod(vec3(0., 8., 4.) + h / 30., 12.); float a = s * min(l, 1. - l); return l - a * max(vec3(-1.), min(min(k - 3., 9. - k), vec3(1.))); }
void main(){
  vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25) discard;
  float lv = vLight < .33 ? .17 : vLight < .66 ? .5 : .83;
  float l = (34. + vDepth * 36. + lv * 15.) / 100. * (1. - .5 * uDim);
  vec3 col = vDust > .5 ? hsl(uHue, .76, .72) : hsl(uHue, .54, l) * vShade;
  col = mix(col, vec3(1., .74, .42), uWarm * .14);
  col = mix(col, hsl(uHue, .35, .05), vSocket);
  float alpha = vDust > .5 ? .6 : .86;
  // The app's colors are sRGB; the renderer works in linear light.
  col = pow(col, vec3(2.2));
  gl_FragColor = vec4(col, alpha * (1. - smoothstep(.16, .25, d) * .5));
  #include <colorspace_fragment>
}`;

// The glow: the same particles again, as big soft additive dots in the bot's color.
const glowVertex = `${flowGLSL}
uniform vec3 uScaleXYZ; uniform float uPixel;
void main(){ vec3 p = flowed(position) * uScaleXYZ; gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, p.z, 1.); gl_PointSize = uPixel * (aDust > .5 ? 3. : 5.); }`;
const glowFragment = `
uniform vec3 uColor; uniform float uGlow;
void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; float k = 1. - d * 2.; gl_FragColor = vec4(uColor, k * k * uGlow);
  #include <colorspace_fragment>
}`;

export function createBot(name, scene, world, quality, index) {
  const spec = specFromFace(null, name), base = 0.6, N = quality === 'low' ? 3500 : 7000;
  const P = buildParticles(spec, N), g = new T.BufferGeometry();
  const pos = new Float32Array(N * 3), grain = new Float32Array(N * 4), dust = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([P.x[i], P.y[i], P.z[i]], i * 3); grain.set([P.ph[i], P.speed[i], P.size[i] * spec.dot, P.light[i]], i * 4); dust[i] = P.dust[i]; }
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aGrain', new T.BufferAttribute(grain, 4)); g.setAttribute('aDust', new T.BufferAttribute(dust, 1));
  const color = new T.Color(`hsl(${spec.hue},62%,66%)`);
  const shared = { uTime: { value: 0 }, uFlow: { value: 0.024 }, uEnergy: { value: 1 }, uScaleXYZ: { value: new T.Vector3(spec.sx, spec.sy, spec.sz) }, uPixel: { value: 2 } };
  const u = { ...shared, uShake: { value: 0 }, uTanE: { value: 0.62 }, uHoleA: { value: Array.from({ length: MAX_HOLES }, () => new T.Vector4()) }, uHoleB: { value: Array.from({ length: MAX_HOLES }, () => new T.Vector4()) }, uHoles: { value: 0 },
    uLightW: { value: new T.Vector3(-7, 14, 9).normalize() }, uHue: { value: spec.hue }, uDim: { value: 0 }, uWarm: { value: 0 } };
  const material = new T.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, transparent: true, depthWrite: true }); material.toneMapped = false;
  const glowU = { ...shared, uColor: { value: color.clone() }, uGlow: { value: 0.03 } };
  const glowMat = new T.ShaderMaterial({ uniforms: glowU, vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: T.AdditiveBlending }); glowMat.toneMapped = false;
  const pts = new T.Points(g, material), glowPts = new T.Points(g, glowMat); pts.frustumCulled = glowPts.frustumCulled = false; glowPts.renderOrder = 2;
  const body = new T.Group(), group = new T.Group(); body.add(glowPts, pts); group.add(body); group.rotation.order = 'YXZ'; scene.add(group);
  const shadow = world.shadow(0, 0, 1.5, 1.3), halo = world.glow(color, 0, 1, 0, 2.2, 0.12);
  const glowLight = new T.PointLight(color, 1.6, 2.6, 2); scene.add(glowLight);
  // Each mood's numbers, exactly as the app has them (Mimo.snap applies MOODS[m].p over NEUTRAL).
  const mimo = new Mimo(spec), moods = new Map(), moodOf = m => { if (!moods.has(m)) { mimo.snap(m); moods.set(m, { ...mimo.cur }); } return moods.get(m); };

  // The trail of glowing particles left by each hop (from the timeline, so any frame can be rendered alone).
  const count = quality === 'low' ? 90 : 220, trailPos = new Float32Array(count * 3), trailAlpha = new Float32Array(count), trailGeo = new T.BufferGeometry();
  trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('alpha', new T.BufferAttribute(trailAlpha, 1));
  const trailMat = new T.ShaderMaterial({ uniforms: { color: { value: color }, pixel: { value: 1 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `attribute float alpha;varying float vAlpha;uniform float pixel;void main(){vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pixel*(1.4+alpha*2.2);}`,
    fragmentShader: `varying float vAlpha;uniform vec3 color;void main(){float d=length(gl_PointCoord-.5);if(d>.5||vAlpha<.01)discard;gl_FragColor=vec4(color,(1.-smoothstep(.1,.5,d))*vAlpha*.8);\n#include <colorspace_fragment>\n}` });
  const trail = new T.Points(trailGeo, trailMat); trail.frustumCulled = false; scene.add(trail);

  const restYaw = (s, t) => {
    const pulse = k => Math.max(0, Math.sin(t * k + index * 2.3)) ** 10;
    if (s.state === 'trabalhando') return Math.PI - 1.15 * pulse(0.45);
    if (s.state === 'erro') return Math.PI - 0.6 + Math.sin(t * 3) * 0.25;
    if (s.state === 'esperando') return angleLerp(-Math.PI / 2, Math.PI / 4, smoothstep(Math.sin(t * 0.7 + index) * 1.4));
    if (s.state === 'dormindo') return Math.PI / 2;
    if (s.state === 'concluido') return t * 0.9;
    return Math.PI / 4 + Math.sin(t * 0.37 + index) * 0.55;   // looking around, mostly toward you
  };
  const heading = (t, timeline) => { const a = timeline.sample(name, t - 0.09).pos, b = timeline.sample(name, t + 0.09).pos; const dx = b[0] - a[0], dz = b[2] - a[2]; return Math.hypot(dx, dz) > 0.004 ? Math.atan2(dx, dz) : null; };

  function update(s, t, timeline, pixel) {
    const sleepy = s.state === 'dormindo' && !s.moving, working = s.state === 'trabalhando' && !s.moving;
    let yaw;
    if (s.moving) yaw = heading(t, timeline) ?? restYaw(s, t);
    else {
      let since = null, last = null;
      for (let k = 1; k <= 8; k++) { const back = timeline.sample(name, t - k * 0.1); if (back.moving) { since = k * 0.1; last = heading(t - k * 0.1, timeline); break; } }
      yaw = since != null && last != null ? angleLerp(last, restYaw(s, t), smoothstep(since / 0.8)) : restYaw(s, t);
    }
    // The app's mood numbers drive the face; walking uses the plain face.
    const c = moodOf(s.moving ? 'normal' : s.state);
    const bc = (t + spec.seed.length * 0.37 + index * 0.9) % 5.2, blink = bc > 4.9 ? 1 - Math.sin((bc - 4.9) / 0.3 * Math.PI) * 0.96 : 1;
    const holes = holesFor(spec, c, blink); u.uHoles.value = holes.length;
    holes.forEach(([x, y, w, h, angle, curve, amount], i) => { u.uHoleA.value[i].set(x, y, w, h); u.uHoleB.value[i].set(Math.cos(angle), Math.sin(angle), curve, amount); });
    const hue = c.hm > 0 ? c.hue : spec.hue;
    u.uHue.value = hue; u.uDim.value = c.dim; u.uShake.value = c.shake; u.uWarm.value = working ? 1 : 0;
    shared.uTime.value = t; shared.uEnergy.value = 0.65 + 0.6 * c.en; shared.uPixel.value = pixel * 1.55;
    glowU.uGlow.value = sleepy ? 0.006 : s.state === 'concluido' ? 0.02 : 0.012;
    glowU.uColor.value.setHSL(hue / 360, 0.7, 0.62);
    const lean = s.moving ? 0.22 * Math.sin(Math.min(1, s.jump / 0.36) * Math.PI * 0.5) : 0;
    group.rotation.set(sleepy ? -1.2 : lean, yaw, s.state === 'esperando' && !s.moving ? Math.sin(t * 5) * 0.05 : working ? Math.sin(t * 9 + index) * 0.02 : 0);
    const breath = 1 + Math.sin(t * 2 * (0.6 + c.en * 0.4)) * 0.017, sq = s.squash * c.squash * breath;
    body.scale.set(base / Math.sqrt(sq), base * sq, base / Math.sqrt(sq));
    body.position.y = sleepy ? 0 : spec.sy * base * sq * 1.02;
    group.position.set(s.pos[0], s.pos[1] + s.jump + (sleepy ? 0.36 : 0) + (working ? Math.abs(Math.sin(t * 7 + index)) * 0.015 : 0), s.pos[2]);
    shadow.position.set(s.pos[0], s.pos[1] + 0.018, s.pos[2]); shadow.scale.setScalar(1 - s.jump * 0.4);
    shadow.material.opacity = s.state === 'concluido' ? Math.max(0, 0.7 - s.age * 0.12) : 0.6 - s.jump * 0.3;
    const cy = group.position.y + (sleepy ? 0 : spec.sy * base);
    halo.position.set(group.position.x, cy, group.position.z); halo.material.color.copy(glowU.uColor.value); halo.material.opacity = sleepy ? 0.06 : 0.13;
    // The glow also lights the floor and furniture around it, a little.
    glowLight.position.set(group.position.x, cy, group.position.z); glowLight.color.copy(glowU.uColor.value); glowLight.intensity = sleepy ? 0.6 : 1.6;
    trailMat.uniforms.pixel.value = pixel;
    for (let i = 0; i < count; i++) {
      const age = (i / count) * 1.1, old = timeline.sample(name, Math.max(0, t - age)), h = (i * 17.318) % TAU, spread = 0.06 + age * 0.3, p = old.pos;
      trailPos[i * 3] = p[0] + Math.sin(h * 3.1) * spread; trailPos[i * 3 + 1] = p[1] + 0.12 + old.jump * 0.55 + Math.abs(Math.sin(h * 2.1)) * spread * 0.7; trailPos[i * 3 + 2] = p[2] + Math.cos(h * 2.2) * spread;
      trailAlpha[i] = old.moving ? (1 - age / 1.1) * 0.75 : 0;
      if (s.state === 'concluido') { const phase = (t * 0.55 + i / count) % 1, a = i * 2.399 + t * 0.2; trailPos[i * 3] = group.position.x + Math.cos(a) * (0.55 + phase * 0.8); trailPos[i * 3 + 1] = cy + Math.sin(a * 1.7) * (0.4 + phase * 0.4); trailPos[i * 3 + 2] = group.position.z + Math.sin(a) * (0.55 + phase * 0.8); trailAlpha[i] = (1 - phase) * 0.85; }
    }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.alpha.needsUpdate = true;
  }
  return { spec, group, update, name, height: () => spec.sy * base * 2 };
}
