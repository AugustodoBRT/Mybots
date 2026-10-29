package expo.modules.termuxbridge

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The particle bots (the "Mimo" style), ported line by line from lib/mimo.mjs, with no Android classes so it can be tested on the
 * computer against the JavaScript (tests/native-mimo). The tables (moods, drawings, eye sizes) are read from assets/mimo-data.json,
 * which scripts/mimo-data.mjs writes from the JavaScript, so nothing is typed twice. Units are CSS pixels (dp).
 */
internal const val TAU = 2 * PI
private fun clamp(v: Double, a: Double = 0.0, b: Double = 1.0) = min(b, max(a, v))
private fun lerp(a: Double, b: Double, k: Double) = a + (b - a) * k
private fun smooth(x: Double): Double { val y = clamp(x); return y * y * (3 - 2 * y) }

internal fun hashStr(s: String): Long {
  var h = 2166136261L.toInt(); var i = 0
  while (i < s.length) { val cp = s.codePointAt(i); h = h xor s[i].code; h *= 16777619; i += Character.charCount(cp) }
  return h.toLong() and 0xFFFFFFFFL
}
internal class Lcg(seed: Long) { private var s = (seed % 2147483646L) + 1L; fun next(): Double { s = (s * 16807L) % 2147483647L; return (s - 1).toDouble() / 2147483646.0 } }

internal class MimoData(json: String) {
  class Mood(val p: DoubleArray, val spr: String?, val bounce: Boolean)
  class Shape(val pts: FloatArray, val color: DoubleArray, val life: Double, val every: Double)
  val keys: List<String>; val index: Map<String, Int>; val topFrac = HashMap<String, Double>(); val topExt = HashMap<String, DoubleArray>(); val eyes = HashMap<String, DoubleArray>()
  val moods = HashMap<String, Mood>(); val shapes = HashMap<String, Shape>(); val neutral: DoubleArray
  init {
    val root = JSONObject(json); val k = root.getJSONArray("keys"); keys = List(k.length()) { k.getString(it) }; index = keys.withIndex().associate { it.value to it.index }
    fun row(o: JSONObject) = DoubleArray(keys.size) { o.getDouble(keys[it]) }
    neutral = row(root.getJSONObject("neutral"))
    root.getJSONObject("topFrac").let { o -> o.keys().forEach { topFrac[it] = o.getDouble(it) } }
    root.getJSONObject("topExt").let { o -> o.keys().forEach { n -> val a = o.getJSONArray(n); topExt[n] = doubleArrayOf(a.getDouble(0), a.getDouble(1)) } }
    root.getJSONObject("eyes").let { o -> o.keys().forEach { n -> val a = o.getJSONArray(n); eyes[n] = doubleArrayOf(a.getDouble(0), a.getDouble(1)) } }
    root.getJSONObject("moods").let { o -> o.keys().forEach { n -> val m = o.getJSONObject(n); moods[n] = Mood(row(m.getJSONObject("p")), if (m.isNull("spr")) null else m.getString("spr"), m.optBoolean("bounce")) } }
    root.getJSONObject("shapes").let { o -> o.keys().forEach { n ->
      val sh = o.getJSONObject(n); val pts = sh.getJSONArray("pts"); val c = sh.getJSONArray("color"); val flat = FloatArray(pts.length() * 2)
      for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); flat[i * 2] = p.getDouble(0).toFloat(); flat[i * 2 + 1] = p.getDouble(1).toFloat() }
      shapes[n] = Shape(flat, doubleArrayOf(c.getDouble(0), c.getDouble(1), c.getDouble(2)), sh.getDouble("life"), sh.getDouble("every")) } }
  }
  companion object { @Volatile private var shared: MimoData? = null; fun of(json: String): MimoData = shared ?: synchronized(this) { shared ?: MimoData(json).also { shared = it } } }
}

