package expo.modules.termuxbridge

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.ContactsContract
import android.telephony.SmsManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * What the bots read and do on the phone when everything runs inside the app (commands of supervisor/device.mjs, answered
 * in the same JSON the supervisor reads). Each one needs the permission the person gave in Ajustes.
 */
internal object DeviceApi {
  private val date = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
  private val main = Handler(Looper.getMainLooper())

  fun call(context: Context, input: JSONObject): JSONObject {
    val args = input.optJSONArray("args") ?: JSONArray()
    val option = { name: String -> (0 until args.length()).firstOrNull { args.optString(it) == name }?.let { args.optString(it + 1) } }
    val limit = (option("-l")?.toIntOrNull() ?: 200).coerceIn(1, 1000)
    val output: Any = when (input.getString("command")) {
      "sms-list" -> sms(context, limit)
      "sms-send" -> { send(context, option("-n").orEmpty(), input.optString("input")); "" }
      "contact-list" -> contacts(context)
      "call-log" -> calls(context, limit)
      "location" -> location(context, option("-p") ?: "network")
      "battery-status" -> battery(context)
      "notification" -> { notice(context, input); "" }
      else -> throw IllegalArgumentException("Pedido do celular desconhecido.")
    }
    return JSONObject().put("output", output.toString())
  }

