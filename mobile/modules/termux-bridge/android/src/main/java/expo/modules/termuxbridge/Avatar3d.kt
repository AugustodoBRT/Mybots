package expo.modules.termuxbridge

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONTokener

/**
 * The 3D bots on the phone: the same three.js body the computer draws (assets/avatar3d.html, built by scripts/build-avatar3d.mjs), run in
 * one hidden WebView. The app asks for a picture of a bot at a size and a moment and gets a WebP data URL back; the screens show it as an
 * image, so a long list costs one WebView, not one per bot. Created on first use and only when the person has 3D on.
 */
internal object Avatar3d {
  private val main = Handler(Looper.getMainLooper())
  private var web: WebView? = null
  private var ready = false
  private var failed = false
  private val waiting = ArrayList<() -> Unit>()

  @SuppressLint("SetJavaScriptEnabled")
  private fun ensure(activity: Activity, then: () -> Unit) {
    if (failed) return
    if (ready) { then(); return }
    waiting.add(then)
    if (web != null) return
    try {
      val view = WebView(activity)
      view.settings.javaScriptEnabled = true
      view.settings.cacheMode = WebSettings.LOAD_NO_CACHE
      view.setBackgroundColor(0)
      view.alpha = 0f
      view.isClickable = false; view.isFocusable = false
      view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      view.webViewClient = object : WebViewClient() {
        override fun onPageFinished(page: WebView?, url: String?) { ready = true; val todo = ArrayList(waiting); waiting.clear(); todo.forEach { it() } }
      }
      // Attached to the window (a detached WebView stops drawing) but one pixel big, invisible and out of the way.
      activity.addContentView(view, FrameLayout.LayoutParams(2, 2))
      view.loadUrl("file:///android_asset/avatar3d.html")
      web = view
    } catch (_: Throwable) { failed = true; waiting.clear() }
  }

  /** `json` is the argument of mybots3d.render. Answers the data URL, or null when the picture could not be made. */
  fun render(activity: Activity?, json: String, done: (String?) -> Unit) {
    if (activity == null) { done(null); return }
    main.post {
      ensure(activity) {
        val view = web
        if (view == null) done(null)
        else view.evaluateJavascript("(function(){try{return mybots3d.render($json)}catch(e){return ''}})()") { value ->
          val text = try { JSONTokener(value ?: "").nextValue() as? String } catch (_: Throwable) { null }
          done(if (text.isNullOrEmpty()) null else text)
        }
      }
    }
  }

  /** The 3D body needs a WebView that can run WebGL; without one the flat face stays. */
  fun available(context: Context): Boolean = try { WebView.getCurrentWebViewPackage() != null } catch (_: Throwable) { false }
}