internal class MimoSpec(val seed: String, val hue: Double, val squar: Double, val sx: Double, val sy: Double, val sz: Double, val eyes: Int, val eyeStyle: String, val eyeGap: Double, val eyeY: Double, val mouth: String, val top: String, val blush: Boolean, val dot: Double) {
  companion object {
    fun parse(json: String): MimoSpec { val o = JSONObject(json); return MimoSpec(o.getString("seed"), o.getDouble("hue"), o.getDouble("squar"), o.getDouble("sx"), o.getDouble("sy"), o.getDouble("sz"), o.getInt("eyes"), o.getString("eyeStyle"), o.getDouble("eyeGap"), o.getDouble("eyeY"), o.getString("mouth"), o.getString("top"), o.optBoolean("blush"), o.getDouble("dot")) }
  }
}

internal class MimoParticles(val n: Int, val nb: Int) {
  val x = FloatArray(n); val y = FloatArray(n); val z = FloatArray(n); val bx = FloatArray(n); val by = FloatArray(n); val bz = FloatArray(n)
  val ph = FloatArray(n); val size = FloatArray(n); val speed = FloatArray(n); val ex = FloatArray(n); val ey = FloatArray(n); val ez = FloatArray(n); val light = FloatArray(n); val dust = ByteArray(n)
  companion object {
    private val cache = object : LinkedHashMap<String, MimoParticles>(16, 0.75f, true) { override fun removeEldestEntry(e: MutableMap.MutableEntry<String, MimoParticles>?) = size > 24 }
    fun of(spec: MimoSpec, n: Int, data: MimoData): MimoParticles = synchronized(cache) { cache.getOrPut(spec.seed + "|" + spec.squar + "|" + spec.top + "|" + n) { build(spec, n, data) } }
    private fun build(spec: MimoSpec, n: Int, data: MimoData): MimoParticles {
      val r = Lcg(hashStr(spec.seed + "#corpo")); val p = spec.squar; val nt = if (spec.top == "nada") 0 else Math.round(n * (data.topFrac[spec.top] ?: 0.0)).toInt(); val nb = n - nt; val dustEvery = max(1, Math.round(n / 180.0).toInt())
      val a = MimoParticles(n, nb)
      fun put(i: Int, x: Double, y: Double, z: Double, bx: Double, by: Double, bz: Double) {
        a.x[i] = x.toFloat(); a.y[i] = y.toFloat(); a.z[i] = z.toFloat(); a.bx[i] = bx.toFloat(); a.by[i] = by.toFloat(); a.bz[i] = bz.toFloat()
        a.ph[i] = (r.next() * TAU).toFloat(); a.size[i] = (0.85 + r.next() * 1.1).toFloat(); a.speed[i] = (0.5 + r.next() * 1.2).toFloat(); a.ex[i] = ((r.next() - 0.5) * 6).toFloat(); a.ey[i] = ((r.next() - 0.5) * 4.7).toFloat(); a.ez[i] = ((r.next() - 0.5) * 5).toFloat(); a.light[i] = r.next().toFloat(); a.dust[i] = if (i % dustEvery == 0) 1 else 0
      }
      for (i in 0 until nb) {
        var x: Double; var y: Double; var z: Double; var m: Double
        do { x = r.next() * 2 - 1; y = r.next() * 2 - 1; z = r.next() * 2 - 1; m = abs(x).pow(p) + abs(y).pow(p) + abs(z).pow(p) } while (m > 1)
        val rr = hypot(hypot(x, y), z).let { if (it == 0.0) 1.0 else it }; val mx = m.pow(1 / p); put(i, x, y, z, x / rr * mx * 1.1, y / rr * mx * 1.1, z / rr * mx * 1.1)
      }
      for (i in nb until n) {
        val side = if (r.next() < 0.5) -1.0 else 1.0; val q = DoubleArray(3)
        if (spec.top == "gato") {
          val t = r.next(); val rad = 0.3 * (1 - t) * sqrt(r.next()); val ang = r.next() * TAU; q[0] = lerp(side * 0.62, side * 0.74, t) + cos(ang) * rad; q[1] = lerp(-0.82, -1.62, t); q[2] = sin(ang) * rad * 0.7
        } else {
          var bx: Double; var by: Double; var bz: Double
          do { bx = r.next() * 2 - 1; by = r.next() * 2 - 1; bz = r.next() * 2 - 1 } while (bx * bx + by * by + bz * bz > 1)
          q[0] = side * 0.64 + bx * 0.27; q[1] = -0.98 + by * 0.27; q[2] = bz * 0.18
        }
        put(i, q[0], q[1], q[2], q[0] * 0.5, q[1] * 0.5, q[2] * 0.5)
      }
      return a
    }
  }
}

