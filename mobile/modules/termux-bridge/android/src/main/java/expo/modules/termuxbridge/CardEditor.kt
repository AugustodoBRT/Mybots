package expo.modules.termuxbridge

import android.app.Activity
import android.app.AlertDialog
import android.text.InputType
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import expo.modules.kotlin.Promise

/** The card form lives entirely in Android views; no card fields cross the JavaScript bridge. */
internal object CardEditor {
  @Volatile var active = false
    private set

  fun show(activity: Activity, promise: Promise) {
    activity.runOnUiThread {
      if (activity.isFinishing || activity.isDestroyed) {
        promise.reject("NO_ACTIVITY", "Abra o MyBots para cadastrar o cartão.", null)
        return@runOnUiThread
      }
      if (active || WalletRulesEditor.active) {
        promise.reject("BUSY", "O cadastro de cartão já está aberto.", null)
        return@runOnUiThread
      }
      val fields = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        val pad = (24 * resources.displayMetrics.density).toInt()
        setPadding(pad, 0, pad, 0)
      }
      fun field(label: String, type: Int): EditText = EditText(activity).apply {
        hint = label
        inputType = type or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        if (android.os.Build.VERSION.SDK_INT >= 26) imeOptions = imeOptions or android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        if (android.os.Build.VERSION.SDK_INT >= 26) importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
        isSaveEnabled = false
        fields.addView(this)
      }
      val label = field("Apelido (opcional, ex.: Nubank compras)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
      val number = field("Número do cartão", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD)
      val month = field("Mês de validade (MM)", InputType.TYPE_CLASS_NUMBER)
      val year = field("Ano de validade (AAAA)", InputType.TYPE_CLASS_NUMBER)
      val cvv = field("Código de segurança (CVV)", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD)
      val name = field("Nome no cartão", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
      val address = field("Endereço de cobrança completo", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
      val scroll = ScrollView(activity).apply { addView(fields) }
      var settled = false
      val dialog = AlertDialog.Builder(activity).setTitle("Novo cartão")
        .setMessage("Os dados ficam protegidos neste celular.").setView(scroll)
        .setNegativeButton("Cancelar") { _, _ -> }
        .setPositiveButton("Salvar", null).create()
      dialog.window?.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
      dialog.setOnDismissListener {
        listOf(label, number, month, year, cvv, name, address).forEach { it.text?.clear() }
        active = false
        WalletEditorGate.close()
        if (!settled) { settled = true; promise.resolve(null) }
      }
      dialog.setOnShowListener {
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
          try {
            val id = PasswordVault.saveCard(activity.applicationContext, number.text.toString(), month.text.toString().toIntOrNull() ?: 0,
              year.text.toString().toIntOrNull() ?: 0, cvv.text.toString(), name.text.toString(), address.text.toString(), label.text.toString())
            settled = true
            promise.resolve(id)
            dialog.dismiss()
          } catch (error: IllegalArgumentException) {
            android.widget.Toast.makeText(activity, error.message ?: "Confira os dados do cartão.", android.widget.Toast.LENGTH_LONG).show()
          } catch (_: Exception) {
            android.widget.Toast.makeText(activity, "Não consegui guardar o cartão protegido.", android.widget.Toast.LENGTH_LONG).show()
          }
        }
      }
      if (!WalletEditorGate.open()) { promise.reject("BUSY", "Aguarde o controle do celular terminar.", null); return@runOnUiThread }
      active = true
      try { dialog.show() } catch (_: Exception) { active = false; WalletEditorGate.close(); promise.reject("DIALOG", "Não consegui abrir o cadastro de cartão.", null) }
    }
  }
}
