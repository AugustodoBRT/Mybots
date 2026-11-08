import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { avatar3dAvailable, prefGet, prefSet } from './termux';

// The computer's window (and the iPhone web app) shows every bot as the Escritório's 3D body by default, with a switch for
// the flat particle face. Kept on this device only; the Android app draws faces natively and has no 3D yet.
const KEY = 'mybots.faces3d';
// The bot's face floating over its browser (?overlay=1) is a transparent Electron view stacked on the page tabs: drawing WebGL there
// blacked the whole window on some Linux GPUs, so it always uses the flat face.
const OVERLAY = Platform.OS === 'web' && /[?&]overlay=1\b/.test(globalThis.location?.search || '');
// On Android the app draws it in a hidden WebView (Avatar3d.kt); a build without that keeps the flat face.
export const FACES_3D_AVAILABLE = (Platform.OS === 'web' && !OVERLAY) || (Platform.OS === 'android' && avatar3dAvailable());
// 3D is the default; only an explicit "off" saved on this device brings the flat face back.
let on = FACES_3D_AVAILABLE;
try { if (FACES_3D_AVAILABLE) on = (Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : prefGet(KEY)) !== '0'; } catch {}
const listeners = new Set();
export function faces3d() { return on; }
export function setFaces3d(value) {
  on = FACES_3D_AVAILABLE && Boolean(value);
  try { if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, on ? '1' : '0'); else prefSet(KEY, on ? '1' : '0'); } catch {}
  for (const listener of listeners) listener(on);
}
export function useFaces3d() {
  const [value, setValue] = useState(on);
  useEffect(() => { listeners.add(setValue); setValue(on); return () => { listeners.delete(setValue); }; }, []);
  return value;
}
