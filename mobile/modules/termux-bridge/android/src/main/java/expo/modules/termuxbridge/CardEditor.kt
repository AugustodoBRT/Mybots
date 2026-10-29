package expo.modules.termuxbridge

import android.app.Activity
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

  fun show(activity: Activity, promise: Promise, light: Boolean = false) {
    activity.runOnUiThread {
      if (activity.isFinishing || activity.isDestroyed) {
        promise.reject("NO_ACTIVITY", "Abra o MyBots para cadastrar o cartão.", null)
        return@runOnUiThread
      }
      if (active || WalletRulesEditor.active) {
        promise.reject("BUSY", "O cadastro de cartão já está aberto.", null)
        return@runOnUiThread
      }
      val ui = AppDialogUi(activity, light)
      lateinit var label: EditText; lateinit var number: EditText; lateinit var month: EditText; lateinit var year: EditText; lateinit var cvv: EditText; lateinit var name: EditText; lateinit var address: EditText
      // Sensitive fields: no suggestions, no autofill, nothing saved in the view state.
      fun EditText.guard(): EditText { inputType = inputType or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        if (android.os.Build.VERSION.SDK_INT >= 26) importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
        isSaveEnabled = false; return this }
      val secret = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
      var settled = false
      lateinit var dialog: android.app.Dialog
      dialog = ui.build("Novo cartão", "Os dados ficam protegidos neste celular; nenhum bot nem a IA enxerga o número, a validade ou o código.", "Salvar", true,
        fill = { form ->
          label = ui.field(form, "Apelido (opcional)", "Ex.: Nubank compras", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).guard()
          number = ui.field(form, "Número do cartão", "0000 0000 0000 0000", "", secret).guard()
          val columns = ui.row(form, 1f, 1.3f, 1f)
          month = ui.field(columns[0], "Mês", "MM", "", InputType.TYPE_CLASS_NUMBER).guard()
          year = ui.field(columns[1], "Ano", "AAAA", "", InputType.TYPE_CLASS_NUMBER).guard()
          cvv = ui.field(columns[2], "CVV", "000", "", secret).guard()
          name = ui.field(form, "Nome no cartão", "Como está impresso", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).guard()
          address = ui.field(form, "Endereço de cobrança completo", "Rua, número, cidade, CEP", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).guard()
        },
        save = {
          try {
            val id = PasswordVault.saveCard(activity.applicationContext, number.text.toString(), month.text.toString().toIntOrNull() ?: 0,
              year.text.toString().toIntOrNull() ?: 0, cvv.text.toString(), name.text.toString(), address.text.toString(), label.text.toString())
            settled = true; promise.resolve(id); true
          } catch (error: IllegalArgumentException) {
            android.widget.Toast.makeText(activity, error.message ?: "Confira os dados do cartão.", android.widget.Toast.LENGTH_LONG).show(); false
          } catch (_: Exception) {
            android.widget.Toast.makeText(activity, "Não consegui guardar o cartão protegido.", android.widget.Toast.LENGTH_LONG).show(); false
          }
        },
        onClosed = {
          listOf(label, number, month, year, cvv, name, address).forEach { it.text?.clear() }
          active = false
          WalletEditorGate.close()
          if (!settled) { settled = true; promise.resolve(null) }
        })
      if (!WalletEditorGate.open()) { promise.reject("BUSY", "Aguarde o controle do celular terminar.", null); return@runOnUiThread }
      active = true
      try { dialog.show() } catch (_: Exception) { active = false; WalletEditorGate.close(); promise.reject("DIALOG", "Não consegui abrir o cadastro de cartão.", null) }
    }
  }
}
