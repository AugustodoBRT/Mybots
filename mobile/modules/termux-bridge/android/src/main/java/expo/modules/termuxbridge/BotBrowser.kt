package expo.modules.termuxbridge

import android.annotation.SuppressLint
import android.content.Context
import android.content.MutableContextWrapper
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.net.http.SslError
import android.net.http.X509TrustManagerExtensions
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Each bot's browser: a WebView per bot, kept in the app. By default the bots share one WebView profile ("shared"),
 * so a login made by one bot serves the others; a bot with "Navegador separado" has its own profile. Kept in the app
 * process so the supervisor can drive it with the app closed (the keep-alive service keeps the process alive).
 * Commands arrive by long-polling /device/browser; the chat's "Navegador do bot" panel shows the same WebView live.
 */
internal object BotBrowser {
  private val main = Handler(Looper.getMainLooper())
  private const val MAX_TABS = 6
  private val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

  class Tab(val botId: String, val web: WebView, val wrapper: MutableContextWrapper) {
    @Volatile var loading = false
    @Volatile var progress = 100
    @Volatile var dialog: String? = null
    // Why the last page did not load (network, certificate), so the bot is told instead of reading an error page.
    @Volatile var failure: String? = null
    // A file the page handed over (a download link): stored with the supervisor as this bot's file.
    @Volatile var downloading = false
    @Volatile var download: JSONObject? = null
    // While the person has taken over: their login is offered for saving (PasswordVault), through a private prompt.
    @Volatile var capture = false
    val nonce: String = java.util.UUID.randomUUID().toString()
    var used = System.currentTimeMillis()
    val listeners = mutableSetOf<(Map<String, Any>) -> Unit>()
    var profile = "shared"
    @Volatile var icon: String? = null
    @Volatile var action: Map<String, Any>? = null
  }
  // Which profile each bot uses, from the supervisor's commands and the chat's panel.
  private val profiles = ConcurrentHashMap<String, String>()
  fun useProfile(botId: String, separate: Boolean) { profiles[botId] = if (separate) "separate" else "shared" }

  // Main thread only.
  private val tabs = LinkedHashMap<String, Tab>()
  private var sharedOwner: String? = null
  @Volatile private var thread: Thread? = null
  val polling get() = thread?.isAlive == true

