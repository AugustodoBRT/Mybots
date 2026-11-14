package expo.modules.termuxbridge

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.net.URLEncoder

/**
 * One live 3D bot drawn straight to the screen (assets/live3d.html in a transparent WebView), at the display's frame rate. The app's
 * still picture of the bot stays underneath until the first frame is drawn, then this fades in over it. Touches pass through.
 * Props: `bot` (JSON with id, name and face, set once) and `mood`.
 */
class Bot3dView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val main = Handler(Looper.getMainLooper())
  private val onReady by EventDispatcher()
  private var web: WebView? = null
  private var mood = "normal"
  private var loaded: String? = null

  private class Quiet(context: Context) : WebView(context) {
    @SuppressLint("ClickableViewAccessibility") override fun onTouchEvent(event: MotionEvent?) = false
    override fun dispatchTouchEvent(event: MotionEvent?) = false
  }

  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  fun setBot(json: String?) {
    if (json.isNullOrEmpty() || json == loaded) return
    loaded = json
    val bot = try { JSONObject(json) } catch (_: Throwable) { return }
    web?.let { removeView(it); it.destroy() }
    val view = Quiet(context)
    view.settings.javaScriptEnabled = true
    view.setBackgroundColor(0); view.alpha = 0f
    view.isClickable = false; view.isFocusable = false
    view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    view.addJavascriptInterface(object {
      @JavascriptInterface fun shown() { main.post { if (web === view) { view.animate().alpha(1f).setDuration(220).start(); onReady(mapOf("ready" to true)) } } }
    }, "MyBotsLive")
    addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    val q = { value: String -> URLEncoder.encode(value, "UTF-8") }
    view.loadUrl("file:///android_asset/live3d.html?id=${q(bot.optString("id"))}&name=${q(bot.optString("name"))}&face=${q(bot.opt("face")?.toString() ?: "null")}&mood=${q(mood)}")
    web = view
  }

  fun setMood(value: String?) {
    val next = value ?: "normal"
    if (next == mood) return
    mood = next
    web?.evaluateJavascript("window.mybotsLive&&mybotsLive.set(${JSONObject().put("mood", next)})", null)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    web?.let { removeView(it); it.destroy() }; web = null; loaded = null
  }
}
