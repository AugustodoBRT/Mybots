import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, AccessibilityInfo, Platform } from 'react-native';
import { MimoView } from './termux';
import { Mimo, specFromFace, particleCount, moodFor } from '../lib/mimo.mjs';
import { paintFrame } from '../lib/mimo-canvas.mjs';
import { currentTheme } from './theme';
import { useBotMood } from './mood-director';

// Only a handful of bots move at once (measured: eight cost nothing, thirty do); the rest of a long list wears a calm still frame.
const MAX_ANIMATED = 8; const slots = new Set();
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then(value => { reduceMotion = value; }).catch(() => {});
function useAnimation(wanted) {
  const id = useRef({}).current; const [on, setOn] = useState(false);
  useEffect(() => {
    if (!wanted || reduceMotion || slots.size >= MAX_ANIMATED) return undefined;
    slots.add(id); setOn(true); return () => { slots.delete(id); setOn(false); };
  }, [wanted]);
  return on;
}

// The computer's window: the same simulation as the phone, drawn on a canvas (30 frames a second while it moves).
function WebFace({ spec, mood, size, light, on }) {
  const ref = useRef(null), sim = useRef(null), live = useRef({ mood, light }); live.current = { mood, light };
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return undefined;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1); canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const small = size <= 150, m = sim.current = new Mimo(spec, { n: particleCount(size, true), fill: small ? 0.96 : 0.9, vfill: small ? 0.92 : 0.78 });
    const paint = dt => paintFrame(ctx, m.compute(size, size, { light: live.current.light === 'light', energy: 0.6, dt }));
    if (!on) { m.snap(live.current.mood); paint(1); return undefined; }
    m.snap(live.current.mood); let raf = 0, last = 0;
    const loop = now => { raf = requestAnimationFrame(loop); if (now - last < 33) return; const dt = Math.min(0.05, (now - (last || now - 33)) / 1000); last = now; m.setMood(live.current.mood); m.update(dt); paint(dt); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [spec, size, on]);
  useEffect(() => { const m = sim.current; if (m && !on) { m.snap(mood); m.compute(size, size, { light: light === 'light', dt: 1 }); const ctx = ref.current?.getContext('2d'); if (ctx) paintFrame(ctx, m.compute(size, size, { light: light === 'light', energy: 0.6, dt: 1 })); } }, [mood, light]);
  return React.createElement('canvas', { ref, style: { width: size, height: size } });
}

const NAMES = { trabalhando: 'trabalhando', esperando: 'esperando você', dormindo: 'dormindo', erro: 'com erro', concluido: 'concluído', falando: 'falando', domal: 'do mal' };

/** A bot's particle body in a size×size box. `animated` bots move (up to eight at a time) and follow what happens to them; the rest are still. */
function FaceArt({ bot, state = 'idle', size = 54, animated = false, mood: forced }) {
  const faceKey = JSON.stringify([bot?.face || null, bot?.name || null, bot?.id || null]);
  const spec = useMemo(() => specFromFace(bot?.face, bot?.name || bot?.id), [faceKey]);
  const specJson = useMemo(() => JSON.stringify(spec), [spec]);
  const on = useAnimation(animated && size >= 28), live = useBotMood(bot?.id);
  const mood = forced || (on && live ? live : moodFor(state)), light = currentTheme();
  const count = particleCount(size, true);
  return <View accessible accessibilityLabel={`${bot?.name || 'Bot'}${NAMES[mood] ? `, ${NAMES[mood]}` : ''}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    {MimoView ? <MimoView style={{ width: size, height: size }} spec={specJson} mood={mood} light={light === 'light'} energy={0.6} count={count} animated={on} fps={60} />
      : Platform.OS === 'web' ? <WebFace spec={spec} mood={mood} size={size} light={light} on={on} /> : null}
  </View>;
}
export default memo(FaceArt);
