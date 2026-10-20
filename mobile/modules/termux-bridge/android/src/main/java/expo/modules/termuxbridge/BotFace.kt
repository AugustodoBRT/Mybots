package expo.modules.termuxbridge

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader

/**
 * A bot's face drawn natively, the same drawing as BotAvatar.js (100×100 grid), for places React Native does not
 * reach: share-sheet shortcuts and the home-screen widget. Each frame takes the animation values BotAvatar uses.
 */
internal object BotFace {
  val FORMS = listOf("orbit", "pixel", "cat", "spark")
  private val HUES = mapOf("green" to 0xFF7EE2B8.toInt(), "blue" to 0xFF8AB6FF.toInt(), "purple" to 0xFFC2A5FF.toInt(), "orange" to 0xFFFFB38A.toInt())
  private const val AMBER = 0xFFFFC86E.toInt()

  private data class Box(val x: Float, val y: Float, val w: Float, val h: Float, val r: Float)
  private data class Shape(val head: Box, val face: Box, val eye: Box)
  private val SHAPES = mapOf(
    "orbit" to Shape(Box(17f, 32f, 66f, 52f, 24f), Box(25f, 42f, 50f, 32f, 15f), Box(0f, 0f, 8f, 11f, 4f)),
    "pixel" to Shape(Box(18f, 32f, 64f, 52f, 9f), Box(26f, 42f, 48f, 32f, 5f), Box(0f, 0f, 9f, 9f, 1.5f)),
    "cat" to Shape(Box(16f, 36f, 68f, 50f, 25f), Box(24f, 45f, 52f, 32f, 15f), Box(0f, 0f, 9f, 9f, 4.5f)),
    "spark" to Shape(Box(17f, 33f, 66f, 51f, 20f), Box(25f, 43f, 50f, 31f, 13f), Box(0f, 0f, 10f, 7f, 3.5f)))

  /** The animation pose: lift 0..1 (breathing), blink 0.1..1 (eye height), look -1..1 (eyes sideways), glow 0..1 (antenna). */
  data class Pose(val lift: Float = 0f, val blink: Float = 1f, val look: Float = 0f, val glow: Float = 0f)

  fun hue(name: String?) = HUES[name] ?: HUES.getValue("green")

  /** Same rule as formFor in BotAvatar.js: the chosen form, or one picked from the id. */
  fun form(avatar: String?, id: String?): String {
    if (avatar in FORMS) return avatar!!
    val sum = (id ?: "").codePoints().toArray().sumOf { Character.toChars(it)[0].code }
    return FORMS[sum % FORMS.size]
  }

