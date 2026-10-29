package expo.modules.termuxbridge

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

/**
 * The look of the wallet's protected forms (card and rules): the app's colors, round boxes and pill buttons, in native views
 * (what is typed here never goes through JavaScript). `light` follows the app's theme, which the screen tells at the call.
 */
internal class AppDialogUi(private val activity: Activity, private val light: Boolean) {
  private val density = activity.resources.displayMetrics.density
  fun dp(value: Int) = (value * density).toInt()
  val bg = if (light) 0xFFFAF8F4.toInt() else 0xFF0A0A0C.toInt()
  val box = if (light) 0xFFF1EEE8.toInt() else 0xFF19191D.toInt()
  val line = if (light) 0xFFE4E0D7.toInt() else 0xFF27272D.toInt()
  val line2 = if (light) 0xFFCFCABF.toInt() else 0xFF37373F.toInt()
  val ink = if (light) 0xFF1B1A17.toInt() else 0xFFF6F4EF.toInt()
  val muted = if (light) 0xFF5F5B53.toInt() else 0xFFABA79E.toInt()
  val accent = if (light) 0xFFA85600.toInt() else 0xFFFF9F1C.toInt()
  val accentInk = if (light) 0xFFFFFFFF.toInt() else 0xFF241500.toInt()

  fun shape(color: Int, radiusDp: Int, strokeColor: Int? = null) = GradientDrawable().apply {
    setColor(color); cornerRadius = dp(radiusDp).toFloat(); if (strokeColor != null) setStroke(dp(1), strokeColor)
  }
  fun label(parent: ViewGroup, value: String) = TextView(activity).apply {
    this.text = value; setTextColor(muted); textSize = 13f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14); bottomMargin = dp(6) }; parent.addView(this)
  }
  fun note(parent: ViewGroup, value: String, top: Int = 12) = TextView(activity).apply {
    this.text = value; setTextColor(muted); textSize = 13.5f; setLineSpacing(0f, 1.15f)
    layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }; parent.addView(this)
  }
  /** A labeled round box in `parent`; the caller adds its own flags (no suggestions, no autofill) when the field is sensitive. */
  fun field(parent: ViewGroup, caption: String, hint: String, value: String, type: Int): EditText {
    label(parent, caption)
    return EditText(activity).apply {
      this.hint = hint; inputType = type; setText(value); setTextColor(ink); setHintTextColor(muted and 0x00FFFFFF or 0x88000000.toInt()); textSize = 16f
      background = shape(box, 14, line); setPadding(dp(14), dp(13), dp(14), dp(13)); isSingleLine = true
      imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
      layoutParams = LinearLayout.LayoutParams(-1, -2); parent.addView(this)
    }
  }
  fun row(parent: ViewGroup, vararg columns: Float): List<LinearLayout> {
    val line = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(-1, -2); parent.addView(this) }
    return columns.mapIndexed { index, weight ->
      LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, -2, weight).apply { if (index > 0) marginStart = dp(10) }; line.addView(this) }
    }
  }
  fun switchRow(parent: ViewGroup, title: String, subtitle: String, checked: Boolean): Switch {
    val holder = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
      background = shape(box, 14, line); setPadding(dp(14), dp(12), dp(14), dp(12)); layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(18) }; parent.addView(this) }
    val copy = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f); holder.addView(this) }
    TextView(activity).apply { this.text = title; setTextColor(ink); textSize = 15.5f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); copy.addView(this) }
    TextView(activity).apply { this.text = subtitle; setTextColor(muted); textSize = 13f; copy.addView(this) }
    return Switch(activity).apply { isChecked = checked; holder.addView(this) }
  }
  private fun button(value: String, filled: Boolean) = TextView(activity).apply {
    this.text = value; textSize = 15.5f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); gravity = Gravity.CENTER; minHeight = dp(48)
    setPadding(dp(22), 0, dp(22), 0); setTextColor(if (filled) accentInk else ink)
    background = if (filled) shape(accent, 24) else shape(Color.TRANSPARENT, 24, line2)
  }

  /** The dialog: a title, a line under it, the form (`fill` adds to it) and the two buttons; `save` returns true to close. */
  fun build(title: String, message: String, positive: String, secure: Boolean, fill: (LinearLayout) -> Unit, save: () -> Boolean, onClosed: () -> Unit): Dialog {
    val dialog = Dialog(activity)
    dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
    val form = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }; fill(form)
    val cap = (activity.resources.displayMetrics.heightPixels * 0.58).toInt()
    val scroll = object : ScrollView(activity) {
      override fun onMeasure(w: Int, h: Int) = super.onMeasure(w, View.MeasureSpec.makeMeasureSpec(cap, View.MeasureSpec.AT_MOST))
    }.apply { isVerticalScrollBarEnabled = false; addView(form) }
    val card = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; background = shape(bg, 26, line); setPadding(dp(22), dp(24), dp(22), dp(20)) }
    TextView(activity).apply { this.text = title; setTextColor(ink); textSize = 22f; typeface = Typeface.create("sans-serif-medium", Typeface.BOLD); card.addView(this) }
    note(card, message, 6)
    card.addView(scroll)
    val cancel = button("Cancelar", false); val ok = button(positive, true)
    LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END; layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(18) }
      addView(cancel); addView(ok, LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(10) }); card.addView(this) }
    cancel.setOnClickListener { dialog.dismiss() }
    ok.setOnClickListener { if (save()) dialog.dismiss() }
    dialog.setContentView(card)
    dialog.window?.apply {
      setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT)); setDimAmount(0.6f); addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      setLayout((activity.resources.displayMetrics.widthPixels * 0.92).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
      setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN)
      if (secure) setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }
    dialog.setOnDismissListener { onClosed() }
    return dialog
  }
}
