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
 * Each bot's own browser: a WebView per bot with its own profile (cookies, storage, logins), kept in the app
 * process so the supervisor can drive it with the app closed (the keep-alive service keeps the process alive).
 * Commands arrive by long-polling /device/browser; the chat's "Navegador do bot" panel shows the same WebView live.
 */
internal object BotBrowser {
  private val main = Handler(Looper.getMainLooper())
  private const val MAX_TABS = 4
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
    var used = System.currentTimeMillis()
    val listeners = mutableSetOf<(Map<String, Any>) -> Unit>()
  }

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
          val answer = JSONObject().put("id", command.optString("id"))
          try { answer.put("ok", true).put("value", run(context, command)) }
          catch (error: Exception) { answer.put("ok", false).put("error", error.message ?: "O navegador não conseguiu fazer isso.") }
          val result = URL("http://127.0.0.1:$port/device/browser/result").openConnection() as HttpURLConnection
          result.requestMethod = "POST"; result.doOutput = true; result.connectTimeout = 3000; result.readTimeout = 10_000
          result.setRequestProperty("Authorization", "Bearer $token"); result.setRequestProperty("Content-Type", "application/json")
          result.outputStream.use { it.write(answer.toString().toByteArray(Charsets.UTF_8)) }
          result.responseCode; result.disconnect()
        }
      } catch (_: InterruptedException) { return }
      catch (_: Exception) { try { Thread.sleep(5000) } catch (_: InterruptedException) { return } }
    }
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
    if (isolated) ProfileStore.getInstance().getProfile(profileName(botId))?.cookieManager?.getCookie(url) else CookieManager.getInstance().getCookie(url)
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
      "read" -> js(context, botId, READ_JS).also { result -> onMain { tabs[botId]?.dialog }?.let { result.put("dialog", it) } }
      "inspect" -> js(context, botId, "($INSPECT_JS)($id)")
      "click" -> {
        val before = DeviceFiles.downloadSerial()
        onMain { tabs[botId]?.failure = null }; js(context, botId, "($CLICK_JS)($id)"); waitLoaded(botId, 12_000)
        val file = awaitDownload(botId, before)
        if (file == null) failed(botId)
        page(context, botId).also { result -> file?.let { result.put("download", it) } }
      }
      "type" -> {
        val input = JSONObject().put("id", id).put("text", args.optString("text")).put("submit", args.optBoolean("submit"))
        js(context, botId, "($TYPE_JS)($input)")
        if (args.optBoolean("submit")) waitLoaded(botId, 15_000)
        page(context, botId)
      }
      "wait" -> {
        val until = System.currentTimeMillis() + args.optInt("timeoutSeconds", 10).coerceIn(1, 30) * 1000L
        val check = "($WAIT_JS)(${JSONObject.quote(args.optString("text"))}, ${JSONObject.quote(args.optString("selector"))})"
        var found = false
        while (System.currentTimeMillis() < until) {
          val loaded = onMain { tabs[botId]?.let { !it.loading && it.progress >= 100 } ?: false }
          if (loaded && runCatching { js(context, botId, check, 3000).optBoolean("found") }.getOrDefault(false)) { found = true; break }
          Thread.sleep(500)
        }
        page(context, botId).put("found", found)
      }
      "screenshot" -> onMain(15_000) { screenshot(context, botId) }
      else -> throw IllegalArgumentException("Comando de navegador inválido.")
    }
  }

  private fun screenshot(context: Context, botId: String): JSONObject {
    val tab = tab(context, botId)
    val web = tab.web
    layoutDetached(context, web)
    val bitmap = Bitmap.createBitmap(web.width.coerceAtLeast(1), web.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    web.draw(Canvas(bitmap))
    val scale = minOf(1f, 720f / bitmap.width)
    val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 70, out)
    return JSONObject().put("url", web.url ?: "").put("title", web.title ?: "").put("image", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
  }

  // A browser with no panel on screen still needs a size to lay out pages and draw screenshots.
  private fun layoutDetached(context: Context, web: WebView) {
    if (web.parent != null && web.width > 0) return
    val metrics = context.resources.displayMetrics
    val width = metrics.widthPixels; val height = minOf(metrics.heightPixels, width * 2)
    web.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
    web.layout(0, 0, width, height)
  }

  private fun profileName(botId: String) = "bot-$botId"

  private fun flushCookies(botId: String) {
    try { if (isolated) ProfileStore.getInstance().getProfile(profileName(botId))?.cookieManager?.flush() else CookieManager.getInstance().flush() } catch (_: Exception) {}
  }

  private fun emit(tab: Tab) {
    val state = mapOf<String, Any>("url" to (tab.web.url ?: ""), "title" to (tab.web.title ?: ""), "loading" to tab.loading, "isolated" to isolated)
    tab.listeners.toList().forEach { it(state) }
  }

  @SuppressLint("SetJavaScriptEnabled")
  fun tab(context: Context, botId: String): Tab {
    tabs[botId]?.let { it.used = System.currentTimeMillis(); return it }
    if (!isolated && sharedOwner != null && sharedOwner != botId) {
      // No profiles on this phone: one bot's logins must never reach another bot.
      tabs.values.toList().forEach { close(it.botId) }
      CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush(); WebStorage.getInstance().deleteAllData()
    }
    if (tabs.size >= MAX_TABS) tabs.values.filter { it.web.parent == null }.minByOrNull { it.used }?.let { close(it.botId) }
    val wrapper = MutableContextWrapper(context.applicationContext)
    val web = WebView(wrapper)
    if (isolated) { ProfileStore.getInstance().getOrCreateProfile(profileName(botId)); WebViewCompat.setProfile(web, profileName(botId)) }
    else sharedOwner = botId
    val tab = Tab(botId, web, wrapper)
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
      override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { tab.loading = true; emit(tab) }
      override fun onPageFinished(view: WebView, url: String?) { tab.loading = false; flushCookies(botId); emit(tab) }
    }
    // No downloads, uploads, camera, microphone or location: none of it is needed to read and fill pages.
    web.setDownloadListener { url, userAgent, disposition, mime, _ -> DeviceFiles.download(context.applicationContext, tab, url, userAgent, disposition, mime) }
    web.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) { tab.progress = newProgress }
      override fun onReceivedTitle(view: WebView, title: String?) { emit(tab) }
      override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean { tab.dialog = "Aviso da página: ${message.orEmpty().take(300)}"; result.confirm(); return true }
      override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean { tab.dialog = "A página pediu confirmação e o MyBots respondeu Cancelar: ${message.orEmpty().take(300)}"; result.cancel(); return true }
      override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean { result.cancel(); return true }
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

  fun action(context: Context, botId: String, action: String): Boolean {
    if (!botId.matches(UUID)) throw IllegalArgumentException("Bot inválido.")
    val web = tab(context, botId).web
    when (action) {
      "back" -> if (web.canGoBack()) web.goBack() else return false
      "reload" -> web.reload()
      else -> throw IllegalArgumentException("Ação inválida.")
    }
    return true
  }

  // The scripts below run inside the page. Elements get a stable data-mybots-id until the page changes.
  private val READ_JS = """
    (() => {
      const clean = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const kindOf = el => {
        const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && type === 'password') return 'password';
        if ((tag === 'input' && (type === 'submit' || type === 'image')) || (tag === 'button' && el.type === 'submit' && el.form)) return 'submit';
        if (tag === 'a') return 'link';
        if (tag === 'select') return 'select';
        if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return 'check';
        if (tag === 'textarea' || tag === 'input' || el.isContentEditable) return 'field';
        return 'button';
      };
      const labelOf = el => {
        const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
        if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
        if (tag === 'input' && (type === 'submit' || type === 'button')) return clean(el.value);
        return clean(el.getAttribute('aria-label') || (tag === 'input' || tag === 'textarea' ? el.placeholder : el.innerText) || el.placeholder || el.title || el.alt || el.name || el.getAttribute('href'));
      };
      window.__mybotsNext = window.__mybotsNext || 1;
      const elements = [];
      for (const el of document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[onclick],[contenteditable=true],summary')) {
        if (elements.length >= 200) break;
        if (el.disabled || (el.getAttribute('type') || '').toLowerCase() === 'hidden' || !visible(el)) continue;
        if (!el.dataset.mybotsId) el.dataset.mybotsId = String(window.__mybotsNext++);
        const kind = kindOf(el);
        const item = { id: Number(el.dataset.mybotsId), kind, label: labelOf(el) };
        if (kind === 'link') item.href = String(el.href).slice(0, 300);
        if (kind === 'field') item.value = String(el.isContentEditable ? el.innerText : el.value || '').slice(0, 200);
        if (kind === 'check') item.checked = el.checked;
        if (kind === 'select') { item.value = el.selectedOptions[0] ? clean(el.selectedOptions[0].text) : ''; item.options = [...el.options].slice(0, 30).map(o => clean(o.text)); }
        elements.push(item);
      }
      const text = document.body ? document.body.innerText.replace(/\n{3,}/g, '\n\n') : '';
      return JSON.stringify({ url: location.href, title: document.title, text: text.slice(0, 15000), truncated: text.length > 15000, elements });
    })()
  """.trimIndent()

  private val FIND = "const el = document.querySelector('[data-mybots-id=\"' + id + '\"]'); if (!el) return JSON.stringify({ error: 'Elemento não encontrado. A página mudou: use browser_read de novo.' });"

  private val INSPECT_JS = """
    (id) => { $FIND
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      const kind = tag === 'input' && type === 'password' ? 'password' : (tag === 'input' && (type === 'submit' || type === 'image')) || (tag === 'button' && el.type === 'submit' && el.form) ? 'submit' : tag === 'a' ? 'link' : 'other';
      const label = String((tag === 'input' ? el.value || el.placeholder : el.innerText) || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return JSON.stringify({ kind, label, url: location.href }); }
  """.trimIndent()

  private val CLICK_JS = """
    (id) => { $FIND
      el.scrollIntoView({ block: 'center' }); if (el.tagName === 'A') el.removeAttribute('target'); el.click();
      return JSON.stringify({ ok: true }); }
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
    (text, selector) => {
      let found = document.readyState === 'complete';
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
  var interactive = false
  private val listener: (Map<String, Any>) -> Unit = { onPage(it) }

  fun show(botId: String?) {
    if (botId == bot) return
    bot?.let { BotBrowser.detach(context, it, this, listener) }
    bot = botId?.takeIf { it.isNotEmpty() }
    if (isAttachedToWindow) bot?.let { BotBrowser.attach(context, it, this, listener) }
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); bot?.let { BotBrowser.attach(context, it, this, listener) } }
  override fun onDetachedFromWindow() { bot?.let { BotBrowser.detach(context, it, this, listener) }; super.onDetachedFromWindow() }
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
