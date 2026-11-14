package expo.modules.termuxbridge

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.Choreographer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min

/**
 * Draws a moving Mimo on the GPU: the simulation (MimoSim) runs on its own thread, one frame at a time, and every particle is a
 * GL point (position, size and color in one buffer), so thousands of them cost one draw call and the screen thread stays free (60 fps).
 * The look is the one of MimoPaint (same frame, same colors); only the painting changes.
 */
internal class MimoGl(private val surface: SurfaceTexture, private val data: MimoData, private val widthPx: Int, private val heightPx: Int, private val onFirstFrame: () -> Unit, private val onFailed: () -> Unit) {
  @Volatile private var specJson = ""; @Volatile private var mood = "normal"; @Volatile private var light = false; @Volatile private var energy = 0.6; @Volatile private var count = 3500
  @Volatile private var dpW = 0.0; @Volatile private var dpH = 0.0; @Volatile private var running = false
  private val thread = HandlerThread("mimo-gl"); private lateinit var handler: Handler
  private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY; private var context: EGLContext = EGL14.EGL_NO_CONTEXT; private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  private var pointProgram = 0; private var shadowProgram = 0
  private var sim: MimoSim? = null; private var simKey = ""; private var last = 0L; private var announced = false
  private var buffer: FloatBuffer = ByteBuffer.allocateDirect(4 * 7 * 8192).order(ByteOrder.nativeOrder()).asFloatBuffer(); private var capacity = 8192
  private val quad: FloatBuffer = ByteBuffer.allocateDirect(4 * 12).order(ByteOrder.nativeOrder()).asFloatBuffer()

  fun update(spec: String, mood: String, light: Boolean, energy: Double, count: Int, dpW: Double, dpH: Double) {
    this.specJson = spec; this.mood = mood; this.light = light; this.energy = energy; this.count = count; this.dpW = dpW; this.dpH = dpH
  }

