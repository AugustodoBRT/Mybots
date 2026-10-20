package expo.modules.termuxbridge

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.MyBotsPdfWriter
import android.provider.MediaStore
import android.util.Base64
import android.webkit.URLUtil
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Files for the bots (etapa D): reading PDFs with Android's renderer, writing PDFs from HTML with the print system,
 * downloads from a bot's browser (with that browser's login), and opening, sharing or saving what a bot sends.
 */
internal object DeviceFiles {
  private val main = Handler(Looper.getMainLooper())
  const val MAX_DOWNLOAD = 20 * 1024 * 1024
  private val BLOCKED = setOf("apk", "apks", "xapk", "aab", "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "sh", "jar", "dex", "so", "bin", "elf", "run")

  // ---- Reading PDFs: text (Android 15+) and pictures of pages that have no text (scans).
  fun pdfRead(context: Context, args: JSONObject): JSONObject {
    val bytes = Base64.decode(args.getString("data"), Base64.NO_WRAP)
    val first = args.optInt("firstPage", 1).coerceAtLeast(1)
    val count = args.optInt("maxPages", 20).coerceIn(1, 30)
    val mode = args.optString("images", "auto")
    val file = File.createTempFile("mybots-read", ".pdf", context.cacheDir)
    try {
      file.writeBytes(bytes)
      val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
      val renderer = try { PdfRenderer(descriptor) } catch (error: SecurityException) { descriptor.close(); throw IllegalStateException("O PDF tem senha; peça uma versão sem senha.") }
      catch (error: Exception) { descriptor.close(); throw IllegalStateException("O arquivo não é um PDF válido.") }
      renderer.use {
        val texts = JSONArray(); val images = JSONArray()
        for (index in (first - 1) until minOf(renderer.pageCount, first - 1 + count)) {
          renderer.openPage(index).use { page ->
            val text = if (Build.VERSION.SDK_INT >= 35) try { page.textContents.joinToString("\n") { it.text } } catch (_: Exception) { "" } else ""
            texts.put(JSONObject().put("page", index + 1).put("text", text.take(20_000)))
            if ((mode == "all" || (mode == "auto" && text.trim().length < 40)) && images.length() < 6) images.put(JSONObject().put("page", index + 1).put("data", render(page)))
          }
        }
        return JSONObject().put("pages", renderer.pageCount).put("text", texts).put("images", images).put("textSupported", Build.VERSION.SDK_INT >= 35)
      }
    } finally { file.delete() }
  }

  private fun render(page: PdfRenderer.Page): String {
    val width = 1100; val height = (width.toFloat() * page.height / page.width).toInt().coerceIn(1, 4000)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.WHITE)
    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
    val out = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 70, out); bitmap.recycle()
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

  // ---- Writing PDFs: the supervisor's HTML, laid out by an offscreen WebView without network or scripts.
  fun pdfCreate(context: Context, html: String): JSONObject {
    val out = File.createTempFile("mybots-write", ".pdf", context.cacheDir)
    val error = AtomicReference<String?>(null)
    val done = CountDownLatch(1)
    main.post {
      try {
        val web = WebView(context.applicationContext)
        web.settings.javaScriptEnabled = false
        web.settings.blockNetworkLoads = true
        web.settings.allowFileAccess = false; web.settings.allowContentAccess = false
        web.webViewClient = object : WebViewClient() {
          var started = false
          override fun onPageFinished(view: WebView, url: String?) {
            if (started) return; started = true
            MyBotsPdfWriter.write(view.createPrintDocumentAdapter("MyBots"), out) { failure -> error.set(failure); done.countDown(); main.post { view.destroy() } }
          }
        }
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
      } catch (failure: Exception) { error.set("Não consegui preparar o PDF."); done.countDown() }
    }
    try {
      if (!done.await(45, TimeUnit.SECONDS)) throw IllegalStateException("O PDF demorou demais para ser gerado.")
      error.get()?.let { throw IllegalStateException(it) }
      if (out.length() == 0L) throw IllegalStateException("O PDF saiu vazio.")
      return JSONObject().put("data", Base64.encodeToString(out.readBytes(), Base64.NO_WRAP))
    } finally { out.delete() }
  }

  // ---- Downloads from a bot's browser.
  @Volatile private var serial = 0
  fun downloadSerial() = serial

  fun download(context: Context, tab: BotBrowser.Tab, url: String, userAgent: String?, disposition: String?, mime: String?) {
    serial++; tab.downloading = true; tab.download = null
    val cookies = BotBrowser.cookies(tab.botId, url)
    val referer = tab.web.url
    Thread({
      tab.download = try { fetchAndStore(context, tab.botId, url, userAgent, disposition, mime, cookies, referer) }
      catch (error: Exception) { JSONObject().put("error", error.message ?: "O download falhou.") }
      tab.downloading = false
    }, "mybots-download").start()
  }

