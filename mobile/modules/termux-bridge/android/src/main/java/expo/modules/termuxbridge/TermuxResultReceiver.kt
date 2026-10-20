package expo.modules.termuxbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle

class TermuxResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val requestId = intent.getStringExtra("mybots.requestId") ?: return
    val result = intent.getBundleExtra("result")
    val values = mapOf(
      "exitCode" to (result?.getInt("exitCode") ?: -1),
      "stdout" to (result?.getString("stdout") ?: ""),
      "stderr" to (result?.getString("stderr") ?: ""),
      "errorCode" to (result?.getInt("err") ?: -1),
      "errorMessage" to (result?.getString("errmsg") ?: "")
    )
    if (requestId.startsWith("keepalive-")) KeepAlive.restartFinished(context.applicationContext, values)
    else TermuxBridgeModule.finish(requestId, values)
  }
}
