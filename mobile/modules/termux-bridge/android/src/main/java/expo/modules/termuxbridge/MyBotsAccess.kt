package expo.modules.termuxbridge

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.Normalizer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The bots' hands on the phone's other apps (nível Livre): Android's accessibility service. It reads the screen as a
 * numbered list, taps, types, scrolls and opens apps when the supervisor asks (phone_* tools, through the browser
 * host's queue). It never declares itself an accessibility tool, so apps that hide from such services (banks) stay
 * hidden and the bot calls the person instead.
 */
class MyBotsAccess : AccessibilityService() {
  override fun onServiceConnected() { instance = this }
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
  override fun onInterrupt() {}
  override fun onUnbind(intent: Intent?): Boolean { instance = null; PhoneControl.release(); return super.onUnbind(intent) }
  override fun onDestroy() { instance = null; PhoneControl.release(); super.onDestroy() }

  companion object {
    @Volatile var instance: MyBotsAccess? = null

    fun enabled(context: Context): Boolean {
      val component = ComponentName(context, MyBotsAccess::class.java)
      val list = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
      return list.split(":").any { ComponentName.unflattenFromString(it) == component }
    }

    /**
     * Android 13+ blocks accessibility for apps installed outside a store until the person allows "configurações
     * restritas" in the app's info. AppOps tells whether that is still blocked (true) on this phone.
     */
    fun restricted(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < 33) return false
      return try {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
        val mode = ops.unsafeCheckOpNoThrow("android:access_restricted_settings", context.applicationInfo.uid, context.packageName)
        mode != android.app.AppOpsManager.MODE_ALLOWED && mode != android.app.AppOpsManager.MODE_DEFAULT
      } catch (_: Exception) { false }
    }
  }
}

/**
 * Which bots the person put on the Livre level and the "sempre perguntar" list, kept by the app itself (Termux, where a
 * Livre bot has a shell, cannot write here). The phone's other apps only obey bots listed here, and the app checks the
 * supervisor's copy against this one.
 */
internal object FreeGuard {
  private fun prefs(context: Context) = context.getSharedPreferences("mybots_free", Context.MODE_PRIVATE)
  fun bots(context: Context): Set<String> = prefs(context).getStringSet("bots", emptySet()).orEmpty()
  fun set(context: Context, botId: String, on: Boolean) { val next = bots(context).toMutableSet().apply { if (on) add(botId) else remove(botId) }; prefs(context).edit().putStringSet("bots", next).apply { if (on) putBoolean("warned", true) }.apply() }
  fun warned(context: Context) = prefs(context).getBoolean("warned", false)
  @Synchronized fun ask(context: Context): String? {
    val saved = prefs(context)
    if (!saved.getBoolean("wallet_default_migrated", false)) {
      val editor = saved.edit()
      saved.getString("ask", null)?.let { value ->
        try {
          val array = JSONArray(value)
          if ((0 until array.length()).none { array.optString(it) == "wallet/pay" }) array.put("wallet/pay")
          editor.putString("ask", array.toString())
        } catch (_: Exception) { /* Invalid legacy data is handled by the supervisor defaults. */ }
      }
      editor.putBoolean("wallet_default_migrated", true).commit()
    }
    return saved.getString("ask", null)
  }
  @Synchronized fun setAsk(context: Context, json: String) { ask(context); prefs(context).edit().putString("ask", json).apply() }
  fun allows(context: Context, botId: String) = botId in bots(context)
}

/** Conservative identification for payment fields and card numbers on accessibility screens. */
internal object CardProtection {
  private val field = Regex("(?:\\bcc[-_ ]?(?:number|num|csc|cvv|exp|name)\\b|(?<![a-z0-9])card[-_ ]?(?:number|num|security|verification|code|cvv|cvc|expiry|expiration|exp|holder)|n[úu]mero.{0,12}cart[aã]o|cart[aã]o.{0,12}(?:n[úu]mero|validade|seguran[çc]a)|\\b(?:cvv|cvc|csc)\\b|validade.{0,12}cart[aã]o)", RegexOption.IGNORE_CASE)
  private val pan = Regex("(?:\\d[ -]?){12,18}\\d")
  private val url = Regex("(?:[a-z][a-z0-9+.-]*://|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}(?=[:/?#]|\\b))[^\\s<>\"']+", RegexOption.IGNORE_CASE)

