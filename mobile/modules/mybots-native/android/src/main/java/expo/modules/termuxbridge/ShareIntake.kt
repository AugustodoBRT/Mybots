package expo.modules.termuxbridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * "Compartilhar → MyBots" from any app: text, links and up to five files (10 MB together, as the ＋ button).
 * Each bot is also a Direct Share target, so the share sheet can send straight to it. Only what the person shared
 * is read; nothing is sent until they confirm in the conversation.
 */
internal object ShareIntake {
  private const val MAX_FILES = 5
  private const val MAX_BYTES = 10 * 1024 * 1024
  const val CATEGORY = "com.mybots.app.SHARE_TARGET"
  @Volatile private var pending: Map<String, Any?>? = null

  fun isShare(intent: Intent?) = intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

  /** Reads the shared content (blocking: call off the main thread) and keeps it until the app takes it. */
  fun capture(context: Context, intent: Intent): Map<String, Any?> {
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(8000).orEmpty()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.take(300).orEmpty()
    val botId = intent.getStringExtra(Intent.EXTRA_SHORTCUT_ID)?.removePrefix("bot-")?.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) }
    val uris = mutableListOf<Uri>()
    @Suppress("DEPRECATION")
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
    else (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let { uris.add(it) }
    intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { if (it !in uris) uris.add(it) } }
    val files = mutableListOf<Map<String, Any?>>(); val problems = mutableListOf<String>(); var total = 0
    for (uri in uris) {
      if (uri.scheme != "content") { problems.add("Só consigo receber arquivos compartilhados por apps (content://)."); continue }
      if (files.size >= MAX_FILES) { problems.add("Recebi só os $MAX_FILES primeiros arquivos."); break }
      try {
        val resolver = context.contentResolver
        var name = "arquivo"; var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) { name = cursor.getString(0) ?: name; if (!cursor.isNull(1)) size = cursor.getLong(1) }
        }
        if (size > MAX_BYTES - total) { problems.add("$name passa do limite de 10 MB por mensagem."); continue }
        val bytes = resolver.openInputStream(uri)?.use { input ->
          val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(65536)
          while (out.size() <= MAX_BYTES - total) { val read = input.read(buffer); if (read < 0) break; out.write(buffer, 0, read) }
          out.toByteArray()
        } ?: throw IllegalStateException()
        if (bytes.size > MAX_BYTES - total) { problems.add("$name passa do limite de 10 MB por mensagem."); continue }
        if (bytes.isEmpty()) { problems.add("$name veio vazio."); continue }
        total += bytes.size
        val mime = resolver.getType(uri) ?: intent.type?.takeIf { !it.contains('*') } ?: "application/octet-stream"
        files.add(mapOf("name" to name.replace(Regex("[/\\\\\u0000]"), "_").take(120), "mime" to mime, "size" to bytes.size, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
      } catch (_: Exception) { problems.add("Não consegui ler um dos arquivos compartilhados.") }
    }
    val share = mapOf("botId" to botId, "text" to text, "subject" to subject, "files" to files, "problems" to problems.distinct())
    pending = share
    return share
  }

  fun take(): Map<String, Any?>? { val share = pending; pending = null; return share }
  fun peek() = pending != null

  /** The share sheet's Direct Share row: one shortcut per bot (most recent first), with its face as the icon. */
  fun publish(context: Context, bots: List<Map<String, Any?>>) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val max = minOf(ShortcutManagerCompat.getMaxShortcutCountPerActivity(context), 8)
    val shortcuts = bots.take(max).mapIndexedNotNull { index, bot ->
      val id = bot["id"] as? String ?: return@mapIndexedNotNull null
      val name = (bot["name"] as? String)?.take(40) ?: return@mapIndexedNotNull null
      val still = bot["still"] as? Map<*, *> ?: return@mapIndexedNotNull null
      val spec = (still["spec"] as? Map<*, *>)?.let { org.json.JSONObject(it).toString() } ?: "{}"
      val face = MimoStill.bitmap(context, spec, still["mood"] as? String ?: "normal", (still["n"] as? Number)?.toInt() ?: 3000, 192, (still["dp"] as? Number)?.toDouble() ?: 52.0, false)
      ShortcutInfoCompat.Builder(context, "bot-$id").setShortLabel(name).setLongLabel(name)
        .setIcon(IconCompat.createWithAdaptiveBitmap(padded(face)))
        .setIntent(Intent(launch).setAction(Intent.ACTION_VIEW).putExtra("mybotsBotId", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        .setCategories(setOf(CATEGORY)).setLongLived(true).setRank(index).build()
    }
    try {
      ShortcutManagerCompat.removeAllDynamicShortcuts(context)
      if (shortcuts.isNotEmpty()) ShortcutManagerCompat.addDynamicShortcuts(context, shortcuts)
    } catch (_: Exception) { /* A launcher limit must never break the app. */ }
  }

  // Adaptive icons crop the outer third; the face sits in the safe zone over the app's dark background.
  private fun padded(face: android.graphics.Bitmap): android.graphics.Bitmap {
    val size = 288; val bitmap = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap); canvas.drawColor(0xFF000000.toInt())
    canvas.drawBitmap(face, null, android.graphics.RectF(48f, 48f, 240f, 240f), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
    return bitmap
  }
}
