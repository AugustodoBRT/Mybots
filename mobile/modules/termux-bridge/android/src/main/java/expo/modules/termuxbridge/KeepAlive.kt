package expo.modules.termuxbridge

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Keeps MyBots working with the screen off: a foreground service ("MyBots ativo") that wakes the supervisor every
 * minute and at each routine's time (exact alarms survive Doze), restarts it through Termux when it stops answering,
 * and holds a wake lock only while a bot is working. The supervisor still decides and runs everything.
 */
internal object KeepAlive {
  private const val CHANNEL = "mybots_keepalive"
  const val NOTIFICATION_ID = 41_100
  const val ACTION_ALARM = "expo.modules.termuxbridge.KEEPALIVE_ALARM"
  const val READY = "Rotinas e avisos funcionando com a tela apagada."
  private const val ALARM_MAX_MS = 15 * 60_000L
  // Waits between restart attempts while the supervisor stays down: 1, 2, 4, 8, 15 and then every 30 minutes.
  private val BACKOFF = longArrayOf(1, 2, 4, 8, 15, 30).map { it * 60_000 }
  private val XIAOMI = setOf("xiaomi", "redmi", "poco")
  @Volatile private var alarmLock: PowerManager.WakeLock? = null

  data class Check(val ok: Boolean, val busy: Boolean, val nextRoutineMs: Long?, val message: String)

  fun prefs(context: Context) = context.getSharedPreferences("mybots_keepalive", Context.MODE_PRIVATE)
  fun enabled(context: Context) = prefs(context).getBoolean("enabled", true)
  fun paired(context: Context) = try { pairingPreferences(context).getString("token", null) != null } catch (_: Exception) { false }

  fun setEnabled(context: Context, value: Boolean) {
    prefs(context).edit().putBoolean("enabled", value).apply()
    if (value) start(context, "app") else {
      context.stopService(Intent(context, KeepAliveService::class.java))
      (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(alarmIntent(context))
      prefs(context).edit().remove("nextAlarmAt").apply()
    }
  }

  /** Starts the service when it is on and paired; false when Android refused (background start without exemption). */
  fun start(context: Context, reason: String): Boolean {
    if (!enabled(context) || !paired(context)) return false
    val intent = Intent(context, KeepAliveService::class.java).putExtra("reason", reason)
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      prefs(context).edit().remove("startError").apply(); true
    } catch (error: Exception) {
      prefs(context).edit().putString("startError", error.javaClass.simpleName).apply(); false
    }
  }

  fun holdRestarts(context: Context, ms: Long) { prefs(context).edit().putLong("holdUntil", System.currentTimeMillis() + ms).apply() }

