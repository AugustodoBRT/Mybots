import React, { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { avatar3dRender } from './termux';

// The 3D bot on the phone: a picture asked of the hidden WebView (Avatar3d.kt) and shown as an image. Still bots are drawn once and
// kept; the few that move are asked again about nine times a second. Until the first picture arrives, or if it never does, `fallback`
// (the flat face) shows.
const LOG = false; const frames = []; let lastAt = performance.now();
const still = new Map(); let moving = 0, movingBig = 0; const MOVING = 2, BIG = 150;
// One WebView draws every picture one after another (about 30 a second in all), so three small bots moving at once left each with 10.
// The big face (the Chefe's) always gets its own place, and is drawn at 80% of its size and shown larger: it is soft dust anyway.
const SCALE = 0.8;
const picture = (bot, size, mood, animated, t) => avatar3dRender(JSON.stringify({ id: bot?.id || bot?.name || 'bot', bot: { id: bot?.id, name: bot?.name, face: bot?.face || null }, size: size >= BIG ? Math.round(size * SCALE) : size, mood, animated, t }));

export default function FaceArt3D({ bot, size, mood, animated, fallback }) {
  const key = JSON.stringify([bot?.id || bot?.name, bot?.face || null, size, mood]);
  // Two layers: `shown` stays on screen while `next` decodes on top of it and only takes over once it has loaded. Swapping one
  // image for another directly leaves a blank frame in between on Android, which was the blinking of the moving bot.
  const [shown, setShown] = useState(() => still.get(key) || null);
  const [next, setNext] = useState(null);
  const slot = useRef(false); const gate = useRef(null);
  useEffect(() => {
    let alive = true; let timer = 0; let failures = 0;
    const big = size >= BIG; const wantMove = Boolean(animated) && (big ? movingBig < 1 : moving < MOVING);
    const cached = wantMove ? null : still.get(key);
    if (cached) { setNext(cached); }
    if (wantMove) { if (big) movingBig += 1; else moving += 1; slot.current = big ? 'big' : 'small'; }
    const again = () => { if (!alive) return; failures += 1; if (wantMove) timer = setTimeout(() => ask(performance.now() / 1000), 110); else if (failures < 6) timer = setTimeout(() => ask(performance.now() / 1000), 700 * failures); };
    const ask = (t) => picture(bot, size, mood, wantMove, t).then(result => {
      if (!alive) return;
      if (!result) { again(); return; }
      failures = 0; setNext(result);
      if (LOG) { const now = performance.now(); frames.push(now - lastAt); lastAt = now; if (frames.length >= 20) { console.log('[3d] ms por quadro: ' + Math.round(frames.reduce((a, b) => a + b, 0) / frames.length) + ' tamanho ' + size); frames.length = 0; } }
      if (!wantMove && !still.has(key)) { still.set(key, result); if (still.size > 120) still.delete(still.keys().next().value); }
      // The next picture is asked as soon as this one is on screen, not on a fixed beat: the pace is whatever the phone can do.
      if (wantMove) new Promise(done => { gate.current = done; timer = setTimeout(done, 160); }).then(() => { if (alive) ask(performance.now() / 1000); });
    }).catch(again);
    if (wantMove || !cached) ask(performance.now() / 1000);
    return () => { alive = false; clearTimeout(timer); if (slot.current) { if (slot.current === 'big') movingBig -= 1; else moving -= 1; slot.current = false; } };
  }, [key, Boolean(animated)]);
  if (!shown && !next) return fallback;
  const box = { width: size, height: size };
  return <View style={box}>
    {shown ? <Image source={{ uri: shown }} style={[box, { position: 'absolute' }]} fadeDuration={0} /> : fallback}
    {next && next !== shown ? <Image key={next.length + ':' + next.slice(-24)} source={{ uri: next }} style={[box, { position: 'absolute' }]} fadeDuration={0} onLoad={() => { setShown(next); const done = gate.current; gate.current = null; done?.(); }} onError={() => setNext(null)} /> : null}
  </View>;
}