  // Match the same brands, Luhn check and text boundaries as supervisor/card-pan.mjs.
  private fun isPan(number: String): Boolean {
    fun n(length: Int) = number.take(length).toInt()
    val known = number[0] == '4' || n(2) in 51..55 || n(4) in 2221..2720 ||
      n(2) in setOf(34, 37) || n(3) in 300..305 || n(2) in setOf(36, 38, 39) ||
      n(4) == 6011 || n(2) == 65 || n(3) in 644..649 || n(6) in 622126..622925 ||
      n(4) in 3528..3589 || n(6) in setOf(606282, 637095, 637568, 637599, 637609, 637612) || n(4) == 3841 ||
      n(6) in setOf(401178, 401179, 431274, 438935, 451416, 457393, 457631, 457632, 504175, 627780, 636297, 636368) ||
      n(6) in 506699..506778 || n(6) in 509000..509999 || n(6) in 650031..650033 || n(6) in 650035..650051 ||
      n(6) in 650405..650439 || n(6) in 650485..650538 || n(6) in 650541..650598 || n(6) in 650700..650718 ||
      n(6) in 650720..650727 || n(6) in 650901..650978 || n(6) in 651652..651679 || n(6) in 655000..655019 || n(6) in 655021..655058
    if (!known) return false
    val sum = number.reversed().mapIndexed { index, c ->
      val d = c.digitToInt() * if (index % 2 == 1) 2 else 1
      if (d > 9) d - 9 else d
    }.sum()
    return sum % 10 == 0
  }
  private fun matchesPan(text: String): List<IntRange> {
    val urls = url.findAll(text).map { it.range }.toList()
    return pan.findAll(text).filter { match ->
      val start = match.range.first; val end = match.range.last + 1
      (start == 0 || !text[start - 1].isLetterOrDigit()) && (end == text.length || !text[end].isLetterOrDigit()) &&
        urls.none { start <= it.last && end > it.first } && isPan(match.value.replace(" ", "").replace("-", ""))
    }.map { it.range }.toList()
  }
  private fun redactPan(text: String): String {
    val out = StringBuilder(text)
    for (range in matchesPan(text).asReversed()) out.replace(range.first, range.last + 1, "[cartão protegido]")
    return out.toString()
  }
  private val cvc = Regex("(?i)(\\b(?:cvv|cvc|csc)\\b\\s*[:#-]?\\s*)\\d{3,4}\\b")
  fun redact(text: String): String = cvc.replace(redactPan(text), "$1[cartão protegido]")
  fun sensitive(node: AccessibilityNodeInfo): Boolean {
    val hint = if (Build.VERSION.SDK_INT >= 26) node.hintText?.toString().orEmpty() else ""
    val meta = "${node.viewIdResourceName.orEmpty()} $hint ${node.contentDescription ?: ""}".replace(Regex("gift[-_ ]?card[-_ ]?code", RegexOption.IGNORE_CASE), " ")
    return field.containsMatchIn(meta) || matchesPan(node.text?.toString().orEmpty()).isNotEmpty() || cvc.containsMatchIn(node.text?.toString().orEmpty())
  }
}

/**
 * Verification codes that arrive by notification (including SMS, through the messages app). The number is hidden
 * before the notification goes to the supervisor; the code stays here, in memory, for a few minutes, and is only
 * written into a field (phone_fill_code) for the sender the bot names and, unless the person confirms, a field whose
 * app or site the message mentions.
 */
internal object VerificationCodes {
  class Code(val code: String, val packageName: String, val app: String, val title: String, val text: String, val time: Long)
  private const val KEEP_MS = 15 * 60_000L
  private val recent = ArrayDeque<Code>()
  // Every code seen, used or not, stays a secret for a while: hidden from screens, pages and results the bot reads.
  private const val SECRET_MS = 30 * 60_000L
  private val seen = ArrayDeque<Pair<String, Long>>()
  private val CONTEXT = Regex("c[óo]d(igo)?\\b|\\bcode\\b|\\botp\\b|token|verifica|verification|senha|password|\\bpin\\b|2fa|autentica|authenticat|confirma|\\blogin\\b|acesso|access|entrar|sign.?in", RegexOption.IGNORE_CASE)
  private val CODE = Regex("\\b(?:[A-Z]{1,3}-)?\\d{3}[ -]\\d{3}\\b|\\b(?:[A-Z]{1,3}-)?\\d{4,8}\\b")
  const val MASK = "[código protegido]"
  private val COMMON = setOf("com", "www", "br", "org", "net", "gov", "edu", "app", "apps", "android", "google", "mobile", "accounts", "account", "login", "auth", "secure", "the", "web", "api")

  /** The notification's title and text with codes hidden; codes found are kept. */
  @Synchronized fun capture(packageName: String, app: String, title: String, text: String, time: Long): Pair<String, String> {
    if (!CONTEXT.containsMatchIn("$title\n$text")) return title to text
    // Only the message holds the code; the title is the sender (an SMS number must stay readable and is never a code).
    val found = CODE.findAll(text).map { it.value.replace(Regex("^[A-Z]{1,3}-"), "").replace(Regex("[ -]"), "") }.toList()
    for (code in found.distinct().reversed()) { recent.addFirst(Code(code, packageName, app, title, text, time)); seen.addFirst(code to time) }
    while (recent.size > 20) recent.removeLast()
    while (seen.size > 50) seen.removeLast()
    return title to text.replace(CODE, MASK)
  }

  @Synchronized fun secrets(): List<String> { val now = System.currentTimeMillis(); seen.removeAll { now - it.second > SECRET_MS }; return seen.map { it.first }.distinct() }

  /** A text the bot is about to read, without any code: known ones, and anything that looks like one in a message about a code. */
  fun hide(text: String): String {
    var out = CardProtection.redact(text)
    for (code in secrets()) out = out.replace(code, MASK)
    return if (CONTEXT.containsMatchIn(out)) out.replace(CODE, MASK) else out
  }

  /** The same for a whole answer to the supervisor (JSON text). */
  fun redact(text: String): String { var out = CardProtection.redact(text); for (code in secrets()) out = out.replace(code, MASK); return out }

  /** Redact string values, not serialized JSON: timestamps and other numbers must stay valid JSON. */
  fun redactJson(value: Any?, key: String = ""): Any? = when (value) {
    is JSONObject -> JSONObject().also { out -> value.keys().forEach { name -> out.put(name, redactJson(value.opt(name), name)) } }
    is JSONArray -> JSONArray().also { out -> for (index in 0 until value.length()) out.put(redactJson(value.opt(index))) }
    is String -> if (key == "image" || key == "icon") value else redact(value)
    else -> value
  }

