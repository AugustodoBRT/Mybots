package expo.modules.termuxbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Paints a bot's character face. The frame is made by lib/face.mjs (encodeFrame): six characters per cell (x, y, kind,
 * opacity, part, glyph); the colors per kind come as "#rrggbb:alpha" items. Nothing here decides how a face looks.
 */
internal object FacePainter {
  // Same order as PARTS in lib/face.mjs: ▀ ▄ ▁ ▂ ▃ ▔ ▌ ▐ as left, top, width, height of the cell.
  private val QUADS = arrayOf(floatArrayOf(0f, 0f, 1f, .5f), floatArrayOf(0f, .5f, 1f, .5f), floatArrayOf(0f, .875f, 1f, .125f), floatArrayOf(0f, .75f, 1f, .25f),
    floatArrayOf(0f, .625f, 1f, .375f), floatArrayOf(0f, 0f, 1f, .125f), floatArrayOf(0f, 0f, .5f, 1f), floatArrayOf(.5f, 0f, .5f, 1f))
  private var typeface: Typeface? = null
  private fun face(context: Context): Typeface = typeface ?: (try { Typeface.createFromAsset(context.assets, "fonts/BotGlyphs.ttf") } catch (e: Exception) { Typeface.MONOSPACE }).also { typeface = it }

  class Tones(val colors: IntArray, val alphas: FloatArray)
  fun tones(spec: String?): Tones {
    val items = (spec ?: "").split(",").filter { it.isNotEmpty() }
    return Tones(IntArray(items.size) { Color.parseColor(items[it].substringBefore(':')) }, FloatArray(items.size) { items[it].substringAfter(':').toFloatOrNull() ?: 1f })
  }

  fun draw(canvas: Canvas, context: Context, frame: String, tones: Tones, cols: Int, rows: Int, width: Float, height: Float, text: Boolean, fade: Float = 1f) {
    if (cols <= 0 || rows <= 0) return
    val cellW = width / cols; val cellH = height / rows
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    if (text) { paint.typeface = face(context); paint.textSize = cellH / 1.32f; paint.textAlign = Paint.Align.CENTER }
    var i = 0
    while (i + 6 <= frame.length) {
      val x = frame[i].code - 32; val y = frame[i + 1].code - 32; val kind = (frame[i + 2].code - 32).coerceIn(0, tones.colors.size - 1)
      val alpha = (frame[i + 3].code - 32) / 100f; val part = frame[i + 4].code - 32; val glyph = frame[i + 5]; i += 6
      if (tones.colors.isEmpty()) return
      paint.color = tones.colors[kind]
      paint.alpha = (255f * (alpha * tones.alphas[kind] * fade).coerceIn(0f, 1f)).toInt()
      val px = x * cellW; val py = y * cellH
      if (part == 0) canvas.drawText(glyph.toString(), px + cellW / 2, py + cellH * 0.7727f, paint)
      else {
        val q = if (part == 1) null else QUADS[part - 2]
        val left = px + (q?.get(0) ?: 0f) * cellW; val top = py + (q?.get(1) ?: 0f) * cellH
        canvas.drawRect(Math.floor(left.toDouble()).toFloat(), Math.floor(top.toDouble()).toFloat(), Math.ceil((left + (q?.get(2) ?: 1f) * cellW).toDouble()).toFloat(), Math.ceil((top + (q?.get(3) ?: 1f) * cellH).toDouble()).toFloat(), paint)
      }
    }
  }

  /** A still face as a bitmap (widget, share shortcuts, notifications). */
  fun bitmap(context: Context, frame: String, tonesSpec: String?, cols: Int, rows: Int, height: Int, text: Boolean): Bitmap {
    val width = Math.ceil(height * 0.4545 * cols / rows).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    draw(Canvas(bitmap), context, frame, tones(tonesSpec), cols, rows, width.toFloat(), height.toFloat(), text)
    return bitmap
  }
}

class FaceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private var frame = ""; private var tones = FacePainter.Tones(IntArray(0), FloatArray(0)); private var cols = 0; private var rows = 0; private var text = false; private var fade = 1f
  init { setWillNotDraw(false) }

  fun setTones(spec: String?) { tones = FacePainter.tones(spec); invalidate() }
  fun setGrid(value: List<Int>?) { cols = value?.getOrNull(0) ?: 0; rows = value?.getOrNull(1) ?: 0; invalidate() }
  fun setText(value: Boolean) { text = value; invalidate() }
  fun setFade(value: Float) { fade = value; invalidate() }
  fun setFrame(value: String?) { frame = value ?: ""; invalidate() }

  override fun onDraw(canvas: Canvas) { FacePainter.draw(canvas, context, frame, tones, cols, rows, width.toFloat(), height.toFloat(), text, fade) }
}
