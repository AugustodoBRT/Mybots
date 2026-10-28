package expo.modules.termuxbridge

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal

/** Private copy of the person's rules, inaccessible to the Termux process. Payments must fail closed until integrated. */
internal object WalletGuard {
  private fun prefs(context: Context) = context.getSharedPreferences("mybots_wallet", Context.MODE_PRIVATE)
  @Synchronized fun rules(context: Context): JSONObject = try {
    JSONObject(prefs(context).getString("rules", "{}") ?: "{}").put("frozen", prefs(context).getBoolean("frozen", true))
  } catch (_: Exception) { JSONObject().put("frozen", true) }
  @Synchronized fun freeze(context: Context) {
    val preferences = prefs(context)
    if (!preferences.edit().putBoolean("frozen", true).putLong("generation", preferences.getLong("generation", 0) + 1).commit())
      throw IllegalStateException("Não consegui congelar a carteira.")
  }
  @Synchronized fun saveFromEditor(context: Context, rules: JSONObject, frozen: Boolean, expectedGeneration: Long) {
    val preferences = prefs(context)
    if (preferences.getLong("generation", 0) != expectedGeneration) throw IllegalArgumentException("A carteira mudou enquanto você editava. Abra as regras novamente.")
    if (!preferences.edit().putString("rules", rules.toString()).putBoolean("frozen", frozen)
        .putLong("generation", preferences.getLong("generation", 0) + 1).commit())
      throw IllegalStateException("Não consegui salvar as regras da carteira.")
  }
  /** Which bots may pay with each card: card id → bot ids. A card nobody chose is used by no bot. */
  @Synchronized fun cardBots(context: Context): JSONObject = try { JSONObject(prefs(context).getString("cardBots", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
  @Synchronized fun setCardBots(context: Context, cardId: String, bots: List<String>) {
    val preferences = prefs(context)
    val all = cardBots(context)
    if (bots.isEmpty()) all.remove(cardId) else all.put(cardId, JSONArray(bots.distinct().take(100)))
    // Changing who may pay counts as a change of the rules: payments booked before it stop being valid.
    if (!preferences.edit().putString("cardBots", all.toString()).putLong("generation", preferences.getLong("generation", 0) + 1).commit())
      throw IllegalStateException("Não consegui salvar os bots do cartão.")
  }
  @Synchronized fun forgetCard(context: Context, cardId: String) {
    if (cardBots(context).has(cardId)) setCardBots(context, cardId, emptyList())
  }
  /** The cards a bot may use, by id. */
  @Synchronized fun cardsOf(context: Context, botId: String): List<String> {
    val all = cardBots(context)
    return all.keys().asSequence().filter { key -> all.optJSONArray(key)?.let { array -> (0 until array.length()).any { array.optString(it) == botId } } == true }.toList()
  }
  @Synchronized fun generation(context: Context): Long = prefs(context).getLong("generation", 0)
  @Synchronized fun snapshot(context: Context): Pair<JSONObject, Long> = rules(context) to generation(context)
}

/** Only a person in the app can edit the rules or unfreeze the wallet. */
internal object WalletRulesEditor {
  @Volatile var active = false
    private set

  fun show(activity: Activity, promise: Promise) {
    activity.runOnUiThread {
      if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread promise.reject("NO_ACTIVITY", "Abra o MyBots para editar a carteira.", null)
      if (active || CardEditor.active) return@runOnUiThread promise.reject("BUSY", "Outra edição protegida já está aberta.", null)
      val (current, generation) = WalletGuard.snapshot(activity.applicationContext)
      val fields = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        val pad = (24 * resources.displayMetrics.density).toInt()
        setPadding(pad, 0, pad, 0)
      }
      fun amount(key: String): String = current.optLong(key, 0).takeIf { it > 0 }?.let { "${it / 100},${(it % 100).toString().padStart(2, '0')}" } ?: ""
      fun field(label: String, value: String, type: Int): EditText = EditText(activity).apply {
        hint = label; inputType = type
        if (android.os.Build.VERSION.SDK_INT >= 26) imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        setText(value); fields.addView(this)
      }
      fun entries(key: String): String = current.optJSONArray(key)?.let { array -> (0 until array.length()).map { array.optString(it) }.joinToString(", ") } ?: ""
      val purchase = field("Máximo por compra (R$)", amount("perPurchase"), InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
      val day = field("Máximo por dia (R$)", amount("perDay"), InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
      val month = field("Máximo por mês (R$)", amount("perMonth"), InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
      val allowed = field("Lojas permitidas (vazio = qualquer loja; domínios separados por vírgula)", entries("allowedStores"), InputType.TYPE_CLASS_TEXT)
      val blocked = field("Lojas proibidas (domínios separados por vírgula)", entries("blockedStores"), InputType.TYPE_CLASS_TEXT)
      val categories = field("Categorias permitidas (vazio = qualquer uma; separadas por vírgula)", entries("categories"), InputType.TYPE_CLASS_TEXT)
      val frozen = CheckBox(activity).apply { text = "Carteira congelada"; isChecked = current.optBoolean("frozen", true); fields.addView(this) }
      val dialog = AlertDialog.Builder(activity).setTitle("Regras da carteira")
        .setMessage("As regras ficam só neste celular e nenhum bot consegue mudá-las. Os três limites valem sempre; lojas permitidas e categorias vazias liberam qualquer uma, e as lojas proibidas continuam barradas. Desmarque “Carteira congelada” para os bots poderem pagar.")
        .setView(ScrollView(activity).apply { addView(fields) }).setNegativeButton("Cancelar") { _, _ -> }
        .setPositiveButton("Salvar", null).create()
      var settled = false
      dialog.setOnDismissListener { active = false; WalletEditorGate.close(); if (!settled) { settled = true; promise.resolve(null) } }
      dialog.setOnShowListener {
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
          try {
            fun cents(input: EditText): Long {
              val text = input.text.toString().trim().replace(',', '.')
              if (!text.matches(Regex("[0-9]{1,10}(?:\\.[0-9]{1,2})?"))) throw IllegalArgumentException("Informe os três limites em reais.")
              val value = BigDecimal(text).movePointRight(2).longValueExact()
              if (value <= 0 || value > 9007199254740991L) throw IllegalArgumentException("Informe limites maiores que zero.")
              return value
            }
            fun strings(input: EditText) = input.text.toString().split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
            fun hosts(input: EditText) = strings(input).map { site ->
              val host = PasswordVault.hostOf(site)
              if (site.lowercase().trimEnd('.') != host) throw IllegalArgumentException("Informe apenas o domínio das lojas, sem caminho ou endereço completo.")
              host
            }
            val allow = hosts(allowed); val block = hosts(blocked); val cats = strings(categories)
            if (cats.any { it.length > 100 }) throw IllegalArgumentException("Cada categoria pode ter até 100 letras.")
            val rules = JSONObject().put("perPurchase", cents(purchase)).put("perDay", cents(day)).put("perMonth", cents(month))
              .put("allowedStores", JSONArray(allow)).put("blockedStores", JSONArray(block)).put("categories", JSONArray(cats))
            WalletGuard.saveFromEditor(activity.applicationContext, rules, frozen.isChecked, generation)
            settled = true; promise.resolve(true); dialog.dismiss()
          } catch (error: Exception) {
            Toast.makeText(activity, if (error is IllegalArgumentException) error.message ?: "Confira as regras." else "Não consegui salvar as regras da carteira.", Toast.LENGTH_LONG).show()
          }
        }
      }
      if (!WalletEditorGate.open()) { promise.reject("BUSY", "Aguarde o controle do celular terminar.", null); return@runOnUiThread }
      active = true
      try { dialog.show() } catch (_: Exception) { active = false; WalletEditorGate.close(); promise.reject("DIALOG", "Não consegui abrir as regras da carteira.", null) }
    }
  }
}
