package expo.modules.termuxbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * Paying with the wallet: the rules are checked here, the purchase is booked before the card leaves the vault, and the
 * person is told at once. The card goes only into the checkout's fields (this phone's browser) or, encrypted, to the
 * computer's browser process; never to the supervisor or the model. Congelar stops a payment that is still filling.
 */
internal object WalletPay {
  const val ACTION_FREEZE = "com.mybots.app.WALLET_FREEZE"
  private const val CHANNEL = "mybots_wallet"
  private fun prefs(context: Context) = context.getSharedPreferences("mybots_wallet", Context.MODE_PRIVATE)
  // Bots whose checkout got the card in the last minutes (until the order is sent): Congelar clears those fields.
  val filling = ConcurrentHashMap<String, Long>()

  class Payment(val entry: JSONObject, val generation: Long, val card: JSONObject)

  private fun strings(array: JSONArray?) = (0 until (array?.length() ?: 0)).map { array!!.optString(it) }.filter { it.isNotBlank() }
  private fun rules(json: JSONObject) = WalletRules(json.optBoolean("frozen", true), json.optLong("perPurchase"), json.optLong("perDay"), json.optLong("perMonth"),
    strings(json.optJSONArray("allowedStores")), strings(json.optJSONArray("blockedStores")), strings(json.optJSONArray("categories")))

  fun intent(json: JSONObject) = WalletIntent(json.optString("store").take(200), strings(json.optJSONArray("items")).take(20), json.optString("category").take(100), json.optLong("total"))

  private fun ledger(context: Context) = try { JSONArray(prefs(context).getString("purchases", "[]")) } catch (_: Exception) { JSONArray() }
  private fun save(context: Context, list: JSONArray) {
    // The extract keeps the latest 300 purchases; older ones no longer count toward any limit anyway.
    val kept = JSONArray(); for (index in maxOf(0, list.length() - 300) until list.length()) kept.put(list.get(index))
    if (!prefs(context).edit().putString("purchases", kept.toString()).commit()) throw IllegalStateException("Não consegui registrar a compra.")
  }

  /** Checks the rules and books the purchase, under the same lock as Congelar and the rules editor. */
  fun authorize(context: Context, botId: String, botName: String, intent: WalletIntent, url: String, pageTotal: Long?): Payment = synchronized(WalletGuard) {
    val card = PasswordVault.cardForPayment(context) ?: throw IllegalStateException("Nenhum cartão cadastrado. Peça à pessoa para cadastrar em Ajustes → Carteira.")
    val (json, generation) = WalletGuard.snapshot(context)
    val list = ledger(context)
    val spent = (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("status") == "paga" }.map { it.optLong("at") to it.optLong("total") }
    val now = System.currentTimeMillis()
    WalletPolicy.check(rules(json), intent, url, pageTotal, spent, now)
    val entry = JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("at", now).put("botId", botId).put("bot", botName.take(60))
      .put("store", WalletPolicy.host(url)).put("items", JSONArray(intent.items)).put("category", intent.category).put("total", intent.total)
      .put("card", card.getString("number").takeLast(4)).put("status", "paga")
    list.put(entry); save(context, list)
    Payment(entry, generation, card)
  }

  /** Still allowed to put the card in: not frozen and the rules unchanged since the purchase was booked. */
  fun valid(context: Context, generation: Long) = synchronized(WalletGuard) { WalletGuard.generation(context) == generation && !WalletGuard.rules(context).optBoolean("frozen", true) }

  private fun update(context: Context, id: String, change: (JSONObject) -> Unit) = synchronized(WalletGuard) {
    val list = ledger(context)
    for (index in 0 until list.length()) list.getJSONObject(index).takeIf { it.optString("id") == id }?.let(change)
    save(context, list)
  }

  /** The card did not reach the checkout (an error, Congelar): the purchase no longer counts. */
  fun cancel(context: Context, id: String, reason: String?) {
    update(context, id) { if (it.optString("status") == "paga") it.put("status", "cancelada").put("reason", (reason ?: "").take(200)) }
    notice(context, id, "Pagamento não concluído", (reason ?: "O cartão não foi usado.").take(300))
  }

  /** The person says a purchase did not happen (Ajustes → Carteira): it stops counting toward the limits. */
  fun dismiss(context: Context, id: String) = update(context, id) { if (it.optString("status") == "paga") it.put("status", "desconsiderada") }

  fun receipt(context: Context, id: String, image: String) {
    if (!id.matches(Regex("[0-9a-f-]{36}")) || image.length > 4_000_000) return
    val folder = File(context.filesDir, "wallet").apply { mkdirs() }
    File(folder, "$id.jpg").writeBytes(Base64.decode(image, Base64.DEFAULT))
    update(context, id) { it.put("receipt", true) }
  }

