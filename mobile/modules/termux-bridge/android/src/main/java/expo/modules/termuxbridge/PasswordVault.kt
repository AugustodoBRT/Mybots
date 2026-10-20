package expo.modules.termuxbridge

import android.content.Context
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

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
