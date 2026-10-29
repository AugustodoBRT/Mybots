package expo.modules.termuxbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.graphics.SurfaceTexture
import java.util.concurrent.Executors
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max
import kotlin.math.min

/** Paints a computed particle frame (MimoSim) on an Android canvas whose units are dp. One drawCircle per particle, a color per bucket. */
internal object MimoPaint {
  fun hsla(h: Double, s: Double, l: Double, a: Double): Int {
    val sat = s / 100; val lig = l / 100; val c = (1 - Math.abs(2 * lig - 1)) * sat; val hp = ((h % 360) + 360) % 360 / 60; val x = c * (1 - Math.abs(hp % 2 - 1)); val m = lig - c / 2
    val (r, g, b) = when { hp < 1 -> Triple(c, x, 0.0); hp < 2 -> Triple(x, c, 0.0); hp < 3 -> Triple(0.0, c, x); hp < 4 -> Triple(0.0, x, c); hp < 5 -> Triple(x, 0.0, c); else -> Triple(c, 0.0, x) }
    return Color.argb((a.coerceIn(0.0, 1.0) * 255).toInt(), ((r + m) * 255).toInt().coerceIn(0, 255), ((g + m) * 255).toInt().coerceIn(0, 255), ((b + m) * 255).toInt().coerceIn(0, 255))
  }
  fun draw(canvas: Canvas, f: MimoFrame) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG); paint.style = Paint.Style.FILL
    // shadow on the ground
    val a = (1 - f.shadowExplode) * (1 - f.shadowJump * 0.6); val core = if (f.light) Color.argb((0.16 * a * 255).toInt(), 40, 30, 20) else Color.argb((0.28 * a * 255).toInt(), 0, 0, 0)
    canvas.save(); canvas.translate(0f, f.shadowY.toFloat()); canvas.scale(1f, 0.19f); canvas.translate(0f, -f.shadowY.toFloat())
    paint.shader = RadialGradient(f.cx.toFloat(), f.shadowY.toFloat(), max(1.0, f.shadowS * 1.25).toFloat(), core, Color.TRANSPARENT, Shader.TileMode.CLAMP)
    canvas.drawRect((f.cx - f.shadowS * 1.3).toFloat(), (f.shadowY - f.shadowS * 1.3).toFloat(), (f.cx + f.shadowS * 1.3).toFloat(), (f.shadowY + f.shadowS * 1.3).toFloat(), paint); canvas.restore(); paint.shader = null
    for (b in 0 until 32) {
      val from = f.start[b]; val to = f.start[b + 1]; if (to == from) continue
      val c = f.color(b); paint.color = hsla(c[0], c[1], c[2], c[3]); val grow = if (b == 30) 1.1 else 1.0
      for (k in from until to) { val i = f.order[k]; canvas.drawCircle(f.sx[i], f.sy[i], (f.radius(i) * grow).toFloat(), paint) }
    }
    for (s in f.sprites) {
      paint.color = hsla(s.color[0], s.color[1], if (f.light) s.color[2] - 24 else s.color[2], s.vis * 0.95)
      var i = 0; while (i < s.pts.size) { canvas.drawCircle((s.ax + s.pts[i] * s.k).toFloat(), (s.ay + s.pts[i + 1] * s.k).toFloat(), s.r.toFloat(), paint); i += 2 }
    }
  }
}

/** Reads the tables from assets/mimo-data.json once. */
internal fun mimoData(context: Context): MimoData = MimoData.of(context.assets.open("mimo-data.json").bufferedReader().use { it.readText() })

/** A still bot as a bitmap (widget, share shortcuts, notifications): `dp` is how large it will look, `px` the bitmap side. */
internal object MimoStill {
  fun bitmap(context: Context, specJson: String, mood: String, count: Int, px: Int, dp: Double, light: Boolean): Bitmap {
    val bitmap = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap)
    val sim = MimoSim(MimoSpec.parse(specJson), count, mimoData(context), fill = if (dp <= 150) 0.96 else 0.9, vfill = if (dp <= 150) 0.92 else 0.78)
    sim.minROverride = MimoSim.airyMinR(dp); sim.snap(mood); val frame = sim.compute(dp, dp, light, 0.6, 1.0); canvas.scale((px / dp).toFloat(), (px / dp).toFloat()); MimoPaint.draw(canvas, frame); return bitmap
  }
}