  /** WebView profiles (Android System WebView 123+). Without them the one shared profile is wiped when another bot uses it. */
  val isolated: Boolean get() = try { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) } catch (_: Exception) { false }

  fun start(context: Context) {
    if (thread?.isAlive == true) return
    val app = context.applicationContext
    thread = Thread({ loop(app) }, "mybots-browser").apply { isDaemon = true; start() }
  }

  /** Same rules as the supervisor: http(s) only, never this phone (the supervisor and Termux listen on loopback). */
  fun allowed(uri: Uri): Boolean {
    if (uri.scheme !in setOf("http", "https")) return false
    val host = (uri.host ?: return false).lowercase().trim('[', ']')
    if (!uri.userInfo.isNullOrEmpty()) return false
    return !(host == "localhost" || host.endsWith(".localhost") || host.startsWith("127.") || host.startsWith("0.") || host == "::1" || host == "::" ||
      host.startsWith("169.254.") || host.startsWith("fe80:") || host.startsWith("::ffff:127."))
  }

  private fun loop(context: Context) {
    while (!Thread.currentThread().isInterrupted) {
      try {
        val saved = pairingPreferences(context)
        val token = saved.getString("token", null)
        if (token == null) { Thread.sleep(10_000); continue }
        val port = saved.getInt("port", 3219)
        val connection = URL("http://127.0.0.1:$port/device/browser").openConnection() as HttpURLConnection
        connection.connectTimeout = 3000; connection.readTimeout = 35_000
        connection.setRequestProperty("Authorization", "Bearer $token")
        val body = if (connection.responseCode == 200) connection.inputStream.bufferedReader().use { it.readText() } else null
        connection.disconnect()
        if (body == null) { Thread.sleep(5000); continue }
        val commands = JSONObject(body).optJSONArray("commands") ?: JSONArray()
        for (index in 0 until commands.length()) {
          val command = commands.getJSONObject(index)
          // One bot's commands keep their order; different bots (and PDF work) never wait for each other.
          lane(command.optString("botId").takeIf { it.isNotEmpty() && it != "null" } ?: "device").execute { respond(context, port, token, command) }
        }
      } catch (_: InterruptedException) { return }
      catch (_: Exception) { try { Thread.sleep(5000) } catch (_: InterruptedException) { return } }
    }
  }

  private val lanes = java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.ExecutorService>()
  private fun lane(key: String): java.util.concurrent.ExecutorService = lanes.getOrPut(key) { java.util.concurrent.Executors.newSingleThreadExecutor { task -> Thread(task, "mybots-browser-$key").apply { isDaemon = true } } }

  private fun respond(context: Context, port: Int, token: String, command: JSONObject) {
    val answer = JSONObject().put("id", command.optString("id"))
    try { answer.put("ok", true).put("value", run(context, command)) }
    catch (error: Exception) { answer.put("ok", false).put("error", error.message ?: "O navegador não conseguiu fazer isso.") }
    try {
      val result = URL("http://127.0.0.1:$port/device/browser/result").openConnection() as HttpURLConnection
      result.requestMethod = "POST"; result.doOutput = true; result.connectTimeout = 3000; result.readTimeout = 10_000
      result.setRequestProperty("Authorization", "Bearer $token"); result.setRequestProperty("Content-Type", "application/json")
      result.outputStream.use { it.write(answer.toString().toByteArray(Charsets.UTF_8)) }
      result.responseCode; result.disconnect()
    } catch (_: Exception) {}
  }

  private fun <T> onMain(timeoutMs: Long = 10_000, block: () -> T): T {
    val result = AtomicReference<Result<T>>()
    val done = CountDownLatch(1)
    main.post { result.set(runCatching(block)); done.countDown() }
    if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) throw IllegalStateException("O navegador não respondeu.")
    return result.get().getOrThrow()
  }

  private fun js(context: Context, botId: String, script: String, timeoutMs: Long = 10_000): JSONObject {
    val value = AtomicReference<String?>()
    val done = CountDownLatch(1)
    onMain { tab(context, botId).web.evaluateJavascript(script) { value.set(it); done.countDown() } }
    if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) throw IllegalStateException("A página não respondeu. Tente browser_wait e leia de novo.")
    val text = try { JSONTokener(value.get() ?: "null").nextValue() as? String } catch (_: Exception) { null }
      ?: throw IllegalStateException("A página ainda não carregou. Use browser_wait.")
    val json = JSONObject(text)
    val scale = onMain { val web = tab(context, botId).web; val width = web.width.coerceAtLeast(1); val height = web.height.coerceAtLeast(1); minOf(1f, 720f / width, 800f / height) * web.scale }
    json.optJSONArray("elements")?.let { elements -> for (n in 0 until elements.length()) elements.optJSONObject(n)?.optJSONObject("box")?.let { box -> for (key in listOf("x", "y", "w", "h")) box.put(key, box.optDouble(key) * scale) } }
    if (json.has("error")) throw IllegalStateException(json.getString("error"))
    return json
  }

  private fun waitLoaded(botId: String, timeoutMs: Long) {
    val until = System.currentTimeMillis() + timeoutMs
    Thread.sleep(300)
    while (System.currentTimeMillis() < until) {
      val tab = onMain { tabs[botId] } ?: return
      if (!tab.loading && tab.progress >= 100) { Thread.sleep(300); return }
      Thread.sleep(200)
    }
  }

  // A download starts a moment after the click; when one starts, wait for it (up to 90 s) and report the stored file.
  private fun awaitDownload(botId: String, before: Int): JSONObject? {
    val start = System.currentTimeMillis()
    while (DeviceFiles.downloadSerial() == before && System.currentTimeMillis() - start < 1500) Thread.sleep(100)
    if (DeviceFiles.downloadSerial() == before) return null
    val tab = onMain { tabs[botId] } ?: return null
    val until = System.currentTimeMillis() + 90_000
    while (tab.downloading && System.currentTimeMillis() < until) Thread.sleep(200)
    return tab.download ?: JSONObject().put("error", "O download ainda não terminou.")
  }

  fun cookies(botId: String, url: String): String? = try {
    if (isolated) ProfileStore.getInstance().getProfile(tabs[botId]?.profile ?: profileName(botId))?.cookieManager?.getCookie(url) else CookieManager.getInstance().getCookie(url)
  } catch (_: Exception) { null }

  private fun failed(botId: String) {
    onMain { tabs[botId]?.failure }?.let { throw IllegalStateException("A página não abriu: $it") }
  }

  // Like Chrome's HTTPS-first: plain http is tried over https; the app never sends a password without encryption.
  fun secure(url: String) = if (url.startsWith("http://", ignoreCase = true)) "https://" + url.substring(7) else url

  private fun page(context: Context, botId: String) = onMain {
    val tab = tab(context, botId)
    JSONObject().put("url", tab.web.url ?: "about:blank").put("title", tab.web.title ?: "").put("loading", tab.loading).put("isolated", isolated)
  }

  private fun run(context: Context, command: JSONObject): JSONObject {
    // File work for the supervisor, not tied to a bot's browser.
    when (command.getString("op")) {
      "pdfRead" -> return DeviceFiles.pdfRead(context, command.optJSONObject("args") ?: JSONObject())
      "pdfCreate" -> return DeviceFiles.pdfCreate(context, (command.optJSONObject("args") ?: JSONObject()).getString("html"))
    }
    val botId = command.getString("botId")
    if (!botId.matches(UUID)) throw IllegalArgumentException("Bot inválido.")
    val args = command.optJSONObject("args") ?: JSONObject()
    if (command.has("profile")) useProfile(botId, command.optString("profile") == "separate")
    if (command.getString("op") == "pcLogin") return PasswordVault.forComputer(context, botId, args)
    if (command.getString("op") in listOf("act", "inspect") && args.has("action")) {
      val scale = onMain { val web = tab(context, botId).web; val width = web.width.coerceAtLeast(1); val height = web.height.coerceAtLeast(1); minOf(1f, 720f / width, 800f / height) * web.scale }
      for (key in listOf("x", "y", "toX", "toY")) if (args.has(key)) args.put(key, args.getDouble(key) / scale)
    }
    val id = args.optInt("id", 0)
    return when (command.getString("op")) {
      "open" -> {
        val url = args.getString("url")
        if (!allowed(Uri.parse(url))) throw IllegalArgumentException("O navegador do bot não abre este endereço.")
        val before = DeviceFiles.downloadSerial()
        onMain { tab(context, botId).apply { dialog = null; failure = null }.web.loadUrl(secure(url)) }
        waitLoaded(botId, 30_000)
        val file = awaitDownload(botId, before)
        if (file == null) failed(botId)
        page(context, botId).also { result -> file?.let { result.put("download", it) } }
      }
      // The timeline's picture of this moment, small.
      "thumb" -> onMain(15_000) { screenshot(context, botId, 480f, 60) }
      "read" -> js(context, botId, READ_JS).also { result -> onMain { tabs[botId]?.dialog }?.let { result.put("dialog", it) } }
      "inspect" -> if (args.has("action")) js(context, botId, "JSON.stringify(($POINT_JS)($args))") else js(context, botId, "($INSPECT_JS)($id)")
      "tabs" -> throw IllegalStateException("Disponível só quando o bot responde pelo computador.")
      "find" -> js(context, botId, "JSON.stringify(($READ_PAGE)($args))")
      "act" -> {
        if (args.optString("action") in listOf("drag", "right_click")) throw IllegalStateException("Disponível só quando o bot responde pelo computador.")
        args.optJSONObject("expectedTarget")?.let { expected ->
          val actual = js(context, botId, "JSON.stringify(($POINT_JS)($args))")
          if (listOf("kind", "label", "url").any { actual.optString(it) != expected.optString(it) }) throw IllegalStateException("O alvo mudou. Leia a página e tente de novo.")
        }
        js(context, botId, "($ACT_JS)($args)")
        if (args.optString("action") == "hover") onMain {
          val web = tab(context, botId).web
          val time = android.os.SystemClock.uptimeMillis()
          for (action in listOf(MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE)) {
            val event = MotionEvent.obtain(time, time, action, (args.optDouble("x") * web.scale).toFloat(), (args.optDouble("y") * web.scale).toFloat(), 0)
            event.source = android.view.InputDevice.SOURCE_MOUSE
            web.dispatchGenericMotionEvent(event); event.recycle()
          }
        }
        page(context, botId)
      }
      "click" -> {
        val before = DeviceFiles.downloadSerial()
        showAction(context, botId, id, "Clicando")
        onMain { tabs[botId]?.failure = null }; js(context, botId, "($CLICK_JS)($id)"); waitLoaded(botId, 12_000)
        val file = awaitDownload(botId, before)
        if (file == null) failed(botId)
        page(context, botId).also { result -> file?.let { result.put("download", it) } }
      }
      "type" -> {
        val input = JSONObject().put("id", id).put("text", args.optString("text")).put("submit", args.optBoolean("submit"))
        showAction(context, botId, id, "Digitando")
        js(context, botId, "($TYPE_JS)($input)")
        if (args.optBoolean("submit")) waitLoaded(botId, 15_000)
        page(context, botId)
      }
      "upload" -> {
        val name = args.getString("name").replace(Regex("[/\\\\\u0000]"), "_").take(120)
        val data = args.getString("data")
        if (data.length > 14_500_000) throw IllegalArgumentException("Envie arquivos de até 10 MB.")
        val input = JSONObject().put("id", id).put("name", name).put("mime", args.optString("mime")).put("data", data)
        js(context, botId, "($UPLOAD_JS)($input)", 30_000)
        page(context, botId).put("attached", name)
      }
      // A saved login (PasswordVault): the app fills and sends it itself; the password never leaves the app.
      "login" -> {
        val before = DeviceFiles.downloadSerial()
        val value = AtomicReference<String?>(); val done = CountDownLatch(1)
        onMain {
          val tab = tab(context, botId); tab.failure = null
          val saved = PasswordVault.forPage(context, botId, tab.web.url)
            ?: throw IllegalStateException("Não há senha salva para este site e este bot. Peça para a pessoa salvar em Ajustes → Senhas (ou entrar uma vez pelo Assumir) ou use browser_ask_user.")
          val input = JSONObject().put("u", saved.optString("username")).put("p", saved.optString("password"))
          tab.web.evaluateJavascript("($LOGIN_JS)($input)") { value.set(it); done.countDown() }
        }
        if (!done.await(10_000, TimeUnit.MILLISECONDS)) throw IllegalStateException("A página não respondeu.")
        val text = try { JSONTokener(value.get() ?: "null").nextValue() as? String } catch (_: Exception) { null } ?: throw IllegalStateException("A página ainda não carregou. Use browser_wait.")
        val json = JSONObject(text)
        if (json.has("error")) throw IllegalStateException(json.getString("error"))
        waitLoaded(botId, 15_000)
        awaitDownload(botId, before)
        failed(botId)
        page(context, botId).put("filled", true).put("username", json.optBoolean("user")).put("sent", json.optBoolean("sent"))
      }
      "wait" -> {
        val until = System.currentTimeMillis() + args.optInt("timeoutSeconds", 10).coerceIn(1, 30) * 1000L
        val check = "($WAIT_JS)(${JSONObject.quote(args.optString("text"))}, ${JSONObject.quote(args.optString("selector"))}, ${JSONObject.quote(args.optString("url"))})"
        var found = false
        while (System.currentTimeMillis() < until) {
          val loaded = onMain { tabs[botId]?.let { !it.loading && it.progress >= 100 } ?: false }
          if (loaded && runCatching { js(context, botId, check, 3000).optBoolean("found") }.getOrDefault(false)) { found = true; break }
          Thread.sleep(500)
        }
        page(context, botId).put("found", found)
      }
      "screenshot" -> {
        try {
          js(context, botId, "(() => { const data = ($READ_PAGE)({}); if (${args.optBoolean("marks")}) ($MARK_JS)(data.elements); const layer = document.createElement('div'); layer.setAttribute('data-mybots-mask',''); layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647'; for (const el of document.querySelectorAll('input[type=password]')) { const r=el.getBoundingClientRect(); const box=document.createElement('div'); box.style.cssText='position:absolute;background:#000;left:'+r.x+'px;top:'+r.y+'px;width:'+r.width+'px;height:'+r.height+'px'; layer.append(box); } document.documentElement.append(layer); return JSON.stringify({ok:true}); })()")
          Thread.sleep(100)
          onMain(15_000) { screenshot(context, botId) }
        } finally { runCatching { js(context, botId, "(() => { ($MARK_JS)(null); document.querySelector('[data-mybots-mask]')?.remove(); return JSON.stringify({ok:true}); })()") } }
      }
      else -> throw IllegalArgumentException("Comando de navegador inválido.")
    }
  }

  private fun screenshot(context: Context, botId: String, maxWidth: Float = 720f, quality: Int = 70): JSONObject {
    val tab = tab(context, botId)
    val web = tab.web
    layoutDetached(context, web)
    val bitmap = Bitmap.createBitmap(web.width.coerceAtLeast(1), web.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    web.draw(Canvas(bitmap))
    val scale = minOf(1f, maxWidth / bitmap.width, 800f / bitmap.height)
    val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
    return JSONObject().put("url", web.url ?: "").put("title", web.title ?: "").put("width", scaled.width).put("height", scaled.height).put("image", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
  }

  // A browser with no panel on screen still needs a size to lay out pages and draw screenshots.
  private fun layoutDetached(context: Context, web: WebView) {
    if (web.parent != null && web.width > 0) return
    val metrics = context.resources.displayMetrics
    val width = metrics.widthPixels; val height = minOf(metrics.heightPixels, width * 2)
    web.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
    web.layout(0, 0, width, height)
  }

  private fun profileName(botId: String) = if (profiles[botId] == "separate") "bot-$botId" else "shared"

  /** Where the bot is about to act, for the person watching: the element's outline, a cursor and a caption. */
  private fun showAction(context: Context, botId: String, id: Int, verb: String) {
    if (onMain { tabs[botId]?.listeners?.isEmpty() } != false) return
    val box = runCatching { js(context, botId, "(() => { const el = document.querySelector('[data-mybots-id=\"$id\"]'); if (!el) return JSON.stringify({}); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight, label: String(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent) || el.placeholder || el.textContent || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 40) }); })()") }.getOrNull() ?: return
    if (!box.has("vw")) return
    val label = box.optString("label")
    val action = mapOf<String, Any>("caption" to (if (label.isEmpty()) verb else "$verb em ‘$label’"), "rect" to mapOf("x" to box.optDouble("x"), "y" to box.optDouble("y"), "width" to box.optDouble("width"), "height" to box.optDouble("height")),
      "width" to box.optDouble("vw"), "height" to box.optDouble("vh"), "at" to System.currentTimeMillis().toDouble())
    onMain { tabs[botId]?.let { it.action = action; emit(it) } }
    // A moment for the eye to follow before the page changes.
    Thread.sleep(350)
  }

  private fun flushCookies(botId: String) {
    try { if (isolated) ProfileStore.getInstance().getProfile(tabs[botId]?.profile ?: profileName(botId))?.cookieManager?.flush() else CookieManager.getInstance().flush() } catch (_: Exception) {}
  }

  private fun emit(tab: Tab) {
    val state = mutableMapOf<String, Any>("url" to (tab.web.url ?: ""), "title" to (tab.web.title ?: ""), "loading" to tab.loading, "isolated" to isolated, "shared" to (tab.profile == "shared"),
      "back" to tab.web.canGoBack(), "forward" to tab.web.canGoForward())
    tab.icon?.let { state["icon"] = it }; tab.action?.let { state["action"] = it }
    tab.listeners.toList().forEach { it(state) }
  }

  @SuppressLint("SetJavaScriptEnabled")
  fun tab(context: Context, botId: String): Tab {
    val profile = profileName(botId)
    // A bot that switched between the shared and its own browser gets a new WebView in the other profile.
    tabs[botId]?.let { if (it.profile == profile) { it.used = System.currentTimeMillis(); return it } else close(botId) }
    // Without WebView profiles, the bots of the shared browser use the app's one profile; a separate bot must never get their logins.
    val owner = if (profile == "shared") "shared" else botId
    if (!isolated && sharedOwner != null && sharedOwner != owner) {
      // No profiles on this phone: one bot's logins must never reach another bot.
      tabs.values.toList().forEach { close(it.botId) }
      CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush(); WebStorage.getInstance().deleteAllData()
    }
    if (tabs.size >= MAX_TABS) tabs.values.filter { it.web.parent == null }.minByOrNull { it.used }?.let { close(it.botId) }
    val wrapper = MutableContextWrapper(context.applicationContext)
    val web = WebView(wrapper)
    if (isolated) { ProfileStore.getInstance().getOrCreateProfile(profile); WebViewCompat.setProfile(web, profile) }
    else sharedOwner = owner
    val tab = Tab(botId, web, wrapper).also { it.profile = profile }
    web.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = true
      allowFileAccess = false; allowContentAccess = false
      setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setGeolocationEnabled(false)
      setSupportZoom(true); builtInZoomControls = true; displayZoomControls = false
      useWideViewPort = true; loadWithOverviewMode = true
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!allowed(request.url)) return true
        if (request.url.scheme == "http" && request.isForMainFrame) { view.loadUrl(secure(request.url.toString())); return true }
        return false
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) tab.failure = when (error.description?.toString()) {
          "net::ERR_CLEARTEXT_NOT_PERMITTED" -> "o site só funciona sem criptografia (http), e o MyBots não abre sites assim."
          else -> "${error.description} (${request.url.host})."
        }
      }
      // Many university and government sites send their certificate without the intermediate one. Like Chrome,
      // fetch it from the address the certificate itself gives and validate the full chain against Android's roots.
      // Any other problem (wrong name, expired, self-signed) stays blocked.
      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        val host = Uri.parse(error.url).host
        val leaf = if (android.os.Build.VERSION.SDK_INT >= 29) error.certificate.x509Certificate else null
        val onlyUnknownIssuer = error.primaryError == SslError.SSL_UNTRUSTED &&
          listOf(SslError.SSL_IDMISMATCH, SslError.SSL_EXPIRED, SslError.SSL_NOTYETVALID).none { error.hasError(it) }
        val refuse = { tab.failure = "o certificado de segurança do site não é confiável."; handler.cancel() }
        if (host == null || leaf == null || !onlyUnknownIssuer) { refuse(); return }
        Thread { val trusted = IncompleteChain.trusted(leaf, host); main.post { if (trusted) handler.proceed() else refuse() } }.start()
      }
      override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { tab.loading = true; tab.icon = null; emit(tab) }
      override fun onPageFinished(view: WebView, url: String?) { tab.loading = false; flushCookies(botId); emit(tab); if (tab.capture) view.evaluateJavascript(captureScript(tab), null) }
    }
    // Downloads go to the bot's files; uploads only through browser_upload (approved file, no picker); no camera, microphone or location.
    web.setDownloadListener { url, userAgent, disposition, mime, _ -> DeviceFiles.download(context.applicationContext, tab, url, userAgent, disposition, mime) }
    web.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) { tab.progress = newProgress }
      override fun onReceivedTitle(view: WebView, title: String?) { emit(tab) }
      override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
        if (icon == null) return
        val out = ByteArrayOutputStream(); Bitmap.createScaledBitmap(icon, 32, 32, true).compress(Bitmap.CompressFormat.PNG, 100, out)
        tab.icon = "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP); emit(tab)
      }
      override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean { tab.dialog = "Aviso da página: ${message.orEmpty().take(300)}"; result.confirm(); return true }
      override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean { tab.dialog = "A página pediu confirmação e o MyBots respondeu Cancelar: ${message.orEmpty().take(300)}"; result.cancel(); return true }
      override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean {
        val prefix = "mybots-login:${tab.nonce}:"
        if (tab.capture && message?.startsWith(prefix) == true) try {
          val login = JSONObject(message.removePrefix(prefix))
          PasswordVault.offered(botId, view.url, login.optString("u"), login.optString("p"))
        } catch (_: Exception) {}
        result.cancel(); return true
      }
      override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
      override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) { callback.invoke(origin, false, false) }
    }
    layoutDetached(context, web)
    tabs[botId] = tab
    return tab
  }

  private fun close(botId: String) {
    val tab = tabs.remove(botId) ?: return
    (tab.web.parent as? ViewGroup)?.removeView(tab.web)
    tab.web.destroy()
  }

  // Panel controls (main thread).
  fun attach(context: Context, botId: String, host: ViewGroup, listener: (Map<String, Any>) -> Unit) {
    val tab = tab(context.applicationContext, botId)
    (tab.web.parent as? ViewGroup)?.takeIf { it !== host }?.removeView(tab.web)
    // Keyboard and <select> popups need the Activity; detached, the WebView goes back to the app context.
    tab.wrapper.baseContext = context
    if (tab.web.parent == null) host.addView(tab.web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    tab.listeners.add(listener)
    emit(tab)
  }

  fun detach(context: Context, botId: String, host: ViewGroup, listener: (Map<String, Any>) -> Unit) {
    val tab = tabs[botId] ?: return
    tab.listeners.remove(listener)
    if (tab.web.parent === host) {
      host.removeView(tab.web)
      tab.wrapper.baseContext = context.applicationContext
      layoutDetached(context, tab.web)
    }
  }

  /** "Assumir" on/off: while the person drives, a login they send is offered for saving. */
  fun setCapture(botId: String, on: Boolean) {
    val tab = tabs[botId] ?: return
    tab.capture = on
    if (on) tab.web.evaluateJavascript(captureScript(tab), null)
  }
  private fun captureScript(tab: Tab) = "($CAPTURE_JS)(${JSONObject.quote("mybots-login:${tab.nonce}:")})"

  fun action(context: Context, botId: String, action: String): Boolean {
    if (!botId.matches(UUID)) throw IllegalArgumentException("Bot inválido.")
    val web = tab(context, botId).web
    when (action) {
      "back" -> if (web.canGoBack()) web.goBack() else return false
      "forward" -> if (web.canGoForward()) web.goForward() else return false
      "reload" -> web.reload()
      "keyboard" -> { web.requestFocus(); (context.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT) }
      "zoom" -> web.zoomIn()
      "zoomOut" -> web.zoomOut()
      else -> throw IllegalArgumentException("Ação inválida.")
    }
    return true
  }

  // The scripts below run inside the page. Elements get a stable data-mybots-id until the page changes.
  private val READ_PAGE = """function readPage({ query = '', limit = 5 } = {}) {
  const elements = [], texts = [];
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = normalize(query).split(/\s+/).filter(word => !['botao','campo','link','de','o','a'].includes(word));
  window.__mybotsNext ||= 1;
  let frame = 0;
  const visit = (doc, ox = 0, oy = 0, parentFrame = '') => {
    const win = doc.defaultView;
    for (const el of doc.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[onclick],[contenteditable=true],summary')) {
      if (elements.length >= 300) break;
      const r = el.getBoundingClientRect(), style = win.getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      if (!visible && el.type !== 'file') continue;
      if (!el.dataset.mybotsId) el.dataset.mybotsId = String(window.__mybotsNext++);
      const kind = el.type === 'password' ? 'password' : el.type === 'file' ? 'file' : el.type === 'submit' || el.type === 'image' || el.tagName === 'BUTTON' && el.type !== 'button' && el.form ? 'submit' : el.tagName.toLowerCase();
      const label = clean(el.getAttribute('aria-label') || (el.labels?.[0]?.innerText) || el.getAttribute('placeholder') || el.textContent || el.title || el.name || el.getAttribute('href'));
      const item = { id: Number(el.dataset.mybotsId), kind, label };
      if (visible && r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth) item.box = { x: r.x + ox, y: r.y + oy, w: r.width, h: r.height };
      if (parentFrame) item.frame = parentFrame;
      if (el.tagName === 'SELECT') item.options = [...el.options].map(o => clean(o.text)).slice(0, 50);
      if (query) {
        const haystack = normalize([label, el.textContent, el.placeholder, el.getAttribute('aria-label'), el.title, el.name].join(' '));
        item.score = words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
      }
      elements.push(item);
    }
    const copy = doc.body?.cloneNode(true);
    copy?.querySelectorAll('input,textarea,script,style,noscript,[data-mybots-marks]').forEach(el => el.remove());
    texts.push((copy?.textContent || '').replace(/\s+/g, ' '));
    for (const el of doc.querySelectorAll('iframe')) {
      try {
        if (!el.contentDocument?.body || el.contentWindow.location.origin !== location.origin) continue;
        const r = el.getBoundingClientRect(); visit(el.contentDocument, ox + r.x, oy + r.y, `frame:${'$'}{++frame}`);
      } catch {}
    }
  };
  visit(document);
  return { text: texts.join('\n').slice(0, 20000), elements: query ? elements.filter(el => el.score > 0).sort((a, b) => b.score - a.score).slice(0, limit) : elements, scroll: { y: scrollY, height: document.documentElement.scrollHeight } };
}""".trimIndent()
  private val READ_JS = "JSON.stringify(($READ_PAGE)({}))"
  private val POINT_JS = """function inspectPoint(args) {
  let doc = document, el = args.action === 'key' ? doc.activeElement : doc.elementFromPoint(args.x, args.y), dx = 0, dy = 0;
  while (el?.tagName === 'IFRAME') {
    try { const r = el.getBoundingClientRect(); doc = el.contentDocument; if (!doc) break; dx += r.x; dy += r.y; el = args.action === 'key' ? doc.activeElement : doc.elementFromPoint(args.x - dx, args.y - dy); } catch { break; }
  }
  el = el?.closest('button,a,input,textarea,select,[role=button],[contenteditable=true]') || el;
  const box = el?.getBoundingClientRect?.(), rect = box && box.width > 0 ? { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height } : null;
  const label = String(el?.getAttribute('aria-label') || el?.textContent || el?.name || '').replace(/\s+/g, ' ').slice(0, 200);
  const write = !!el && (el.type === 'submit' || el.type === 'image' || !!el.form || el.tagName === 'A' && /comprar|pagar|pagamento|checkout|buy|purchase|pay/i.test(label + ' ' + el.getAttribute('href')));
  return { kind: el?.type === 'password' ? 'password' : write ? 'submit' : 'field', label, url: location.href, rect };
}""".trimIndent()
  private val MARK_JS = """function markPage(elements) {
  document.querySelector('[data-mybots-marks]')?.remove();
  if (!elements) return;
  const layer = document.createElement('div'); layer.setAttribute('data-mybots-marks', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  for (const { id, box } of elements) {
    if (!box) continue;
    const node = document.createElement('div'); node.textContent = String(id);
    node.style.cssText = `position:absolute;left:${'$'}{box.x}px;top:${'$'}{box.y}px;width:${'$'}{box.w}px;height:${'$'}{box.h}px;border:2px solid #e22;color:#fff;background:#a0000022;font:bold 14px sans-serif;box-sizing:border-box`;
    layer.append(node);
  }
  document.documentElement.append(layer);
}""".trimIndent()

  private val ACT_JS = """
    args => {
      const el = args.action === 'key' ? document.activeElement : document.elementFromPoint(args.x, args.y);
      if (args.action === 'scroll') window.scrollBy(args.dx, args.dy);
      else if (args.action === 'key') {
        const key = args.key === 'Space' ? ' ' : args.key;
        if (key === 'Tab' || key === 'Shift+Tab') {
          const all = [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')].filter(e => !e.disabled && e.tabIndex >= 0 && e.getBoundingClientRect().width > 0);
          const i = all.indexOf(el), step = key === 'Tab' ? 1 : -1; all[(i + step + all.length) % all.length]?.focus();
        } else {
          const allowed = el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
          if (allowed && key === 'Enter' && el?.form) el.form.requestSubmit();
          if (['PageDown','PageUp','ArrowDown','ArrowUp','Home','End'].includes(key)) window.scrollBy(0, key === 'Home' ? -document.documentElement.scrollHeight : key === 'End' ? document.documentElement.scrollHeight : (key.endsWith('Up') ? -1 : 1) * (key.startsWith('Page') ? innerHeight : 40));
          el?.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
        }
      } else if (el) {
        const link = el.closest('a[target]');
        if (args.action !== 'hover' && link && !['_self','_top','_parent',''].includes(link.target.toLowerCase())) return JSON.stringify({ error: 'Abas: disponível só quando o bot responde pelo computador.' });
        el.focus();
        for (const type of (args.action === 'hover' ? ['mouseover','mouseenter','mousemove'] : args.action === 'double_click' ? ['mousedown','mouseup','click','mousedown','mouseup','click','dblclick'] : ['mousedown','mouseup','click'])) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: args.x, clientY: args.y, view: window }));
      }
      return JSON.stringify({ok:true});
    }
  """.trimIndent()

  private val FIND = "let el = document.querySelector('[data-mybots-id=\"' + id + '\"]'); if (!el) { const visit = doc => { for (const f of doc.querySelectorAll('iframe')) { try { const d = f.contentDocument; if (!d) continue; const found = d.querySelector('[data-mybots-id=\"' + id + '\"]') || visit(d); if (found) return found; } catch {} } }; el = visit(document); } if (!el) return JSON.stringify({ error: 'Elemento não encontrado. A página mudou: use browser_read de novo.' });"

  private val INSPECT_JS = """
    (id) => { $FIND
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      const kind = tag === 'input' && type === 'password' ? 'password' : tag === 'input' && type === 'file' ? 'file' : (tag === 'input' && (type === 'submit' || type === 'image')) || (tag === 'button' && el.type === 'submit' && el.form) ? 'submit' : tag === 'a' ? 'link' : 'other';
      const near = kind === 'file' ? ((el.labels && el.labels[0] && el.labels[0].innerText) || (el.closest('label, td, div, fieldset') || {}).innerText || el.name) : '';
      const label = String(near || (tag === 'input' ? (type === 'password' ? el.placeholder : el.value || el.placeholder) : el.innerText) || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return JSON.stringify({ kind, label, url: location.href }); }
  """.trimIndent()

  private val CLICK_JS = """
    (id) => { $FIND
      if (el.closest('a[target]') && !['_self','_top','_parent',''].includes(el.closest('a[target]').target.toLowerCase())) return JSON.stringify({ error: 'Abas: disponível só quando o bot responde pelo computador.' });
      el.scrollIntoView({ block: 'center' }); el.click();
      return JSON.stringify({ ok: true }); }
  """.trimIndent()

  // Puts the bot's file in a file field, as if the person had picked it (no system file picker, no other files reachable).
  private val UPLOAD_JS = """
    ({ id, name, mime, data }) => { $FIND
      if (el.tagName !== 'INPUT' || (el.getAttribute('type') || '').toLowerCase() !== 'file') return JSON.stringify({ error: 'Este elemento não é um campo de arquivo.' });
      const raw = atob(data); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], name, { type: mime || 'application/octet-stream', lastModified: Date.now() }));
      el.files = transfer.files;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ ok: true, files: [...el.files].map(f => f.name) }); }
  """.trimIndent()

  // Fills the saved login into the visible password field and the user field before it, then sends the form.
  private val LOGIN_JS = """
    ({ u, p }) => {
      const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const pw = [...document.querySelectorAll('input[type=password]')].find(visible);
      if (!pw) return JSON.stringify({ error: 'Não achei o campo de senha nesta página. Abra a página de login (browser_read) e tente de novo.' });
      const scope = pw.form || document;
      const texts = [...scope.querySelectorAll('input')].filter(el => visible(el) && ['text', 'email', 'tel', 'number', ''].includes((el.getAttribute('type') || '').toLowerCase()));
      const user = texts.filter(el => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || texts[0];
      const set = (el, v) => { el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      if (u && user) set(user, u);
      set(pw, p);
      const button = pw.form && [...pw.form.querySelectorAll('button, input[type=submit], input[type=image]')].find(el => visible(el) && (el.tagName !== 'BUTTON' || el.type === 'submit'));
      let sent = false;
      if (button) { button.click(); sent = true; }
      else if (pw.form) { if (pw.form.requestSubmit) pw.form.requestSubmit(); else pw.form.submit(); sent = true; }
      else for (const t of ['keydown', 'keypress', 'keyup']) pw.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      return JSON.stringify({ ok: true, user: Boolean(u && user), sent }); }
  """.trimIndent()

  // While the person has taken over: when they send a form with a password, hand it to the app (only the app knows the prefix).
  private val CAPTURE_JS = """
    (prefix) => { if (window.__mybotsCapture === prefix) return; window.__mybotsCapture = prefix;
      const send = form => {
        const scope = form || document; const pw = scope.querySelector('input[type=password]');
        if (!pw || !pw.value) return;
        const texts = [...scope.querySelectorAll('input')].filter(el => ['text', 'email', 'tel', 'number', ''].includes((el.getAttribute('type') || '').toLowerCase()));
        const user = texts.filter(el => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
        try { prompt(prefix + JSON.stringify({ u: user ? user.value : '', p: pw.value })); } catch (e) {}
      };
      document.addEventListener('submit', e => send(e.target), true);
      document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button, input[type=submit], input[type=image], a'); const pw = document.querySelector('input[type=password]'); if (b && pw && pw.value) send(b.form || pw.form); }, true);
      document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.type === 'password') send(e.target.form); }, true); }
  """.trimIndent()

  private val TYPE_JS = """
    ({ id, text, submit }) => { $FIND
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && type === 'password') return JSON.stringify({ error: 'Campos de senha só a pessoa preenche.' });
      el.scrollIntoView({ block: 'center' }); el.focus();
      if (tag === 'select') {
        const option = [...el.options].find(o => o.text.trim().toLowerCase() === text.trim().toLowerCase() || o.value === text);
        if (!option) return JSON.stringify({ error: 'Opção não encontrada nesta lista. Veja as opções em browser_read.' });
        el.value = option.value;
      } else if (el.isContentEditable) el.textContent = text;
      else if (tag === 'input' && (type === 'checkbox' || type === 'radio')) { const want = !/^(false|não|nao|0|off)$/i.test(text.trim()); if (el.checked !== want) el.click(); }
      else if (tag === 'input' || tag === 'textarea') Object.getOwnPropertyDescriptor(tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, text);
      else return JSON.stringify({ error: 'Este elemento não é um campo. Use browser_click.' });
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      if (submit) {
        if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
        else for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      return JSON.stringify({ ok: true }); }
  """.trimIndent()

  private val WAIT_JS = """
    (text, selector, url) => {
      let found = document.readyState === 'complete';
      if (found && url) found = location.href.includes(url);
      if (found && text) found = !!document.body && document.body.innerText.includes(text);
      if (found && selector) { try { found = !!document.querySelector(selector); } catch (e) { return JSON.stringify({ error: 'Seletor CSS inválido.' }); } }
      return JSON.stringify({ found }); }
  """.trimIndent()
}

