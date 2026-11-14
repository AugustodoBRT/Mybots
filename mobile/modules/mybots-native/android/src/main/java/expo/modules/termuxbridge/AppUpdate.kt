package expo.modules.termuxbridge

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates from inside the app: the newest release of the public APK repository (GitHub Releases, APKs only).
 * A download is installed only when its SHA-256 matches the release's and it is MyBots signed with the same
 * certificate as the installed app, so a swapped file can never replace it. Android still asks the person to confirm.
 */
internal object AppUpdate {
  const val REPOSITORY = "AugustodoBRT/Mybots"
  private const val LATEST = "https://api.github.com/repos/$REPOSITORY/releases/latest"
  const val ACTION_STATUS = "expo.modules.termuxbridge.UPDATE_STATUS"
  private val APK = Regex("^mybots-v(\\d+)\\.apk$")
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null
  @Volatile private var downloading = false

  private fun get(url: String, accept: String): HttpURLConnection {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 10_000; connection.readTimeout = 30_000; connection.instanceFollowRedirects = true
    connection.setRequestProperty("Accept", accept); connection.setRequestProperty("User-Agent", "MyBots")
    if (connection.responseCode != 200) { connection.disconnect(); throw IllegalStateException("O servidor de atualizações respondeu ${connection.responseCode}.") }
    // Only the release host and GitHub's download CDN, always over https.
    if (connection.url.protocol != "https" || !(connection.url.host == "api.github.com" || connection.url.host == "github.com" || connection.url.host.endsWith(".githubusercontent.com"))) {
      connection.disconnect(); throw SecurityException("A atualização veio de um endereço inesperado.")
    }
    return connection
  }

  fun installed(context: Context): PackageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
  @Suppress("DEPRECATION")
  fun code(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

  /** Blocking. The newest release and whether it is newer than this install. */
  fun check(context: Context): Map<String, Any?> {
    val current = installed(context)
    val json = get(LATEST, "application/vnd.github+json").let { c -> c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() } }
    val release = JSONObject(json)
    val assets = release.optJSONArray("assets")
    var apk: JSONObject? = null; var digest: JSONObject? = null; var version = 0L
    for (i in 0 until (assets?.length() ?: 0)) {
      val asset = assets!!.getJSONObject(i); val name = asset.optString("name")
      APK.find(name)?.let { apk = asset; version = it.groupValues[1].toLong() }
    }
    for (i in 0 until (assets?.length() ?: 0)) {
      val asset = assets!!.getJSONObject(i)
      if (apk != null && asset.optString("name") == apk!!.optString("name") + ".sha256") digest = asset
    }
    val result = mutableMapOf<String, Any?>("currentCode" to code(current).toDouble(), "currentName" to (current.versionName ?: ""),
      "latestCode" to version.toDouble(), "latestName" to release.optString("name").ifBlank { release.optString("tag_name") },
      "notes" to release.optString("body").take(4000), "publishedAt" to release.optString("published_at"),
      "available" to (apk != null && digest != null && version > code(current)))
    apk?.let { result["size"] = it.optLong("size").toDouble(); result["apkUrl"] = it.optString("browser_download_url") }
    digest?.let { result["shaUrl"] = it.optString("browser_download_url") }
    context.getSharedPreferences("mybots_update", Context.MODE_PRIVATE).edit().putLong("checkedAt", System.currentTimeMillis()).apply()
    return result
  }

