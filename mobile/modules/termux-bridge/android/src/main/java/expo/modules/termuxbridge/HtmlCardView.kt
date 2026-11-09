package expo.modules.termuxbridge

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayInputStream

/**
 * A small page a bot made for the canvas (a panel, a prototype, a calculator), shown isolated: JavaScript runs, but nothing leaves
 * the phone (every request is answered empty), there is no file or content access, no storage and no bridge to the app. On the
 * canvas it is a picture that lets touches pass through; opened in full screen (`interactive`), the person can use it.
 * Props: `html` (the whole page, already wrapped with its Content-Security-Policy) and `interactive`.
 */
class HtmlCardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private var interactive = false
  private var shown: String? = null

  private inner class Page(context: Context) : WebView(context) {
    @SuppressLint("ClickableViewAccessibility") override fun onTouchEvent(event: MotionEvent?) = if (interactive) super.onTouchEvent(event) else false
    override fun dispatchTouchEvent(event: MotionEvent?) = if (interactive) super.dispatchTouchEvent(event) else false
  }

  @SuppressLint("SetJavaScriptEnabled")
  private val web = Page(context).apply {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = false
    settings.databaseEnabled = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.blockNetworkLoads = true
    settings.cacheMode = WebSettings.LOAD_NO_CACHE
    settings.javaScriptCanOpenWindowsAutomatically = false
    settings.setSupportMultipleWindows(false)
    setBackgroundColor(0xFFFFFFFF.toInt())
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    webViewClient = object : WebViewClient() {
      private fun empty() = WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(ByteArray(0)))
      // Inline data only: anything else (http, file, content, intent) gets nothing back.
      override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
        if (request?.url?.scheme == "data" || request?.url?.scheme == "blob") null else empty()
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
    }
  }

  init { addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)) }

  fun setHtml(value: String?) {
    val page = value ?: ""
    if (page == shown) return
    shown = page
    web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
  }

  fun setInteractive(value: Boolean?) {
    interactive = value == true
    web.isClickable = interactive; web.isFocusable = interactive; web.isFocusableInTouchMode = interactive
    importantForAccessibility = if (interactive) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    web.stopLoading()
  }
}
