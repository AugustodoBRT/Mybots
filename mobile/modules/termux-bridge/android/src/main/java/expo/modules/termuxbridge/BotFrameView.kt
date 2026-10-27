package expo.modules.termuxbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.EditText
import android.text.Editable
import android.text.TextWatcher
import android.text.InputType
import android.view.inputmethod.InputMethodManager
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import android.util.Base64
import android.view.ViewGroup
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

/** JPEG bytes stay in native code. Only the newest waiting frame is decoded, behind the displayed bitmap. */
class BotFrameView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    private val views = mutableMapOf<String, BotFrameView>()
    fun send(botId: String, value: String) { Handler(Looper.getMainLooper()).post { views[botId]?.input(value) } }
  }
  override val shouldUseAndroidLayout = true
  private val onMetadata by EventDispatcher()
  private val main = Handler(Looper.getMainLooper())
  private val surface = object : View(context) {
    val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    override fun onDraw(canvas: Canvas) { bitmap?.let { canvas.drawBitmap(it, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), paint) } }
  }
  private var bitmap: Bitmap? = null
  private var spare: Bitmap? = null
  private var worker: ExecutorService? = null
  private var socket: WebSocket? = null
  private var bot: String? = null
  private var generation = 0
  private data class Frame(val bytes: ByteArray, val offset: Int, val page: Map<String, Any>)
  private var pending: Frame? = null
  private val received = mutableMapOf<String, Any>()
  private var decoding = false
  private var lastEmit = 0L
  private var emitQueued = false
  private val metadata = mutableMapOf<String, Any>()
  private val emit = Runnable { emitQueued = false; lastEmit = SystemClock.uptimeMillis(); onMetadata(metadata.toMap()) }

  private var awaitingFrame = 0L
  private val slowInput = Runnable { if (awaitingFrame != 0L) { metadata["slow"] = true; onMetadata(metadata.toMap()) } }
  private var lastViewport: JSONObject? = null
  private var inputKey: java.security.PublicKey? = null
  private var lastText = ""
  private var secret = false
  private var changingEditor = false
  private val editor = object : EditText(context) {
    override fun onCreateInputConnection(outAttrs: android.view.inputmethod.EditorInfo): android.view.inputmethod.InputConnection? {
      val connection = super.onCreateInputConnection(outAttrs) ?: return null
      return object : android.view.inputmethod.InputConnectionWrapper(connection, false) {
        override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
          if (text.isEmpty() && beforeLength > 0) { input(JSONObject().put("type", "key").put("key", "Backspace").toString()); return true }
          return super.deleteSurroundingText(beforeLength, afterLength)
        }
      }
    }
  }.apply {
    alpha = 0f; setTextColor(android.graphics.Color.TRANSPARENT); setBackgroundColor(android.graphics.Color.TRANSPARENT)
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
    setSingleLine(true)
    imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_GO
  }
  private val typeBatch = Runnable { sendText() }
  private fun sendText() {
    val text = editor.text.toString()
    if (text == lastText || inputKey == null) return
    if (inputs.size >= 8) { main.postDelayed(typeBatch, 30); return }
    var prefix = 0
    while (prefix < text.length && prefix < lastText.length && text[prefix] == lastText[prefix]) prefix++
    // Avoid splitting a surrogate pair while applying an IME replacement.
    if (prefix > 0 && prefix < lastText.length && Character.isHighSurrogate(lastText[prefix - 1])) prefix--
    val payload = JSONObject().put("delete", lastText.substring(prefix).codePointCount(0, lastText.length - prefix)).put("text", text.substring(prefix)).put("secret", secret).toString().toByteArray(Charsets.UTF_8)
    try {
      val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
      val aes = Cipher.getInstance("AES/GCM/NoPadding"); aes.init(Cipher.ENCRYPT_MODE, key); aes.updateAAD("mybots-input".toByteArray())
      val encrypted = aes.doFinal(payload)
      val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
      rsa.init(Cipher.ENCRYPT_MODE, inputKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
      val b64 = { bytes: ByteArray -> Base64.encodeToString(bytes, Base64.NO_WRAP) }
      inputs.add(JSONObject().put("type", "encrypted").put("key", b64(rsa.doFinal(key.encoded))).put("iv", b64(aes.iv)).put("data", b64(encrypted.copyOfRange(0, encrypted.size - 16))).put("tag", b64(encrypted.copyOfRange(encrypted.size - 16, encrypted.size))))
      lastText = text; flushInput()
    } catch (_: Exception) { metadata["error"] = "Não consegui proteger a digitação. Assuma o navegador de novo."; publish() }
    finally { payload.fill(0) }
  }
  private fun focus(value: JSONObject) {
    if (!value.optBoolean("active")) { sendText(); editor.clearFocus(); (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(editor.windowToken, 0); return }
    secret = value.optBoolean("secret")
    changingEditor = true; editor.setText(""); lastText = ""
    editor.inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    changingEditor = false
    editor.requestFocus()
    editor.post { (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT) }
  }
  private val inputs = java.util.ArrayDeque<JSONObject>()
  private var inputSeq = 0L
  private var inputBusy = false
  fun input(value: String?) {
    val command = runCatching { JSONObject(value ?: return) }.getOrNull() ?: return
    command.remove("nonce")
    if (command.optString("type") == "viewport") lastViewport = JSONObject(command.toString())
    if (command.optString("type") == "keyboard") { editor.requestFocus(); (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT); return }
    if (command.optString("type") == "key" || command.optString("phase") == "touchStart") sendText()
    if (command.optString("type") == "touch" && command.optString("phase") == "touchMove") inputs.removeAll { it.optString("phase") == "touchMove" }
    if (inputs.size >= 16) { inputs.clear(); metadata["error"] = "Conexão lenta. Tente novamente."; publish(); return }
    inputs.add(command); flushInput()
  }
  private fun flushInput() {
    val ws = socket ?: return
    if (inputBusy || inputs.isEmpty()) return
    inputBusy = true
    if (awaitingFrame == 0L) { awaitingFrame = SystemClock.uptimeMillis(); main.postDelayed(slowInput, 500) }
    ws.send(JSONObject().put("type", "input").put("seq", ++inputSeq).put("input", inputs.removeFirst()).toString())
  }

  init {
    // A software layer finishes drawing before its old bitmap is returned to the decoder.
    surface.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    addView(editor, ViewGroup.LayoutParams(1, 1))
    editor.setOnEditorActionListener { _, _, _ -> input(JSONObject().put("type", "key").put("key", "Enter").toString()); true }
    editor.setOnKeyListener { _, code, event ->
      if (event.action == android.view.KeyEvent.ACTION_DOWN && code == android.view.KeyEvent.KEYCODE_DEL && editor.text.isEmpty()) { input(JSONObject().put("type", "key").put("key", "Backspace").toString()); true } else false
    }
    editor.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(s: Editable?) { if (!changingEditor) { main.removeCallbacks(typeBatch); main.postDelayed(typeBatch, 30) } }
    })
    addView(surface, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  fun show(id: String?) {
    if (bot == id) return
    bot?.let { if (views[it] === this) views.remove(it) }; disconnect(); bot = id?.takeIf { runCatching { UUID.fromString(it) }.isSuccess }
    bitmap = null; spare = null; metadata.clear(); received.clear(); surface.invalidate()
    if (isAttachedToWindow) bot?.let { views[it] = this }; connect()
  }

  private fun connect() {
    val id = bot ?: return
    if (!isAttachedToWindow || socket != null) return
    val saved = pairingPreferences(context)
    val token = saved.getString("token", null) ?: return
    val port = saved.getInt("port", 3219)
    val epoch = generation
    worker = worker ?: Executors.newSingleThreadExecutor { task -> Thread(task, "mybots-frame").apply { isDaemon = true } }
    val request = Request.Builder().url("http://127.0.0.1:$port/frames?bot=$id").header("Authorization", "Bearer $token").build()
    socket = OkHttpClientProvider.getOkHttpClient().newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) { main.post { if (epoch == generation) { if (inputs.isEmpty()) lastViewport?.let { inputs.add(JSONObject(it.toString())) }; flushInput() } } }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (bytes.size > 4_020_000) { webSocket.close(1008, "Quadro inválido."); return }
        val data = bytes.toByteArray()
        val packet = runCatching { parse(data, id) }.getOrNull() ?: return
        main.post { if (epoch == generation) { received.putAll(packet.page); pending = packet.copy(page = received.toMap()); decode(epoch, id) } }
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        val value = runCatching { JSONObject(text) }.getOrNull() ?: return
        main.post { if (epoch == generation) { value.optJSONObject("captcha")?.let { c ->
            val data = mutableMapOf<String, Any>("present" to c.optBoolean("present"), "solved" to c.optBoolean("solved"), "autoReturn" to c.optBoolean("autoReturn"), "width" to c.optDouble("width"), "height" to c.optDouble("height"))
            c.optJSONObject("rect")?.let { r -> data["rect"] = mapOf("x" to r.optDouble("x"), "y" to r.optDouble("y"), "width" to r.optDouble("width"), "height" to r.optDouble("height")) }
            metadata["captcha"] = data
          }
          if (value.has("loading")) metadata["loading"] = value.optBoolean("loading")
          // The tab strip, where the bot is about to act and a finished download go to the panel as they are.
          for (key in listOf("tabbar", "action", "download")) value.optJSONObject(key)?.let { metadata[key] = plain(it) }
          if (value.has("inputKey")) inputKey = runCatching { KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(value.getString("inputKey"), Base64.DEFAULT))) }.getOrNull()
          value.optJSONObject("focus")?.let { focus(it) }
          if (value.has("inputAck")) {
            // Slowness is how long the computer takes to take the input: a tap that changes nothing sends no frame.
            inputBusy = false
            if (awaitingFrame != 0L) { metadata["latency"] = SystemClock.uptimeMillis() - awaitingFrame; awaitingFrame = 0L; main.removeCallbacks(slowInput) }
            if (metadata["slow"] == true) { metadata["slow"] = false; publish() }
            if (value.has("error")) { metadata["error"] = value.optString("error"); publish() }
            flushInput(); return@post
          }; if (value.has("desktop")) metadata["desktop"] = value.optBoolean("desktop"); if (value.optBoolean("closed")) { metadata["closed"] = true; focus(JSONObject().put("active", false)) }; if (value.has("error")) metadata["error"] = value.optString("error"); publish() } }
      }
      override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) { retry(epoch, response?.code == 401 || response?.code == 403) }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { retry(epoch, false) }
    })
  }

  private fun retry(epoch: Int, denied: Boolean) {
    main.post {
      if (epoch != generation || !isAttachedToWindow) return@post
      socket = null
      metadata["error"] = if (denied) "Acesso negado à tela ao vivo. Reconecte o MyBots." else "Reconectando à tela ao vivo…"
      publish()
      if (!denied) main.postDelayed({ if (epoch == generation) connect() }, 2000)
    }
  }

  private fun parse(data: ByteArray, id: String): Frame {
    val page = mutableMapOf<String, Any>()
    require(data.size >= 35 && String(data, 0, 4, Charsets.US_ASCII) == "MBF1")
    val header = ByteBuffer.wrap(data)
    val packetBot = UUID(header.getLong(4), header.getLong(12)).toString()
    require(packetBot == id)
    val width = header.getShort(20).toInt() and 65535; val height = header.getShort(22).toInt() and 65535
    require(width in 1..8192 && height in 1..8192)
    page["botId"] = id; page["width"] = width; page["height"] = height; page["seq"] = header.getInt(24).toLong() and 0xffffffffL
    var at = 34
    for ((n, key) in listOf("url", "title", "tabs").withIndex()) {
      val length = header.getShort(28 + n * 2).toInt() and 65535
      if (length == 65535) continue
      require(at + length <= data.size)
      if (key != "tabs") page[key] = String(data, at, length, Charsets.UTF_8)
      else {
        require(length > 0); val count = data[at].toInt() and 255; require(count <= 5)
        var pos = at + 1; val tabs = mutableListOf<Map<String, Any>>()
        repeat(count) {
          require(pos + 4 <= at + length); val size = header.getShort(pos + 2).toInt() and 65535; require(pos + 4 + size <= at + length)
          tabs.add(mapOf("tab" to (data[pos].toInt() and 255), "active" to (data[pos + 1].toInt() == 1), "title" to String(data, pos + 4, size, Charsets.UTF_8))); pos += 4 + size
        }
        require(pos == at + length); page[key] = tabs
      }
      at += length
    }
    return Frame(data, at, page)
  }

  private fun decode(epoch: Int, id: String) {
    val packet = pending ?: return
    val data = packet.bytes; val at = packet.offset
    if (decoding) return
    pending = null; decoding = true
    val reuse = spare; spare = null
    worker?.execute {
      var decoded: Bitmap? = null
      val page = packet.page
      try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, at, data.size - at, bounds)
        require(bounds.outWidth in 1..8192 && bounds.outHeight in 1..8192 && bounds.outWidth.toLong() * bounds.outHeight <= 16_777_216)
        val options = BitmapFactory.Options().apply { inMutable = true; inPreferredConfig = Bitmap.Config.ARGB_8888; inBitmap = reuse }
        decoded = try { BitmapFactory.decodeByteArray(data, at, data.size - at, options) }
          catch (_: IllegalArgumentException) { options.inBitmap = null; BitmapFactory.decodeByteArray(data, at, data.size - at, options) }
      } catch (_: Exception) {}
      val ready = decoded
      main.post {
        if (epoch != generation) return@post
        decoding = false
        if (ready != null) {
          spare = bitmap; bitmap = ready; metadata.remove("closed"); metadata.remove("error"); metadata.putAll(page)
          if (awaitingFrame != 0L) { metadata["latency"] = SystemClock.uptimeMillis() - awaitingFrame; awaitingFrame = 0L; main.removeCallbacks(slowInput) }
          metadata["slow"] = false
          surface.invalidate(); publish()
        } else spare = reuse
        decode(epoch, id)
      }
    }
  }

  private fun plain(value: Any?): Any = when (value) {
    is JSONObject -> value.keys().asSequence().associateWith { plain(value.opt(it)) }
    is org.json.JSONArray -> (0 until value.length()).map { plain(value.opt(it)) }
    null, JSONObject.NULL -> ""
    else -> value
  }

  private fun publish() {
    if (emitQueued) return
    emitQueued = true; main.postDelayed(emit, (500L - (SystemClock.uptimeMillis() - lastEmit)).coerceAtLeast(0L))
  }

  private fun disconnect() {
    main.removeCallbacks(slowInput); awaitingFrame = 0L; main.removeCallbacks(typeBatch); changingEditor = true; editor.setText(""); lastText = ""; editor.clearFocus(); changingEditor = false; inputKey = null; generation++; inputs.clear(); inputBusy = false; inputSeq = 0; socket?.cancel(); socket = null; pending = null; decoding = false; spare = null
    main.removeCallbacks(emit); emitQueued = false
    worker?.shutdownNow(); worker = null
  }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); bot?.let { views[it] = this }; connect() }
  override fun onDetachedFromWindow() { bot?.let { if (views[it] === this) views.remove(it) }; disconnect(); super.onDetachedFromWindow() }
}
