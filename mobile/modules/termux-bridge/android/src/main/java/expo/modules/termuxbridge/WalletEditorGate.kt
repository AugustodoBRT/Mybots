package expo.modules.termuxbridge

/** Invalidates phone commands as soon as a protected editor opens, including commands already running. */
internal object WalletEditorGate {
  private var generation = 0L
  private var active = false
  private var gestures = 0
  private fun valid(token: Long) {
    if (active || token != generation) throw IllegalStateException("Feche os ajustes da carteira para usar o controle do celular.")
  }
  @Synchronized fun open(): Boolean {
    if (active || gestures != 0) return false
    active = true; generation++
    return true
  }
  @Synchronized fun close() { active = false }
  @Synchronized fun token(): Long { valid(generation); return generation }
  @Synchronized fun check(token: Long) = valid(token)
  @Synchronized fun <T> action(token: Long, block: () -> T): T { valid(token); return block() }
  @Synchronized fun beginGesture(token: Long) { valid(token); gestures++ }
  @Synchronized fun endGesture() { if (gestures > 0) gestures-- }
}
