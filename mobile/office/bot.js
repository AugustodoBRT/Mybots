// A bot of the Escritório, live: the app's creature (lib/mimo.mjs) as a 3D particle body (the same particles, flow,
// face holes, moods and colors), with a glow and a trail of particles left by its hops. Moved by office/engine.js.
import * as T from './vendor/three.module.js';
import { Mimo, specFromFace, buildParticles, EYE_STYLES } from '../../lib/mimo.mjs';

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
uniform float uHue, uDim, uWarm, uAlpha;
varying float vDepth; varying float vLight; varying float vDust; varying float vShade; varying float vSocket;
vec3 hsl(float h, float s, float l){ vec3 k = mod(vec3(0., 8., 4.) + h / 30., 12.); float a = s * min(l, 1. - l); return l - a * max(vec3(-1.), min(min(k - 3., 9. - k), vec3(1.))); }
void main(){
  vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25) discard;
  float lv = vLight < .33 ? .17 : vLight < .66 ? .5 : .83;
  float l = (34. + vDepth * 36. + lv * 15.) / 100. * (1. - .5 * uDim);
  vec3 col = vDust > .5 ? hsl(uHue, .76, .72) : hsl(uHue, .54, l) * vShade;
  col = mix(col, vec3(1., .74, .42), uWarm * .14);
  col = mix(col, hsl(uHue, .35, .05), vSocket);
  float alpha = vDust > .5 ? .35 : uAlpha;
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


/**
 * One bot. `view` is what the engine decided this frame: position (feet), yaw, jump, squash, mood (an app mood name),
 * lying (asleep), warm (lit by its monitor), moving. Particle count is chosen by the engine from how many bots there are.
 */
