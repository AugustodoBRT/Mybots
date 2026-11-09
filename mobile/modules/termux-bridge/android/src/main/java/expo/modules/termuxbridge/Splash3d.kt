package expo.modules.termuxbridge

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import java.net.URLEncoder

/**
 * The opening screen's 3D bot (assets/splash3d.html): a visible, transparent WebView in the middle of the screen, over the app's own
 * opening screen (which draws the background and the words). It shows itself once the first frame is drawn; `finish` plays the bot's last
 * jump and calls back when it lands, and `hide` fades it out and removes it. Touches pass through it.
 */
internal object Splash3d {
  private val main = Handler(Looper.getMainLooper())
  private var web: WebView? = null
  private var finished: (() -> Unit)? = null

  private class Quiet(activity: Activity) : WebView(activity) {
    @SuppressLint("ClickableViewAccessibility") override fun onTouchEvent(event: MotionEvent?) = false
    override fun dispatchTouchEvent(event: MotionEvent?) = false
  }

  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  fun show(activity: Activity?, size: Int, offset: Int, id: String, name: String, face: String) {
    if (activity == null) return
    main.post {
      if (web != null) return@post
      try {
        val view = Quiet(activity)
        view.settings.javaScriptEnabled = true
        view.setBackgroundColor(0); view.alpha = 0f
        view.isClickable = false; view.isFocusable = false
        view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        view.addJavascriptInterface(object {
          @JavascriptInterface fun shown() { main.post { web?.animate()?.alpha(1f)?.setDuration(220)?.start() } }
          @JavascriptInterface fun done() { main.post { val then = finished; finished = null; then?.invoke() } }
        }, "MyBotsSplash")
        val params = FrameLayout.LayoutParams(size, size, Gravity.CENTER).apply { topMargin = offset }
        activity.addContentView(view, params)
        val q = { value: String -> URLEncoder.encode(value, "UTF-8") }
        view.loadUrl("file:///android_asset/splash3d.html?id=${q(id)}&name=${q(name)}&face=${q(face)}")
        web = view
      } catch (_: Throwable) { web = null }
    }
  }

  /** The app is ready: the bot jumps one last time; `done` runs when it lands (at once if there is no bot, and at most after 2.5 s). */
  fun finish(done: () -> Unit) {
    main.post {
      val view = web
      if (view == null || view.alpha == 0f) { done(); return@post }
      var called = false
      val once = { if (!called) { called = true; done() } }
      finished = once
      main.postDelayed({ once() }, 2500)
      view.evaluateJavascript("window.mybotsSplash&&mybotsSplash.finish()", null)
    }
  }

  fun hide(ms: Long) {
    main.post {
      val view = web ?: return@post
      web = null; finished = null
      view.animate().alpha(0f).setDuration(ms).withEndAction {
        (view.parent as? ViewGroup)?.removeView(view)
        try { view.destroy() } catch (_: Throwable) {}
      }.start()
    }
  }
}