internal class SpriteDraw(val pts: FloatArray, val color: DoubleArray, val ax: Double, val ay: Double, val k: Double, val vis: Double, val r: Double)

/** One computed picture: where every particle is, grouped by color bucket (sorted order + starts), and the drawings that rise from the head. */
internal class MimoFrame(val n: Int) {
  val sx = FloatArray(n); val sy = FloatArray(n); val sp = FloatArray(n); val order = IntArray(n); val start = IntArray(33); val bucketOf = ByteArray(n)
  var sprites: List<SpriteDraw> = emptyList()
  var w = 0.0; var h = 0.0; var s = 0.0; var u = 0.0; var cx = 0.0; var hue = 0.0; var dim = 0.0; var light = false; var alpha = 1.0; var dot = 1.0; var minR = 0.3
  var shadowY = 0.0; var shadowS = 0.0; var shadowExplode = 0.0; var shadowJump = 0.0
  lateinit var particles: MimoParticles
  fun radius(i: Int): Double = max(minR, particles.size[i] * sp[i] * u * dot * (if (particles.dust[i].toInt() != 0) 0.72 else 1.0))
  /** [hue, saturation %, lightness %, alpha] of a bucket, the same rule as bucketColor in lib/mimo.mjs. */
  fun color(b: Int): DoubleArray {
    val sat = if (light) 64.0 else 54.0
    if (b == 30) return if (light) doubleArrayOf(4.0, 80.0, 42.0, 0.92) else doubleArrayOf(6.0, 90.0, 62.0, 0.95)
    if (b == 31) return doubleArrayOf(hue, 76.0, if (light) 36.0 else 72.0, 0.6 * alpha)
    val db = (b / 3) / 9.0; val lv = doubleArrayOf(0.17, 0.5, 0.83)[b % 3]; var l = if (light) 52 - db * 28 - lv * 8 else 34 + db * 36 + lv * 15; l = if (light) l + dim * 22 else l * (1 - 0.5 * dim)
    return doubleArrayOf(hue, sat, l, 0.86 * alpha)
  }
}

internal class Hole(val x: Double, val y: Double, val w: Double, val h: Double, val angle: Double, val curve: Double, val amount: Double) {
  val c = cos(angle); val s = sin(angle); val r2 = (3.4 * max(w, h) * 1.08).let { it * it }
}

internal class MimoSim(var spec: MimoSpec, var n: Int, val data: MimoData, val fill: Double = 0.88, val vfill: Double = 0.8, var thickForce: Double = -1.0) {
  private class Sprite(val type: String, var age: Double, val life: Double, val ox: Double)
  var mood = "normal"; private var def = data.moods.getValue("normal"); val cur = data.neutral.copyOf()
  var t = (hashStr(spec.seed) % 900) / 100.0; var hue = spec.hue; var ball = 0.0; var ballTarget = 0.0; private var lookX = 0.0; private var lookY = 0.0
  private var sprites = ArrayList<Sprite>(); private var em = 0.0; var action: String? = null; private var actionStart = 0.0
  private var particles = MimoParticles.of(spec, n, data); private var dx = FloatArray(n); private var dy = FloatArray(n); private var frame = MimoFrame(n)
  private fun c(k: String) = cur[data.index.getValue(k)]

