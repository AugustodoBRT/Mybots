// Paints a Mimo frame (lib/mimo.mjs `compute`) on a 2D canvas: the shadow, one fill per color bucket and the little rising drawings.
import { TAU, bucketColor, particleRadius } from './mimo.mjs';
const hsla = ([h, s, l, a]) => `hsla(${h.toFixed(0)},${s}%,${l.toFixed(1)}%,${a.toFixed(2)})`;
export function paintFrame(ctx, f) {
  ctx.clearRect(0, 0, f.W, f.H);
  const { shadow } = f, cx = f.cx; ctx.save(); ctx.translate(0, shadow.y); ctx.scale(1, 0.19); ctx.translate(0, -shadow.y);
  const g = ctx.createRadialGradient(cx, shadow.y, 0, cx, shadow.y, shadow.s * 1.25), a = (1 - shadow.explode) * (1 - shadow.jump * 0.6);
  g.addColorStop(0, f.light ? `rgba(40,30,20,${(0.16 * a).toFixed(3)})` : `rgba(0,0,0,${(0.28 * a).toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - shadow.s * 1.3, shadow.y - shadow.s * 1.3, shadow.s * 2.6, shadow.s * 2.6); ctx.restore();
  for (let b = 0; b < 32; b++) {
    const list = f.buckets[b]; if (!list.length) continue;
    ctx.fillStyle = hsla(bucketColor(f, b)); ctx.beginPath();
    const grow = b === 30 ? 1.1 : 1;
    for (const i of list) { const r = particleRadius(f, i) * grow; ctx.moveTo(f.SX[i] + r, f.SY[i]); ctx.arc(f.SX[i], f.SY[i], r, 0, TAU); }
    ctx.fill();
  }
  for (const s of f.sprites) {
    ctx.fillStyle = `hsla(${s.color[0]},${s.color[1]}%,${f.light ? s.color[2] - 24 : s.color[2]}%,${(s.vis * 0.95).toFixed(2)})`; ctx.beginPath();
    for (const [px, py] of s.pts) { ctx.moveTo(s.ax + px * s.k + s.r, s.ay + py * s.k); ctx.arc(s.ax + px * s.k, s.ay + py * s.k, s.r, 0, TAU); }
    ctx.fill();
  }
}
