import React, { useEffect, useRef, useState } from 'react';

// The Escritório's 3D bot as an avatar (office/avatar.js, loaded on first use). Until three.js arrives, `fallback`
// (a plain placeholder) is shown, and it stays if WebGL is not available. The computer's window switches a card that does not work
// off and draws WebGL on the processor (desktop/electron/gpu.js), so in practice it only stays where a browser has no WebGL at all.
let loading = null, webgl = null;
const hasWebGL = () => {
  if (webgl === null) { try { const canvas = document.createElement('canvas'); webgl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { webgl = false; } }
  return webgl;
};
const load = () => (loading ||= import('./office/avatar.js'));

export default function FaceArt3D({ bot, size, mood, animated, fallback }) {
  const ref = useRef(null), avatar = useRef(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const key = JSON.stringify([bot?.face || null, bot?.name || null, bot?.id || null, size]);
  useEffect(() => {
    let alive = true;
    if (!hasWebGL()) { setFailed(true); return undefined; }
    load().then(({ mountAvatar }) => {
      if (!alive || !ref.current) return;
      avatar.current = mountAvatar(ref.current, bot, { size, mood: mood || 'normal', animated });
      setReady(true);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; avatar.current?.dispose(); avatar.current = null; };
  }, [key]);
  useEffect(() => { avatar.current?.set({ mood: mood || 'normal', animated }); }, [mood, animated]);
  if (failed) return fallback;
  return <>
    {!ready ? fallback : null}
    {React.createElement('canvas', { ref, style: { width: size, height: size, display: ready ? 'block' : 'none' } })}
  </>;
}
