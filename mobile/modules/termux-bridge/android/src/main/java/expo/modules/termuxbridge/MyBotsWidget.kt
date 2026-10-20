package expo.modules.termuxbridge

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The home-screen widget: the most recent bots with their faces alive (breathing and blinking; glancing around while
 * they work; the antenna blinking amber while they wait for the person), the latest message and the next deadline.
 * Faces are drawn by BotFace and played as frames by a ViewFlipper, which the launcher animates on its own.
 * Data comes from the supervisor's /device/widget long-poll, so the widget follows the bots with the app closed.
 */
class MyBotsWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    WidgetSync.render(context, ids); WidgetSync.start(context)
  }
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    WidgetSync.render(context, intArrayOf(id))
  }
  override fun onEnabled(context: Context) { WidgetSync.start(context) }
  override fun onDisabled(context: Context) { WidgetSync.stop() }
}

internal object WidgetSync {
  // Frames per loop; fewer when a launcher refuses the full animation (RemoteViews travel through Binder).
  @Volatile private var frameCount = 12
  @Volatile private var thread: Thread? = null

  fun ids(context: Context): IntArray = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, MyBotsWidget::class.java))
  private fun prefs(context: Context) = context.getSharedPreferences("mybots_widget", Context.MODE_PRIVATE)

  /** Follows the supervisor while at least one widget is on the home screen. */
  fun start(context: Context) {
    val app = context.applicationContext
    if (ids(app).isEmpty() || thread?.isAlive == true) return
    thread = Thread({ loop(app) }, "mybots-widget").apply { isDaemon = true; start() }
  }
  fun stop() { thread?.interrupt(); thread = null }

  private fun loop(context: Context) {
    while (!Thread.currentThread().isInterrupted && ids(context).isNotEmpty()) {
      try {
        val saved = pairingPreferences(context)
        val token = saved.getString("token", null)
        if (token == null) { Thread.sleep(15_000); continue }
        val version = prefs(context).getString("version", "") ?: ""
        val connection = URL("http://127.0.0.1:${saved.getInt("port", 3219)}/device/widget?v=$version").openConnection() as HttpURLConnection
        connection.connectTimeout = 3000; connection.readTimeout = 35_000
        connection.setRequestProperty("Authorization", "Bearer $token")
        val body = if (connection.responseCode == 200) connection.inputStream.bufferedReader().use { it.readText() } else null
        connection.disconnect()
        if (body == null) { Thread.sleep(10_000); continue }
        val summary = JSONObject(body)
        if (summary.optString("version") != version) {
          prefs(context).edit().putString("version", summary.optString("version")).putString("summary", body).apply()
          render(context, ids(context))
        }
      } catch (_: InterruptedException) { return }
      catch (_: Exception) { try { Thread.sleep(10_000) } catch (_: InterruptedException) { return } }
    }
  }

  private fun open(context: Context, botId: String?, code: Int): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP) ?: return null
    botId?.let { launch.putExtra("mybotsBotId", it) }
    return PendingIntent.getActivity(context, code, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** The face's animation as frames: one loop of about 2.2 s, like BotAvatar in the app. */
  private fun frames(bot: JSONObject, size: Int): List<Bitmap> {
    val state = bot.optString("state", "idle")
    val count = frameCount
    return (0 until count).map { i ->
      val t = i / count.toFloat()
      val lift = ((1 - cos(2 * PI * t)) / 2).toFloat()
      val pose = when (state) {
        "working" -> BotFace.Pose(lift = lift, look = sin(2 * PI * t).toFloat(), glow = (0.6 + 0.4 * sin(4 * PI * t)).toFloat())
        "waiting" -> BotFace.Pose(lift = lift * 0.4f, glow = if (i % (count / 2).coerceAtLeast(1) < count / 5 + 1) 1f else 0f)
        // A blink near the end of each loop.
        else -> BotFace.Pose(lift = lift, blink = if (count > 4 && i == count - 3) 0.12f else if (count > 4 && i == count - 2) 0.55f else 1f)
      }
      BotFace.draw(size, bot.optString("color"), bot.optString("avatar"), bot.optString("id"), state, pose)
    }
  }

  private fun face(context: Context, views: RemoteViews, bot: JSONObject, size: Int) {
    views.removeAllViews(R.id.mybots_widget_face)
    for (frame in frames(bot, size)) {
      views.addView(R.id.mybots_widget_face, RemoteViews(context.packageName, R.layout.mybots_widget_frame).apply { setImageViewBitmap(R.id.mybots_widget_frame, frame) })
    }
  }

  private fun summary(context: Context) = try { JSONObject(prefs(context).getString("summary", null) ?: "{}") } catch (_: Exception) { JSONObject() }

  private fun list(context: Context, data: JSONObject, rows: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.mybots_widget)
    views.setImageViewBitmap(R.id.mybots_widget_logo, BotFace.draw(66, "green", "orbit", null, tile = false))
    open(context, null, 0)?.let { views.setOnClickPendingIntent(R.id.mybots_widget_header, it) }
    val bots = data.optJSONArray("bots") ?: JSONArray()
    val approvals = data.optInt("approvals"); val open = data.optInt("openItems")
    val badge = when {
      approvals > 0 -> if (approvals > 1) "$approvals decisões" else "1 decisão"
      open > 0 -> if (open > 1) "$open pendências" else "1 pendência"
      else -> null
    }
    views.setViewVisibility(R.id.mybots_widget_badge, if (badge == null) View.GONE else View.VISIBLE)
    badge?.let {
      views.setTextViewText(R.id.mybots_widget_badge, it)
      views.setInt(R.id.mybots_widget_badge, "setBackgroundResource", if (approvals > 0) R.drawable.mybots_widget_pill_amber else R.drawable.mybots_widget_pill)
      views.setTextColor(R.id.mybots_widget_badge, if (approvals > 0) 0xFFFFC86E.toInt() else 0xFF7EE2B8.toInt())
    }
    views.removeAllViews(R.id.mybots_widget_list)
    views.setViewVisibility(R.id.mybots_widget_empty, if (bots.length() == 0) View.VISIBLE else View.GONE)
    views.setViewVisibility(R.id.mybots_widget_list, if (bots.length() == 0) View.GONE else View.VISIBLE)
    for (index in 0 until minOf(rows, bots.length())) {
      val bot = bots.getJSONObject(index)
      val row = RemoteViews(context.packageName, R.layout.mybots_widget_bot)
      face(context, row, bot, 112)
      row.setTextViewText(R.id.mybots_widget_name, bot.optString("name"))
      row.setTextViewText(R.id.mybots_widget_preview, bot.optString("preview"))
      row.setTextColor(R.id.mybots_widget_preview, when (bot.optString("state")) { "waiting" -> 0xFFFFC86E.toInt(); "working" -> BotFace.hue(bot.optString("color")); else -> 0xFF8B94A6.toInt() })
      open(context, bot.optString("id"), 100 + index)?.let { row.setOnClickPendingIntent(R.id.mybots_widget_bot, it) }
      views.addView(R.id.mybots_widget_list, row)
    }
    val next = data.optJSONObject("next")
    views.setViewVisibility(R.id.mybots_widget_footer, if (next == null) View.GONE else View.VISIBLE)
    next?.let { views.setTextViewText(R.id.mybots_widget_footer, "◷  ${it.optString("title")} · ${it.optString("due")}") }
    return views
  }

  private fun single(context: Context, data: JSONObject): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.mybots_widget_small)
    val bot = data.optJSONArray("bots")?.optJSONObject(0)
    if (bot == null) {
      views.setTextViewText(R.id.mybots_widget_name, "MyBots"); views.setTextViewText(R.id.mybots_widget_preview, "Abra para conectar")
      face(context, views, JSONObject().put("color", "green").put("avatar", "orbit"), 192)
      open(context, null, 1)?.let { views.setOnClickPendingIntent(R.id.mybots_widget_root, it) }
      return views
    }
    face(context, views, bot, 192)
    views.setTextViewText(R.id.mybots_widget_name, bot.optString("name"))
    views.setTextViewText(R.id.mybots_widget_preview, when (bot.optString("state")) { "waiting" -> "Esperando você"; "working" -> "Trabalhando…"; else -> bot.optString("preview") })
    views.setTextColor(R.id.mybots_widget_preview, when (bot.optString("state")) { "waiting" -> 0xFFFFC86E.toInt(); "working" -> BotFace.hue(bot.optString("color")); else -> 0xFF8B94A6.toInt() })
    open(context, bot.optString("id"), 2)?.let { views.setOnClickPendingIntent(R.id.mybots_widget_root, it) }
    return views
  }

  /** Draws every widget from the last summary; Android 12+ picks the layout that fits each size by itself. */
  fun render(context: Context, ids: IntArray) {
    if (ids.isEmpty()) return
    val manager = AppWidgetManager.getInstance(context); val data = summary(context)
    for (id in ids) {
      val views = if (Build.VERSION.SDK_INT >= 31) RemoteViews(mapOf(
        SizeF(110f, 110f) to single(context, data), SizeF(220f, 110f) to list(context, data, 2), SizeF(220f, 220f) to list(context, data, 3)))
      else {
        val options = manager.getAppWidgetOptions(id)
        val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH); val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
        if (width in 1..219) single(context, data) else list(context, data, if (height >= 220) 3 else 2)
      }
      try { manager.updateAppWidget(id, views) }
      catch (_: Exception) {
        // Too much for this launcher: try again with a lighter animation, down to a still face.
        if (frameCount > 1) { frameCount = if (frameCount > 6) 6 else 1; render(context, intArrayOf(id)) }
      }
    }
  }
}
