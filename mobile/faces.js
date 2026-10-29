import { makeFace, frameFace, encodeFrame, faceTones, layout, stateName, stillOf, botSeed, botColor } from '../lib/face.mjs';

// Faces are made once per seed and pieces; frames are made per tick (animated) or once (still, cached in lib/face.mjs).
const faces = new Map();
export function faceOf(bot) {
  const key = JSON.stringify([botSeed(bot), bot?.face?.pieces || null]);
  let face = faces.get(key);
  if (!face) { if (faces.size >= 300) faces.delete(faces.keys().next().value); face = makeFace(botSeed(bot), bot?.face?.pieces || {}); faces.set(key, face); }
  return face;
}
export const tonesText = (color, mode) => faceTones(color, mode).map(([hex, alpha]) => `${hex}:${alpha}`).join(',');
export const gridAt = (face, state, t) => frameFace(face, stateName(state), t);
export const frameAt = (face, state, t, size) => { const l = layout(face, size); return encodeFrame(gridAt(face, state, t), l.crop, l.text); };
export { layout, stillOf, botColor, stateName };
