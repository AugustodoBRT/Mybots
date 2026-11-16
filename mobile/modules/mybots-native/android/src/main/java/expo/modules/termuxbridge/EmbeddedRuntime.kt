package expo.modules.termuxbridge

import android.content.Context
import android.app.ActivityManager
import android.os.StatFs
import android.net.ConnectivityManager
import android.os.Build
import android.system.Os
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.Inet4Address
import java.util.TimeZone
import java.util.zip.GZIPInputStream
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * The phone's own MyBots: the APK carries a small Linux (Alpine, assets/mybots-runtime.tgz) and PRoot, and the same
 * supervisor and AI command-line tools run inside it. Android only lets an app execute files from its nativeLibraryDir, which is
 * why PRoot travels as lib*.so. What the app answers to the JS side is { exitCode, stdout, stderr }.
 *
 * rootfs/ is replaced when the APK brings a new one; home/ (the supervisor's data, the AIs and their logins, /root inside) never is.
 */
internal object EmbeddedRuntime {
  private const val ASSET = "mybots-runtime.tgz"
  private const val STAMP = ".mybots-runtime"
  private const val PATH = "/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  private val DEVICES = listOf("/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty", "/dev/ptmx", "/dev/pts")
  private val installing = Any()
  // Android hides these from apps; programs that read them at startup get a well-formed static copy.
  private fun procFiles(): Map<String, String> {
    val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
    val stat = buildString {
      append("cpu  0 0 0 0 0 0 0 0 0 0\n")
      repeat(cores) { append("cpu$it 0 0 0 0 0 0 0 0 0 0\n") }
      append("intr 0\nctxt 0\nbtime 0\nprocesses 1\nprocs_running 1\nprocs_blocked 0\n")
    }
    return mapOf("stat" to stat, "loadavg" to "0.00 0.00 0.00 1/1 1\n", "version" to "Linux version ${System.getProperty("os.version")} (android)\n", "uptime" to "1000.00 1000.00\n")
  }

  private fun prefs(context: Context) = context.getSharedPreferences("mybots_runtime", Context.MODE_PRIVATE)
  private fun redact(context: Context, value: String): String {
    var text = value.replace(Regex("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]"), "")
    val token = try { File(base(context), "home/.mybots/token").readText().trim() } catch (_: Exception) { "" }
    if (token.length >= 16) text = text.replace(token, "[token redigido]")
    return text.replace(Regex("Bearer\\s+[^\\s\"',;]+", RegexOption.IGNORE_CASE), "Bearer [redigido]")
      .replace(Regex("(?:sk-|sess-|codex_)[A-Za-z0-9_-]{12,}"), "[token redigido]")
      .replace(Regex("""((?:encryptedToken|access_token|refresh_token|client_secret|api_key|token|password|senha)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')""", RegexOption.IGNORE_CASE)) { it.groupValues[1] + "[redigido]" }
      .replace(Regex("((?:encryptedToken|access_token|refresh_token|client_secret|api_key|token|password|senha)[\"']?\\s*[:=]\\s*[\"']?)[^\\s,\"'}]+", RegexOption.IGNORE_CASE)) { it.groupValues[1] + "[redigido]" }
      .takeLast(18000)
  }

  private fun tail(file: File, limit: Int = 6000): String = try {
    RandomAccessFile(file, "r").use { input ->
      val size = minOf(input.length(), limit.toLong()).toInt()
      input.seek(input.length() - size)
      val bytes = ByteArray(size); input.readFully(bytes); String(bytes, Charsets.UTF_8)
    }
  } catch (_: Exception) { "(ainda não há registro)" }

  fun diagnostics(context: Context): String {
    val p = prefs(context)
    fun date(key: String): String = p.getLong(key, 0).takeIf { it > 0 }?.let { java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) } ?: "não registrado"
    val home = File(base(context), "home/.mybots")
    val exits = if (Build.VERSION.SDK_INT >= 30) try {
      context.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(context.packageName, 0, 3).joinToString("; ") { "motivo=" + it.reason + ", status=" + it.status + ", horário=" + java.util.Date(it.timestamp) }
    } catch (_: Exception) { "não disponível" } else "não disponível nesta versão do Android"
    val space = try { StatFs(context.filesDir.path).availableBytes / 1048576 } catch (_: Exception) { -1 }
    val lines = listOf(
      "Diagnóstico local (não depende do supervisor)",
      "Arquiteturas: " + Build.SUPPORTED_ABIS.joinToString(", "),
      "Linux habilitado: " + enabled(context),
      "Espaço disponível: " + space + " MB",
      "Saídas recentes do app registradas pelo Android: " + exits,
      "Último início: " + date("supervisorStartedAt"),
      "Última saída: " + date("supervisorExitedAt") + ", código=" + p.getInt("supervisorExitCode", 0),
      "Última falha nativa: " + p.getString("supervisorFailure", "não registrada"),
      "Erro recente do ambiente (" + date("supervisorStderrAt") + "):\n" + (p.getString("supervisorStderr", "(sem registro)") ?: "").takeLast(4000),
      "Log do supervisor:\n" + tail(File(home, "supervisor.log")),
      "Preparação do ambiente:\n" + tail(File(home, "ambiente-supervisor.txt"), 2000)
    )
    return redact(context, lines.joinToString("\n\n"))
  }

  private fun base(context: Context) = File(context.filesDir, "runtime")
  private fun rootfs(context: Context) = File(base(context), "rootfs")
  private fun library(context: Context, name: String) = File(context.applicationInfo.nativeLibraryDir, name)

  fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)
  fun setEnabled(context: Context, on: Boolean) { prefs(context).edit().putBoolean("enabled", on).apply() }
  /** Needs Android 10 or newer, and this APK must carry the Linux and PRoot for this phone's processor. */
  fun supported(context: Context) = Build.VERSION.SDK_INT >= 29 && library(context, "libproot.so").exists() &&
    (try { context.assets.open(ASSET).close(); true } catch (_: Exception) { false })

  private fun installRootfs(context: Context) = synchronized(installing) {
    val wanted = context.assets.open("$ASSET.sha256").bufferedReader().use { it.readText().trim() }
    val target = rootfs(context)
    val stamp = File(target, STAMP)
    if (!stamp.exists() || stamp.readText().trim() != wanted) {
      val fresh = File(base(context), "rootfs.new")
      fresh.deleteRecursively(); fresh.mkdirs()
      context.assets.open(ASSET).use { input -> untar(GZIPInputStream(BufferedInputStream(input, 1 shl 16), 1 shl 16), fresh) }
      File(fresh, STAMP).writeText(wanted)
      target.deleteRecursively()
      if (!fresh.renameTo(target)) throw IllegalStateException("Não consegui instalar o ambiente do MyBots.")
    }
    File(base(context), "home").mkdirs()
    File(base(context), "tmp").mkdirs()
    val proc = File(base(context), "proc"); proc.mkdirs()
    procFiles().forEach { (name, content) -> File(proc, name).writeText(content) }
  }

  /** Android has no glibc-style resolver files: the Linux inside needs the DNS of the network in use, at every start. */
  private fun writeResolver(context: Context) {
    val found = try {
      val manager = context.getSystemService(ConnectivityManager::class.java)
      manager.getLinkProperties(manager.activeNetwork)?.dnsServers.orEmpty().filter { it is Inet4Address || !it.isLinkLocalAddress }.mapNotNull { it.hostAddress }
    } catch (_: Exception) { emptyList() }
    val servers = (found + listOf("1.1.1.1", "8.8.8.8")).distinct().take(3)
    File(rootfs(context), "etc/resolv.conf").writeText(servers.joinToString("") { "nameserver $it\n" })
  }

  private fun command(context: Context, program: String, args: List<String>): List<String> {
    val home = base(context)
    return buildList {
      add(library(context, "libproot.so").path)
      addAll(listOf("--link2symlink", "-0", "-r", rootfs(context).path))
      DEVICES.filter { File(it).exists() }.forEach { addAll(listOf("-b", it)) }
      addAll(listOf("-b", "/proc", "-b", "/sys"))
      File(home, "proc").list().orEmpty().sorted().forEach { addAll(listOf("-b", "${File(home, "proc/$it").path}:/proc/$it")) }
      addAll(listOf("-b", "${File(home, "home").path}:/root", "-w", "/root"))
      add(program); addAll(args)
    }
  }

  private fun environment(context: Context) = mapOf(
    "PROOT_LOADER" to library(context, "libproot_loader.so").path,
    "PROOT_TMP_DIR" to File(base(context), "tmp").path,
    "HOME" to "/root", "PATH" to PATH, "LANG" to "C.UTF-8", "TMPDIR" to "/tmp", "TERM" to "xterm-256color",
    "TZ" to TimeZone.getDefault().id, "MYBOTS_EMBEDDED" to "1", "MYBOTS_DEVICE_KIND" to "phone",
    // Loopback is shared between apps: 3229 stays clear of the port other tools commonly take (3219).
    "MYBOTS_PORT" to "3229"
  )

  private fun inside(value: String) = value

  /**
   * Runs one command in the embedded Linux and answers once. With [detach], the answer comes as soon as the command prints its JSON line:
   * the pairing script leaves the supervisor running under this same PRoot, which therefore stays alive after the script ends.
   */
  fun run(context: Context, program: String, args: Array<String>, stdin: String?, timeoutMs: Long, detach: Boolean, done: (Map<String, Any?>) -> Unit) {
    thread(name = "mybots-runtime", isDaemon = true) {
      val answered = java.util.concurrent.atomic.AtomicBoolean(false)
      val out = StringBuffer(); val err = StringBuffer()
      fun answer(code: Int, message: String = "") {
        if (code != 0) android.util.Log.w("MyBotsRuntime", "exit=$code $message ${err.toString().takeLast(1500)}")
        if (answered.compareAndSet(false, true)) done(mapOf("exitCode" to code, "stdout" to out.toString(), "stderr" to err.toString(), "errorCode" to -1, "errorMessage" to message))
      }
      try {
        installRootfs(context)
        writeResolver(context)
        // Commands come wrapped in `timeout <limit>`; the timer below does that, and PRoot reports the exit code of whichever process ended last.
        val wrapped = program == RUNTIME_TIMEOUT
        val runner = if (wrapped) args[1] else program
        val rest = (if (wrapped) args.drop(2) else args.toList()).map(::inside)
        val builder = ProcessBuilder(command(context, inside(runner), rest))
        builder.directory(base(context))
        builder.environment().apply { clear(); putAll(environment(context)) }
        val process = builder.start()
        val errors = thread(isDaemon = true) {
          var savedAt = 0L
          try {
            process.errorStream.bufferedReader().forEachLine { line ->
              synchronized(err) { err.append(line.takeLast(8000)).append('\n'); if (err.length > 12000) err.delete(0, err.length - 12000) }
              val at = System.currentTimeMillis()
              if (detach && at - savedAt >= 1000) {
                prefs(context).edit().putString("supervisorStderr", redact(context, err.toString())).putLong("supervisorStderrAt", at).apply()
                savedAt = at
              }
            }
          } catch (_: Exception) { /* Process shutdown can close the pipe while its reader is waiting. */ }
        }
        thread(isDaemon = true) {
          try { process.outputStream.use { stream -> stdin?.let { stream.write(it.toByteArray()) } } } catch (_: Exception) {}
        }
        val timer = thread(isDaemon = true) {
          try { Thread.sleep(timeoutMs); if (!answered.get()) { answer(124, "O comando demorou demais."); process.destroyForcibly() } } catch (_: InterruptedException) {}
        }
        process.inputStream.bufferedReader().forEachLine { line ->
          if (out.length < 20_000_000 && !answered.get()) out.append(line).append('\n')
          if (detach && line.startsWith("{") && line.contains("encryptedToken")) {
            prefs(context).edit().putLong("supervisorStartedAt", System.currentTimeMillis()).apply()
            timer.interrupt(); answer(0)
          }
        }
        val code = process.waitFor()
        errors.join(200)
        if (detach) {
          prefs(context).edit().putLong("supervisorExitedAt", System.currentTimeMillis()).putInt("supervisorExitCode", code).putString("supervisorStderr", redact(context, err.toString())).apply()
          android.util.Log.i("MyBotsRuntime", "supervisor runtime exited: code=$code")
        }
        timer.interrupt()
        answer(code)
      } catch (error: Exception) {
        if (detach) prefs(context).edit().putString("supervisorFailure", redact(context, error.javaClass.simpleName + ": " + (error.message ?: ""))).putLong("supervisorExitedAt", System.currentTimeMillis()).putInt("supervisorExitCode", -1).apply()
        answer(-1, error.message ?: error.javaClass.simpleName)
      }
    }
  }

  // Installing and signing in to an AI, each by its own official installer and login. Only these can be started from the app.
  private val TERMINALS = mapOf(
    "claude" to "command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash; claude auth login",
    "codex" to "", // Started below with the supervisor's verified runtime installer.
    // Antigravity signs in only on its own full-screen program, which needs a terminal (wide, so its link comes in one line), and it has no command that ends when the login does: signing in is confirmed by its models listing.
    "agy" to "command -v agy >/dev/null || curl -fsSL https://antigravity.google/cli/install.sh | bash; script -qfc 'stty cols 4000 rows 40; exec agy' /dev/null <&0 & p=\$!; while kill -0 \$p 2>/dev/null; do sleep 5; if agy models >/dev/null 2>&1 </dev/null; then kill \$p; exit 0; fi; done; exit 1"
  )
  private var terminal: Process? = null

  /** One sign-in at a time. What passes through here (a link, a code) is shown to the person and handed to the AI's own program, never kept or logged. */
  fun terminalStart(context: Context, kind: String, emit: (Map<String, Any?>) -> Unit) {
    val script = TERMINALS[kind] ?: throw IllegalArgumentException("IA desconhecida.")
    terminalStop()
    thread(name = "mybots-terminal", isDaemon = true) {
      try {
        installRootfs(context)
        writeResolver(context)
        val loginCommand = if (kind == "codex") {
          val endpoint = JSONObject(File(base(context), "home/.mybots/endpoint.json").readText())
          val release = endpoint.getString("release")
          require(release.matches(Regex("[0-9a-f]{64}"))) { "Abra o MyBots para preparar o supervisor antes de conectar o Codex." }
          command(context, "/usr/bin/node", listOf("/root/.mybots/runtime/$release/supervisor/codex-login.mjs"))
        } else command(context, "/bin/bash", listOf("-lc", script))
        val builder = ProcessBuilder(loginCommand).redirectErrorStream(true)
        builder.directory(base(context))
        builder.environment().apply { clear(); putAll(environment(context)); put("NO_COLOR", "1") }
        val process = builder.start(); terminal = process
        val buffer = ByteArray(4096)
        while (true) { val read = process.inputStream.read(buffer); if (read < 0) break; emit(mapOf("text" to String(buffer, 0, read))) }
        emit(mapOf("exit" to process.waitFor()))
      } catch (error: Exception) { emit(mapOf("text" to (error.message ?: "Falhou."), "exit" to -1)) }
    }
  }
  fun terminalWrite(text: String) { terminal?.outputStream?.let { it.write(text.toByteArray()); it.flush() } }
  fun terminalStop() { terminal?.destroyForcibly(); terminal = null }

  /** A small tar reader: symlinks and modes matter here, and hard links cannot exist inside an app's files. */
  private fun untar(stream: java.io.InputStream, target: File) {
    val root = target.canonicalPath + File.separator
    val input = DataInputStream(stream)
    val header = ByteArray(512); val buffer = ByteArray(1 shl 16)
    var longName: String? = null; var longLink: String? = null
    fun text(from: Int, length: Int) = String(header, from, (from until from + length).firstOrNull { header[it] == 0.toByte() }?.minus(from) ?: length, Charsets.UTF_8)
    fun octal(from: Int, length: Int) = text(from, length).trim().ifEmpty { "0" }.toLong(8)
    fun content(size: Long, sink: (ByteArray, Int) -> Unit) {
      var left = size
      while (left > 0) { val read = input.read(buffer, 0, minOf(left, buffer.size.toLong()).toInt()); if (read < 0) throw EOFException(); sink(buffer, read); left -= read }
      val padding = ((512 - size % 512) % 512).toInt(); if (padding > 0) input.readFully(ByteArray(padding))
    }
    fun bytes(size: Long) = java.io.ByteArrayOutputStream().also { sink -> content(size) { data, count -> sink.write(data, 0, count) } }.toString("UTF-8").trimEnd('\u0000')
    while (true) {
      try { input.readFully(header) } catch (_: EOFException) { return }
      if (header.all { it == 0.toByte() }) return
      val type = header[156].toInt().toChar(); val size = octal(124, 12); val mode = octal(100, 8).toInt() and 0x1ff
      when (type) { 'L' -> { longName = bytes(size); continue }; 'K' -> { longLink = bytes(size); continue }; 'x', 'g' -> { content(size) { _, _ -> }; continue } }
      val prefix = text(345, 155)
      val name = longName ?: (if (prefix.isNotEmpty()) "$prefix/${text(0, 100)}" else text(0, 100)); longName = null
      val link = longLink ?: text(157, 100); longLink = null
      val file = File(target, name)
      if (!(file.canonicalPath + File.separator).startsWith(root)) throw SecurityException("Caminho inválido no ambiente: $name")
      when (type) {
        '5' -> { file.mkdirs(); Os.chmod(file.path, mode or 0x1c0) }
        '2' -> { file.parentFile?.mkdirs(); file.delete(); Os.symlink(link, file.path) }
        '0', '\u0000' -> {
          file.parentFile?.mkdirs()
          FileOutputStream(file).use { sink -> content(size) { data, count -> sink.write(data, 0, count) } }
          Os.chmod(file.path, mode or 0x180)
        }
        else -> content(size) { _, _ -> }
      }
    }
  }
}
