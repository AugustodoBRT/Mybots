package expo.modules.termuxbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

// Every notification on the phone becomes a supervisor event, the way OpenClaw's Android node forwards them.
class MyBotsNotificationListener : NotificationListenerService() {
  // Notifications already in the shade when access is granted would otherwise never be seen; ids dedupe repeats.
  override fun onListenerDisconnected() { connected = false; BotNotifier.stop() }

  override fun onListenerConnected() {
    connected = true
    BotNotifier.start(applicationContext)
    // The system binds the listener after a reboot or update too: a chance to bring the keep-alive service back.
    KeepAlive.start(applicationContext, "boot")
    val current = try { activeNotifications.orEmpty().mapNotNull { toEvent(it) } } catch (error: Exception) { emptyList() }
    NotificationForwarder.enqueue(applicationContext, current)
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    toEvent(sbn)?.let { NotificationForwarder.enqueue(applicationContext, listOf(it)) }
  }

  private fun toEvent(sbn: StatusBarNotification): JSONObject? {
    if (sbn.packageName in IGNORED || sbn.isOngoing) return null
    val notification = sbn.notification
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return null
    val extras = notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val body = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
    val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n").orEmpty()
    val text = listOf(body, lines).filter { it.isNotBlank() }.joinToString("\n")
    if (title.isBlank() && text.isBlank()) return null
    val app = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString() } catch (error: Exception) { sbn.packageName }
    return JSONObject()
      .put("id", "${sbn.key}|${sbn.postTime}")
      .put("package", sbn.packageName)
      .put("app", app.take(100))
      .put("title", title.take(300))
      .put("text", text.take(4000))
      .put("subText", extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty().take(200))
      .put("category", notification.category.orEmpty())
      .put("time", sbn.postTime)
  }

  companion object {
    @Volatile var connected = false

    // HyperOS may unbind the listener in the background; the keep-alive service asks for it again.
    fun rebind(context: Context) {
      if (connected || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
      val component = android.content.ComponentName(context, MyBotsNotificationListener::class.java)
      val enabled = android.provider.Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      if (enabled.split(":").any { android.content.ComponentName.unflattenFromString(it) == component })
        try { requestRebind(component) } catch (_: Exception) {}
    }

    // MyBots itself, and Termux/Termux:API (bot notifications and the supervisor's own status) would loop back.
    private val IGNORED = setOf("com.mybots.app", "com.termux", "com.termux.api")
  }
}

internal object NotificationForwarder {
  private val executor = Executors.newSingleThreadExecutor()
  private const val MAX_QUEUED = 1000

  private fun queue(context: Context) = File(context.filesDir, "notification-queue.jsonl")

  fun enqueue(context: Context, events: List<JSONObject>) = executor.execute {
    val file = queue(context)
    val lines = (if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList()) + events.map { it.toString() }
    file.writeText(lines.takeLast(MAX_QUEUED).joinToString("\n", postfix = "\n"))
    send(context)
  }

  fun flush(context: Context) = executor.execute { send(context) }

  // Runs on the executor only. Events stay queued until the supervisor confirms them.
  private fun send(context: Context) {
    val file = queue(context)
    if (!file.exists()) return
    val saved = try { pairingPreferences(context) } catch (error: Exception) { return }
    val token = saved.getString("token", null) ?: return
    val port = saved.getInt("port", 3219)
    var pending = file.readLines().filter { it.isNotBlank() }
    while (pending.isNotEmpty()) {
      val batch = pending.take(50)
      val ok = try {
        val connection = URL("http://127.0.0.1:$port/device/events").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.connectTimeout = 3000; connection.readTimeout = 5000; connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Content-Type", "application/json")
        val payload = JSONObject().put("events", JSONArray(batch.map { JSONObject(it) })).toString()
        connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
        val code = connection.responseCode
        connection.disconnect()
        code == 200
      } catch (error: Exception) { false }
      if (!ok) break
      pending = pending.drop(batch.size)
      file.writeText(if (pending.isEmpty()) "" else pending.joinToString("\n", postfix = "\n"))
    }
  }
}


/**
 * Shows the bots' notifications as MyBots (not as Termux:API). The system keeps this listener bound, so the
 * long-poll runs with the app closed; the supervisor falls back to Termux:API when nobody picks a notice up.
 */
internal object BotNotifier {
  private const val CHANNEL = "mybots_bots"
  @Volatile private var thread: Thread? = null
  val polling get() = thread?.isAlive == true

  fun start(context: Context) {
    if (thread?.isAlive == true) return
    thread = Thread({ loop(context) }, "mybots-notifier").apply { isDaemon = true; start() }
  }

  fun stop() { thread?.interrupt(); thread = null }

  private fun loop(context: Context) {
    while (!Thread.currentThread().isInterrupted) {
      try {
        val saved = pairingPreferences(context)
        val token = saved.getString("token", null)
        if (token == null) { Thread.sleep(10_000); continue }
        val port = saved.getInt("port", 3219)
        val connection = URL("http://127.0.0.1:$port/device/outbox").openConnection() as HttpURLConnection
        connection.connectTimeout = 3000; connection.readTimeout = 35_000
        connection.setRequestProperty("Authorization", "Bearer $token")
        val body = if (connection.responseCode == 200) connection.inputStream.bufferedReader().use { it.readText() } else null
        connection.disconnect()
        if (body == null) { Thread.sleep(5000); continue }
        val items = JSONObject(body).optJSONArray("items") ?: JSONArray()
        val delivered = JSONArray()
        for (index in 0 until items.length()) {
          val item = items.getJSONObject(index)
          if (show(context, item)) delivered.put(item.getString("id"))
        }
        if (delivered.length() > 0) {
          val ack = URL("http://127.0.0.1:$port/device/outbox/ack").openConnection() as HttpURLConnection
          ack.requestMethod = "POST"; ack.doOutput = true; ack.connectTimeout = 3000; ack.readTimeout = 5000
          ack.setRequestProperty("Authorization", "Bearer $token"); ack.setRequestProperty("Content-Type", "application/json")
          ack.outputStream.use { it.write(JSONObject().put("ids", delivered).toString().toByteArray(Charsets.UTF_8)) }
          ack.responseCode; ack.disconnect()
        }
      } catch (_: InterruptedException) { return }
      catch (_: Exception) { try { Thread.sleep(5000) } catch (_: InterruptedException) { return } }
    }
  }

  fun show(context: Context, item: JSONObject): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 33 && !manager.areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null)
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Mensagens dos bots", NotificationManager.IMPORTANCE_HIGH))
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      ?.putExtra("mybotsBotId", item.optString("botId"))
    val tap = open?.let { PendingIntent.getActivity(context, item.getString("id").hashCode(), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val title = item.optString("title").take(80); val text = item.optString("text").take(1000)
    @Suppress("DEPRECATION")
    val builder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL) else Notification.Builder(context))
      .setSmallIcon(R.drawable.mybots_notification).setContentTitle(title).setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text)).setAutoCancel(true).setColor(0xFF9ED8B9.toInt())
    if (tap != null) builder.setContentIntent(tap)
    manager.notify(item.optString("tag").ifEmpty { item.getString("id") }.hashCode(), builder.build())
    return true
  }
}