  private fun fetchAndStore(context: Context, botId: String, url: String, userAgent: String?, disposition: String?, mime: String?, cookies: String?, referer: String?): JSONObject {
    val target = URL(BotBrowser.secure(url))
    if (target.protocol != "https" || !BotBrowser.allowed(android.net.Uri.parse(target.toString()))) throw IllegalStateException("Este download não é permitido.")
    val connection = target.openConnection() as HttpsURLConnection
    connection.sslSocketFactory = completing(target.host)
    connection.connectTimeout = 15_000; connection.readTimeout = 60_000
    cookies?.let { connection.setRequestProperty("Cookie", it) }
    userAgent?.let { connection.setRequestProperty("User-Agent", it) }
    referer?.let { connection.setRequestProperty("Referer", it) }
    if (connection.responseCode != 200) throw IllegalStateException("O site respondeu ${connection.responseCode} ao baixar o arquivo.")
    val header = connection.getHeaderField("Content-Disposition")
    val type = (mime?.takeIf { it.isNotBlank() && it != "application/octet-stream" } ?: connection.contentType?.substringBefore(';')?.trim() ?: "application/octet-stream").lowercase()
    val name = URLUtil.guessFileName(url, disposition?.takeIf { it.isNotBlank() } ?: header, type).replace(Regex("[\\u0000/\\\\]"), "_").take(120)
    if (name.substringAfterLast('.', "").lowercase() in BLOCKED || type == "application/vnd.android.package-archive") throw IllegalStateException("Arquivos executáveis (.${name.substringAfterLast('.', "")}) são bloqueados.")
    val bytes = connection.inputStream.use { input ->
      val out = ByteArrayOutputStream(); val buffer = ByteArray(65_536)
      while (out.size() <= MAX_DOWNLOAD) { val read = input.read(buffer); if (read < 0) break; out.write(buffer, 0, read) }
      out.toByteArray()
    }
    connection.disconnect()
    if (bytes.size > MAX_DOWNLOAD) throw IllegalStateException("O arquivo passa de 20 MB.")
    if (bytes.isEmpty()) throw IllegalStateException("O arquivo veio vazio.")
    return post(context, JSONObject().put("botId", botId).put("name", name).put("mime", type).put("source", target.host).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
  }

  private fun post(context: Context, body: JSONObject): JSONObject {
    val saved = pairingPreferences(context)
    val token = saved.getString("token", null) ?: throw IllegalStateException("O MyBots não está pareado.")
    val connection = URL("http://127.0.0.1:${saved.getInt("port", 3219)}/device/files").openConnection() as HttpURLConnection
    connection.requestMethod = "POST"; connection.doOutput = true; connection.connectTimeout = 3000; connection.readTimeout = 30_000
    connection.setRequestProperty("Authorization", "Bearer $token"); connection.setRequestProperty("Content-Type", "application/json")
    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
    val code = connection.responseCode
    val text = (if (code == 200) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
    connection.disconnect()
    val json = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
    if (code != 200) throw IllegalStateException(json.optString("error").ifEmpty { "O supervisor não guardou o arquivo." })
    return json
  }

  // Same rule as the browser: the platform's trust, plus an incomplete chain completed from the certificate's AIA.
  private fun completing(host: String): SSLSocketFactory {
    val platform = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(null as KeyStore?) }
      .trustManagers.filterIsInstance<X509TrustManager>().first()
    val manager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = platform.checkClientTrusted(chain, authType)
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        try { platform.checkServerTrusted(chain, authType) } catch (error: CertificateException) { if (!IncompleteChain.trusted(chain[0], host)) throw error }
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = platform.acceptedIssuers
    }
    return SSLContext.getInstance("TLS").apply { init(null, arrayOf(manager), null) }.socketFactory
  }

  // ---- What a bot sends: staged in the app's cache, then opened, shared or saved to Downloads.
  private fun staged(context: Context, id: String, name: String): File {
    if (!id.matches(Regex("[0-9a-fA-F-]{36}"))) throw IllegalArgumentException("Arquivo inválido.")
    val safe = name.replace(Regex("[\\u0000/\\\\]"), "_").take(120).ifBlank { "arquivo" }
    return File(File(context.cacheDir, "shared/$id").apply { mkdirs() }, safe)
  }

  fun stage(context: Context, id: String, name: String, chunk: String, append: Boolean): Long {
    val file = staged(context, id, name)
    val bytes = Base64.decode(chunk, Base64.NO_WRAP)
    if (append) file.appendBytes(bytes) else file.writeBytes(bytes)
    if (file.length() > MAX_DOWNLOAD) { file.delete(); throw IllegalArgumentException("Arquivo grande demais.") }
    return file.length()
  }

  fun act(context: Context, id: String, name: String, mime: String, action: String): String {
    val file = staged(context, id, name)
    if (!file.exists()) throw IllegalStateException("Baixe o arquivo de novo.")
    val uri = FileProvider.getUriForFile(context, context.packageName + ".mybots.files", file)
    when (action) {
      "open" -> {
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        // Termux accepts any file (to copy it into its home); it is never the app that should open a bot's file.
        @Suppress("DEPRECATION")
        val viewers = context.packageManager.queryIntentActivities(intent, 0).filter { it.activityInfo.packageName !in setOf(TERMUX_PACKAGE, context.packageName) }
        if (viewers.isEmpty()) throw IllegalStateException("Nenhum app deste celular abre este tipo de arquivo. Use Compartilhar ou Salvar.")
        if (viewers.size == 1) context.startActivity(intent.setClassName(viewers[0].activityInfo.packageName, viewers[0].activityInfo.name))
        else context.startActivity(Intent.createChooser(intent, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
          .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, context.packageManager.queryIntentActivities(intent, 0).filter { it.activityInfo.packageName == TERMUX_PACKAGE }
            .map { android.content.ComponentName(it.activityInfo.packageName, it.activityInfo.name) }.toTypedArray()))
      }
      "share" -> {
        val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(name, uri)
        context.startActivity(Intent.createChooser(send, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
      }
      "save" -> {
        if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("Salvar em Downloads precisa do Android 10 ou mais novo. Use Compartilhar.")
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, file.name); put(MediaStore.Downloads.MIME_TYPE, mime)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MyBots")
        }
        val target = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("Não consegui salvar em Downloads.")
        context.contentResolver.openOutputStream(target)?.use { output -> file.inputStream().use { it.copyTo(output) } } ?: throw IllegalStateException("Não consegui salvar em Downloads.")
        return "Downloads/MyBots/${file.name}"
      }
      else -> throw IllegalArgumentException("Ação inválida.")
    }
    return action
  }
}