  /** Keeps the CPU on for a moment, so an alarm can reach the service and the supervisor before the phone sleeps again. */
  fun wakeBriefly(context: Context, ms: Long) {
    val lock = alarmLock ?: (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MyBots:despertar").apply { setReferenceCounted(false) }.also { alarmLock = it }
    lock.acquire(ms)
  }

  // Blocking: runs on the service's worker thread (or a receiver's goAsync thread).
  fun check(context: Context, reason: String): Check {
    val p = prefs(context); val now = System.currentTimeMillis()
    val saved = try { pairingPreferences(context) } catch (_: Exception) { null }
    val token = saved?.getString("token", null) ?: return Check(false, false, null, "Abra o MyBots para conectar o supervisor.")
    val port = saved.getInt("port", 3219)
    val body = JSONObject().put("reason", reason)
    val report = p.getLong("reportDownSince", 0)
    if (report > 0) body.put("restarted", JSONObject().put("downSince", report))
    p.edit().putLong("lastCheckAt", now).apply()
    val code: Int; var text: String? = null
    try {
      val connection = URL("http://127.0.0.1:$port/device/wake").openConnection() as HttpURLConnection
      connection.requestMethod = "POST"; connection.connectTimeout = 3000; connection.readTimeout = 10_000; connection.doOutput = true
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      code = connection.responseCode
      if (code == 200) text = connection.inputStream.bufferedReader().use { it.readText() }
      connection.disconnect()
    } catch (_: Exception) { return down(context, now) }
    // Anything answering on the port (an older supervisor without /device/wake, or one paired again) is alive: never restart it.
    p.edit().putLong("lastOkAt", now).putLong("downSince", 0).putInt("failures", 0).putInt("attempts", 0).apply()
    if (code != 200) return Check(true, false, null, READY)
    if (report > 0) p.edit().remove("reportDownSince").apply()
    val json = try { JSONObject(text ?: "{}") } catch (_: Exception) { JSONObject() }
    val next = if (json.isNull("nextRoutineMs")) null else json.optLong("nextRoutineMs").takeIf { it > 0 }
    val busy = json.optBoolean("busy")
    return Check(true, busy, next, if (busy) "Um bot está trabalhando agora." else READY)
  }

  private fun down(context: Context, now: Long): Check {
    val p = prefs(context)
    val since = p.getLong("downSince", 0).takeIf { it > 0 } ?: now
    val failures = p.getInt("failures", 0) + 1
    val attempts = p.getInt("attempts", 0)
    p.edit().putLong("downSince", since).putInt("failures", failures).apply()
    // Two misses in a row, so a supervisor being replaced by the app (pairing) is not restarted underneath it.
    val due = failures >= 2 && now >= p.getLong("holdUntil", 0) && now - p.getLong("lastRestartAt", 0) >= BACKOFF[minOf(attempts, BACKOFF.size - 1)]
    if (!due) return Check(false, false, null, "O supervisor não está respondendo. Vou tentar reiniciar.")
    p.edit().putLong("lastRestartAt", now).putInt("attempts", attempts + 1).putLong("restartDownSince", since).apply()
    restart(context)
    return Check(false, false, null, "O supervisor parou. Reiniciando no Termux…")
  }

  private fun restart(context: Context) {
    val p = prefs(context)
    if (context.packageManager.checkPermission(RUN_COMMAND_PERMISSION, context.packageName) != PackageManager.PERMISSION_GRANTED) {
      p.edit().putString("restartMessage", "O MyBots não tem permissão para executar comandos no Termux.").apply(); return
    }
    try {
      val script = context.assets.open("mybots-restart.sh").bufferedReader().use { it.readText() }
      val release = context.assets.open("mybots-supervisor.sha256").bufferedReader().use { it.readText().trim() }
      val id = "keepalive-" + UUID.randomUUID()
      val callback = Intent(context, TermuxResultReceiver::class.java).setData(Uri.parse("mybots://termux/$id")).putExtra("mybots.requestId", id)
      val flags = PendingIntent.FLAG_ONE_SHOT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val result = PendingIntent.getBroadcast(context, 41_200, callback, flags)
      // No stdin extra: the restart script never reads it.
      startTermux(context, runCommandIntent(TERMUX_TIMEOUT, arrayOf("120s", TERMUX_BASH, "-lc", script, "mybots", release, transportPublicKey(), transportDigest()),
        null, result, "MyBots · reiniciar supervisor"))
      p.edit().putString("restartMessage", "Reiniciando…").apply()
    } catch (error: Exception) {
      p.edit().putString("restartMessage", "Não consegui acionar o Termux (${error.javaClass.simpleName}).").apply()
    }
  }

  /** Termux's answer to a restart: the same encrypted envelope as pairing, saved so the app and the service keep working. */
  fun restartFinished(context: Context, result: Map<String, Any?>) {
    val p = prefs(context)
    val exit = result["exitCode"] as? Int ?: -1
    if (exit == 0) {
      try {
        val envelope = JSONObject((result["stdout"] as? String).orEmpty().trim().lines().last())
        storePairing(context, envelope.getString("encryptedToken"), envelope.getInt("port"), envelope.getString("release"))
        p.edit().putString("restartMessage", "Reiniciado").putLong("reportDownSince", p.getLong("restartDownSince", System.currentTimeMillis())).apply()
      } catch (_: Exception) { p.edit().putString("restartMessage", "O Termux não confirmou o reinício.").apply() }
      start(context, "periodic")
    } else {
      val error = (result["stderr"] as? String).orEmpty().lines().lastOrNull { it.isNotBlank() }?.take(200)
        ?: (result["errorMessage"] as? String)?.takeIf { it.isNotBlank() }?.take(200)
      p.edit().putString("restartMessage", error ?: "O reinício falhou (código $exit).").apply()
    }
  }

  private fun alarmIntent(context: Context) = PendingIntent.getBroadcast(context, 0,
    Intent(context, KeepAliveReceiver::class.java).setAction(ACTION_ALARM), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  /** Wakes the phone at the next routine (just after it is due) or in 15 minutes at the latest, even in Doze. */
  fun schedule(context: Context, nextRoutineMs: Long?) {
    if (!enabled(context)) return
    val now = System.currentTimeMillis()
    var at = now + ALARM_MAX_MS
    if (nextRoutineMs != null) at = minOf(at, maxOf(nextRoutineMs + 2_000, now + 60_000))
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(context))
      else manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(context))
      prefs(context).edit().putLong("nextAlarmAt", at).apply()
    } catch (_: SecurityException) { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(context)) }
  }

  fun notification(context: Context, text: String): Notification {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null)
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "MyBots ativo", NotificationManager.IMPORTANCE_MIN).apply {
        description = "Mantém rotinas e avisos dos bots funcionando com a tela apagada."; setShowBadge(false)
      })
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    @Suppress("DEPRECATION")
    val builder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL) else Notification.Builder(context).setPriority(Notification.PRIORITY_MIN))
      .setSmallIcon(R.drawable.mybots_notification).setContentTitle("MyBots ativo").setContentText(text)
      .setOngoing(true).setShowWhen(false).setCategory(Notification.CATEGORY_SERVICE).setColor(0xFF9ED8B9.toInt())
    open?.let { builder.setContentIntent(PendingIntent.getActivity(context, NOTIFICATION_ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)) }
    return builder.build()
  }

  fun status(context: Context): Map<String, Any?> {
    val p = prefs(context)
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
    val stamp = { key: String -> p.getLong(key, 0).takeIf { it > 0 }?.toDouble() }
    return mapOf(
      "enabled" to enabled(context), "running" to KeepAliveService.running, "paired" to paired(context),
      "lastCheckAt" to stamp("lastCheckAt"), "lastOkAt" to stamp("lastOkAt"), "downSince" to stamp("downSince"),
      "lastRestartAt" to stamp("lastRestartAt"), "restartMessage" to p.getString("restartMessage", null), "nextAlarmAt" to stamp("nextAlarmAt"),
      "startError" to p.getString("startError", null),
      "batteryUnrestricted" to power.isIgnoringBatteryOptimizations(context.packageName),
      "termuxBatteryUnrestricted" to power.isIgnoringBatteryOptimizations(TERMUX_PACKAGE),
      "backgroundRestricted" to (Build.VERSION.SDK_INT >= 28 && activity.isBackgroundRestricted),
      "exactAlarms" to (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()),
      "notifications" to notifications.areNotificationsEnabled(),
      "xiaomi" to (Build.MANUFACTURER.lowercase() in XIAOMI || Build.BRAND.lowercase() in XIAOMI))
  }

  /** Opens the screen that lifts one restriction; falls back to the app's own settings page. Returns which one opened. */
  fun openSettings(context: Context, target: String): String {
    val pkg = if (target.startsWith("termux")) TERMUX_PACKAGE else context.packageName
    val label = if (pkg == TERMUX_PACKAGE) "Termux" else "MyBots"
    val direct = when (target) {
      "battery" -> listOf(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg")))
      // HyperOS/MIUI keep their own battery saver ("Sem restrições") and autostart lists besides Android's.
      "hyperosBattery", "termuxBattery" -> listOf(Intent().setComponent(ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
        .putExtra("package_name", pkg).putExtra("package_label", label))
      "autostart", "termuxAutostart" -> listOf(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
      "exactAlarm" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) listOf(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg"))) else emptyList()
      "details", "termuxDetails" -> emptyList()
      else -> throw IllegalArgumentException("Ajuste inválido.")
    }
    for (intent in direct) {
      try { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return "direct" } catch (_: Exception) {}
    }
    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    return "details"
  }
}

class KeepAliveService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private var checking = false
  private var text = KeepAlive.READY
  private var workLock: PowerManager.WakeLock? = null
  private var busySince = 0L
  private val periodic = Runnable { check("periodic") }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() { super.onCreate(); running = true }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Every startForegroundService must be answered with startForeground, even when the service already runs.
    if (!promote() || !KeepAlive.enabled(this)) { stopSelf(); return START_NOT_STICKY }
    BotNotifier.start(applicationContext)
    BotBrowser.start(applicationContext)
    WidgetSync.start(applicationContext)
    MyBotsNotificationListener.rebind(applicationContext)
    check(intent?.getStringExtra("reason") ?: "periodic")
    return START_STICKY
  }

  private fun promote(): Boolean = try {
    val notification = KeepAlive.notification(this, text)
    if (Build.VERSION.SDK_INT >= 34) startForeground(KeepAlive.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(KeepAlive.NOTIFICATION_ID, notification)
    true
  } catch (error: Exception) {
    // Android refused a background start without an exemption; the next alarm or app opening tries again.
    KeepAlive.prefs(this).edit().putString("startError", error.javaClass.simpleName).apply(); false
  }

  private fun check(reason: String) {
    if (checking) return
    checking = true
    handler.removeCallbacks(periodic)
    KeepAlive.wakeBriefly(this, 30_000)
    worker.execute {
      val result = try { KeepAlive.check(applicationContext, reason) } catch (_: Exception) { KeepAlive.Check(false, false, null, "Não consegui verificar o supervisor.") }
      if (result.ok) NotificationForwarder.flush(applicationContext)
      handler.post { checking = false; apply(result) }
    }
  }

  private fun apply(result: KeepAlive.Check) {
    if (!running) return
    holdForWork(result.busy)
    KeepAlive.schedule(this, result.nextRoutineMs)
    if (result.message != text) {
      text = result.message
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(KeepAlive.NOTIFICATION_ID, KeepAlive.notification(this, text))
    }
    handler.postDelayed(periodic, if (result.busy) 15_000 else if (!result.ok) 30_000 else 60_000)
  }

  // The CPU stays on only while a bot works (a routine or a message), renewed at each check, at most 30 minutes in a row.
  private fun holdForWork(busy: Boolean) {
    val now = System.currentTimeMillis()
    if (!busy) { workLock?.takeIf { it.isHeld }?.release(); busySince = 0; return }
    if (busySince == 0L) busySince = now
    if (now - busySince > 30 * 60_000) { workLock?.takeIf { it.isHeld }?.release(); return }
    val lock = workLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MyBots:rotina").apply { setReferenceCounted(false) }.also { workLock = it }
    lock.acquire(2 * 60_000)
  }

  override fun onDestroy() {
    running = false
    handler.removeCallbacksAndMessages(null)
    workLock?.takeIf { it.isHeld }?.release()
    worker.shutdown()
    super.onDestroy()
  }

  companion object { @Volatile var running = false }
}

/** Alarm (routine time / 15-minute heartbeat), phone restart and app update all bring the service back. */
class KeepAliveReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val reason = when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> "boot"
      KeepAlive.ACTION_ALARM -> "alarm"
      else -> return
    }
    val app = context.applicationContext
    if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) AppUpdate.finished(app)
    if (!KeepAlive.enabled(app) || !KeepAlive.paired(app)) return
    KeepAlive.wakeBriefly(app, 60_000)
    if (KeepAlive.start(app, reason)) return
    // Without the service (Android refused to start it) the alarm still wakes the supervisor once and schedules the next one.
    val pending = goAsync()
    Thread {
      try { KeepAlive.schedule(app, KeepAlive.check(app, reason).nextRoutineMs) } catch (_: Exception) {} finally { pending.finish() }
    }.start()
  }
}
