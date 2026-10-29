import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, AccessibilityInfo, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FaceView } from './termux';
import { faceOf, layout, tonesText, frameAt, gridAt, stillOf, botColor } from './faces';
import { faceTones, KINDS, PART, tone, calmTime } from '../lib/face.mjs';
import { currentTheme } from './theme';

// One clock for every animated face, a few repaints a second, and only a handful of faces animate at once:
// the rest of a long list wears a calm still frame (measured: 8 animated faces cost nothing, 30 do).
const FPS = 8, MAX_ANIMATED = 8;
const listeners = new Set(); const slots = new Set(); let timer = null; let started = 0;
function subscribe(fn) {
  listeners.add(fn);
  if (!timer) { started = Date.now(); timer = setInterval(() => { const t = Date.now() - started; listeners.forEach(listener => listener(t)); }, 1000 / FPS); }
  return () => { listeners.delete(fn); if (!listeners.size && timer) { clearInterval(timer); timer = null; } };
}
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then(value => { reduceMotion = value; }).catch(() => {});

function useAnimation(wanted) {
  const id = useRef({}).current; const [on, setOn] = useState(false); const [t, setT] = useState(0);
  useEffect(() => {
    if (!wanted || reduceMotion || slots.size >= MAX_ANIMATED) return undefined;
    slots.add(id); setOn(true);
    const stop = subscribe(setT);
    return () => { stop(); slots.delete(id); setOn(false); };
  }, [wanted]);
  return [on, t];
}

// Painted by a native view: the JS side only hands over a frame string and the colors.
function Native({ bot, face, state, size, mode, on, t }) {
  const l = layout(face, size), color = botColor(bot);
  const tones = useMemo(() => tonesText(color, mode), [color, mode]);
  const still = on ? null : stillOf(bot, state, size, mode);
  return <FaceView style={{ width: l.width, height: l.height }} frame={still ? still.frame : frameAt(face, state, t, size)} tones={still ? still.tones : tones} grid={[l.cols, l.rows]} text={l.text} />;
}

// Where there is no native view (the computer's window): rectangles grouped by color in one Path each.
function Vector({ bot, face, state, size, mode, on, t }) {
  const l = layout(face, size), tones = faceTones(botColor(bot), mode), grid = gridAt(face, state, on ? t : 1050);
  const paths = new Map(), parts = Object.keys(PART);
  for (let y = l.crop.y0; y <= l.crop.y1; y++) for (let x = l.crop.x0; x <= l.crop.x1; x++) {
    const cell = grid[y][x]; if (!cell || cell.c === ' ') continue;
    const [hex, ka] = tones[Math.max(0, KINDS.indexOf(cell.k))], alpha = Math.round(cell.a * ka * 10) / 10, i = parts.indexOf(cell.c), q = i >= 0 ? PART[parts[i]] : [0, 0, 1, 1];
    const key = hex + alpha;
    paths.set(key, (paths.get(key) || '') + `M${x - l.crop.x0 + q[0]} ${y - l.crop.y0 + q[1]}h${q[2]}v${q[3]}h${-q[2]}z`);
  }
  return <Svg width={l.width} height={l.height} viewBox={`0 0 ${l.cols} ${l.rows}`} preserveAspectRatio="none">
    {[...paths].map(([key, d]) => <Path key={key} d={d} fill={key.slice(0, 7)} fillOpacity={Number(key.slice(7))} />)}
  </Svg>;
}

// The computer's window: a canvas, like the lab. Real characters (the embedded BotGlyphs font) when each cell is 8 px or more.
function WebCanvas({ bot, face, state, size, mode, on, t }) {
  const l = layout(face, size), color = botColor(bot), ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return undefined;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1); canvas.width = Math.round(l.width * dpr); canvas.height = Math.round(l.height * dpr);
    const paint = () => {
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, l.width, l.height);
      const grid = gridAt(face, state, on ? t : calmTime(face)), cw = l.width / l.cols, ch = l.height / l.rows;
      if (l.text) { ctx.font = `${ch / 1.32}px BotGlyphs, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; }
      for (let y = l.crop.y0; y <= l.crop.y1; y++) for (let x = l.crop.x0; x <= l.crop.x1; x++) {
        const cell = grid[y][x]; if (!cell || cell.c === ' ') continue;
        const [hex, alpha] = tone(cell.k, color, mode); ctx.globalAlpha = Math.max(0, Math.min(1, alpha * cell.a)); ctx.fillStyle = hex;
        const px = (x - l.crop.x0) * cw, py = (y - l.crop.y0) * ch, quad = PART[cell.c], block = cell.c === '█' || quad;
        if (l.text && !block) ctx.fillText(cell.c, px + cw / 2, py + ch * 0.7727);
        else { const q = quad || [0, 0, 1, 1]; ctx.fillRect(Math.floor(px + q[0] * cw), Math.floor(py + q[1] * ch), Math.ceil(q[2] * cw), Math.ceil(q[3] * ch)); }
      }
      ctx.globalAlpha = 1;
    };
    paint();
    if (l.text) globalThis.document?.fonts?.load?.('12px BotGlyphs').then(paint).catch(() => {});
    return undefined;
  }, [face, state, size, mode, color, on, t]);
  return React.createElement('canvas', { ref, style: { width: l.width, height: l.height } });
}

const NAMES = { working: 'trabalhando', waiting: 'esperando você', sleeping: 'dormindo', error: 'com erro', done: 'concluído' };

/** A bot's character face in a size×size box. `animated` faces move (up to eight at a time); the rest are still. */
function FaceArt({ bot, state = 'idle', size = 54, animated = false }) {
  const face = faceOf(bot), mode = currentTheme();
  const [on, t] = useAnimation(animated && size >= 28);
  const Painter = FaceView ? Native : Platform.OS === 'web' ? WebCanvas : Vector;
  return <View accessible accessibilityLabel={`${bot?.name || 'Bot'}${NAMES[state] ? `, ${NAMES[state]}` : ''}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Painter bot={bot} face={face} state={state} size={size} mode={mode} on={on} t={t} />
  </View>;
}
export default memo(FaceArt);