/** The chat's "Navegador do bot" panel: shows the bot's live WebView; touches reach it only after "Assumir". */
class BotBrowserView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onPage by EventDispatcher()
  private var bot: String? = null
  private var pageWidth = 0
  private var pageHeight = 0
  var interactive = false
    set(value) { field = value; bot?.let { BotBrowser.setCapture(it, value) } }
  // Set before botId by the panel: whether this bot uses its own profile ("Navegador separado").
  var separate = false
    set(value) { field = value; bot?.let { BotBrowser.useProfile(it, value) } }
  private val listener: (Map<String, Any>) -> Unit = { onPage(it) }

  fun show(botId: String?) {
    if (botId == bot) return
    bot?.let { BotBrowser.setCapture(it, false); BotBrowser.detach(context, it, this, listener) }
    bot = botId?.takeIf { it.isNotEmpty() }
    bot?.let { BotBrowser.useProfile(it, separate) }
    if (isAttachedToWindow) bot?.let { BotBrowser.attach(context, it, this, listener); BotBrowser.setCapture(it, interactive) }
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); bot?.let { BotBrowser.attach(context, it, this, listener) } }
  override fun onDetachedFromWindow() { bot?.let { BotBrowser.setCapture(it, false); BotBrowser.detach(context, it, this, listener) }; super.onDetachedFromWindow() }
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    if (interactive) {
      val width = View.MeasureSpec.getSize(widthMeasureSpec)
      val height = View.MeasureSpec.getSize(heightMeasureSpec)
      if (width != pageWidth || pageHeight == 0) { pageWidth = width; pageHeight = height }
      else pageHeight = maxOf(pageHeight, height)
      getChildAt(0)?.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(pageHeight, View.MeasureSpec.EXACTLY))
    } else { pageWidth = 0; pageHeight = 0 }
  }
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (interactive && pageHeight > 0) getChildAt(0)?.layout(0, 0, right - left, pageHeight)
  }
  override fun onInterceptTouchEvent(event: MotionEvent) = !interactive || super.onInterceptTouchEvent(event)
  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent) = !interactive || super.onTouchEvent(event)
}

