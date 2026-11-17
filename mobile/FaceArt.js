import React, { memo, useEffect, useRef, useState } from 'react';
import { View, AccessibilityInfo } from 'react-native';
import { moodFor, botColor } from '../lib/mimo.mjs';
import { useBotMood } from './mood-director';
import FaceArt3D from './FaceArt3D';

// Only a handful of bots move at once (measured: eight cost nothing, thirty do); the rest of a long list wears a calm still picture.
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

/**
 * What shows in a bot's place while its 3D picture is being made (or if it cannot be, say a graphics card that does not work and no
 * way to draw on the processor either): a soft cube in the bot's color with two eyes. It never pretends to be the bot's face.
 */
export function FacePlaceholder({ bot, size = 54 }) {
  const color = botColor(bot) || '#8a8f98', eye = Math.max(2, Math.round(size * 0.075));
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: size * 0.78, height: size * 0.72, borderRadius: size * 0.24, backgroundColor: color, opacity: 0.55, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: size * 0.17 }}>
      <View style={{ width: eye, height: eye * 1.5, borderRadius: eye, backgroundColor: '#10131a' }} /><View style={{ width: eye, height: eye * 1.5, borderRadius: eye, backgroundColor: '#10131a' }} />
    </View>
  </View>;
}

const NAMES = { trabalhando: 'trabalhando', esperando: 'esperando você', dormindo: 'dormindo', erro: 'com erro', concluido: 'concluído', falando: 'falando', domal: 'do mal' };

/** A bot's 3D body in a size×size box. `animated` bots move (up to eight at a time) and follow what happens to them; the rest are still. */
function FaceArt({ bot, state = 'idle', size = 54, animated = false, mood: forced }) {
  const on = useAnimation(animated && size >= 28), live = useBotMood(bot?.id);
  const mood = forced || (on && live ? live : moodFor(state));
  return <View accessible accessibilityLabel={`${bot?.name || 'Bot'}${NAMES[mood] ? `, ${NAMES[mood]}` : ''}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <FaceArt3D bot={bot} size={size} mood={mood} animated={on} fallback={<FacePlaceholder bot={bot} size={size} />} />
  </View>;
}
export default memo(FaceArt);