  private fun shade(color: Int, amount: Float): Int {
    val mix = { c: Int -> (if (amount < 0) c * (1 + amount) else c + (255 - c) * amount).toInt().coerceIn(0, 255) }
    return Color.rgb(mix(Color.red(color)), mix(Color.green(color)), mix(Color.blue(color)))
  }
  private fun alpha(color: Int, value: Float) = Color.argb((value * 255).toInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
  private fun RectF(box: Box) = android.graphics.RectF(box.x, box.y, box.x + box.w, box.y + box.h)

  fun draw(size: Int, color: String?, avatar: String?, id: String?, state: String = "idle", pose: Pose = Pose(), tile: Boolean = true): Bitmap {
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap); canvas.scale(size / 100f, size / 100f)
    val hue = hue(color); val form = form(avatar, id); val shape = SHAPES.getValue(form)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    if (tile) {
      paint.shader = RadialGradient(50f, 38f, 70f, alpha(hue, 0.26f), alpha(hue, 0.05f), Shader.TileMode.CLAMP)
      canvas.drawRoundRect(RectF(0.5f, 0.5f, 99.5f, 99.5f), 30f, 30f, paint); paint.shader = null
      paint.style = Paint.Style.STROKE; paint.strokeWidth = 1f; paint.color = alpha(hue, 0.22f)
      canvas.drawRoundRect(RectF(0.5f, 0.5f, 99.5f, 99.5f), 30f, 30f, paint); paint.style = Paint.Style.FILL
    }
    // Shadow shrinks as the bot rises.
    val shadow = 1f - 0.14f * pose.lift
    paint.color = alpha(Color.BLACK, 0.35f)
    canvas.drawOval(RectF(50 - 22 * shadow, 90 - 3.2f, 50 + 22 * shadow, 90 + 3.2f), paint)

    canvas.save()
    canvas.translate(0f, -2.6f * pose.lift)
    if (form == "spark") canvas.rotate(-6f, 50f, 50f)
    if (form == "cat") {
      paint.color = shade(hue, 0.1f)
      canvas.drawPath(poly(22f, 46f, 27f, 18f, 44f, 37f), paint); canvas.drawPath(poly(78f, 46f, 73f, 18f, 56f, 37f), paint)
      paint.color = shade(hue, -0.25f)
      canvas.drawPath(poly(27.5f, 39f, 29.5f, 26f, 37f, 34.5f), paint); canvas.drawPath(poly(72.5f, 39f, 70.5f, 26f, 63f, 34.5f), paint)
    } else {
      paint.color = shade(hue, -0.1f); canvas.drawRoundRect(RectF(48f, 16f, 52f, 33f), 2f, 2f, paint)
      paint.color = shade(hue, 0.2f)
      if (form == "pixel") canvas.drawRoundRect(RectF(43.5f, 9f, 56.5f, 19f), 2.5f, 2.5f, paint)
      else if (form == "orbit") canvas.drawCircle(50f, 13f, 6.5f, paint)
      val head = shape.head
      paint.color = shade(hue, -0.18f)
      canvas.drawRoundRect(RectF(head.x - 5, head.y + 18, head.x + 3, head.y + 34), 4f, 4f, paint)
      canvas.drawRoundRect(RectF(head.x + head.w - 3, head.y + 18, head.x + head.w + 5, head.y + 34), 4f, 4f, paint)
    }
    val head = shape.head; val face = shape.face
    paint.shader = LinearGradient(0f, head.y, 0f, head.y + head.h, shade(hue, 0.25f), shade(hue, -0.12f), Shader.TileMode.CLAMP)
    canvas.drawRoundRect(RectF(head), head.r, head.r, paint); paint.shader = null
    paint.color = alpha(Color.WHITE, 0.32f)
    val hx = head.x + head.w * 0.3f; val hw = head.w * 0.2f
    canvas.drawOval(RectF(hx - hw, head.y + 7 - 3.2f, hx + hw, head.y + 7 + 3.2f), paint)
    paint.shader = LinearGradient(0f, face.y, 0f, face.y + face.h, 0xFF1A2130.toInt(), 0xFF0C1018.toInt(), Shader.TileMode.CLAMP)
    canvas.drawRoundRect(RectF(face), face.r, face.r, paint); paint.shader = null
    val eyeColor = shade(hue, 0.55f)
    paint.style = Paint.Style.STROKE; paint.strokeWidth = 2.4f; paint.strokeCap = Paint.Cap.ROUND; paint.color = alpha(eyeColor, 0.85f)
    canvas.drawPath(Path().apply { moveTo(45f, face.y + face.h * 0.78f); quadTo(50f, face.y + face.h * 0.92f, 55f, face.y + face.h * 0.78f) }, paint)
    paint.style = Paint.Style.FILL
    if (form == "orbit" || form == "pixel") { paint.color = alpha(Color.WHITE, 0.5f); canvas.drawCircle(50f, if (form == "pixel") 14f else 13f, 3f, paint) }
    // Antenna light (or the spark's star): pulses while working, amber while waiting for the person.
    val light = if (state == "waiting") AMBER else hue
    if (form == "spark") {
      canvas.save()
      val scale = 1f + 0.25f * pose.glow
      canvas.translate(60f + 13f, 4f + 13f); canvas.rotate(14f * pose.lift); canvas.scale(scale * 26f / 24f, scale * 26f / 24f); canvas.translate(-12f, -12f)
      paint.color = if (state == "waiting") AMBER else shade(hue, 0.35f)
      canvas.drawPath(poly(12f, 1.5f, 14.4f, 8.7f, 21.5f, 11.1f, 14.4f, 13.5f, 12f, 21f, 9.6f, 13.5f, 2.5f, 11.1f, 9.6f, 8.7f), paint)
      canvas.restore()
    } else if (form != "cat" && pose.glow > 0f) {
      val radius = 9f * (0.6f + 0.65f * pose.glow)
      paint.color = alpha(light, 0.7f * pose.glow)
      canvas.drawCircle(50f, (if (form == "pixel") 5f else 4f) + 9f, radius, paint)
    }
    // Eyes with a soft glow of the bot's color.
    val eye = shape.eye; val eyeY = face.y + face.h * 0.46f; val shift = 4.5f * pose.look
    val height = eye.h * pose.blink.coerceIn(0.1f, 1f)
    for (x in listOf(face.x + face.w * 0.31f, face.x + face.w * 0.69f)) {
      paint.color = alpha(hue, 0.35f)
      canvas.drawRoundRect(RectF(x + shift - eye.w / 2 - 1.2f, eyeY - height / 2 - 1.2f, x + shift + eye.w / 2 + 1.2f, eyeY + height / 2 + 1.2f), eye.r + 1.2f, eye.r + 1.2f, paint)
      paint.color = eyeColor
      canvas.drawRoundRect(RectF(x + shift - eye.w / 2, eyeY - height / 2, x + shift + eye.w / 2, eyeY + height / 2), minOf(eye.r, height / 2), minOf(eye.r, height / 2), paint)
    }
    canvas.restore()
    return bitmap
  }

  private fun poly(vararg points: Float) = Path().apply {
    moveTo(points[0], points[1]); var i = 2
    while (i < points.size) { lineTo(points[i], points[i + 1]); i += 2 }
    close()
  }
}
