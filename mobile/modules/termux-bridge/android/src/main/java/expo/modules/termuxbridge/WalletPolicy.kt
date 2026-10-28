package expo.modules.termuxbridge

import java.util.Calendar
import java.util.TimeZone

internal data class WalletRules(val frozen: Boolean, val perPurchase: Long, val perDay: Long, val perMonth: Long,
  val allowed: List<String>, val blocked: List<String>, val categories: List<String>)
internal data class WalletIntent(val store: String, val items: List<String>, val category: String, val total: Long)

/**
 * The person's spending rules, checked here in the app and never by the model. The checkout's address and total come
 * from the page itself (or from the computer's browser process), not from what the bot says. Amounts are centavos.
 */
internal object WalletPolicy {
  /**
   * The card a bot pays with. `lastFours` is every card (id → last four), `allowed` the ids the person chose for this bot,
   * `hint` the last four the bot named (or empty). A card the person did not allow for that bot is never returned.
   */
  fun pickCard(lastFours: Map<String, String>, allowed: List<String>, hint: String): String {
    if (lastFours.isEmpty()) throw IllegalStateException("Nenhum cartão cadastrado. Peça à pessoa para cadastrar em Carteira.")
    val usable = allowed.filter { lastFours.containsKey(it) }
    if (usable.isEmpty()) throw IllegalStateException("A pessoa não liberou nenhum cartão da carteira para este bot. Peça que ela escolha os bots de um cartão em Carteira.")
    val names = usable.joinToString(", ") { "final " + lastFours[it] }
    return when {
      hint.length == 4 -> usable.firstOrNull { lastFours[it] == hint } ?: throw IllegalStateException("Este bot não pode usar o cartão final $hint. Cartões liberados: $names.")
      usable.size == 1 -> usable[0]
      else -> throw IllegalStateException("Há mais de um cartão liberado para este bot: $names. Informe o final em card.")
    }
  }

  fun host(url: String): String? = try {
    val uri = java.net.URI(url)
    if (uri.scheme?.lowercase() != "https" || uri.rawUserInfo != null) null else uri.host?.lowercase()?.trimEnd('.')?.takeIf { it.isNotEmpty() }
  } catch (_: Exception) { null }
  fun domain(value: String) = value.trim().lowercase().removePrefix("https://").removePrefix("http://").substringBefore('/').trimEnd('.')
  private fun within(host: String, domain: String) = domain.isNotEmpty() && (host == domain || host.endsWith(".$domain"))
  fun money(cents: Long): String {
    val reais = (cents / 100).toString().reversed().chunked(3).joinToString(".").reversed()
    return "R$ $reais,${(cents % 100).toString().padStart(2, '0')}"
  }

  /** Returns what is left of the month after this purchase; throws, in words for the bot, when any rule says no. */
  fun check(rules: WalletRules, intent: WalletIntent, url: String, pageTotal: Long?, purchases: List<Pair<Long, Long>>, now: Long, zone: TimeZone = TimeZone.getDefault()): Long {
    if (rules.frozen) throw IllegalStateException("A carteira está congelada. Só a pessoa descongela, no app (Ajustes → Carteira).")
    if (listOf(rules.perPurchase, rules.perDay, rules.perMonth).any { it <= 0 }) throw IllegalStateException("As regras da carteira ainda não foram definidas no app.")
    val page = host(url) ?: throw IllegalArgumentException("O pagamento só é feito numa página https.")
    if (!within(page, domain(intent.store))) throw IllegalArgumentException("A loja informada não é a do checkout aberto ($page).")
    if (rules.blocked.any { within(page, domain(it)) }) throw IllegalArgumentException("A loja $page está proibida na carteira.")
    if (rules.allowed.none { within(page, domain(it)) }) throw IllegalArgumentException("A loja $page não está entre as lojas permitidas da carteira.")
    if (rules.categories.none { it.trim().equals(intent.category.trim(), ignoreCase = true) }) throw IllegalArgumentException("A categoria “${intent.category.take(60)}” não está permitida. Permitidas: ${rules.categories.joinToString(", ")}.")
    if (intent.items.isEmpty() || intent.items.any { it.isBlank() || it.length > 200 }) throw IllegalArgumentException("Informe os itens da compra.")
    if (intent.total <= 0) throw IllegalArgumentException("Informe o total da compra.")
    if (pageTotal == null) throw IllegalArgumentException("Não encontrei um único total visível no checkout. Abra a etapa final do pagamento, com o total à mostra.")
    if (intent.total != pageTotal) throw IllegalArgumentException("O total informado (${money(intent.total)}) não é o da página (${money(pageTotal)}).")
    if (intent.total > rules.perPurchase) throw IllegalArgumentException("A compra (${money(intent.total)}) passa do limite por compra (${money(rules.perPurchase)}).")
    fun key(time: Long, field: Int) = Calendar.getInstance(zone).apply { timeInMillis = time }.let { it.get(Calendar.YEAR) * 1000 + if (field == Calendar.MONTH) it.get(Calendar.MONTH) else it.get(Calendar.DAY_OF_YEAR) }
    val day = purchases.filter { key(it.first, Calendar.DAY_OF_YEAR) == key(now, Calendar.DAY_OF_YEAR) }.sumOf { it.second }
    val month = purchases.filter { key(it.first, Calendar.MONTH) == key(now, Calendar.MONTH) }.sumOf { it.second }
    if (day + intent.total > rules.perDay) throw IllegalArgumentException("A compra passa do limite do dia: já foram ${money(day)} de ${money(rules.perDay)}.")
    if (month + intent.total > rules.perMonth) throw IllegalArgumentException("A compra passa do limite do mês: já foram ${money(month)} de ${money(rules.perMonth)}.")
    return rules.perMonth - month - intent.total
  }
}