/** Completes a certificate chain from the issuer address in the certificate (AIA), then checks it with Android's trust store. */
internal object IncompleteChain {
  private val decided = ConcurrentHashMap<String, Boolean>()
  private val ISSUERS = byteArrayOf(0x06, 0x08, 0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x02) // id-ad-caIssuers

  fun trusted(leaf: X509Certificate, host: String): Boolean {
    val key = MessageDigest.getInstance("SHA-256").digest(leaf.encoded).joinToString("") { "%02x".format(it) } + "|" + host.lowercase()
    decided[key]?.let { return it }
    var result = false
    if (names(leaf, host)) {
      val chain = mutableListOf(leaf)
      for (hop in 0 until 3) {
        val next = issuerUrl(chain.last())?.let { download(it) } ?: break
        chain.add(next)
        if (check(chain, host)) { result = true; break }
      }
    }
    decided[key] = result
    return result
  }

  private fun check(chain: List<X509Certificate>, host: String) = try {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(null as KeyStore?) }
    val manager = factory.trustManagers.filterIsInstance<X509TrustManager>().first()
    val auth = if (chain[0].publicKey.algorithm == "EC") "ECDHE_ECDSA" else "ECDHE_RSA"
    X509TrustManagerExtensions(manager).checkServerTrusted(chain.toTypedArray(), auth, host)
    true
  } catch (_: Exception) { false }

  // The certificate must name this host (DNS names, one leading wildcard label at most).
  private fun names(leaf: X509Certificate, host: String): Boolean {
    val target = host.lowercase().trimEnd('.')
    return (leaf.subjectAlternativeNames ?: return false).filter { it[0] == 2 }.map { (it[1] as String).lowercase().trimEnd('.') }.any { name ->
      name == target || (name.startsWith("*.") && target.substringAfter('.', "") == name.substring(2) && target.indexOf('.') > 0)
    }
  }

  private fun issuerUrl(cert: X509Certificate): String? {
    val bytes = cert.getExtensionValue("1.3.6.1.5.5.7.1.1") ?: return null
    for (start in 0..bytes.size - ISSUERS.size - 2) {
      if (!ISSUERS.indices.all { bytes[start + it] == ISSUERS[it] }) continue
      var at = start + ISSUERS.size
      if (bytes[at] != 0x86.toByte()) continue
      var length = bytes[at + 1].toInt() and 0xFF; at += 2
      if (length == 0x81) { length = bytes[at].toInt() and 0xFF; at += 1 }
      if (at + length > bytes.size) return null
      val url = String(bytes, at, length, Charsets.US_ASCII)
      if (url.startsWith("http://") || url.startsWith("https://")) return url
    }
    return null
  }

  private fun download(url: String): X509Certificate? {
    // Issuer certificates are published over plain http; the app's network policy forbids that for its own traffic,
    // so a plain address is tried over https first and otherwise fetched with a minimal GET. Its content is validated
    // above, so the transport adds no trust.
    val secure = BotBrowser.secure(url)
    val data = fetch(secure) ?: if (url.startsWith("http://")) plainGet(URL(url)) else null
    return try { data?.let { CertificateFactory.getInstance("X.509").generateCertificates(it.inputStream()).filterIsInstance<X509Certificate>().firstOrNull() } }
      catch (_: Exception) { null }
  }

  private fun limited(input: java.io.InputStream): ByteArray? {
    val out = ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (out.size() <= 65_536) { val read = input.read(buffer); if (read < 0) break; out.write(buffer, 0, read) }
    return out.toByteArray().takeIf { it.size <= 65_536 }
  }

  private fun fetch(url: String): ByteArray? = try {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 5000; connection.readTimeout = 5000
    val data = if (connection.responseCode == 200) connection.inputStream.use { limited(it) } else null
    connection.disconnect(); data
  } catch (_: Exception) { null }

  private fun plainGet(url: URL): ByteArray? = try {
    java.net.Socket().use { socket ->
      socket.connect(java.net.InetSocketAddress(url.host, if (url.port > 0) url.port else 80), 5000); socket.soTimeout = 5000
      socket.getOutputStream().write("GET ${url.file.ifEmpty { "/" }} HTTP/1.0\r\nHost: ${url.host}\r\nUser-Agent: MyBots\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
      val response = limited(socket.getInputStream()) ?: return null
      val split = (0..response.size - 4).firstOrNull { response[it] == 13.toByte() && response[it + 1] == 10.toByte() && response[it + 2] == 13.toByte() && response[it + 3] == 10.toByte() } ?: return null
      if (!String(response, 0, split, Charsets.US_ASCII).startsWith("HTTP/1.") || String(response, 9, 3, Charsets.US_ASCII) != "200") null
      else response.copyOfRange(split + 4, response.size)
    }
  } catch (_: Exception) { null }
}