  fun fold(value: String) = Normalizer.normalize(value, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase()

  /** The newest code from this sender (app name, package or the title the messages app shows, like an SMS number). */
  @Synchronized fun find(from: String): Code? {
    val now = System.currentTimeMillis()
    recent.removeAll { now - it.time > KEEP_MS }
    val wanted = fold(from).replace(Regex("[\\s()+-]"), "")
    if (wanted.length < 2) return null
    return recent.firstOrNull { code -> listOf(code.app, code.packageName, code.title).any { val have = fold(it).replace(Regex("[\\s()+-]"), ""); have.isNotEmpty() && (have.contains(wanted) || wanted.contains(have) && have.length >= 3) } }
  }
  @Synchronized fun used(code: Code) { recent.remove(code) }

  /** Words that name an app or a site, to look for in the message ("accounts.ifood.com.br" → "ifood"). */
  fun names(vararg values: String): List<String> = values.flatMap { fold(it).split(Regex("[^a-z0-9]+")) }.filter { it.length >= 3 && it !in COMMON }.distinct()
  fun mentions(code: Code, names: List<String>): Boolean { val text = fold("${code.title}\n${code.text}"); return names.any { text.contains(it) } }
}

/** "Parar" and "Assumir" from the notification. */
class PhoneControlReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      PhoneControl.ACTION_STOP -> PhoneControl.stopHere(context.applicationContext, "notice")
      PhoneControl.ACTION_TAKE -> PhoneControl.takeHere(context.applicationContext, true)
      PhoneControl.ACTION_RETURN -> PhoneControl.takeHere(context.applicationContext, false)
      WalletPay.ACTION_FREEZE -> WalletPay.freeze(context.applicationContext)
    }
  }
}

internal class Stopped : IllegalStateException("Parado: a pessoa interrompeu o controle do celular. Não tente de novo sem ela pedir.")

internal object PhoneControl {
  const val ACTION_STOP = "com.mybots.app.PHONE_STOP"
  const val ACTION_TAKE = "com.mybots.app.PHONE_TAKE"
  const val ACTION_RETURN = "com.mybots.app.PHONE_RETURN"
  private const val CHANNEL = "mybots_phone"
  private const val NOTICE_ID = 7_301
  private val main = Handler(Looper.getMainLooper())
  private val sender = Executors.newSingleThreadExecutor()
  // Apps and screens a bot never acts on, whatever the level: MyBots itself, installing apps, granting permissions.
  private val BLOCKED = setOf("com.mybots.app", "com.android.packageinstaller", "com.google.android.packageinstaller", "com.android.permissioncontroller", "com.google.android.permissioncontroller")
  private val SETTINGS_WORDS = Regex("acessibilidade|accessibility|desinstalar|uninstall|forçar parada|force stop|configurações restritas|restricted settings|administrador|admin app|permiss|permission|notifica", RegexOption.IGNORE_CASE)

  private val ALIASES = mapOf("configuracoes" to "settings", "ajustes" to "settings", "contatos" to "contacts", "mensagens" to "messages", "relogio" to "clock", "telefone" to "phone",
    "camera" to "camera", "arquivos" to "files", "fotos" to "photos", "galeria" to "photos", "calendario" to "calendar", "agenda" to "calendar", "calculadora" to "calculator", "loja" to "play store")

  @Volatile private var task: String? = null
  @Volatile private var botName = ""
  @Volatile private var caption = ""
  @Volatile var person = false
  private val stopped = ConcurrentHashMap.newKeySet<String>()
  private val nodes = ConcurrentHashMap<Int, AccessibilityNodeInfo>()
  private val editorToken = ThreadLocal<Long>()
  private fun <T> editorAction(block: () -> T): T = WalletEditorGate.action(editorToken.get() ?: throw IllegalStateException("Comando inválido."), block)
  private var bar: LinearLayout? = null
  private var label: TextView? = null
  private var takeButton: TextView? = null
  private var mark: MarkView? = null

  private fun service(): MyBotsAccess = MyBotsAccess.instance ?: throw IllegalStateException("O controle do celular está desligado. A pessoa liga em Ajustes → Controle do celular, no MyBots (acessibilidade do Android).")

  /** A queued command from the supervisor (phone lane). Stop, take-over and end come through immediate() instead. */
  fun run(context: Context, command: JSONObject): JSONObject {
    editorToken.set(WalletEditorGate.token())
    try {
    val args = command.optJSONObject("args") ?: JSONObject()
    val taskId = args.optString("taskId")
    if (taskId.isEmpty() || taskId in stopped) throw Stopped()
    if (!FreeGuard.allows(context, args.optString("botId"))) throw IllegalStateException("Este bot não está no nível Livre neste celular. Só a pessoa escolhe esse nível, no app.")
    if (person) throw IllegalStateException("A pessoa assumiu o celular. Espere ela tocar em “Devolver ao bot”.")
    val service = service()
    begin(context, service, taskId, args.optString("botName").take(40))
    val result = when (command.getString("op")) {
      "phoneScreen" -> screen(service, args.optBoolean("image"))
      "phoneTap" -> tap(context, service, args)
      "phoneType" -> type(context, service, args)
      "phoneScroll" -> scroll(context, service, args)
      "phoneOpenApp" -> openApp(context, service, args)
      "phoneBack" -> {
        check(taskId)
        editorAction { service.performGlobalAction(if (args.optBoolean("home")) AccessibilityService.GLOBAL_ACTION_HOME else AccessibilityService.GLOBAL_ACTION_BACK) }
        pause(taskId, 600); after(service, JSONObject())
      }
      "phoneFillCode" -> fillCode(context, service, args)
      else -> throw IllegalArgumentException("Comando do celular inválido.")
    }
    WalletEditorGate.check(editorToken.get() ?: throw IllegalStateException("Comando inválido."))
    return result
    } finally { editorToken.remove() }
  }

