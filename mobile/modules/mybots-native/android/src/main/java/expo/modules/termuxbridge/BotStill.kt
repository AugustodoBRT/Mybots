package expo.modules.termuxbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import org.json.JSONObject

/**
 * A bot as a small picture where the app's 3D body cannot be drawn (widget, share shortcuts, notifications: no screen of ours, no WebGL):
 * a soft cube in the bot's color with its eyes, the same plain look as the placeholder inside the app. The 3D body itself only lives in the app.
 */
internal object BotStill {
  fun bitmap(@Suppress("UNUSED_PARAMETER") context: Context, specJson: String, @Suppress("UNUSED_PARAMETER") mood: String, @Suppress("UNUSED_PARAMETER") count: Int, px: Int, @Suppress("UNUSED_PARAMETER") dp: Double, @Suppress("UNUSED_PARAMETER") light: Boolean): Bitmap {
    val bitmap = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap)
    val spec = try { JSONObject(specJson) } catch (_: Exception) { JSONObject() }
    val hue = ((spec.optDouble("hue", 30.0) % 360 + 360) % 360).toFloat(); val eyes = if (spec.optInt("eyes", 2) == 1) 1 else 2
    val size = px.toFloat(); val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val body = RectF(size * 0.11f, size * 0.14f, size * 0.89f, size * 0.86f); val radius = size * 0.24f
    // the shadow on the ground, then the body with a lighter top
    paint.color = Color.argb(46, 0, 0, 0); canvas.drawOval(RectF(size * 0.2f, size * 0.84f, size * 0.8f, size * 0.95f), paint)
    paint.shader = LinearGradient(0f, body.top, 0f, body.bottom, Color.HSVToColor(floatArrayOf(hue, 0.38f, 1f)), Color.HSVToColor(floatArrayOf(hue, 0.58f, 0.82f)), Shader.TileMode.CLAMP)
    canvas.drawRoundRect(body, radius, radius, paint); paint.shader = null
    paint.color = Color.rgb(16, 19, 26); val eyeW = size * 0.075f; val eyeH = size * 0.115f; val y = size * 0.5f
    val centers = if (eyes == 1) listOf(size * 0.5f) else listOf(size * 0.37f, size * 0.63f)
    for (x in centers) canvas.drawOval(RectF(x - eyeW, y - eyeH, x + eyeW, y + eyeH), paint)
    canvas.drawRoundRect(RectF(size * 0.46f, size * 0.64f, size * 0.54f, size * 0.665f), size * 0.012f, size * 0.012f, paint)
    return bitmap
  }
}
