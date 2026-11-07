import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// Test switch: the computer's window (and the iPhone web app) can show every bot as the Escritório's 3D body instead of
// the flat particle face. Kept on this device only; the Android app draws faces natively and has no 3D yet.
const KEY = 'mybots.faces3d';
export const FACES_3D_AVAILABLE = Platform.OS === 'web';
let on = false;
try { on = FACES_3D_AVAILABLE && globalThis.localStorage?.getItem(KEY) === '1'; } catch {}
const listeners = new Set();
export function faces3d() { return on; }
export function setFaces3d(value) {
  on = FACES_3D_AVAILABLE && Boolean(value);
  try { globalThis.localStorage?.setItem(KEY, on ? '1' : '0'); } catch {}
  for (const listener of listeners) listener(on);
}
export function useFaces3d() {
  const [value, setValue] = useState(on);
  useEffect(() => { listeners.add(setValue); setValue(on); return () => { listeners.delete(setValue); }; }, []);
  return value;
}