  fun immediate(context: Context, command: JSONObject): JSONObject {
    val args = command.optJSONObject("args") ?: JSONObject()
    when (command.getString("op")) {
      "phoneStop" -> { args.optString("taskId").takeIf { it.isNotEmpty() && it != "null" }?.let { stopped.add(it) } ?: task?.let { stopped.add(it) }; finish(context) }
      "phoneEnd" -> if (task == args.optString("taskId")) finish(context)
      "phoneControl" -> { person = args.optBoolean("person"); refresh(context) }
    }
    return JSONObject().put("ok", true)
  }

  /** Parar on the overlay or the notice: everything stops here at once, then the supervisor cancels the turn. */
  fun stopHere(context: Context, source: String) {
    task?.let { stopped.add(it) }
    finish(context)
    post(context, JSONObject().put("event", "stop").put("source", source))
  }

  fun takeHere(context: Context, take: Boolean) {
    person = take; refresh(context)
    post(context, JSONObject().put("event", if (take) "take" else "return"))
  }

  fun release() { main.post { removeOverlay() } }

  fun post(context: Context, body: JSONObject) = sender.execute {
    try {
      val saved = pairingPreferences(context)
      val token = saved.getString("token", null) ?: return@execute
      val connection = URL("http://127.0.0.1:${saved.getInt("port", 3219)}/device/phone").openConnection() as HttpURLConnection
      connection.requestMethod = "POST"; connection.doOutput = true; connection.connectTimeout = 3000; connection.readTimeout = 10_000
      connection.setRequestProperty("Authorization", "Bearer $token"); connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      connection.responseCode; connection.disconnect()
    } catch (_: Exception) {}
  }

  private fun check(taskId: String) {
    WalletEditorGate.check(editorToken.get() ?: throw IllegalStateException("Comando inválido."))
    if (taskId in stopped) throw Stopped()
    if (person) throw IllegalStateException("A pessoa assumiu o celular. Espere ela tocar em “Devolver ao bot”.")
  }

  /** Waits, checking for Parar every 50 ms. */
  private fun pause(taskId: String, ms: Long) {
    val until = System.currentTimeMillis() + ms
    while (System.currentTimeMillis() < until) { check(taskId); Thread.sleep(50) }
    check(taskId)
  }

  private fun begin(context: Context, service: MyBotsAccess, taskId: String, name: String) {
    if (task == taskId) return
    task = taskId; botName = name; caption = "Olhando a tela"; person = false
    main.post { showOverlay(service) }
    notice(context)
  }

