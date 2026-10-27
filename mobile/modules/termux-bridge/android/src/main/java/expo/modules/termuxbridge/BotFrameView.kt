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

  private val inputs = java.util.ArrayDeque<JSONObject>()
  private var inputSeq = 0L
  private var inputBusy = false
  fun input(value: String?) {
    val command = runCatching { JSONObject(value ?: return) }.getOrNull() ?: return
    command.remove("nonce")
    if (command.optString("type") == "touch" && command.optString("phase") == "touchMove") inputs.removeAll { it.optString("phase") == "touchMove" }
    if (inputs.size >= 16) { inputs.clear(); metadata["error"] = "Conexão lenta. Tente novamente."; publish(); return }
    inputs.add(command); flushInput()
  }
  private fun flushInput() {
    val ws = socket ?: return
    if (inputBusy || inputs.isEmpty()) return
    inputBusy = true
    ws.send(JSONObject().put("type", "input").put("seq", ++inputSeq).put("input", inputs.removeFirst()).toString())
  }

  init {
    // A software layer finishes drawing before its old bitmap is returned to the decoder.
    surface.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    addView(surface, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  fun show(id: String?) {
    if (bot == id) return
    disconnect(); bot = id?.takeIf { runCatching { UUID.fromString(it) }.isSuccess }
    bitmap = null; spare = null; metadata.clear(); received.clear(); surface.invalidate()
    connect()
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
      override fun onOpen(webSocket: WebSocket, response: Response) { main.post { if (epoch == generation) flushInput() } }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (bytes.size > 4_020_000) { webSocket.close(1008, "Quadro inválido."); return }
        val data = bytes.toByteArray()
        val packet = runCatching { parse(data, id) }.getOrNull() ?: return
        main.post { if (epoch == generation) { received.putAll(packet.page); pending = packet.copy(page = received.toMap()); decode(epoch, id) } }
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        val value = runCatching { JSONObject(text) }.getOrNull() ?: return
        main.post { if (epoch == generation) { if (value.has("inputAck")) { inputBusy = false; flushInput(); return@post }; if (value.has("desktop")) metadata["desktop"] = value.optBoolean("desktop"); if (value.optBoolean("closed")) metadata["closed"] = true; if (value.has("error")) metadata["error"] = value.optString("error"); publish() } }
      }
      override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) { retry(epoch, response?.code == 401 || response?.code == 403) }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { retry(epoch, code == 1008) }
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
          surface.invalidate(); publish()
        } else spare = reuse
        decode(epoch, id)
      }
    }
  }

  private fun publish() {
    if (emitQueued) return
    emitQueued = true; main.postDelayed(emit, (500L - (SystemClock.uptimeMillis() - lastEmit)).coerceAtLeast(0L))
  }

  private fun disconnect() {
    generation++; inputs.clear(); inputBusy = false; inputSeq = 0; socket?.cancel(); socket = null; pending = null; decoding = false; spare = null
    main.removeCallbacks(emit); emitQueued = false
    worker?.shutdownNow(); worker = null
  }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); connect() }
  override fun onDetachedFromWindow() { disconnect(); super.onDetachedFromWindow() }
}