  fun start() {
    running = true; thread.start(); handler = Handler(thread.looper)
    handler.post { try { setup(); Choreographer.getInstance().postFrameCallback(frameCallback) } catch (e: Throwable) { running = false; release(); Handler(Looper.getMainLooper()).post(onFailed) } }
  }
  /** Stops drawing; with `wait` it returns only when the thread is done with the surface (the surface is freed right after). */
  fun stop(wait: Boolean = false) {
    running = false
    if (thread.isAlive) { handler.post { Choreographer.getInstance().removeFrameCallback(frameCallback); release(); thread.quitSafely() }; if (wait) try { thread.join(400) } catch (_: InterruptedException) {} }
  }

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!running) return
      try { frame(frameTimeNanos); Choreographer.getInstance().postFrameCallback(this) }
      catch (e: Throwable) { running = false; release(); Handler(Looper.getMainLooper()).post(onFailed) }
    }
  }

  private fun setup() {
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY); val version = IntArray(2); check(EGL14.eglInitialize(display, version, 0, version, 1))
    val configs = arrayOfNulls<EGLConfig>(1); val num = IntArray(1)
    val want = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8, EGL14.EGL_NONE)
    check(EGL14.eglChooseConfig(display, want, 0, configs, 0, 1, num, 0) && num[0] > 0)
    context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    eglSurface = EGL14.eglCreateWindowSurface(display, configs[0], surface, intArrayOf(EGL14.EGL_NONE), 0)
    check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context))
    EGL14.eglSwapInterval(display, 1)
    val vertex = "attribute vec2 aPos; attribute float aSize; attribute vec4 aColor; uniform vec2 uView; uniform float uScale; varying vec4 vColor; varying float vR; varying float vHalf;" +
      "void main(){ gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0); vR = aSize * uScale; gl_PointSize = vR * 2.0 + 2.0; vHalf = vR + 1.0; vColor = aColor; }"
    val fragment = "precision mediump float; varying vec4 vColor; varying float vR; varying float vHalf;" +
      "void main(){ float d = length(gl_PointCoord - 0.5) * 2.0 * vHalf; float cover = clamp(vR + 0.5 - d, 0.0, 1.0) * min(1.0, 4.0 * vR * vR); float a = cover * vColor.a; gl_FragColor = vec4(vColor.rgb * a, a); }"
    pointProgram = program(vertex, fragment)
    val sv = "attribute vec2 aPos; uniform vec2 uView; varying vec2 vPos; void main(){ vPos = aPos; gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0); }"
    val sf = "precision mediump float; varying vec2 vPos; uniform vec2 uC; uniform float uS; uniform vec4 uCol;" +
      "void main(){ float d = length(vec2(vPos.x - uC.x, (vPos.y - uC.y) / 0.19)) / uS; float a = clamp(1.0 - d, 0.0, 1.0) * uCol.a; gl_FragColor = vec4(uCol.rgb * a, a); }"
    shadowProgram = program(sv, sf)
    GLES20.glEnable(GLES20.GL_BLEND); GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
  }

  private fun program(vs: String, fs: String): Int {
    fun shader(type: Int, src: String): Int { val s = GLES20.glCreateShader(type); GLES20.glShaderSource(s, src); GLES20.glCompileShader(s); val ok = IntArray(1); GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0); check(ok[0] != 0) { GLES20.glGetShaderInfoLog(s) }; return s }
    val p = GLES20.glCreateProgram(); GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs)); GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs)); GLES20.glLinkProgram(p)
    val ok = IntArray(1); GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0); check(ok[0] != 0); return p
  }

  private fun release() {
    if (display != EGL14.EGL_NO_DISPLAY) {
      EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, eglSurface)
      if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
      EGL14.eglTerminate(display)
    }
    display = EGL14.EGL_NO_DISPLAY; context = EGL14.EGL_NO_CONTEXT; eglSurface = EGL14.EGL_NO_SURFACE
  }

  private fun put(x: Float, y: Float, size: Float, c: Int) {
    if (buffer.remaining() < 7) { val bigger = ByteBuffer.allocateDirect(4 * 7 * capacity * 2).order(ByteOrder.nativeOrder()).asFloatBuffer(); buffer.flip(); bigger.put(buffer); buffer = bigger; capacity *= 2 }
    buffer.put(x); buffer.put(y); buffer.put(size)
    buffer.put(((c shr 16) and 255) / 255f); buffer.put(((c shr 8) and 255) / 255f); buffer.put((c and 255) / 255f); buffer.put(((c ushr 24) and 255) / 255f)
  }

  private fun frame(nanos: Long) {
    val spec = specJson; val w = dpW; val h = dpH; if (spec.isEmpty() || w <= 0 || h <= 0) return
    val small = min(w, h) <= 150; val vw = if (small) 66.0 * w / min(w, h) else w; val vh = if (small) 66.0 * h / min(w, h) else h
    val key = "$spec|$count|$small"
    var s = sim; if (s == null || key != simKey) { s = MimoSim(MimoSpec.parse(spec), count, data, fill = if (small) 0.96 else 0.9, vfill = if (small) 0.92 else 0.78); sim = s; simKey = key; s.snap(mood) }
    s.moodTo(mood); val dt = min(0.05, if (last == 0L) 0.016 else (nanos - last) / 1e9); last = nanos
    s.minROverride = MimoSim.airyMinR(min(vw, vh)); s.update(dt); val f = s.compute(vw, vh, light, energy, dt)
    buffer.clear()
    for (b in 0 until 32) {
      val from = f.start[b]; val to = f.start[b + 1]; if (to == from) continue
      val c = f.color(b); val argb = MimoPaint.hsla(c[0], c[1], c[2], c[3]); val grow = if (b == 30) 1.1 else 1.0
      for (k in from until to) { val i = f.order[k]; put(f.sx[i], f.sy[i], (f.radius(i) * grow).toFloat(), argb) }
    }
    for (sp in f.sprites) {
      val argb = MimoPaint.hsla(sp.color[0], sp.color[1], if (f.light) sp.color[2] - 24 else sp.color[2], sp.vis * 0.95)
      var i = 0; while (i < sp.pts.size) { put((sp.ax + sp.pts[i] * sp.k).toFloat(), (sp.ay + sp.pts[i + 1] * sp.k).toFloat(), sp.r.toFloat(), argb); i += 2 }
    }
    val total = buffer.position() / 7; buffer.flip()
    GLES20.glViewport(0, 0, widthPx, heightPx); GLES20.glClearColor(0f, 0f, 0f, 0f); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    val scale = (widthPx / vw).toFloat()
    // the shadow on the ground: a flat ellipse that fades out
    val a = (1 - f.shadowExplode) * (1 - f.shadowJump * 0.6); val core = if (f.light) 0.16 * a else 0.28 * a
    GLES20.glUseProgram(shadowProgram)
    GLES20.glUniform2f(GLES20.glGetUniformLocation(shadowProgram, "uView"), vw.toFloat(), vh.toFloat()); GLES20.glUniform2f(GLES20.glGetUniformLocation(shadowProgram, "uC"), f.cx.toFloat(), f.shadowY.toFloat())
    GLES20.glUniform1f(GLES20.glGetUniformLocation(shadowProgram, "uS"), max(1.0, f.shadowS * 1.25).toFloat())
    GLES20.glUniform4f(GLES20.glGetUniformLocation(shadowProgram, "uCol"), if (f.light) 40f / 255 else 0f, if (f.light) 30f / 255 else 0f, if (f.light) 20f / 255 else 0f, core.toFloat())
    val x0 = (f.cx - f.shadowS * 1.3).toFloat(); val x1 = (f.cx + f.shadowS * 1.3).toFloat(); val y0 = (f.shadowY - f.shadowS * 1.3 * 0.19).toFloat(); val y1 = (f.shadowY + f.shadowS * 1.3 * 0.19).toFloat()
    quad.clear(); quad.put(floatArrayOf(x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1)); quad.position(0)
    val sPos = GLES20.glGetAttribLocation(shadowProgram, "aPos"); GLES20.glEnableVertexAttribArray(sPos); GLES20.glVertexAttribPointer(sPos, 2, GLES20.GL_FLOAT, false, 8, quad); GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6); GLES20.glDisableVertexAttribArray(sPos)
    // the particles
    GLES20.glUseProgram(pointProgram)
    GLES20.glUniform2f(GLES20.glGetUniformLocation(pointProgram, "uView"), vw.toFloat(), vh.toFloat()); GLES20.glUniform1f(GLES20.glGetUniformLocation(pointProgram, "uScale"), scale)
    val pos = GLES20.glGetAttribLocation(pointProgram, "aPos"); val size = GLES20.glGetAttribLocation(pointProgram, "aSize"); val col = GLES20.glGetAttribLocation(pointProgram, "aColor")
    buffer.position(0); GLES20.glEnableVertexAttribArray(pos); GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 28, buffer)
    buffer.position(2); GLES20.glEnableVertexAttribArray(size); GLES20.glVertexAttribPointer(size, 1, GLES20.GL_FLOAT, false, 28, buffer)
    buffer.position(3); GLES20.glEnableVertexAttribArray(col); GLES20.glVertexAttribPointer(col, 4, GLES20.GL_FLOAT, false, 28, buffer)
    GLES20.glDrawArrays(GLES20.GL_POINTS, 0, total)
    GLES20.glDisableVertexAttribArray(pos); GLES20.glDisableVertexAttribArray(size); GLES20.glDisableVertexAttribArray(col)
    EGL14.eglSwapBuffers(display, eglSurface)
    if (!announced) { announced = true; Handler(Looper.getMainLooper()).post(onFirstFrame) }
  }
}