/** The particle bot on screen: the app hands over its body (JSON), its mood and the theme; the animation runs here, a few frames a second. */
class MimoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private var specJson = ""; private var mood = "normal"; private var light = false; private var energy = 0.6; private var count = 1200; private var animated = false; private var fps = 30
  private var sim: MimoSim? = null; private var frame: MimoFrame? = null; private var last = 0L; private var dirty = true; private val handler = Handler(Looper.getMainLooper())
  private val tick = Runnable { invalidate() }
  init { setWillNotDraw(false) }

  fun configure(spec: String?, mood: String?, light: Boolean?, energy: Double?, count: Int?, animated: Boolean?, fps: Int?) {
    var rebuild = false
    if (spec != null && spec != specJson) { specJson = spec; rebuild = true }
    if (mood != null) this.mood = mood; if (light != null) this.light = light; if (energy != null) this.energy = energy; if (count != null && count != this.count) { this.count = count; rebuild = true }
    if (animated != null) this.animated = animated; if (fps != null) this.fps = max(5, min(60, fps))
    if (rebuild) sim = null; dirty = true; syncGl(); invalidate()
  }
  fun setSpec(v: String?) = configure(v, null, null, null, null, null, null)
  fun setMood(v: String?) = configure(null, v, null, null, null, null, null)
  fun setLight(v: Boolean?) = configure(null, null, v, null, null, null, null)
  fun setEnergy(v: Double?) = configure(null, null, null, v, null, null, null)
  fun setCount(v: Int?) = configure(null, null, null, null, v, null, null)
  fun setAnimated(v: Boolean?) = configure(null, null, null, null, null, v, null)
  fun setFps(v: Int?) = configure(null, null, null, null, null, null, v)


  // Moving faces are drawn on the GPU (MimoGl, on a thread of its own); the Canvas drawing below stays as the still frame and the fallback.
  private var texture: TextureView? = null; private var gl: MimoGl? = null; private var glShown = false; private var glBroken = false
  private fun pushGl() { val d = resources.displayMetrics.density; gl?.update(specJson, mood, light, energy, count, width / d.toDouble(), height / d.toDouble()) }
  private fun syncGl() {
    val want = animated && !glBroken && width > 0 && height > 0 && specJson.isNotEmpty()
    if (want && texture == null) {
      val t = TextureView(context); t.isOpaque = false
      t.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
        override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
          val g = MimoGl(st, mimoData(context), w, h, { glShown = true; invalidate() }, { glBroken = true; teardownGl(); invalidate() }); gl = g; pushGl(); g.start()
        }
        override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
        override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean { gl?.stop(true); gl = null; return true }
        override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
      }
      texture = t; addView(t, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    } else if (!want && texture != null) teardownGl()
    else pushGl()
  }
  private fun teardownGl() { val g = gl; gl = null; g?.stop(true); texture?.let { removeView(it) }; texture = null; glShown = false }
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); syncGl() }
  override fun onDetachedFromWindow() { handler.removeCallbacks(tick); teardownGl(); super.onDetachedFromWindow() }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); dirty = true; syncGl(); invalidate() }
  // Small faces are not simulated small: the body is made at 66 dp with many particles into a bitmap and the bitmap is shrunk
  // (a few dozen particles in 40 dp is noise; the same face shrunk keeps its eyes and mouth). Still ones are cached by look and expression.
  private var small: Bitmap? = null; private var smallCanvas: Canvas? = null; private val smooth = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  private fun drawSmall(canvas: Canvas, w: Double, h: Double) {
    val side = min(w, h); val d = resources.displayMetrics.density; val dst = RectF(((w - side) / 2 * d).toFloat(), ((h - side) / 2 * d).toFloat(), ((w + side) / 2 * d).toFloat(), ((h + side) / 2 * d).toFloat())
    if (!animated || texture != null) {
      val px = (side * d * 2).toInt().coerceIn(96, 512); val key = "$specJson|$mood|$light|$px"; val bitmap = synchronized(cache) { cache[key] }
      if (bitmap == null) { val spec = specJson; val m = mood; val l = light; val ctx = context
        if (pending.add(key)) maker.execute { try { val b = MimoStill.bitmap(ctx, spec, m, STILL_COUNT, px, SMALL_DP, l); synchronized(cache) { cache.put(key, b) } } finally { pending.remove(key); postInvalidate() } }
        return }
      canvas.drawBitmap(bitmap, null, dst, smooth); return
    }
    var s = sim; if (s == null) { s = MimoSim(MimoSpec.parse(specJson), 1600, mimoData(context), fill = 0.96, vfill = 0.92); sim = s; s.snap(mood) }
    s.moodTo(mood); val now = SystemClock.uptimeMillis(); val dt = min(0.08, (now - (if (last == 0L) now else last)) / 1000.0); last = now
    val bitmap = small ?: Bitmap.createBitmap(SMALL_PX, SMALL_PX, Bitmap.Config.ARGB_8888).also { small = it; smallCanvas = Canvas(it) }
    s.update(dt); val f = s.compute(SMALL_DP, SMALL_DP, light, energy, dt); bitmap.eraseColor(0)
    smallCanvas!!.save(); smallCanvas!!.scale((SMALL_PX / SMALL_DP).toFloat(), (SMALL_PX / SMALL_DP).toFloat()); MimoPaint.draw(smallCanvas!!, f); smallCanvas!!.restore()
    canvas.drawBitmap(bitmap, null, dst, smooth)
  }

  override fun onDraw(canvas: Canvas) {
    val d = resources.displayMetrics.density; val w = width / d.toDouble(); val h = height / d.toDouble(); if (w <= 0 || h <= 0 || specJson.isEmpty() || glShown) return
    if (min(w, h) <= SMALL_MAX) {
      val now = SystemClock.uptimeMillis(); drawSmall(canvas, w, h)
      handler.removeCallbacks(tick); if (animated && texture == null && isAttachedToWindow && visibility == View.VISIBLE) handler.postDelayed(tick, max(1L, 1000L / min(fps, 15) - (SystemClock.uptimeMillis() - now))); return
    }
    if (texture != null) return
    val small = min(w, h) <= 150; var s = sim
    if (s == null) { s = MimoSim(MimoSpec.parse(specJson), count, mimoData(context), fill = if (small) 0.96 else 0.9, vfill = if (small) 0.92 else 0.78); sim = s; dirty = true }
    s.moodTo(mood)
    val now = SystemClock.uptimeMillis(); val dt = min(0.05, (now - (if (last == 0L) now else last)) / 1000.0); last = now
    if (animated) { s.update(dt); frame = s.compute(w, h, light, energy, dt) }
    else if (dirty || frame == null) { s.snap(mood); frame = s.compute(w, h, light, energy, 1.0) }
    dirty = false; canvas.save(); canvas.scale(d, d); frame?.let { MimoPaint.draw(canvas, it) }; canvas.restore()
    handler.removeCallbacks(tick); if (animated && texture == null && isAttachedToWindow && visibility == View.VISIBLE) handler.postDelayed(tick, max(1L, 1000L / fps - (SystemClock.uptimeMillis() - now)))
  }
  private companion object { const val SMALL_MAX = 150.0; const val SMALL_DP = 66.0; const val SMALL_PX = 256; const val STILL_COUNT = 4500; val maker = Executors.newSingleThreadExecutor(); val pending = java.util.Collections.synchronizedSet(HashSet<String>()); val cache = object : android.util.LruCache<String, Bitmap>(80) {} }
}