  fun moodTo(m: String) { if (data.moods.containsKey(m) && mood != m) { mood = m; def = data.moods.getValue(m); em = 0.2 } }
  fun specTo(next: MimoSpec) { val old = spec; spec = next; if (old.seed != next.seed || old.squar != next.squar || old.top != next.top) rebuild() }
  fun countTo(count: Int) { if (count != n) { n = count; rebuild() } }
  private fun rebuild() { particles = MimoParticles.of(spec, n, data); dx = FloatArray(n); dy = FloatArray(n); frame = MimoFrame(n) }
  fun act(a: String) { action = a; actionStart = t; if (a == "ball") ballTarget = 1 - ballTarget }
  /** The mood at once (no blending) at a calm moment, for faces that do not move. */
  fun snap(m: String) {
    moodTo(m); for (i in cur.indices) cur[i] = def.p[i]; hue = if (def.p[data.index.getValue("hm")] > 0) def.p[data.index.getValue("hue")] else spec.hue; ball = ballTarget; sprites.clear()
    var tt = 1.0; while (((tt + spec.seed.length * 0.37) % 5.2) > 3.5) tt += 0.7; t = tt; action = null
  }
  fun update(dt: Double, px: Double = 0.0, py: Double = 0.0) {
    t += dt; val k = 1 - exp(-dt * 7); val tg = def.p
    for (i in cur.indices) if (data.keys[i] != "hue") cur[i] = lerp(cur[i], tg[i], k)
    val hm = tg[data.index.getValue("hm")]; val th = if (hm > 0) tg[data.index.getValue("hue")] else spec.hue; val d = ((th - hue + 540) % 360) - 180; hue = (hue + d * k * 0.9 + 360) % 360
    ball = lerp(ball, ballTarget, k)
    val scan = sin(t * 2.2) * 0.9 * c("scan"); lookX = lerp(lookX, px * c("look") + scan + c("ax"), k); lookY = lerp(lookY, py * c("look") + c("up"), k)
    if (def.bounce && action == null && ((t * 1.3) % 3.2) < 0.04) act("jump")
    val sp = def.spr; em -= dt
    if (sp != null && em <= 0) { val sh = data.shapes.getValue(sp); sprites.add(Sprite(sp, 0.0, sh.life, (sprites.size % 5) / 4.0 - 0.5)); em = sh.every }
    for (s in sprites) s.age += dt; sprites = ArrayList(sprites.filter { it.age < it.life })
  }

