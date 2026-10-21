package expo.modules.termuxbridge

import android.content.Context
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import android.util.Base64
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.X509EncodedKeySpec
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/**
 * Saved site logins, kept only in the app (Android Keystore). Neither the supervisor nor the model ever receives a
 * password: browser_login asks the app, which fills the page itself, and only on the site the login was saved for
 * (the same host or one of its subdomains), and only for the bots the person chose. Passwords are never shown again.
 */
internal object PasswordVault {
  private const val KEY = "entries"
  @Volatile var offerListener: ((Map<String, Any?>) -> Unit)? = null
  // A login the person just typed in a bot's browser ("Assumir"), waiting for "Salvar?" in the chat.
  @Volatile private var offer: JSONObject? = null

  private fun prefs(context: Context): android.content.SharedPreferences {
    val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    return EncryptedSharedPreferences.create(context, "mybots_passwords", key,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  }
  private fun entries(context: Context) = try { JSONArray(prefs(context).getString(KEY, "[]")) } catch (_: Exception) { JSONArray() }
  private fun write(context: Context, list: JSONArray) {
    if (!prefs(context).edit().putString(KEY, list.toString()).commit()) throw IllegalStateException("Não consegui guardar a senha protegida.")
  }

  /** "https://sig.cefetmg.br/sigaa/x" or "sig.cefetmg.br" → "sig.cefetmg.br". */
  fun hostOf(site: String): String {
    val text = site.trim()
    val host = (if (text.contains("://")) Uri.parse(text).host else Uri.parse("https://$text").host)?.lowercase()?.trimEnd('.')
    if (host == null || !host.matches(Regex("[a-z0-9-]+(\\.[a-z0-9-]+)+"))) throw IllegalArgumentException("Informe o endereço do site, como sig.cefetmg.br.")
    return host
  }

  private fun matches(saved: String, host: String) = host == saved || host.endsWith(".$saved")

  /** What the settings list shows: site, user and bots; never the password. */
  fun list(context: Context): List<Map<String, Any?>> {
    val list = entries(context)
    return (0 until list.length()).map { list.getJSONObject(it) }.map { item ->
      mapOf("id" to item.optString("id"), "host" to item.optString("host"), "username" to item.optString("username"),
        "bots" to item.optJSONArray("bots")?.let { bots -> (0 until bots.length()).map { bots.getString(it) } }, "createdAt" to item.optDouble("createdAt"))
    }
  }

  fun save(context: Context, site: String, username: String, password: String, bots: List<String>?): Map<String, Any?> {
    val host = hostOf(site)
    if (username.length > 200 || password.isEmpty() || password.length > 500) throw IllegalArgumentException("Preencha a senha (até 500 caracteres) e o usuário (até 200).")
    if (bots != null && bots.any { !it.matches(Regex("[0-9a-fA-F-]{36}")) }) throw IllegalArgumentException("Bot inválido.")
    val list = entries(context); val kept = JSONArray()
    // One login per site and user: saving again replaces the password.
    for (i in 0 until list.length()) list.getJSONObject(i).let { if (!(it.optString("host") == host && it.optString("username") == username)) kept.put(it) }
    val entry = JSONObject().put("id", UUID.randomUUID().toString()).put("host", host).put("username", username).put("password", password)
      .put("bots", bots?.let { JSONArray(it) } ?: JSONObject.NULL).put("createdAt", System.currentTimeMillis().toDouble())
    kept.put(entry); write(context, kept)
    return mapOf("id" to entry.getString("id"), "host" to host, "username" to username)
  }

  /**
   * A password export (Chrome, Google, Firefox, Bitwarden, 1Password: CSV with url, username and password columns),
   * read here and kept like the logins saved by hand. Lines without a web address or password are skipped.
   */
  fun importCsv(context: Context, text: String, bots: List<String>?): Map<String, Any?> {
    if (bots != null && bots.any { !it.matches(Regex("[0-9a-fA-F-]{36}")) }) throw IllegalArgumentException("Bot inválido.")
    val rows = csvRows(text.removePrefix("\uFEFF"))
    if (rows.isEmpty()) throw IllegalArgumentException("O arquivo está vazio.")
    val header = rows[0].map { it.trim().lowercase() }
    fun column(vararg names: String) = names.map { header.indexOf(it) }.firstOrNull { it >= 0 } ?: -1
    val url = column("url", "login_uri", "website", "login url", "site"); val user = column("username", "login_username", "login", "user", "email")
    val pass = column("password", "login_password")
    if (url < 0 || pass < 0) throw IllegalArgumentException("Este CSV não parece uma exportação de senhas: faltam as colunas de site e senha.")
    val list = entries(context); var imported = 0; var skipped = 0
    for (row in rows.drop(1)) {
      val password = row.getOrNull(pass) ?: ""; val username = row.getOrNull(user)?.trim() ?: ""
      val host = try { val site = row.getOrNull(url)?.trim() ?: ""; if (!site.startsWith("http://") && !site.startsWith("https://")) null else hostOf(site) } catch (_: Exception) { null }
      if (host == null || password.isEmpty() || password.length > 500 || username.length > 200) { if (row.any { it.isNotBlank() }) skipped++; continue }
      // One login per site and user, as when saving by hand: importing again replaces the password.
      for (i in list.length() - 1 downTo 0) list.getJSONObject(i).let { if (it.optString("host") == host && it.optString("username") == username) list.remove(i) }
      list.put(JSONObject().put("id", UUID.randomUUID().toString()).put("host", host).put("username", username).put("password", password)
        .put("bots", bots?.let { JSONArray(it) } ?: JSONObject.NULL).put("createdAt", System.currentTimeMillis().toDouble()))
      imported++
    }
    if (imported > 0) write(context, list)
    return mapOf("imported" to imported, "skipped" to skipped)
  }

  /** RFC 4180: commas, quotes doubled inside quoted fields, and line breaks inside them (notes). */
  internal fun csvRows(text: String): List<List<String>> {
    val rows = mutableListOf<List<String>>(); var row = mutableListOf<String>(); val field = StringBuilder(); var quoted = false; var i = 0
    while (i < text.length) {
      val c = text[i]
      if (quoted) {
        if (c == '"' && i + 1 < text.length && text[i + 1] == '"') { field.append('"'); i++ }
        else if (c == '"') quoted = false
        else field.append(c)
      } else when (c) {
        '"' -> quoted = true
        ',' -> { row.add(field.toString()); field.setLength(0) }
        '\r' -> {}
        '\n' -> { row.add(field.toString()); field.setLength(0); rows.add(row); row = mutableListOf() }
        else -> field.append(c)
      }
      i++
    }
    if (field.isNotEmpty() || row.isNotEmpty()) { row.add(field.toString()); rows.add(row) }
    return rows.filter { it.size > 1 || it.firstOrNull()?.isNotEmpty() == true }
  }

  fun delete(context: Context, id: String): Boolean {
    val list = entries(context); val kept = JSONArray(); var removed = false
    for (i in 0 until list.length()) list.getJSONObject(i).let { if (it.optString("id") == id) removed = true else kept.put(it) }
    write(context, kept); return removed
  }

  /** The login a bot may use on this page, or null. */
  fun forPage(context: Context, botId: String, url: String?): JSONObject? {
    val uri = Uri.parse(url ?: return null)
    if (uri.scheme != "https") return null
    val host = uri.host?.lowercase()?.trimEnd('.') ?: return null
    val list = entries(context)
    return (0 until list.length()).map { list.getJSONObject(it) }
      .filter { matches(it.optString("host"), host) }
      .filter { item -> item.optJSONArray("bots")?.let { bots -> (0 until bots.length()).any { bots.getString(it) == botId } } ?: true }
      .maxByOrNull { it.optString("host").length }
  }

  /** Only the browser worker can decrypt this one-use login; the supervisor forwards ciphertext. */
  fun forComputer(context: Context, botId: String, args: JSONObject): JSONObject {
    val url = args.getString("url")
    val challenge = args.getString("challenge")
    if (url.length > 2000 || !challenge.matches(Regex("[A-Za-z0-9_-]{32}")) || args.getString("publicKey").length > 1000) throw IllegalArgumentException("Pedido de login protegido inválido.")
    val saved = forPage(context, botId, url) ?: throw IllegalStateException("Não há senha salva para este site e este bot. Salve em Ajustes → Senhas ou entre no Chrome do bot.")
    val bytes = JSONObject().put("url", url).put("challenge", challenge).put("username", saved.optString("username")).put("password", saved.optString("password")).toString().toByteArray(Charsets.UTF_8)
    val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
    try {
      val aes = Cipher.getInstance("AES/GCM/NoPadding")
      aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
      aes.updateAAD(challenge.toByteArray(Charsets.UTF_8))
      val encrypted = aes.doFinal(bytes)
      val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding")
      val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(args.getString("publicKey"), Base64.NO_WRAP)))
      rsa.init(Cipher.ENCRYPT_MODE, publicKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
      fun b64(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
      return JSONObject().put("key", b64(rsa.doFinal(key))).put("iv", b64(iv)).put("data", b64(encrypted.copyOfRange(0, encrypted.size - 16))).put("tag", b64(encrypted.copyOfRange(encrypted.size - 16, encrypted.size)))
    } finally { bytes.fill(0); key.fill(0) }
  }

  // A login typed by the person while they had taken over a bot's browser.
  fun offered(botId: String, url: String?, username: String, password: String) {
    val uri = Uri.parse(url ?: return)
    if (uri.scheme != "https" || password.isEmpty() || password.length > 500) return
    val host = uri.host?.lowercase() ?: return
    offer = JSONObject().put("botId", botId).put("host", host).put("username", username.take(200)).put("password", password)
    offerListener?.invoke(mapOf("botId" to botId, "host" to host, "username" to username.take(200)))
  }
  fun pendingOffer(): Map<String, Any?>? = offer?.let { mapOf("botId" to it.optString("botId"), "host" to it.optString("host"), "username" to it.optString("username")) }
  fun takeOffer(context: Context, scope: String): Map<String, Any?>? {
    val item = offer ?: return null; offer = null
    if (scope == "dismiss") return null
    return save(context, item.getString("host"), item.getString("username"), item.getString("password"), if (scope == "all") null else listOf(item.getString("botId")))
  }
}