  private fun finish(context: Context) {
    task = null; caption = ""; person = false; nodes.clear()
    main.post { removeOverlay() }
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTICE_ID)
  }

  private fun refresh(context: Context) {
    if (task == null) return
    main.post { label?.text = text(); takeButton?.text = if (person) "Devolver" else "Assumir" }
    notice(context)
  }

  private fun text() = if (person) "Você está no controle · $botName espera" else "● $botName · $caption"

  private fun notice(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null)
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Bot controlando o celular", NotificationManager.IMPORTANCE_LOW).apply { description = "Aparece enquanto um bot mexe em outros apps, com o botão Parar."; setShowBadge(false) })
    val action = { name: String, code: Int -> PendingIntent.getBroadcast(context, code, Intent(name).setPackage(context.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    @Suppress("DEPRECATION")
    val builder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL) else Notification.Builder(context))
      .setSmallIcon(R.drawable.mybots_notification).setContentTitle(if (person) "Você assumiu o celular" else "$botName está controlando o celular")
      .setContentText(if (person) "Toque em Devolver quando terminar." else caption).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false).setColor(0xFF9ED8B9.toInt())
      .addAction(Notification.Action.Builder(null, "Parar", action(ACTION_STOP, 1)).build())
      .addAction(Notification.Action.Builder(null, if (person) "Devolver" else "Assumir", action(if (person) ACTION_RETURN else ACTION_TAKE, 2)).build())
    try { manager.notify(NOTICE_ID, builder.build()) } catch (_: SecurityException) {}
  }

  // The overlay: a bar at the top with what the bot is doing, Assumir/Devolver and Parar, always on top of other apps.
  @SuppressLint("SetTextI18n")
  private fun showOverlay(service: MyBotsAccess) {
    if (bar != null) { label?.text = text(); return }
    val windows = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val density = service.resources.displayMetrics.density
    val dp = { value: Int -> (value * density).toInt() }
    val button = { title: String, color: Int, click: () -> Unit -> TextView(service).apply {
      text = title; setTextColor(Color.WHITE); textSize = 14f; setPadding(dp(14), dp(8), dp(14), dp(8)); setSingleLine(true); gravity = Gravity.CENTER
      background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(color) }
      setOnClickListener { click() }
    } }
    val row = LinearLayout(service).apply {
      orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(6), dp(6), dp(6))
      background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0xEE10141A.toInt()) }
    }
    val caption = TextView(service).apply { text = text(); setTextColor(Color.WHITE); textSize = 13f; setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END }
    val take = button(if (person) "Devolver" else "Assumir", 0xFF2C3440.toInt()) { takeHere(service.applicationContext, !person) }
    val stop = button("Parar", 0xFFD9534F.toInt()) { stopHere(service.applicationContext, "overlay") }
    row.addView(caption, LinearLayout.LayoutParams(0, -2, 1f))
    row.addView(take, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
    row.addView(stop, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(6) })
    // As wide as the screen minus a margin, so the caption shrinks and Parar always fits.
    val params = WindowManager.LayoutParams(service.resources.displayMetrics.widthPixels - dp(24), -2, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; y = dp(36) }
    val marks = MarkView(service)
    val full = WindowManager.LayoutParams(-1, -1, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT)
    try { windows.addView(marks, full); mark = marks } catch (_: Exception) {}
    try { windows.addView(row, params); bar = row; label = caption; takeButton = take } catch (_: Exception) {}
  }

  private fun removeOverlay() {
    val service = MyBotsAccess.instance
    val windows = service?.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    for (view in listOfNotNull(bar, mark)) try { windows?.removeView(view) } catch (_: Exception) {}
    bar = null; label = null; takeButton = null; mark = null
  }

  /** Where the bot is about to act: an outline and the caption, a moment before it happens. */
  private fun show(taskId: String, words: String, rect: Rect?) {
    caption = words
    main.post { label?.text = text(); mark?.show(rect) }
    MyBotsAccess.instance?.let { notice(it.applicationContext) }
    if (rect != null) pause(taskId, 350)
  }

  private class MarkView(context: Context) : View(context) {
    private var rect: Rect? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 6f; color = 0xFF9ED8B9.toInt() }
    private val clear = Runnable { rect = null; invalidate() }
    fun show(next: Rect?) { rect = next; invalidate(); removeCallbacks(clear); postDelayed(clear, 1200) }
    override fun onDraw(canvas: Canvas) {
      val r = rect ?: return
      val location = IntArray(2); getLocationOnScreen(location)
      canvas.drawRoundRect(RectF((r.left - location[0]).toFloat(), (r.top - location[1]).toFloat(), (r.right - location[0]).toFloat(), (r.bottom - location[1]).toFloat()), 12f, 12f, paint)
    }
  }

  private fun root(service: MyBotsAccess): AccessibilityNodeInfo? {
    repeat(6) { service.rootInActiveWindow?.let { return it }; Thread.sleep(150) }
    return null
  }

  private fun appLabel(context: Context, packageName: String): String = try {
    context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(packageName, 0)).toString()
  } catch (_: Exception) { packageName }

  /** The screen as numbered elements; ids stay valid for tap/type/scroll until the next phone_screen. */
  private fun screen(service: MyBotsAccess, image: Boolean): JSONObject {
    val root = root(service)
    val packageName = root?.packageName?.toString().orEmpty()
    val result = JSONObject().put("package", packageName).put("app", if (packageName.isEmpty()) "" else appLabel(service, packageName))
    val metrics = service.resources.displayMetrics
    result.put("width", metrics.widthPixels).put("height", metrics.heightPixels)
    nodes.clear()
    val elements = JSONArray(); val boxes = mutableListOf<Pair<Int, Rect>>(); val secret = mutableListOf<Rect>()
    fun visit(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || depth > 40 || elements.length() >= 300) return
      if (node.isVisibleToUser) {
        val raw = node.text?.toString().orEmpty().replace(Regex("\\s+"), " ").trim()
        val rawDescription = node.contentDescription?.toString().orEmpty().replace(Regex("\\s+"), " ").trim()
        // Verification codes on any screen (the SMS app, a field just filled) are never read by the bot.
        val text = VerificationCodes.hide(raw); val description = VerificationCodes.hide(rawDescription)
        val coded = text != raw || description != rawDescription
        val card = CardProtection.sensitive(node)
        val useful = node.isClickable || node.isLongClickable || node.isEditable || node.isScrollable || node.isCheckable || text.isNotEmpty() || description.isNotEmpty()
        if (useful) {
          val box = Rect(); node.getBoundsInScreen(box)
          if (box.width() > 0 && box.height() > 0) {
            val id = elements.length() + 1
            nodes[id] = node
            val item = JSONObject().put("id", id)
              .put("kind", when { node.isEditable -> "campo"; node.isCheckable -> "opção"; node.isClickable -> "botão"; node.isScrollable -> "lista"; else -> "texto" })
            // Passwords, as in the browser: the IA sees that there is one, never what it is.
            if (node.isPassword || card) { item.put(if (card) "card" else "password", true); if (text.isNotEmpty()) item.put("text", "••••"); secret.add(box) }
            else if (coded) { item.put("code", true); secret.add(box); if (text.isNotEmpty()) item.put("text", text.take(200)) }
            else if (text.isNotEmpty()) item.put("text", text.take(200))
            if (!card && description.isNotEmpty() && description != text) item.put("description", description.take(200))
            if (!card && Build.VERSION.SDK_INT >= 26) node.hintText?.toString()?.takeIf { it.isNotBlank() && it != text }?.let { item.put("hint", VerificationCodes.hide(it).take(120)) }
            if (node.isCheckable) item.put("checked", node.isChecked)
            if (node.isScrollable) item.put("scrollable", true)
            if (node.isFocused) item.put("focused", true)
            if (!node.isEnabled) item.put("enabled", false)
            item.put("box", JSONObject().put("x", box.left).put("y", box.top).put("w", box.width()).put("h", box.height()))
            elements.put(item); boxes.add(id to box)
          }
        }
      }
      for (index in 0 until node.childCount) visit(node.getChild(index), depth + 1)
    }
    visit(root, 0)
    result.put("elements", elements)
    // Apps that hide from accessibility (banks, payments) show an empty screen here: the bot hands it to the person.
    if (packageName.isNotEmpty() && elements.length() == 0) result.put("refused", true).put("message", "Este app não deixa o MyBots ver nem controlar a tela (comum em bancos e apps de pagamento). Chame a pessoa com phone_ask_user.")
    if (blocked(service, root)) result.put("blocked", true).put("message", "Aqui o bot só olha: o MyBots, instalar apps e dar permissões ficam sempre com a pessoa.")
    if (image) capture(service, 720f, 70, boxes, secret)?.let { result.put("image", it.optString("image")).put("imageWidth", it.optInt("width")).put("imageHeight", it.optInt("height")) }
      ?: result.put("imageError", "A tela deste app não pode ser capturada (app protegido ou o Android recusou agora).")
    return result
  }

  private fun blocked(service: MyBotsAccess, root: AccessibilityNodeInfo?): Boolean {
    val packageName = root?.packageName?.toString().orEmpty()
    if (packageName in BLOCKED) return true
    if (!packageName.contains("settings")) return false
    // Settings screens about MyBots itself (its accessibility, permissions, uninstall): reading only.
    val words = StringBuilder()
    fun collect(node: AccessibilityNodeInfo?, depth: Int) { if (node == null || depth > 30 || words.length > 20_000) return; node.text?.let { words.append(it).append('\n') }; for (index in 0 until node.childCount) collect(node.getChild(index), depth + 1) }
    collect(root, 0)
    return words.contains("MyBots") && SETTINGS_WORDS.containsMatchIn(words)
  }

  private fun requireActionable(service: MyBotsAccess) {
    if (blocked(service, root(service))) throw IllegalStateException("Esta tela é sempre da pessoa: o MyBots, instalar apps e dar permissões não são feitos por bots, nem no nível Livre.")
  }

  private fun node(id: Int): AccessibilityNodeInfo {
    val node = nodes[id] ?: throw IllegalArgumentException("Elemento não encontrado. Veja a tela de novo com phone_screen.")
    if (!node.refresh() || !node.isVisibleToUser) throw IllegalStateException("A tela mudou. Veja de novo com phone_screen.")
    return node
  }

  private fun labelOf(node: AccessibilityNodeInfo) = if (node.isPassword || CardProtection.sensitive(node)) "campo protegido" else VerificationCodes.hide((node.text?.toString()?.takeUnless { node.isPassword } ?: node.contentDescription?.toString() ?: (if (Build.VERSION.SDK_INT >= 26) node.hintText?.toString() else null)).orEmpty().replace(Regex("\\s+"), " ").trim()).take(40)

  private fun tap(context: Context, service: MyBotsAccess, args: JSONObject): JSONObject {
    val taskId = args.optString("taskId"); val long = args.optBoolean("long")
    requireActionable(service)
    val verb = if (long) "Segurando" else "Tocando"
    if (args.has("id")) {
      val node = node(args.getInt("id"))
      val box = Rect(); node.getBoundsInScreen(box)
      val name = labelOf(node)
      show(taskId, if (name.isEmpty()) verb else "$verb em ‘$name’", box)
      var target: AccessibilityNodeInfo? = node
      while (target != null && !(if (long) target.isLongClickable else target.isClickable)) target = target.parent
      val done = editorAction { target?.performAction(if (long) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK) == true }
      if (!done) gesture(service, taskId, box.exactCenterX(), box.exactCenterY(), null, if (long) 700 else 60)
      pause(taskId, 700)
      return after(service, JSONObject().put("target", JSONObject().put("label", name)))
    }
    val x = args.getInt("x").toFloat(); val y = args.getInt("y").toFloat()
    show(taskId, "$verb em ($x, $y)", Rect((x - 30).toInt(), (y - 30).toInt(), (x + 30).toInt(), (y + 30).toInt()))
    gesture(service, taskId, x, y, null, if (long) 700 else 60)
    pause(taskId, 700)
    return after(service, JSONObject())
  }

  private fun type(context: Context, service: MyBotsAccess, args: JSONObject): JSONObject {
    val taskId = args.optString("taskId")
    requireActionable(service)
    val node = node(args.getInt("id"))
    if (node.isPassword || CardProtection.sensitive(node)) throw IllegalStateException("Campos protegidos só a pessoa preenche. Use phone_ask_user.")
    if (!node.isEditable) throw IllegalStateException("Este elemento não é um campo de texto. Veja os campos em phone_screen.")
    val box = Rect(); node.getBoundsInScreen(box)
    val name = labelOf(node)
    show(taskId, if (name.isEmpty()) "Digitando" else "Digitando em ‘$name’", box)
    editorAction { node.performAction(AccessibilityNodeInfo.ACTION_FOCUS) }
    val bundle = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, args.optString("text")) }
    if (!editorAction { node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle) }) throw IllegalStateException("O app não aceitou o texto neste campo.")
    if (args.optBoolean("submit")) {
      check(taskId)
      if (Build.VERSION.SDK_INT >= 30) editorAction { node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id) }
    }
    pause(taskId, 500)
    return after(service, JSONObject().put("target", JSONObject().put("label", name)))
  }

  private fun scroll(context: Context, service: MyBotsAccess, args: JSONObject): JSONObject {
    val taskId = args.optString("taskId"); val direction = args.optString("direction")
    requireActionable(service)
    show(taskId, mapOf("up" to "Rolando para cima", "down" to "Rolando para baixo", "left" to "Rolando para a esquerda", "right" to "Rolando para a direita")[direction] ?: "Rolando", null)
    val node = if (args.has("id")) node(args.getInt("id")) else null
    var target = node
    while (target != null && !target.isScrollable) target = target.parent
    val actionId = when (direction) {
      "up" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP.id
      "down" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN.id
      "left" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT.id
      else -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT.id
    }
    val done = editorAction { target != null && (target.performAction(actionId) || target.performAction(if (direction == "up" || direction == "left") AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) }
    if (!done) {
      // A swipe in the middle of the screen (or of the list): content moves the opposite way of the finger.
      val metrics = service.resources.displayMetrics
      val box = Rect(0, 0, metrics.widthPixels, metrics.heightPixels).also { area -> node?.getBoundsInScreen(area) }
      val cx = box.exactCenterX(); val cy = box.exactCenterY(); val dx = box.width() * 0.3f; val dy = box.height() * 0.3f
      when (direction) {
        "down" -> gesture(service, taskId, cx, cy + dy, cx to cy - dy, 350)
        "up" -> gesture(service, taskId, cx, cy - dy, cx to cy + dy, 350)
        "right" -> gesture(service, taskId, cx + dx, cy, cx - dx to cy, 350)
        else -> gesture(service, taskId, cx - dx, cy, cx + dx to cy, 350)
      }
    }
    pause(taskId, 600)
    return after(service, JSONObject())
  }

  private fun openApp(context: Context, service: MyBotsAccess, args: JSONObject): JSONObject {
    val taskId = args.optString("taskId"); val wanted = args.optString("app").trim()
    val manager = context.packageManager
    val launchers = manager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
    // The same app by its Portuguese or English name (a phone in English shows "Settings" for Configurações).
    val names = VerificationCodes.fold(wanted).let { listOfNotNull(it, ALIASES[it]) }
    val match = launchers.firstOrNull { it.activityInfo.packageName == wanted }
      ?: names.firstNotNullOfOrNull { name -> launchers.firstOrNull { VerificationCodes.fold(it.loadLabel(manager).toString()) == name } }
      ?: names.firstNotNullOfOrNull { name -> launchers.firstOrNull { VerificationCodes.fold(it.loadLabel(manager).toString()).contains(name) } }
      ?: throw IllegalArgumentException("Não achei o app “$wanted” neste celular. Use o nome como aparece na tela inicial.")
    val packageName = match.activityInfo.packageName
    val name = match.loadLabel(manager).toString()
    if (packageName in BLOCKED) throw IllegalStateException("O MyBots, instalar apps e dar permissões ficam sempre com a pessoa.")
    show(taskId, "Abrindo $name", null)
    val intent = manager.getLaunchIntentForPackage(packageName) ?: Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(packageName, match.activityInfo.name)
    // An enabled accessibility service may start activities from the background.
    editorAction { service.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)) }
    val until = System.currentTimeMillis() + 8000
    while (System.currentTimeMillis() < until && service.rootInActiveWindow?.packageName?.toString() != packageName) pause(taskId, 150)
    pause(taskId, 500)
    return after(service, JSONObject().put("target", JSONObject().put("app", name)))
  }

  /**
   * A verification code from a notification straight into a field: another app's (where phone) or the bot's own
   * browser on the phone (where browser). The code is never returned, logged or shown.
   */
  private fun fillCode(context: Context, service: MyBotsAccess, args: JSONObject): JSONObject {
    val taskId = args.optString("taskId")
    val code = VerificationCodes.find(args.optString("from"))
      ?: throw IllegalStateException("Nenhum código recente de “${args.optString("from")}”. Peça o código no app ou site, espere a notificação chegar e tente de novo (vale até 15 minutos). Confira o remetente como aparece na notificação.")
    val sender = code.app.ifEmpty { code.packageName } + if (code.title.isNotBlank()) " · ${code.title.take(40)}" else ""
    if (args.optString("where") == "browser") {
      val botId = args.optString("botId")
      BotBrowser.useProfile(botId, args.optString("profile") == "separate")
      val host = android.net.Uri.parse(BotBrowser.codeTarget(context, botId)).host.orEmpty()
      if (host.isEmpty()) throw IllegalStateException("Abra a página do código no navegador antes (browser_open).")
      if (!args.optBoolean("confirmed") && !VerificationCodes.mentions(code, VerificationCodes.names(host))) return JSONObject().put("needsPerson", true).put("sender", sender).put("target", host)
      check(taskId)
      BotBrowser.fillCode(context, botId, args.getInt("id"), code.code)
      VerificationCodes.used(code)
      return JSONObject().put("filled", true).put("sender", sender).put("target", JSONObject().put("label", host)).put("next", "O código está no campo. Envie o formulário com browser_click.")
    }
    requireActionable(service)
    val node = node(args.getInt("id"))
    if (!node.isEditable) throw IllegalStateException("Este elemento não é um campo de texto. Veja os campos em phone_screen.")
    val packageName = root(service)?.packageName?.toString().orEmpty()
    val app = appLabel(context, packageName)
    if (!args.optBoolean("confirmed") && !VerificationCodes.mentions(code, VerificationCodes.names(app, packageName))) return JSONObject().put("needsPerson", true).put("sender", sender).put("target", app)
    val box = Rect(); node.getBoundsInScreen(box)
    show(taskId, "Preenchendo o código", box)
    val bundle = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, code.code) }
    if (!editorAction { node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle) }) throw IllegalStateException("O app não aceitou o código neste campo.")
    VerificationCodes.used(code)
    pause(taskId, 500)
    return after(service, JSONObject().put("filled", true).put("sender", sender).put("target", JSONObject().put("label", app)))
  }

  private fun gesture(service: MyBotsAccess, taskId: String, x: Float, y: Float, to: Pair<Float, Float>?, duration: Long) {
    check(taskId)
    val path = Path().apply { moveTo(x, y); to?.let { lineTo(it.first, it.second) } }
    val done = CountDownLatch(1); val ok = AtomicReference(false)
    // The bar must not catch the bot's own touch.
    main.post { bar?.let { view -> (view.layoutParams as? WindowManager.LayoutParams)?.let { it.flags = it.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE; try { (service.getSystemService(Context.WINDOW_SERVICE) as WindowManager).updateViewLayout(view, it) } catch (_: Exception) {} } } }
    Thread.sleep(50)
    val token = editorToken.get() ?: throw IllegalStateException("Comando inválido.")
    WalletEditorGate.beginGesture(token)
    val ended = java.util.concurrent.atomic.AtomicBoolean(false)
    fun finishGesture() { if (ended.compareAndSet(false, true)) WalletEditorGate.endGesture(); done.countDown() }
    main.post {
      try {
        val started = WalletEditorGate.action(token) {
          service.dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(), object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) { ok.set(true); finishGesture() }
            override fun onCancelled(gestureDescription: GestureDescription?) { finishGesture() }
          }, main)
        }
        if (!started) finishGesture()
      } catch (_: Exception) { finishGesture() }
    }
    done.await(duration + 3000, TimeUnit.MILLISECONDS)
    main.post { bar?.let { view -> (view.layoutParams as? WindowManager.LayoutParams)?.let { it.flags = it.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv(); try { (service.getSystemService(Context.WINDOW_SERVICE) as WindowManager).updateViewLayout(view, it) } catch (_: Exception) {} } } }
    if (!ok.get()) throw IllegalStateException("O Android não completou o toque. Veja a tela de novo com phone_screen.")
  }

  /** What every action returns: the app now in front and a small picture for the timeline and the live view. */
  private fun after(service: MyBotsAccess, result: JSONObject): JSONObject {
    nodes.clear()
    val packageName = service.rootInActiveWindow?.packageName?.toString().orEmpty()
    result.put("app", if (packageName.isEmpty()) "" else appLabel(service, packageName)).put("package", packageName)
      .put("next", result.optString("next").ifEmpty { "Veja a tela com phone_screen antes da próxima ação." })
    capture(service, 480f, 60, emptyList(), secretBoxes(service))?.let { result.put("thumb", it) }
    return result
  }

  private fun secretBoxes(service: MyBotsAccess): List<Rect> {
    val boxes = mutableListOf<Rect>()
    fun visit(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || depth > 40) return
      val words = "${node.text ?: ""} ${node.contentDescription ?: ""}"
      if (node.isPassword || CardProtection.sensitive(node) || VerificationCodes.hide(words) != words) boxes.add(Rect().also { node.getBoundsInScreen(it) })
      for (index in 0 until node.childCount) visit(node.getChild(index), depth + 1)
    }
    visit(service.rootInActiveWindow, 0)
    return boxes
  }

  /** A screenshot (Android 11+), with password fields blacked out and, if asked, the element numbers drawn on it. */
  private fun capture(service: MyBotsAccess, maxWidth: Float, quality: Int, marks: List<Pair<Int, Rect>>, secret: List<Rect>): JSONObject? {
    if (Build.VERSION.SDK_INT < 30) return null
    repeat(3) {
      val done = CountDownLatch(1); val shot = AtomicReference<Bitmap?>(); val code = AtomicReference(0)
      service.takeScreenshot(Display.DEFAULT_DISPLAY, service.mainExecutor, object : AccessibilityService.TakeScreenshotCallback {
        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
          try { val buffer = screenshot.hardwareBuffer; shot.set(Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)?.copy(Bitmap.Config.ARGB_8888, true)); buffer.close() } catch (_: Exception) {}
          done.countDown()
        }
        override fun onFailure(errorCode: Int) { code.set(errorCode); done.countDown() }
      })
      done.await(4, TimeUnit.SECONDS)
      val bitmap = shot.get()
      if (bitmap != null) {
        val canvas = Canvas(bitmap)
        val black = Paint().apply { color = Color.BLACK }
        for (box in secret) canvas.drawRect(box, black)
        if (marks.isNotEmpty()) {
          val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3f; color = 0xFFE5484D.toInt() }
          val fill = Paint().apply { color = 0xFFE5484D.toInt() }
          val font = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 28f; isFakeBoldText = true }
          for ((id, box) in marks) {
            canvas.drawRect(box, stroke)
            val label = id.toString(); val width = font.measureText(label) + 10
            canvas.drawRect(box.left.toFloat(), box.top.toFloat(), box.left + width, box.top + 32f, fill)
            canvas.drawText(label, box.left + 5f, box.top + 26f, font)
          }
        }
        val scale = minOf(1f, maxWidth / bitmap.width)
        val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
        val out = ByteArrayOutputStream(); scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        return JSONObject().put("image", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)).put("width", scaled.width).put("height", scaled.height)
      }
      // Android allows a screenshot about every third of a second.
      if (code.get() == AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) Thread.sleep(400) else return null
    }
    return null
  }
}
