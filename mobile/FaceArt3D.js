import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { avatar3dRender } from './termux';

// The 3D bot on the phone: a picture asked of the hidden WebView (Avatar3d.kt) and shown as an image. Still bots are drawn once and
// kept; the few that move are asked again about nine times a second. Until the first picture arrives, or if it never does, `fallback`
// (the flat face) shows.
const still = new Map(); let moving = 0; const MOVING = 3;
const picture = (bot, size, mood, animated, t) => avatar3dRender(JSON.stringify({ id: bot?.id || bot?.name || 'bot', bot: { id: bot?.id, name: bot?.name, face: bot?.face || null }, size, mood, animated, t }));

export default function FaceArt3D({ bot, size, mood, animated, fallback }) {
  const key = JSON.stringify([bot?.id || bot?.name, bot?.face || null, size, mood]);
  const [uri, setUri] = useState(() => still.get(key) || null);
  const slot = useRef(false);
  useEffect(() => {
    let alive = true; let timer = 0;
    const cached = still.get(key); if (cached) setUri(cached);
    const wantMove = Boolean(animated) && moving < MOVING;
    if (wantMove) { moving += 1; slot.current = true; }
    const ask = (t) => picture(bot, size, mood, wantMove, t).then(result => {
      if (!alive) return; if (result) { setUri(result); if (!wantMove && !still.has(key)) { still.set(key, result); if (still.size > 120) still.delete(still.keys().next().value); } }
      if (wantMove) timer = setTimeout(() => ask(performance.now() / 1000), 110);
    }).catch(() => {});
    if (wantMove || !cached) ask(performance.now() / 1000);
    return () => { alive = false; clearTimeout(timer); if (slot.current) { moving -= 1; slot.current = false; } };
  }, [key, Boolean(animated)]);
  return uri ? <Image source={{ uri }} style={{ width: size, height: size }} fadeDuration={0} /> : fallback;
}