  fun compute(w: Double, h: Double, light: Boolean = false, energy: Double = 0.6, dtk: Double = 0.016, paused: Boolean = false, maxS: Double = 200.0): MimoFrame {
    val sp = spec; val P = particles; val N = P.n; val f = frame; val minDim = min(w, h)
    val thick = if (thickForce >= 0) thickForce else if (minDim < 44) 1.7 else if (minDim < 70) 1.2 else if (minDim < 130) 0.7 else if (minDim < 200) 0.4 else 0.0
    val el = t - actionStart; var spin = 0.0; var explode = 0.0; var jump = 0.0; var squashJ = 1.0
    when (action) {
      "spin" -> { spin = smooth(el / 2.15) * TAU; if (el > 2.2) action = null }
      "dissolve" -> { explode = if (el < 1.4) smooth(el / 1.4) else if (el < 2.2) 1.0 else 1 - smooth((el - 2.2) / 1.7); if (el > 3.9) action = null }
      "jump" -> { val pr = clamp(el / 1.5); jump = sin(pr * PI); squashJ = 1 + sin(pr * TAU * 2) * 0.09 * (1 - pr); if (el > 1.5) action = null }
      "ball" -> if (el > 1.2) action = null
    }
    val te = data.topExt.getValue(sp.top); val extX = max(1.1 * sp.sx, te[0] * sp.sx + 0.15); val yTop = -max(1.03 * sp.sy, te[1] * sp.sy); val yBot = 1.05 * sp.sy
    val s = min(min(w * 0.5 * fill / extX, h * vfill / (yBot - yTop)), maxS); val u = s / 130
    val cx = w / 2 + sin(t * 0.7) * 3 * u; val cy0 = h * 0.5 - (yTop + yBot) / 2 * s + (if (h < 120) 0.0 else 4.0); val cy = cy0 + sin(t * 1.7) * 6 * u - jump * 78 * u
    val asym = c("asym"); val lean = c("lean"); val en = c("en")
    val ang = spin + sin(t * 0.55) * 0.1 + lookX * 0.1 + asym * 0.45; val tilt = sin(t * 0.75) * 0.035 + lean + asym * 0.5
    val ca = cos(ang); val sa = sin(ang); val ct = cos(tilt); val st = sin(tilt)
    val breath = 1 + sin(t * 2 * (0.6 + en * 0.4)) * 0.017; val squash = squashJ * c("squash"); val SXs = sp.sx; val SYs = sp.sy; val SZs = sp.sz
    val o = DoubleArray(4)
    fun proj(x0: Double, y0: Double, z0: Double) { val x = x0 * SXs; val y = y0 * SYs; val z = z0 * SZs; val rx = x * ca + z * sa; val rz = z * ca - x * sa; val ry = y * ct + rx * st; val xx = rx * ct - y * st; val p = 4.8 / (4.8 - rz * 0.42); o[0] = cx + xx * s * p * breath; o[1] = cy + ry * s * p * breath * squash; o[2] = rz; o[3] = p }
    proj(0.0, -0.06, 1.04); val fpx = o[0]; val fpy = o[1]; val fs = s * breath; val faceVis = smooth(clamp((ca - 0.16) / 0.65)) * (1 - smooth(explode * 2))
    val bc = (t + sp.seed.length * 0.37) % 5.2; val blink = if (bc > 4.9) 1 - sin((bc - 4.9) / 0.3 * PI) * 0.96 else 1.0
    val holes = ArrayList<Hole>(); val thk = 1 + 0.75 * thick; val minH = 0.013 + 0.03 * thick; val eye = data.eyes.getValue(sp.eyeStyle); val bw = eye[0]; val bh = eye[1]
    val one = sp.eyes == 1; val gap = sp.eyeGap; val eyePos = if (one) doubleArrayOf(0.0) else doubleArrayOf(-0.34 * gap, 0.34 * gap)
    val eo = c("eo"); val ew = c("ew"); val et = c("et"); val ec = c("ec"); val ey = c("ey"); val wink = c("wink"); val xw = c("x")
    for (ex in eyePos) {
      val side = if (one) 0 else if (ex < 0) -1 else 1; val big = if (one) 1.5 else 1.0; val cs = 1 + asym * (if (side == -1) 1.0 else if (side == 1) -0.9 else 0.0)
      var ww = bw * big * ew * cs; var hh = max(minH, bh * big * eo * (if (eo > 0.2) blink else 1.0) * cs); var curve = ec
      if (side == 1 && wink > 0) { hh = lerp(hh, 0.03, wink); curve += wink * 0.12; ww *= 1 + 0.12 * wink }
      val x = (ex + lookX * 0.065) * SXs; val y = (sp.eyeY + ey + lookY * 0.05 + side * asym * 0.25) * SYs
      holes.add(Hole(x, y, ww * SXs * thk, max(minH, hh) * SYs * (1 + 0.35 * thick), -side * et, curve, 1 - xw))
      if (xw > 0.02) for (a in doubleArrayOf(PI / 4, -PI / 4)) holes.add(Hole(x, y, 0.2 * SXs * thk, max(0.032, 0.032 * thk) * SYs, a, 0.0, xw))
    }
    if (sp.eyes == 3) holes.add(Hole(lookX * 0.03 * SXs, (sp.eyeY - 0.34) * SYs, 0.075 * SXs * thk, 0.095 * SYs * thk, 0.0, 0.0, 1 - xw))
    val rest = smooth(c("rest"))
    if (rest >= 0.01 && sp.mouth != "nenhuma") {
      val y = (if (sp.mouth == "redonda") 0.42 else 0.41) * SYs
      fun add(x: Double, ww: Double, hh: Double, cv: Double, ang: Double = 0.0) { holes.add(Hole(x * SXs, y, ww * SXs * thk, max(hh, 0.02 + 0.025 * thick) * SYs, ang, cv, rest)) }
      when (sp.mouth) { "pequena" -> add(0.0, 0.09, 0.022, 0.0); "sorriso" -> add(0.0, 0.17, 0.035, -0.09); "larga" -> add(0.0, 0.3, 0.05, -0.12); "redonda" -> add(0.0, 0.075, 0.09, 0.0)
        "dentes" -> doubleArrayOf(-0.13, -0.045, 0.045, 0.13).forEachIndexed { i, x -> add(x, 0.03, 0.05, 0.0, if (i % 2 == 1) 0.45 else -0.45) }; "gato" -> { add(-0.075, 0.085, 0.024, -0.1); add(0.075, 0.085, 0.024, -0.1) } }
    }
    val mo = (1 - smooth(c("rest"))) * c("mo")
    if (mo > 0.01) {
      val talk = c("talk"); val open = if (talk > 0.01) (0.3 + abs(sin(t * 9.5)) * 1.4) * talk + (1 - talk) else 1.0
      holes.add(Hole(lookX * 0.025 * SXs, (c("my") + lookY * 0.02) * SYs, c("mw") * SXs * thk, max(0.02 + 0.025 * thick, c("mh") * open) * SYs * (1 + 0.3 * thick), 0.0, c("mc"), smooth(mo)))
    }
    val moveK = if (paused) 0.0 else 1 - exp(-dtk * 22); val faceW = max(0.1, abs(ca)); val flow = 0.009 + energy * 0.025; val enMul = 0.65 + energy * en
    val shake = c("shake"); val rise = c("rise"); val glitchOn = c("glitch") > 0.3; val gseed = floor(t * 12).toInt(); val squashF = fs * squash
    val counts = IntArray(33); val bk = f.bucketOf; val sft = DoubleArray(2)
    for (i in 0 until N) {
      val ph = P.ph[i].toDouble(); val spd = P.speed[i].toDouble(); val tt = t * spd * enMul
      var x = lerp(P.x[i].toDouble(), P.bx[i].toDouble(), ball); var y = lerp(P.y[i].toDouble(), P.by[i].toDouble(), ball); var z = lerp(P.z[i].toDouble(), P.bz[i].toDouble(), ball); var fade = 1.0
      x += sin(tt + ph + y * 3) * flow + shake * sin(t * 33 + ph); y += cos(tt * 1.1 + ph + x * 3) * flow; z += sin(tt * 0.8 + ph) * flow
      if (P.dust[i].toInt() != 0) { val orbit = 0.06 + 0.12 * (1 + sin(tt)); x *= 1 + orbit; y *= 1 + orbit; z *= 1 + orbit; if (rise > 0.01) { val fr = (t * 0.26 * spd + ph / TAU) % 1; y -= rise * fr * 1.9; fade = 1 - fr * 0.75 * rise } }
      x += P.ex[i] * explode; y += P.ey[i] * explode + sin(t + ph) * explode * 0.3; z += P.ez[i] * explode
      proj(x, y, z); val q0 = o[0]; val q1 = o[1]; val q2 = o[2]; val q3 = o[3]
      val fx = (q0 - fpx) / fs; val fy = (q1 - fpy) / squashF; val lx = (fx * ct + fy * st) / faceW; val ly = -fx * st + fy * ct
      var ox = 0.0; var oy = 0.0
      if (faceVis > 0.001 && abs(lx) < 1.6 && abs(ly) < 1.5) for (hole in holes) if (repel(lx, ly, hole, sft)) { ox += sft[0]; oy += sft[1] }
      val tX = (ox * faceW * ct - oy * st) * fs * faceVis; val tY = (ox * faceW * st + oy * ct) * fs * squash * faceVis
      dx[i] = lerp(dx[i].toDouble(), tX, moveK).toFloat(); dy[i] = lerp(dy[i].toDouble(), tY, moveK).toFloat()
      f.sx[i] = (q0 + dx[i]).toFloat(); f.sy[i] = (q1 + dy[i]).toFloat(); f.sp[i] = (q3 * fade).toFloat()
      val depth = clamp((q2 + 1.2) / 2.4)
      val b = if (glitchOn && (i * 13 + gseed) % 17 == 0) 30 else if (P.dust[i].toInt() != 0) 31 else min(9, floor(depth * 10).toInt()) * 3 + (if (P.light[i] < 0.33) 0 else if (P.light[i] < 0.66) 1 else 2)
      bk[i] = b.toByte(); counts[b + 1]++
    }
    for (b in 0 until 32) counts[b + 1] += counts[b]
    System.arraycopy(counts, 0, f.start, 0, 33); val fillAt = counts.copyOf()
    for (i in 0 until N) { val b = bk[i].toInt(); f.order[fillAt[b]++] = i }
    val out = ArrayList<SpriteDraw>()
    if (sprites.isNotEmpty() && minDim >= 70) for (sprite in sprites) {
      val sh = data.shapes.getValue(sprite.type); val a = sprite.age / sprite.life; val vis = smooth(a / 0.12) * (1 - smooth((a - 0.55) / 0.45)); if (vis < 0.02) continue
      val k = s * 0.26; val ax = min(w - k * 0.9, cx + s * extX * 0.72 + sprite.ox * s * 0.12 + sin(sprite.age * 3) * s * 0.04); val ay = max(k * 1.1, cy + yTop * s * 0.62 - sprite.age * s * 0.2)
      out.add(SpriteDraw(sh.pts, sh.color, ax, ay, k, vis, max(0.9, u * 1.5)))
    }
    f.sprites = out; f.particles = P; f.w = w; f.h = h; f.s = s; f.u = u; f.cx = cx; f.hue = hue; f.dim = c("dim"); f.light = light; f.alpha = 1 - explode * 0.3; f.dot = sp.dot; f.minR = if (thick > 0.2) 0.85 + 0.4 * thick else 0.3
    f.shadowY = cy0 + yBot * s * 1.04; f.shadowS = s; f.shadowExplode = explode; f.shadowJump = jump
    return f
  }