export function createBot(bot, scene, { particles = 6000, index = 0 } = {}) {
  const spec = specFromFace(bot.face, bot.name || bot.id), base = 0.46, N = Math.max(800, Math.round(particles));
  const P = buildParticles(spec, N), g = new T.BufferGeometry();
  const pos = new Float32Array(N * 3), grain = new Float32Array(N * 4), dust = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([P.x[i], P.y[i], P.z[i]], i * 3); grain.set([P.ph[i], P.speed[i], P.size[i] * spec.dot, P.light[i]], i * 4); dust[i] = P.dust[i]; }
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aGrain', new T.BufferAttribute(grain, 4)); g.setAttribute('aDust', new T.BufferAttribute(dust, 1));
  const color = new T.Color().setHSL(spec.hue / 360, 0.62, 0.66);
  const shared = { uTime: { value: 0 }, uFlow: { value: 0.010 }, uEnergy: { value: 1 }, uScaleXYZ: { value: new T.Vector3(spec.sx, spec.sy, spec.sz) }, uPixel: { value: 2 } };
  const u = { ...shared, uShake: { value: 0 }, uTanE: { value: 0.62 }, uHoleA: { value: Array.from({ length: MAX_HOLES }, () => new T.Vector4()) }, uHoleB: { value: Array.from({ length: MAX_HOLES }, () => new T.Vector4()) }, uHoles: { value: 0 },
    uLightW: { value: new T.Vector3(-7, 14, 9).normalize() }, uHue: { value: spec.hue }, uDim: { value: 0 }, uWarm: { value: 0 }, uAlpha: { value: 0.32 } };
  const material = new T.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, transparent: true, depthWrite: false }); material.toneMapped = false;
  const glowU = { ...shared, uColor: { value: color.clone() }, uGlow: { value: 0.012 } };
  const glowMat = new T.ShaderMaterial({ uniforms: glowU, vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: T.AdditiveBlending }); glowMat.toneMapped = false;
  const pts = new T.Points(g, material), glowPts = new T.Points(g, glowMat); pts.frustumCulled = glowPts.frustumCulled = false; glowPts.renderOrder = 2;
  const body = new T.Group(), group = new T.Group(); body.add(glowPts, pts); group.add(body); group.rotation.order = 'YXZ'; scene.add(group);
  // A quiet solid silhouette underneath the grains keeps small bots readable.
  const shellGeo = new T.SphereGeometry(1, 32, 24), vertices = shellGeo.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const length = (Math.abs(x) ** spec.squar + Math.abs(y) ** spec.squar + Math.abs(z) ** spec.squar) ** (1 / spec.squar);
    vertices.setXYZ(i, x / length * spec.sx * 0.97, y / length * spec.sy * 0.97, z / length * spec.sz * 0.97);
  }
  shellGeo.computeVertexNormals();
  const shellMat = new T.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05 });
  const shell = new T.Mesh(shellGeo, shellMat); shell.castShadow = true; body.add(shell);
  const face = new T.Group(); face.position.set(0, 0.16, spec.sz * 0.96); face.rotation.x = -0.24; body.add(face);
  const ink = new T.MeshBasicMaterial({ color: '#172431' }), eyeGeo = new T.SphereGeometry(1, 16, 12);
  const eyes = (spec.eyes === 1 ? [0] : [-0.34 * spec.eyeGap, 0.34 * spec.eyeGap]).map(x => {
    const eye = new T.Mesh(eyeGeo, ink); eye.position.set(x * spec.sx, -spec.eyeY * spec.sy, 0.02); face.add(eye); return eye;
  });
  if (spec.eyes === 3) { const eye = new T.Mesh(eyeGeo, ink); eye.position.set(0, -spec.eyeY * spec.sy + 0.32, 0.02); face.add(eye); eyes.push(eye); }
  const mouth = new T.Mesh(eyeGeo, ink); mouth.position.set(0, -0.34 * spec.sy, 0.025); face.add(mouth);
  // Soft contact shadow and a little light of its own color on what is around it.
  let noShadow = false;
  const shadow = new T.Mesh(new T.CircleGeometry(0.62, 28), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.4, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  const light = new T.PointLight(color, 1.4, 2.6, 2); scene.add(light);
  const mimo = new Mimo(spec), moods = new Map(), moodOf = m => { if (!moods.has(m)) { mimo.snap(m); moods.set(m, { ...mimo.cur }); } return moods.get(m); };

  // Trail: a ring of particles dropped while it hops, each fading out over a second.
  const count = 160, trailPos = new Float32Array(count * 3), trailAlpha = new Float32Array(count), born = new Float32Array(count).fill(-99); let next = 0, lastDrop = 0;
  const trailGeo = new T.BufferGeometry(); trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('alpha', new T.BufferAttribute(trailAlpha, 1));
  const trailMat = new T.ShaderMaterial({ uniforms: { color: { value: color }, pixel: { value: 1 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `attribute float alpha;varying float vAlpha;uniform float pixel;void main(){vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pixel*(1.4+alpha*2.2);}`,
    fragmentShader: `varying float vAlpha;uniform vec3 color;void main(){float d=length(gl_PointCoord-.5);if(d>.5||vAlpha<.01)discard;gl_FragColor=vec4(color,(1.-smoothstep(.1,.5,d))*vAlpha*.8);\n#include <colorspace_fragment>\n}` });
  const trail = new T.Points(trailGeo, trailMat); trail.frustumCulled = false; scene.add(trail);
  let seed = index * 97 + 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  let previousTime = null;
  const expression = { ...moodOf('normal') };
  function update(view, t, pixel) {
    const desired = moodOf(view.mood || 'normal'), blend = 1 - Math.exp(-Math.min(0.05, previousTime == null ? 0.016 : t - previousTime) * 9); previousTime = t;
    for (const key of Object.keys(desired)) expression[key] = typeof desired[key] === 'number' ? expression[key] + (desired[key] - expression[key]) * blend : desired[key];
    const c = expression;
    const bc = (t + spec.seed.length * 0.37 + index * 0.9) % 5.2, blink = bc > 4.9 ? 1 - Math.sin((bc - 4.9) / 0.3 * Math.PI) * 0.96 : 1;
    const [, eyeWidth, eyeHeight] = EYE_STYLES[spec.eyeStyle];
    eyes.forEach((eye, i) => { const third = i === 2, size = spec.eyes === 1 ? 1.3 : 1; eye.scale.set((third ? 0.075 : eyeWidth * 0.75 * size) * c.ew, Math.max(0.018, (third ? 0.10 : eyeHeight * 0.75 * size) * c.eo * blink), 0.045); });
    mouth.visible = spec.mouth !== 'nenhuma' || c.mo > 0.1; mouth.scale.set(0.11 + c.mo * 0.07, 0.026 + c.mo * 0.08, 0.035);
    // A mood with its own color (waiting, error) pulls the hue toward it by how active the mood is; calm moods keep the bot's own hue.
    const hue = (spec.hue + (((c.hue - spec.hue + 540) % 360) - 180) * Math.min(1, Math.max(0, c.hm)) + 360) % 360;
    shellMat.color.setHSL(hue / 360, 0.46, view.lying ? 0.38 : 0.59);
    const holes = holesFor(spec, c, blink); u.uHoles.value = holes.length;
    holes.forEach(([x, y, w, h, angle, curve, amount], i) => { u.uHoleA.value[i].set(x, y, w, h); u.uHoleB.value[i].set(Math.cos(angle), Math.sin(angle), curve, amount); });
    u.uHue.value = hue; u.uDim.value = c.dim; u.uShake.value = c.shake; u.uWarm.value = view.warm ? 1 : 0;
    shared.uTime.value = t; shared.uEnergy.value = 0.65 + 0.6 * c.en; shared.uPixel.value = pixel * 1.05;
    glowU.uColor.value.setHSL(hue / 360, 0.7, 0.62); glowU.uGlow.value = view.lying ? 0.006 : view.mood === 'concluido' ? 0.02 : 0.012;
    group.rotation.set(view.lying ? -1.2 : view.lean || 0, view.yaw, view.roll || 0);
    const breath = 1 + Math.sin(t * 2 * (0.6 + c.en * 0.4) + index) * 0.017, sq = (view.squash || 1) * c.squash * breath;
    body.scale.set(base / Math.sqrt(sq), base * sq, base / Math.sqrt(sq)); body.position.y = view.lying ? 0 : spec.sy * base * sq * 1.02;
    group.position.set(view.pos[0], view.pos[1] + (view.jump || 0) + (view.lying ? 0.36 : 0), view.pos[2]);
    group.visible = view.visible !== false;
    shadow.position.set(view.pos[0], (view.floor ?? view.pos[1]) + 0.02, view.pos[2]); shadow.scale.setScalar(1 - Math.min(0.6, (view.jump || 0) * 0.4)); shadow.material.opacity = view.flying ? 0 : 0.42 - (view.jump || 0) * 0.25; shadow.visible = group.visible && !noShadow;
    const cy = group.position.y + (view.lying ? 0 : spec.sy * base);
    light.position.set(group.position.x, cy, group.position.z); light.color.copy(glowU.uColor.value); light.intensity = view.lying ? 0.12 : 0.35; light.visible = group.visible;
    // Drop trail grains while in the air or flying; age all of them.
    if ((view.moving || view.flying) && t - lastDrop > 0.016) { lastDrop = t; for (let k = 0; k < 3; k++) { const i = next; next = (next + 1) % count; born[i] = t; trailPos.set([group.position.x + (rnd() - 0.5) * 0.4, group.position.y + 0.12 + rnd() * 0.5, group.position.z + (rnd() - 0.5) * 0.4], i * 3); } }
    for (let i = 0; i < count; i++) { const age = t - born[i]; trailAlpha[i] = age < 1.1 ? (1 - age / 1.1) * 0.75 : 0; if (age < 1.1) trailPos[i * 3 + 1] += 0.0025; }
    trailMat.uniforms.pixel.value = pixel; trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.alpha.needsUpdate = true;
    return cy;
  }
  function dispose() { for (const o of [group, shadow, light, trail]) scene.remove(o); shellGeo.dispose(); shellMat.dispose(); eyeGeo.dispose(); ink.dispose(); g.dispose(); material.dispose(); glowMat.dispose(); trailGeo.dispose(); trailMat.dispose(); shadow.geometry.dispose(); shadow.material.dispose(); }
  return { spec, update, dispose, height: spec.sy * base * 2, color, hideShadow: () => { noShadow = true; shadow.visible = false; }, grainAlpha: value => { u.uAlpha.value = value; } };
}