  private fun need(context: Context, permission: String, what: String) {
    if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED)
      throw SecurityException("O MyBots não tem permissão para $what. Peça à pessoa para liberar em Ajustes → Celular → Permissões do celular.")
  }

  private fun sms(context: Context, limit: Int): JSONArray {
    need(context, Manifest.permission.READ_SMS, "ler os SMS")
    val out = JSONArray()
    context.contentResolver.query(Uri.parse("content://sms"), arrayOf("_id", "thread_id", "address", "body", "date", "type", "read"), null, null, "date DESC")?.use { row ->
      while (row.moveToNext() && out.length() < limit) out.put(JSONObject()
        .put("_id", row.getLong(0)).put("threadid", row.getLong(1)).put("number", row.getString(2).orEmpty()).put("body", row.getString(3).orEmpty())
        .put("received", date.format(Date(row.getLong(4)))).put("type", when (row.getInt(5)) { 1 -> "inbox"; 2 -> "sent"; 3 -> "draft"; 4 -> "outbox"; else -> "other" }).put("read", row.getInt(6) == 1))
    }
    return out
  }

  private fun send(context: Context, number: String, text: String) {
    need(context, Manifest.permission.SEND_SMS, "enviar SMS")
    if (number.isBlank() || text.isBlank()) throw IllegalArgumentException("Falta o número ou o texto do SMS.")
    @Suppress("DEPRECATION") val manager = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java) else SmsManager.getDefault()
    manager.sendMultipartTextMessage(number, null, manager.divideMessage(text), null, null)
  }

  private fun contacts(context: Context): JSONArray {
    need(context, Manifest.permission.READ_CONTACTS, "ler os contatos")
    val phone = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
    val name = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME; val number = ContactsContract.CommonDataKinds.Phone.NUMBER
    val out = JSONArray()
    context.contentResolver.query(phone, arrayOf(name, number), null, null, "$name ASC")?.use { row ->
      while (row.moveToNext() && out.length() < 5000) out.put(JSONObject().put("name", row.getString(0).orEmpty()).put("number", row.getString(1).orEmpty()))
    }
    return out
  }

  private fun calls(context: Context, limit: Int): JSONArray {
    need(context, Manifest.permission.READ_CALL_LOG, "ler as chamadas")
    val out = JSONArray()
    context.contentResolver.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.CACHED_NAME, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION), null, null, "${CallLog.Calls.DATE} DESC")?.use { row ->
      while (row.moveToNext() && out.length() < limit) out.put(JSONObject().put("name", row.getString(0) ?: "UNKNOWN_CALLER").put("phone_number", row.getString(1).orEmpty())
        .put("type", when (row.getInt(2)) { CallLog.Calls.INCOMING_TYPE -> "INCOMING"; CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"; CallLog.Calls.MISSED_TYPE -> "MISSED"; CallLog.Calls.REJECTED_TYPE -> "REJECTED"; CallLog.Calls.BLOCKED_TYPE -> "BLOCKED"; else -> "UNKNOWN" })
        .put("date", date.format(Date(row.getLong(3)))).put("duration", row.getLong(4)))
    }
    return out
  }

  @SuppressLint("MissingPermission")
  private fun location(context: Context, wanted: String): JSONObject {
    need(context, Manifest.permission.ACCESS_FINE_LOCATION, "ver a localização")
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val provider = listOf(wanted, LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).firstOrNull { it in manager.allProviders && manager.isProviderEnabled(it) }
      ?: throw IllegalStateException("A localização do celular está desligada.")
    val found = AtomicReference<Location?>(); val done = CountDownLatch(1)
    val answer = { place: Location? -> found.compareAndSet(null, place); done.countDown() }
    val signal = CancellationSignal()
    var listener: LocationListener? = null
    main.post {
      try {
        if (Build.VERSION.SDK_INT >= 30) manager.getCurrentLocation(provider, signal, { it.run() }) { answer(it) }
        else { val once = LocationListener { answer(it) }; listener = once; @Suppress("DEPRECATION") manager.requestSingleUpdate(provider, once, Looper.getMainLooper()) }
      } catch (_: Exception) { answer(null) }
    }
    done.await(35, TimeUnit.SECONDS)
    signal.cancel(); listener?.let { manager.removeUpdates(it) }
    // A fresh fix can be refused with the app out of sight; the last one known is still the phone's place.
    val place = found.get() ?: manager.allProviders.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
      ?: throw IllegalStateException("Não consegui a localização agora. Com o app fechado, o Android exige \"Permitir o tempo todo\" para o MyBots.")
    return JSONObject().put("latitude", place.latitude).put("longitude", place.longitude).put("altitude", place.altitude).put("accuracy", place.accuracy.toDouble())
      .put("bearing", place.bearing.toDouble()).put("speed", place.speed.toDouble()).put("elapsedMs", (System.currentTimeMillis() - place.time).coerceAtLeast(0)).put("provider", place.provider ?: provider)
  }

  private fun battery(context: Context): JSONObject {
    val info = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: throw IllegalStateException("O Android não informou a bateria.")
    val scale = info.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
    val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    return JSONObject().put("percentage", info.getIntExtra(BatteryManager.EXTRA_LEVEL, 0) * 100 / scale)
      .put("health", when (info.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)) { BatteryManager.BATTERY_HEALTH_GOOD -> "GOOD"; BatteryManager.BATTERY_HEALTH_OVERHEAT -> "OVERHEAT"; BatteryManager.BATTERY_HEALTH_DEAD -> "DEAD"; BatteryManager.BATTERY_HEALTH_COLD -> "COLD"; else -> "UNKNOWN" })
      .put("plugged", when (info.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)) { BatteryManager.BATTERY_PLUGGED_AC -> "PLUGGED_AC"; BatteryManager.BATTERY_PLUGGED_USB -> "PLUGGED_USB"; BatteryManager.BATTERY_PLUGGED_WIRELESS -> "PLUGGED_WIRELESS"; else -> "UNPLUGGED" })
      .put("status", when (info.getIntExtra(BatteryManager.EXTRA_STATUS, 0)) { BatteryManager.BATTERY_STATUS_CHARGING -> "CHARGING"; BatteryManager.BATTERY_STATUS_DISCHARGING -> "DISCHARGING"; BatteryManager.BATTERY_STATUS_FULL -> "FULL"; BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "NOT_CHARGING"; else -> "UNKNOWN" })
      .put("temperature", info.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0).put("current", manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW))
  }

  private fun notice(context: Context, input: JSONObject) {
    val item = input.optJSONObject("notice") ?: throw IllegalArgumentException("Aviso inválido.")
    if (!BotNotifier.show(context, item)) throw IllegalStateException("O Android está bloqueando as notificações do MyBots. Libere em Ajustes → Celular.")
  }
}