  private fun repel(x: Double, y: Double, h: Hole, out: DoubleArray): Boolean {
    val dx = x - h.x; val dy = y - h.y; if (dx * dx + dy * dy > h.r2) return false
    val u2 = dx * h.c + dy * h.s; val v = -dx * h.s + dy * h.c; val bend = h.curve * (clamp(u2 / h.w, -1.7, 1.7).pow(2) - 1); val vv = v - bend; val nx = u2 / h.w; val ny = vv / h.h; val r = hypot(nx, ny); val outer = 3.4
    if (r >= outer) return false
    val edge = 1 + min(0.017 / h.h, 0.65); val reach = sqrt(edge * edge + (1 - edge * edge / (outer * outer)) * r * r); val force = (reach - r) * h.amount; val inv = 1 / max(r, 0.0001); val du = nx * inv * force * h.w
    var dv = ny * inv * force * h.h; dv += h.curve * (clamp((u2 + du) / h.w, -1.7, 1.7).pow(2) - 1) - bend
    out[0] = du * h.c - dv * h.s; out[1] = du * h.s + dv * h.c; return true
  }

  companion object {
    /** For the tests: runs `steps` steps of 0.033 s on a mood and prints the first particles and the bucket sizes as JSON (same numbers as the JavaScript). */
    @JvmStatic fun dump(dataJson: String, specJson: String, mood: String, steps: Int, n: Int, w: Double, h: Double, light: Boolean): String {
      val sim = MimoSim(MimoSpec.parse(specJson), n, MimoData.of(dataJson)); sim.moodTo(mood); var f: MimoFrame? = null
      for (i in 0 until steps) { sim.update(0.033); f = sim.compute(w, h, light, 0.6, 0.033) }
      val fr = f!!; val xs = JSONArray(); for (i in 0 until min(40, fr.n)) xs.put(Math.round(fr.sx[i] * 100) / 100.0).put(Math.round(fr.sy[i] * 100) / 100.0)
      val sizes = JSONArray(); for (b in 0 until 32) sizes.put(fr.start[b + 1] - fr.start[b])
      val colors = JSONArray(); for (b in intArrayOf(0, 7, 15, 22, 29, 30, 31)) { val c = fr.color(b); colors.put(JSONArray().put(Math.round(c[0] * 10) / 10.0).put(c[1]).put(Math.round(c[2] * 10) / 10.0).put(Math.round(c[3] * 100) / 100.0)) }
      return JSONObject().put("xy", xs).put("buckets", sizes).put("colors", colors).put("sprites", fr.sprites.size).put("hue", Math.round(sim.hue * 100) / 100.0).toString()
    }
  }
}
