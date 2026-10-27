package expo.modules.termuxbridge

import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.kotlin.Promise
import android.app.Activity
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import android.os.Bundle
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private data class TermuxCommand(val path: String, val args: Array<String>, val stdin: String?, val timeoutMs: Long)

internal const val TERMUX_PACKAGE = "com.termux"
internal const val RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND"
private const val TERMUX_PREFIX = "/data/data/com.termux/files/usr"
internal const val TERMUX_BASH = "$TERMUX_PREFIX/bin/bash"
internal const val TERMUX_TIMEOUT = "$TERMUX_PREFIX/bin/timeout"

internal fun runCommandIntent(path: String, args: Array<String>, stdin: String?, result: PendingIntent, label: String) = Intent().apply {
  component = ComponentName(TERMUX_PACKAGE, "com.termux.app.RunCommandService")
  action = "com.termux.RUN_COMMAND"
  putExtra("com.termux.RUN_COMMAND_PATH", path)
  putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args)
  putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
  putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
  putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
  putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", result)
  putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", label)
  stdin?.let { putExtra("com.termux.RUN_COMMAND_STDIN", it) }
}

// A plain startService is refused while MyBots is in the background (screen off, app minimized);
// Termux's RunCommandService promotes itself to the foreground, as its docs require for this call.
internal fun startTermux(context: Context, intent: Intent) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
}

class TermuxBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TermuxBridge")
    Events("onSpeech", "onOpenBot", "onShare", "onUpdate", "onPasswordOffer")

    // Tapping a bot notification opens MyBots on that bot; the app may be closed (launch intent) or running (new intent).
    OnActivityEntersForeground {
      appContext.reactContext?.let { BotNotifier.start(it.applicationContext); BotBrowser.start(it.applicationContext); WidgetSync.start(it.applicationContext) }
      appContext.currentActivity?.intent?.let { intent ->
        intent.getStringExtra("mybotsBotId")?.takeIf { it.isNotEmpty() }?.let { launchBot = it; intent.removeExtra("mybotsBotId") }
        receiveShare(intent)
      }
    }
    OnNewIntent { intent ->
      intent.getStringExtra("mybotsBotId")?.takeIf { it.isNotEmpty() }?.let { launchBot = it; sendEvent("onOpenBot", mapOf("botId" to it)) }
      receiveShare(intent)
    }
    // Something shared from another app; the conversation shows it in the composer before anything is sent.
    AsyncFunction("takeShare") {
      appContext.currentActivity?.intent?.let { receiveShare(it) }
      if (sharing) null else ShareIntake.take()
    }
    // Updates from the project's GitHub Releases: check, then download, verify and hand to Android's installer.
    OnCreate { AppUpdate.listener = { event -> sendEvent("onUpdate", event) }; PasswordVault.offerListener = { event -> sendEvent("onPasswordOffer", event) } }
    AsyncFunction("updateCheck") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("NOT_READY", "O MyBots não está pronto.", null)
      Thread {
        try { promise.resolve(AppUpdate.check(context.applicationContext) + mapOf("canInstall" to AppUpdate.canInstall(context.applicationContext))) }
        catch (error: Exception) { promise.reject("UPDATE", if (error is java.io.IOException) "Sem conexão com o GitHub agora. Tente de novo mais tarde." else error.message ?: "Não consegui procurar atualizações.", error) }
      }.start()
    }
    AsyncFunction("updateCanInstall") { appContext.reactContext?.let { AppUpdate.canInstall(it.applicationContext) } ?: false }
    AsyncFunction("updateInstall") { apkUrl: String, shaUrl: String, promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("NOT_READY", "O MyBots não está pronto.", null)
      val app = context.applicationContext
      if (!AppUpdate.canInstall(app)) { AppUpdate.openInstallPermission(app); return@AsyncFunction promise.resolve("permission") }
      Thread {
        try { promise.resolve(AppUpdate.download(app, apkUrl, shaUrl)) }
        catch (error: Exception) {
          val message = if (error is java.io.IOException) "A conexão caiu durante o download. Tente de novo." else error.message ?: "Não consegui atualizar."
          AppUpdate.listener?.invoke(mapOf("state" to "error", "message" to message)); promise.reject("UPDATE", message, error)
        }
      }.start()
    }
    // The home-screen widget: how many are placed, and Android's "add to home screen" request.
    AsyncFunction("widgetStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val manager = android.appwidget.AppWidgetManager.getInstance(context)
      mapOf("placed" to WidgetSync.ids(context).size, "canPin" to (Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported))
    }
    AsyncFunction("requestWidget") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val manager = android.appwidget.AppWidgetManager.getInstance(context)
      Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported &&
        manager.requestPinAppWidget(ComponentName(context, MyBotsWidget::class.java), null, null)
    }
    // Saved site logins (Ajustes → Senhas). The list never includes the passwords.
    AsyncFunction("passwordsList") { PasswordVault.list(appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")) }
    AsyncFunction("passwordSave") { site: String, username: String, password: String, bots: List<String>? ->
      PasswordVault.save(appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto."), site, username, password, bots)
    }
    // A password export file (CSV): read and parsed here, so the passwords never pass through the app's JavaScript.
    AsyncFunction("passwordImport") { bots: List<String>?, promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("NO_ACTIVITY", "Abra o MyBots para escolher o arquivo.", null)
      if (passwordPicker.getAndSet(promise) != null) return@AsyncFunction promise.reject("BUSY", "Já estou escolhendo um arquivo.", null)
      importBots = bots
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel", "application/octet-stream"))
      try { activity.startActivityForResult(intent, PICK_PASSWORDS) } catch (error: Exception) { passwordPicker.set(null); promise.reject("PICKER", "Não encontrei um seletor de arquivos neste celular.", error) }
    }
    // The export holds every password in plain text: after importing, the person can delete it right here.
    AsyncFunction("passwordImportDelete") {
      val uri = importedFile ?: return@AsyncFunction false
      importedFile = null
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      try { android.provider.DocumentsContract.deleteDocument(context.contentResolver, uri) } catch (_: Exception) { false }
    }
    AsyncFunction("passwordDelete") { id: String -> PasswordVault.delete(appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto."), id) }
    AsyncFunction("passwordOffer") { PasswordVault.pendingOffer() }
    AsyncFunction("passwordOfferAnswer") { scope: String ->
      PasswordVault.takeOffer(appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto."), scope)
    }
    AsyncFunction("publishShareTargets") { bots: List<Map<String, Any?>> ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      Thread { ShareIntake.publish(context.applicationContext, bots) }.start()
      true
    }
    AsyncFunction("takeLaunchBot") {
      appContext.currentActivity?.intent?.let { intent ->
        intent.getStringExtra("mybotsBotId")?.takeIf { it.isNotEmpty() }?.let { launchBot = it; intent.removeExtra("mybotsBotId") }
      }
      val bot = launchBot; launchBot = null; bot
    }

    // When the app is open the supervisor hands notices over the WebSocket and the app shows them here.
    AsyncFunction("showBotNotification") { item: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      BotNotifier.show(context.applicationContext, JSONObject(item))
    }
    AsyncFunction("botNotificationStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      val channel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.getNotificationChannel("mybots_bots") else null
      BotNotifier.start(context.applicationContext)
      mapOf("enabled" to manager.areNotificationsEnabled(), "channelBlocked" to (channel?.importance == android.app.NotificationManager.IMPORTANCE_NONE), "polling" to BotNotifier.polling)
    }
    AsyncFunction("openNotificationSettings") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    // Each bot's browser (etapa B): the live panel, its state and the controls the person uses after "Assumir".
    View(BotBrowserView::class) {
      Events("onPage")
      Prop("botId") { view: BotBrowserView, id: String? -> view.show(id) }
      Prop("interactive") { view: BotBrowserView, value: Boolean -> view.interactive = value }
    }
    View(BotFrameView::class) {
      Events("onMetadata")
      Prop("botId") { view: BotFrameView, id: String? -> view.show(id) }
    }
    Function("browserPresentation") { on: Boolean ->
      appContext.currentActivity?.let { activity ->
        activity.requestedOrientation = if (on) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      }
    }
    AsyncFunction("browserInfo") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      BotBrowser.start(context.applicationContext)
      mapOf("isolated" to BotBrowser.isolated, "polling" to BotBrowser.polling)
    }
    AsyncFunction("browserAction") { botId: String, action: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      BotBrowser.action(context.applicationContext, botId, action)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    // Files a bot sends (or the person attached): staged in chunks, then opened, shared or saved to Downloads.
    AsyncFunction("fileStage") { id: String, name: String, chunk: String, append: Boolean ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      DeviceFiles.stage(context.applicationContext, id, name, chunk, append)
    }
    AsyncFunction("fileAction") { id: String, name: String, mime: String, action: String ->
      val context = appContext.currentActivity ?: appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      DeviceFiles.act(context, id, name, mime, action)
    }

    AsyncFunction("readStore") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val file = File(context.filesDir, "mybots-local.json")
      if (!file.exists()) "{\"schema\":1,\"mode\":\"computer\",\"bots\":[]}" else {
        val backup = File(context.filesDir, "backup/pre-v8.json")
        if (!backup.exists()) {
          backup.parentFile?.mkdirs()
          FileOutputStream(backup).use { stream -> stream.write(file.readBytes()); stream.fd.sync() }
        }
        file.readText(Charsets.UTF_8)
      }
    }

    AsyncFunction("writeStore") { value: String ->
      if (value.length > 20_000_000) throw IllegalArgumentException("O histórico local está grande demais para salvar.")
      val parsed = JSONObject(value)
      if (parsed.optInt("schema") != 1 || !parsed.optJSONArray("bots").let { it != null }) {
        throw IllegalArgumentException("O arquivo local do MyBots tem um formato inválido.")
      }
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val file = File(context.filesDir, "mybots-local.json")
      val temporary = File(context.filesDir, "mybots-local.json.tmp")
      FileOutputStream(temporary).use { stream ->
        stream.write(value.toByteArray(Charsets.UTF_8))
        stream.fd.sync()
      }
      android.system.Os.rename(temporary.absolutePath, file.absolutePath)
      true
    }

    AsyncFunction("readPairing") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val release = context.assets.open("mybots-supervisor.sha256").bufferedReader().use { it.readText().trim() }
      val saved = pairingPreferences(context)
      val token = saved.getString("token", null)
      if (token == null || saved.getString("release", null) != release) null
      else mapOf("port" to saved.getInt("port", 3219), "token" to token, "release" to release)
    }

    AsyncFunction("savePairing") { value: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val encrypted = value["encryptedToken"] as? String ?: throw IllegalArgumentException("Pareamento inválido.")
      val port = (value["port"] as? Number)?.toInt() ?: 0
      val release = value["release"] as? String ?: ""
      val token = storePairing(context, encrypted, port, release)
      mapOf("port" to port, "token" to token, "release" to release)
    }

    // Key for the supervisor's encrypted secrets. It never leaves the app except over the authenticated
    // local WebSocket, so a Termux file alone cannot reveal the e-mail password.
    AsyncFunction("secretsKey") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val saved = pairingPreferences(context)
      saved.getString("secrets_key", null) ?: run {
        val key = Base64.encodeToString(ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }, Base64.NO_WRAP)
        if (!saved.edit().putString("secrets_key", key).commit()) throw IllegalStateException("Não consegui guardar a chave protegida.")
        key
      }
    }

    AsyncFunction("connectorBundle") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      // Not ".gz": the Android build silently decompresses .gz assets and drops the extension.
      Base64.encodeToString(context.assets.open("mybots-connectors.bin").use { it.readBytes() }, Base64.NO_WRAP)
    }

    // Attachments use the system document picker: the app reads only the file the person chose.
    AsyncFunction("pickFile") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("NO_ACTIVITY", "Abra o MyBots para escolher um arquivo.", null)
      if (picker.getAndSet(promise) != null) return@AsyncFunction promise.reject("BUSY", "Já estou escolhendo um arquivo.", null)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
      try { activity.startActivityForResult(intent, PICK_FILE) } catch (error: Exception) { picker.set(null); promise.reject("PICKER", "Não encontrei um seletor de arquivos neste celular.", error) }
    }

    AsyncFunction("notificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33) promise.resolve(mapOf("status" to "granted"))
      else Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, android.Manifest.permission.POST_NOTIFICATIONS)
    }

    AsyncFunction("microphonePermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, android.Manifest.permission.RECORD_AUDIO)
    }

    // Inline dictation: the system recognizer streams partial text and the voice level to the composer,
    // without opening Google's full-screen dialog. Audio stays with the recognizer; MyBots receives text only.
    // Dictation keeps listening through pauses: Android's recognizer ends each phrase on silence, so the session
    // starts it again and joins the phrases, until the person taps to stop (or cancels).
    AsyncFunction("startListening") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("NOT_READY", "O MyBots não está pronto.", null)
      Handler(Looper.getMainLooper()).post {
        try {
          speech?.destroy(); speech = null
          val recognizer = when {
            SpeechRecognizer.isRecognitionAvailable(context) -> SpeechRecognizer.createSpeechRecognizer(context)
            Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context) -> SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            else -> null
          } ?: return@post promise.reject("SPEECH", "Este celular não tem reconhecimento de voz. Instale ou ative o app Google.", null)
          speech = recognizer; dictating = true; spoken.setLength(0)
          val emit = { type: String, extra: Map<String, Any?> -> sendEvent("onSpeech", mapOf("type" to type) + extra) }
          val joined = { more: String -> listOf(spoken.toString(), more.trim()).filter { it.isNotBlank() }.joinToString(" ") }
          val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 10000L)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 10000L)
          val finish = {
            if (speech === recognizer) {
              dictating = false; speech = null
              emit("final", mapOf("text" to spoken.toString()))
              recognizer.destroy()
            }
          }
          val again = { if (speech === recognizer && dictating) try { recognizer.startListening(intent) } catch (_: Exception) { finish() } else finish() }
          recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { emit("ready", emptyMap()) }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) { emit("level", mapOf("level" to ((rmsdB + 2f) / 12f).coerceIn(0f, 1f))) }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
              if (speech !== recognizer) return
              // Silence or a phrase that was not understood: keep listening while the person has not stopped.
              if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                if (dictating) Handler(Looper.getMainLooper()).postDelayed({ again() }, 150) else finish()
                return
              }
              val message = when (error) {
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permita o microfone para o MyBots."
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "O reconhecimento de voz precisa de internet agora."
                else -> "O reconhecimento de voz parou. Tente de novo."
              }
              if (spoken.isNotBlank()) finish() else { dictating = false; speech = null; recognizer.destroy() }
              emit("error", mapOf("message" to message, "code" to error))
            }
            override fun onResults(results: Bundle?) {
              if (speech !== recognizer) return
              val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
              val all = joined(text); spoken.setLength(0); spoken.append(all)
              if (dictating) { emit("partial", mapOf("text" to all)); again() } else finish()
            }
            override fun onPartialResults(partial: Bundle?) { emit("partial", mapOf("text" to joined(partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()))) }
            override fun onEvent(eventType: Int, params: Bundle?) {}
          })
          recognizer.startListening(intent)
          promise.resolve(true)
        } catch (error: Exception) { promise.reject("SPEECH", "Não consegui ligar o microfone.", error) }
      }
    }

    // Stop: the last phrase is recognized and everything said goes to the message; cancel discards it.
    AsyncFunction("stopListening") { cancel: Boolean ->
      Handler(Looper.getMainLooper()).post {
        val recognizer = speech ?: return@post
        dictating = false
        if (cancel) { speech = null; recognizer.cancel(); recognizer.destroy(); spoken.setLength(0); return@post }
        recognizer.stopListening()
        // Some recognizers send nothing after a stop in silence: deliver what was said anyway.
        Handler(Looper.getMainLooper()).postDelayed({
          if (speech === recognizer) { speech = null; sendEvent("onSpeech", mapOf("type" to "final", "text" to spoken.toString())); recognizer.destroy() }
        }, 3000)
      }
      true
    }

    // Dictation uses Android's speech recognizer screen; the audio never reaches MyBots, only the text.
    AsyncFunction("dictate") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("NO_ACTIVITY", "Abra o MyBots para ditar.", null)
      if (dictation.getAndSet(promise) != null) return@AsyncFunction promise.reject("BUSY", "O ditado já está aberto.", null)
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
        .putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale sua mensagem")
      try { activity.startActivityForResult(intent, DICTATE) } catch (error: Exception) { dictation.set(null); promise.reject("SPEECH", "Este celular não tem reconhecimento de voz disponível. Instale ou ative o app Google.", error) }
    }

    OnActivityResult { activity, payload ->
      when (payload.requestCode) {
        PICK_FILE -> {
          val promise = picker.getAndSet(null) ?: return@OnActivityResult
          val uri = payload.data?.data
          if (payload.resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return@OnActivityResult }
          Thread {
            try {
              val resolver = activity.contentResolver
              var name = "arquivo"; var size = -1L
              resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) { name = cursor.getString(0) ?: name; if (!cursor.isNull(1)) size = cursor.getLong(1) }
              }
              if (size > MAX_ATTACHMENT) { promise.reject("TOO_LARGE", "Escolha um arquivo de até 10 MB.", null); return@Thread }
              val bytes = resolver.openInputStream(uri)?.use { input ->
                val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(65536)
                while (out.size() <= MAX_ATTACHMENT) { val read = input.read(buffer); if (read < 0) break; out.write(buffer, 0, read) }
                out.toByteArray()
              } ?: throw IllegalStateException()
              if (bytes.size > MAX_ATTACHMENT) { promise.reject("TOO_LARGE", "Escolha um arquivo de até 10 MB.", null); return@Thread }
              promise.resolve(mapOf("name" to name.take(120), "mime" to (resolver.getType(uri) ?: "application/octet-stream"), "size" to bytes.size, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
            } catch (error: Exception) { promise.reject("READ", "Não consegui ler o arquivo escolhido.", error) }
          }.start()
        }
        PICK_PASSWORDS -> {
          val promise = passwordPicker.getAndSet(null) ?: return@OnActivityResult
          val uri = payload.data?.data
          if (payload.resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return@OnActivityResult }
          Thread {
            try {
              val bytes = activity.contentResolver.openInputStream(uri)?.use { input ->
                val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(65536)
                while (out.size() <= MAX_PASSWORD_FILE) { val read = input.read(buffer); if (read < 0) break; out.write(buffer, 0, read) }
                out.toByteArray()
              } ?: throw IllegalStateException()
              if (bytes.size > MAX_PASSWORD_FILE) { promise.reject("TOO_LARGE", "O arquivo de senhas pode ter até 5 MB.", null); return@Thread }
              val result = PasswordVault.importCsv(activity.applicationContext, String(bytes, Charsets.UTF_8), importBots)
              java.util.Arrays.fill(bytes, 0)
              importedFile = uri
              promise.resolve(result + mapOf("name" to (activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "arquivo")))
            } catch (error: IllegalArgumentException) { promise.reject("CSV", error.message, error) }
            catch (error: Exception) { promise.reject("READ", "Não consegui ler o arquivo de senhas.", error) }
          }.start()
        }
        DICTATE -> {
          val promise = dictation.getAndSet(null) ?: return@OnActivityResult
          val text = if (payload.resultCode == Activity.RESULT_OK) payload.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() else null
          promise.resolve(text)
        }
      }
    }

    // The supervisor package outgrew one RUN_COMMAND stdin; larger packages are staged in parts first.
    AsyncFunction("supervisorParts") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val size = context.assets.open("mybots-supervisor.tgz").use { it.readBytes().size }
      if (size <= PAIR_PART) 0 else (size + PAIR_PART - 1) / PAIR_PART
    }

    AsyncFunction("notificationAccess") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val enabled = android.provider.Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      enabled.split(":").any { ComponentName.unflattenFromString(it)?.packageName == context.packageName }
    }

    AsyncFunction("openNotificationAccess") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      context.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    AsyncFunction("flushNotifications") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      NotificationForwarder.flush(context.applicationContext)
      true
    }

    AsyncFunction("deviceInfo") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      @Suppress("DEPRECATION")
      val termux = context.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
      "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})\nSistema: ${Build.VERSION.INCREMENTAL}\nTermux: ${termux.versionName}"
    }

    // termux-api commands hang (no error) when the Termux:API app is missing or signed by another source
    // than Termux (F-Droid vs GitHub/Play): Android only lets the two talk when the signatures match.
    AsyncFunction("termuxApiStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val manager = context.packageManager
      val api = try { @Suppress("DEPRECATION") manager.getPackageInfo("com.termux.api", 0) } catch (_: Exception) { null }
      if (api == null) mapOf("installed" to false) else mapOf(
        "installed" to true, "version" to (api.versionName ?: ""),
        "sameSigner" to (manager.checkSignatures(TERMUX_PACKAGE, "com.termux.api") == PackageManager.SIGNATURE_MATCH),
        "enabled" to (api.applicationInfo?.enabled != false))
    }

    AsyncFunction("openAppSettings") { packageName: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      if (packageName !in setOf(TERMUX_PACKAGE, "com.termux.api", context.packageName)) throw IllegalArgumentException("App inválido.")
      context.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    // "Funcionar com a tela apagada": the keep-alive service and what Android/HyperOS may still block.
    AsyncFunction("keepAliveStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      KeepAlive.status(context.applicationContext)
    }
    AsyncFunction("setKeepAlive") { enabled: Boolean ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      KeepAlive.setEnabled(context.applicationContext, enabled)
      KeepAlive.status(context.applicationContext)
    }
    // Called whenever the app connects to the supervisor: starts the service if the person left it on.
    AsyncFunction("startKeepAlive") {
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      KeepAlive.start(context.applicationContext, "app")
    }
    AsyncFunction("openPowerSettings") { target: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      KeepAlive.openSettings(context, target)
    }

    AsyncFunction("copyText") { value: String ->
      if (value.length > 50_000) throw IllegalArgumentException("Os logs são grandes demais para copiar de uma vez.")
      val context = appContext.reactContext ?: throw IllegalStateException("O MyBots não está pronto.")
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("MyBots · logs do Termux", value))
      true
    }

    AsyncFunction("runCodex") { operation: String, payload: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("MYBOTS_NOT_READY", "O MyBots não está pronto.", null)
      } else {
        submit(context, operation, payload, promise)
      }
    }
  }

  // Reads the shared content once (the intent's action is cleared so reopening the app does not repeat it).
  private fun receiveShare(intent: Intent) {
    if (!ShareIntake.isShare(intent)) return
    val context = appContext.currentActivity ?: appContext.reactContext ?: return
    val copy = Intent(intent); intent.action = Intent.ACTION_MAIN; intent.removeExtra(Intent.EXTRA_STREAM); intent.removeExtra(Intent.EXTRA_TEXT)
    sharing = true
    Thread {
      try { ShareIntake.capture(context, copy) } catch (_: Exception) {}
      sharing = false
      sendEvent("onShare", mapOf("ready" to true))
    }.start()
  }

  private fun submit(context: Context, operation: String, payload: Map<String, Any?>, promise: Promise) {
    if (context.packageManager.checkPermission(RUN_COMMAND_PERMISSION, context.packageName) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("TERMUX_PERMISSION", "Permita que o MyBots execute comandos no Termux nas permissões do app.", null)
      return
    }
    try {
      @Suppress("DEPRECATION")
      context.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
    } catch (_: Exception) {
      promise.reject("TERMUX_MISSING", "Instale e abra o Termux neste celular para conectar ao Codex.", null)
      return
    }

    val command = try { commandFor(context, operation, payload) } catch (error: Exception) {
      promise.reject("TERMUX_REQUEST", error.message ?: "Não foi possível preparar o pedido.", error)
      return
    }
    val id = if (operation == "reply") payload["requestId"] as String else UUID.randomUUID().toString()
    if (pending.putIfAbsent(id, promise) != null) {
      promise.reject("TERMUX_DUPLICATE", "Este pedido já está em execução.", null)
      return
    }
    val callback = Intent(context, TermuxResultReceiver::class.java)
      .setData(Uri.parse("mybots://termux/$id"))
      .putExtra(REQUEST_ID, id)
    val flags = PendingIntent.FLAG_ONE_SHOT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    val result = PendingIntent.getBroadcast(context, requestCodes.incrementAndGet(), callback, flags)
    val intent = runCommandIntent(command.path, command.args, command.stdin, result, "MyBots · Codex")
    try {
      startTermux(context, intent)
      Handler(Looper.getMainLooper()).postDelayed({
        pending.remove(id)?.reject("TERMUX_TIMEOUT", "O retorno do Termux demorou. Reabra a conversa para recuperar a resposta salva.", null)
      }, command.timeoutMs)
    } catch (error: Exception) {
      pending.remove(id)
      promise.reject("TERMUX_START", "Não consegui iniciar o Codex no Termux. Confira a permissão de execução.", error)
    }
  }

  private fun commandFor(context: Context, operation: String, payload: Map<String, Any?>): TermuxCommand {
    return when (operation) {
      "pair" -> {
        val script = context.assets.open("mybots-pair.sh").bufferedReader().use { it.readText() }
        val release = context.assets.open("mybots-supervisor.sha256").bufferedReader().use { it.readText().trim() }
        val backup = payload["migrationBackup"] as? String ?: ""
        if (backup.isNotEmpty() && !backup.matches(Regex("mybots-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F-]{36}\\.json"))) throw IllegalArgumentException("Backup de migração inválido.")
        val archive = context.assets.open("mybots-supervisor.tgz").use { it.readBytes() }
        val key = transportPublicKey()
        val digest = transportDigest()
        // Pairing replaces the supervisor; the keep-alive service must not restart the old one meanwhile.
        KeepAlive.holdRestarts(context, 300_000)
        val staged = archive.size > PAIR_PART
        TermuxCommand(TIMEOUT, arrayOf("240s", BASH, "-lc", script, "mybots", release, backup, key, digest, if (staged) "staged" else "inline"), if (staged) null else Base64.encodeToString(archive, Base64.NO_WRAP), 245_000)
      }
      "pairPart" -> {
        val release = context.assets.open("mybots-supervisor.sha256").bufferedReader().use { it.readText().trim() }
        val archive = context.assets.open("mybots-supervisor.tgz").use { it.readBytes() }
        val index = (payload["index"] as? Number)?.toInt() ?: -1
        if (index < 0 || index * PAIR_PART >= archive.size) throw IllegalArgumentException("Parte do pacote inválida.")
        val part = archive.copyOfRange(index * PAIR_PART, minOf(archive.size, (index + 1) * PAIR_PART))
        KeepAlive.holdRestarts(context, 300_000)
        TermuxCommand(TIMEOUT, arrayOf("30s", BASH, "-lc", PAIR_PART_SCRIPT, "mybots", release, index.toString()), Base64.encodeToString(part, Base64.NO_WRAP), 35_000)
      }
      "status" -> TermuxCommand(TIMEOUT, arrayOf("20s", BASH, "-lc", "codex login status"), null, 25_000)
      "models" -> TermuxCommand(TIMEOUT, arrayOf("35s", BASH, "-lc", MODEL_LIST_SCRIPT), null, 40_000)
      "reply" -> {
        val model = payload["model"] as? String ?: throw IllegalArgumentException("Escolha um modelo.")
        if (!model.matches(Regex("[A-Za-z0-9._/-]{1,120}"))) throw IllegalArgumentException("O modelo escolhido é inválido.")
        val effort = payload["reasoningEffort"] as? String ?: ""
        if (effort.isNotEmpty() && effort !in EFFORTS) throw IllegalArgumentException("O nível de raciocínio escolhido é inválido.")
        val prompt = payload["prompt"] as? String ?: throw IllegalArgumentException("Escreva uma mensagem.")
        if (prompt.isBlank() || prompt.length > 100_000) throw IllegalArgumentException("A conversa está grande demais para enviar.")
        val id = validRequestId(payload["requestId"])
        val session = (payload["codexSessionId"] as? String)?.let { validRequestId(it) } ?: ""
        val script = context.assets.open("mybots-termux.sh").bufferedReader().use { it.readText() }
        TermuxCommand(BASH, arrayOf("-lc", script, "mybots", "reply", id, model, effort, session), prompt,
          if (effort in setOf("max", "ultra")) 680_000 else 260_000)
      }
      "recover" -> {
        val id = validRequestId(payload["requestId"])
        val offset = (payload["offset"] as? Number)?.toInt() ?: 0
        if (offset !in 0..20_000_000) throw IllegalArgumentException("Trecho de resposta inválido.")
        val script = context.assets.open("mybots-termux.sh").bufferedReader().use { it.readText() }
        TermuxCommand(TIMEOUT, arrayOf("15s", BASH, "-lc", script, "mybots", "recover", id, offset.toString()), null, 20_000)
      }
      "backupPart", "backupFinish", "backupList", "backupRead", "environment" -> {
        val script = context.assets.open("mybots-maintenance.sh").bufferedReader().use { it.readText() }
        val args = mutableListOf("50s", BASH, "-lc", script, "mybots", operation)
        var input: String? = null
        when (operation) {
          "backupPart", "backupFinish" -> {
            args.add(validRequestId(payload["requestId"]))
            if (operation == "backupPart") {
              input = payload["chunk"] as? String ?: throw IllegalArgumentException("Trecho de backup vazio.")
              if (input.length > 12_000) throw IllegalArgumentException("Trecho de backup grande demais.")
              val index = (payload["index"] as? Number)?.toInt() ?: -1
              if (index !in 0..1999) throw IllegalArgumentException("Índice inválido.")
              args.add(index.toString())
            } else {
              val count = (payload["count"] as? Number)?.toInt() ?: 0
              if (count !in 1..2000) throw IllegalArgumentException("Quantidade inválida.")
              args.add(count.toString())
            }
          }
          "backupRead" -> {
            val name = payload["name"] as? String ?: throw IllegalArgumentException("Escolha um backup.")
            if (!name.matches(Regex("mybots-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F-]{36}\\.json"))) throw IllegalArgumentException("Nome de backup inválido.")
            val offset = (payload["offset"] as? Number)?.toInt() ?: 0
            if (offset !in 0..20_000_000) throw IllegalArgumentException("Trecho inválido.")
            args.add(name); args.add(offset.toString())
          }
        }
        TermuxCommand(TIMEOUT, args.toTypedArray(), input, 55_000)
      }
      else -> throw IllegalArgumentException("Operação do Termux não permitida.")
    }
  }

  @Suppress("DEPRECATION")
  private fun validRequestId(value: Any?): String {
    val id = value as? String ?: throw IllegalArgumentException("Pedido sem identificador.")
    if (!id.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))) {
      throw IllegalArgumentException("Identificador de pedido inválido.")
    }
    return id
  }

  companion object {
    private const val REQUEST_ID = "mybots.requestId"
    private const val PAIR_PART = 60_000
    private var speech: SpeechRecognizer? = null
    @Volatile private var dictating = false
    private val spoken = StringBuilder()
    @Volatile private var launchBot: String? = null
    @Volatile private var sharing = false
    private const val PICK_FILE = 41_017
    private const val DICTATE = 41_018
    private const val MAX_ATTACHMENT = 10 * 1024 * 1024
    private val picker = java.util.concurrent.atomic.AtomicReference<Promise?>(null)
    private const val PICK_PASSWORDS = 41_019
    private const val MAX_PASSWORD_FILE = 5 * 1024 * 1024
    private val passwordPicker = java.util.concurrent.atomic.AtomicReference<Promise?>(null)
    @Volatile private var importBots: List<String>? = null
    @Volatile private var importedFile: Uri? = null
    private val dictation = java.util.concurrent.atomic.AtomicReference<Promise?>(null)
    private val PAIR_PART_SCRIPT = """
      set -eu; umask 077
      [[ "${'$'}1" =~ ^[0-9a-f]{64}$ ]] && [[ "${'$'}2" =~ ^[0-9]{1,3}$ ]] || exit 1
      dir="${'$'}HOME/.mybots/staging/${'$'}1"; mkdir -p "${'$'}dir"
      printf -v part '%04d' "${'$'}2"
      base64 -d > "${'$'}dir/${'$'}part.tmp"; mv "${'$'}dir/${'$'}part.tmp" "${'$'}dir/${'$'}part"
      printf '{}\n'
    """.trimIndent()
    private const val TIMEOUT = TERMUX_TIMEOUT
    private const val BASH = TERMUX_BASH
    private val EFFORTS = setOf("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")
    private val requestCodes = AtomicInteger()
    private val pending = ConcurrentHashMap<String, Promise>()
    private val mainHandler = Handler(Looper.getMainLooper())

    @JvmStatic
    fun finish(id: String, result: Map<String, Any?>) {
      mainHandler.post { pending.remove(id)?.resolve(result) }
    }

    private val MODEL_LIST_SCRIPT = """
      set -u
      args=(app-server --listen stdio://)
      for feature in apps plugins hooks browser_use computer_use multi_agent code_mode_host; do args+=(-c "features.${'$'}feature=false"); done
      app_pid=""
      cleanup() { if [ -n "${'$'}app_pid" ]; then kill "${'$'}app_pid" 2>/dev/null || true; wait "${'$'}app_pid" 2>/dev/null || true; fi; }
      trap cleanup EXIT
      coproc APP { codex "${'$'}{args[@]}"; }
      app_in="${'$'}{APP[1]}"
      app_out="${'$'}{APP[0]}"
      app_pid="${'$'}APP_PID"
      printf '%s\n' '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"mybots","title":"MyBots","version":"0.1.0"}}}' >&"${'$'}app_in"
      id=1
      while IFS= read -r -t 30 -u "${'$'}app_out" line; do
        id_pattern="\"id\"[[:space:]]*:[[:space:]]*${'$'}id([,}])"
        if [[ "${'$'}line" =~ ${'$'}id_pattern ]]; then break; fi
      done
      if [[ -z "${'$'}{line:-}" ]] || ! [[ "${'$'}line" =~ ${'$'}id_pattern ]]; then printf '%s\n' 'Codex não respondeu à inicialização do catálogo.' >&2; exit 1; fi
      if [[ "${'$'}line" == *'"error"'* ]]; then printf '%s\n' 'Codex recusou a inicialização do catálogo.' >&2; exit 1; fi
      printf '%s\n' '{"method":"initialized","params":{}}' >&"${'$'}app_in"
      id=2
      cursor=""
      page=0
      while [ "${'$'}page" -lt 20 ]; do
        if [ -n "${'$'}cursor" ]; then
          escaped_cursor="${'$'}{cursor//\\/\\\\}"
          escaped_cursor="${'$'}{escaped_cursor//\"/\\\"}"
          printf '{"id":%s,"method":"model/list","params":{"limit":100,"includeHidden":false,"cursor":"%s"}}\n' "${'$'}id" "${'$'}escaped_cursor" >&"${'$'}app_in"
        else
          printf '{"id":%s,"method":"model/list","params":{"limit":100,"includeHidden":false}}\n' "${'$'}id" >&"${'$'}app_in"
        fi
        line=""
        while IFS= read -r -t 30 -u "${'$'}app_out" line; do
          id_pattern="\"id\"[[:space:]]*:[[:space:]]*${'$'}id([,}])"
          if [[ "${'$'}line" =~ ${'$'}id_pattern ]]; then break; fi
        done
        if [[ -z "${'$'}{line:-}" ]] || ! [[ "${'$'}line" =~ ${'$'}id_pattern ]]; then printf '%s\n' 'Codex não respondeu à lista de modelos.' >&2; exit 1; fi
        if [[ "${'$'}line" == *'"error"'* ]] || [[ "${'$'}line" != *'"data"'* ]]; then printf '%s\n' 'Codex não conseguiu carregar os modelos.' >&2; exit 1; fi
        printf '%s\n' "${'$'}line"
        if [[ "${'$'}line" != *'"nextCursor"'* ]] || [[ "${'$'}line" =~ \"nextCursor\"[[:space:]]*:[[:space:]]*null ]]; then exit 0; fi
        if [[ "${'$'}line" =~ \"nextCursor\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then cursor="${'$'}{BASH_REMATCH[1]}"; else printf '%s\n' 'A próxima página do catálogo veio inválida.' >&2; exit 1; fi
        id=${'$'}((id + 1))
        page=${'$'}((page + 1))
      done
      printf '%s\n' 'O catálogo de modelos excedeu o limite de páginas.' >&2
      exit 1
    """.trimIndent()
  }
}