  /** Blocking. Downloads, verifies and hands the APK to Android's installer; progress goes to [listener]. */
  fun download(context: Context, apkUrl: String, shaUrl: String): String {
    if (downloading) throw IllegalStateException("A atualização já está sendo baixada.")
    downloading = true
    try {
      val expected = get(shaUrl, "application/octet-stream").let { c -> c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() } }
        .trim().split(Regex("\\s+")).first().lowercase()
      if (!expected.matches(Regex("[0-9a-f]{64}"))) throw IllegalStateException("A versão nova não trouxe uma soma de verificação válida.")
      val folder = File(context.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
      val file = File(folder, "mybots-update.apk")
      val sha = MessageDigest.getInstance("SHA-256")
      val connection = get(apkUrl, "application/octet-stream")
      val total = connection.contentLengthLong
      if (total > 200L * 1024 * 1024) throw IllegalStateException("O arquivo da atualização é grande demais.")
      var done = 0L; var reported = -1
      connection.inputStream.use { input -> file.outputStream().use { output ->
        val buffer = ByteArray(128 * 1024)
        while (true) {
          val read = input.read(buffer); if (read < 0) break
          output.write(buffer, 0, read); sha.update(buffer, 0, read); done += read
          if (done > 200L * 1024 * 1024) throw IllegalStateException("O arquivo da atualização é grande demais.")
          val percent = if (total > 0) (done * 100 / total).toInt() else -1
          if (percent != reported) { reported = percent; listener?.invoke(mapOf("state" to "downloading", "percent" to percent, "done" to done.toDouble(), "total" to total.toDouble())) }
        }
      } }
      connection.disconnect()
      if (sha.digest().joinToString("") { "%02x".format(it) } != expected) { file.delete(); throw SecurityException("O arquivo baixado não confere com a versão publicada. Nada foi instalado.") }
      verify(context, file)
      listener?.invoke(mapOf("state" to "installing"))
      install(context, file)
      return "installing"
    } finally { downloading = false }
  }

  @Suppress("DEPRECATION")
  private fun verify(context: Context, file: File) {
    val manager = context.packageManager
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val archive = manager.getPackageArchiveInfo(file.absolutePath, flags) ?: run { file.delete(); throw SecurityException("O arquivo baixado não é um APK válido.") }
    val current = manager.getPackageInfo(context.packageName, flags)
    if (archive.packageName != context.packageName) { file.delete(); throw SecurityException("O arquivo baixado não é o MyBots.") }
    if (code(archive) <= code(current)) { file.delete(); throw IllegalStateException("Esta versão não é mais nova que a instalada.") }
    val certificates = { info: PackageInfo -> (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)
      ?.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }?.toSet().orEmpty() }
    val mine = certificates(current); val theirs = certificates(archive)
    if (mine.isEmpty() || mine != theirs) { file.delete(); throw SecurityException("A versão baixada foi assinada por outra pessoa. Nada foi instalado.") }
  }

  /** After Android replaces the app it does not reopen it: a notice says the update worked and opens the new version. */
  fun finished(context: Context) {
    val prefs = context.getSharedPreferences("mybots_update", Context.MODE_PRIVATE)
    if (prefs.getString("installing", null) == null) return
    prefs.edit().remove("installing").apply()
    val name = installed(context).versionName ?: ""
    BotNotifier.show(context, JSONObject().put("id", "mybots-update").put("tag", "mybots-update")
      .put("title", "MyBots atualizado").put("text", "A versão $name está instalada. Toque para abrir."))
  }

  private fun install(context: Context, file: File) {
    context.getSharedPreferences("mybots_update", Context.MODE_PRIVATE).edit().putString("installing", file.name).apply()
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(context.packageName); setSize(file.length())
      if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val id = installer.createSession(params)
    installer.openSession(id).use { session ->
      file.inputStream().use { input -> session.openWrite("mybots.apk", 0, file.length()).use { output -> input.copyTo(output); session.fsync(output) } }
      val intent = Intent(context, AppUpdateReceiver::class.java).setAction(ACTION_STATUS)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      session.commit(PendingIntent.getBroadcast(context, 41_300, intent, flags).intentSender)
    }
  }

  fun canInstall(context: Context) = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
  fun openInstallPermission(context: Context) {
    context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
}

/** Android's installer reports here: it asks the person to confirm, then installs (the app restarts on the new version). */
class AppUpdateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let { try { context.startActivity(it) } catch (_: Exception) {} }
        AppUpdate.listener?.invoke(mapOf("state" to "confirm"))
      }
      PackageInstaller.STATUS_SUCCESS -> AppUpdate.listener?.invoke(mapOf("state" to "done"))
      else -> {
        val message = when (status) {
          PackageInstaller.STATUS_FAILURE_ABORTED -> "Instalação cancelada."
          PackageInstaller.STATUS_FAILURE_BLOCKED -> "O Android bloqueou a instalação (Play Protect?). Tente pelo link do APK."
          PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "Esta versão não é compatível com a instalada."
          PackageInstaller.STATUS_FAILURE_STORAGE -> "Falta espaço no celular para instalar."
          else -> intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)?.take(200) ?: "A instalação falhou."
        }
        AppUpdate.listener?.invoke(mapOf("state" to "error", "message" to message))
      }
    }
  }
}