  /** The extract for the app: no card number, only its last four digits. */
  fun list(context: Context): String {
    val list = ledger(context); val out = JSONArray()
    for (index in list.length() - 1 downTo 0) {
      val entry = JSONObject(list.getJSONObject(index).toString())
      if (entry.optBoolean("receipt")) entry.put("receipt", "file://" + File(File(context.filesDir, "wallet"), entry.optString("id") + ".jpg").absolutePath)
      out.put(entry)
    }
    return out.toString()
  }

  fun paid(context: Context, payment: Payment) {
    val entry = payment.entry; val items = strings(entry.optJSONArray("items"))
    val what = items.first().take(60) + if (items.size > 1) " e mais ${items.size - 1}" else ""
    notice(context, entry.getString("id"), "${entry.optString("bot")} comprou $what por ${WalletPolicy.money(entry.optLong("total"))}",
      "Em ${entry.optString("store")}, cartão final ${entry.optString("card")}. Se você não reconhece, toque em Congelar carteira.", freeze = true)
  }

  private fun notice(context: Context, id: String, title: String, text: String, freeze: Boolean = false) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 33 && !manager.areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null)
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Carteira", NotificationManager.IMPORTANCE_HIGH))
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    @Suppress("DEPRECATION")
    val builder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL) else Notification.Builder(context))
      .setSmallIcon(R.drawable.mybots_notification).setContentTitle(title.take(100)).setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text)).setAutoCancel(true).setColor(0xFF9ED8B9.toInt())
    open?.let { builder.setContentIntent(PendingIntent.getActivity(context, id.hashCode(), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)) }
    if (freeze) {
      val action = PendingIntent.getBroadcast(context, 7_302, Intent(context, PhoneControlReceiver::class.java).setAction(ACTION_FREEZE), PendingIntent.FLAG_IMMUTABLE)
      @Suppress("DEPRECATION") builder.addAction(Notification.Action.Builder(null, "Congelar carteira", action).build())
    }
    manager.notify(("wallet-$id").hashCode(), builder.build())
  }

  /** Congelar, from the app or the notice: clears the card from open checkouts and stops the payment on the computer. */
  fun freeze(context: Context) {
    WalletGuard.freeze(context)
    for ((botId, at) in filling) { if (System.currentTimeMillis() - at < 15 * 60_000) runCatching { BotBrowser.clearCards(context, botId) }; filling.remove(botId) }
    PhoneControl.post(context, JSONObject().put("event", "walletFrozen"))
  }

  /**
   * The computer's browser asked for the card: the rules are checked with the checkout it read, the purchase is booked,
   * and the card goes out encrypted to that browser process's one-time key, bound to the page and the request.
   */
  fun forComputer(context: Context, botId: String, args: JSONObject): JSONObject {
    val url = args.getString("url"); val challenge = args.getString("challenge")
    if (url.length > 2000 || !challenge.matches(Regex("[A-Za-z0-9_-]{32}")) || args.getString("publicKey").length > 1000) throw IllegalArgumentException("Pedido de pagamento inválido.")
    val total = args.optLong("pageTotal", 0).takeIf { it > 0 }
    val payment = authorize(context, botId, args.optString("botName"), intent(args.getJSONObject("intent")), url, total)
    val card = payment.card
    val bytes = JSONObject().put("url", url).put("challenge", challenge).put("total", total).put("number", card.getString("number")).put("cvv", card.getString("cvv"))
      .put("month", card.getInt("expiryMonth")).put("year", card.getInt("expiryYear")).put("name", card.getString("name")).toString().toByteArray(Charsets.UTF_8)
    val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
    try {
      if (!valid(context, payment.generation)) throw IllegalStateException("A carteira foi congelada.")
      val aes = Cipher.getInstance("AES/GCM/NoPadding")
      aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
      aes.updateAAD(challenge.toByteArray(Charsets.UTF_8))
      val encrypted = aes.doFinal(bytes)
      val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding")
      rsa.init(Cipher.ENCRYPT_MODE, KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(args.getString("publicKey"), Base64.NO_WRAP))),
        OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
      fun b64(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
      return JSONObject().put("key", b64(rsa.doFinal(key))).put("iv", b64(iv)).put("data", b64(encrypted.copyOfRange(0, encrypted.size - 16)))
        .put("tag", b64(encrypted.copyOfRange(encrypted.size - 16, encrypted.size))).put("id", payment.entry.getString("id"))
    } catch (error: Exception) { cancel(context, payment.entry.getString("id"), error.message); throw error }
    finally { bytes.fill(0); key.fill(0) }
  }

  /** The computer's browser filled the card (with the receipt) or could not. */
  fun computerDone(context: Context, args: JSONObject) {
    val id = args.getString("id")
    val entry = (0 until ledger(context).length()).map { ledger(context).getJSONObject(it) }.firstOrNull { it.optString("id") == id } ?: return
    if (!args.optBoolean("ok")) { cancel(context, id, args.optString("error").ifEmpty { null }); return }
    args.optString("image").takeIf { it.isNotEmpty() }?.let { receipt(context, id, it) }
    val card = PasswordVault.cardForPayment(context)
    paid(context, Payment(entry, 0, card ?: JSONObject()))
  }
}
