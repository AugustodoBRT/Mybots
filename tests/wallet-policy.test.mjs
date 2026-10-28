import test from 'node:test';
import assert from 'node:assert/strict';
import { readCheckoutTotal } from '../supervisor/wallet-checkout.mjs';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession } from '../pc/browser-worker.mjs';

const kotlinCompiler = '/opt/intellij-idea-ultimate-edition/plugins/Kotlin/kotlinc/bin/kotlinc';
const policy = new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/WalletPolicy.kt', import.meta.url);

// The rules are enforced by the app (WalletPolicy.kt), never by the supervisor or the model: compiled and run here.
test('carteira no app: loja, categoria, total da página e limites por compra, dia e mês, sem esperar relógio real', { skip: !existsSync(kotlinCompiler) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-wallet-policy-'));
  try {
    writeFileSync(join(dir, 'Policy.kt'), readFileSync(policy, 'utf8'));
    writeFileSync(join(dir, 'Main.kt'), `package expo.modules.termuxbridge
import java.util.TimeZone
fun fails(message: String, block: () -> Unit) { val error = runCatching(block).exceptionOrNull() ?: error("deveria recusar: $message"); check(error.message!!.contains(message)) { "esperava '$message', veio '\${error.message}'" } }
fun at(iso: String) = java.time.Instant.parse(iso).toEpochMilli()
fun main() {
  val zone = TimeZone.getTimeZone("America/Sao_Paulo")
  val rules = WalletRules(false, 5000, 8000, 10000, listOf("loja.example"), listOf("bloqueada.loja.example"), listOf("livros"))
  val intent = WalletIntent("loja.example", listOf("Livro"), "Livros", 4000)
  val url = "https://www.loja.example/checkout"; val now = at("2026-10-28T15:00:00Z")
  check(WalletPolicy.check(rules, intent, url, 4000, emptyList(), now, zone) == 6000L)
  fails("não é o da página") { WalletPolicy.check(rules, intent, url, 4001, emptyList(), now, zone) }
  fails("único total") { WalletPolicy.check(rules, intent, url, null, emptyList(), now, zone) }
  fails("não é a do checkout") { WalletPolicy.check(rules, intent, "https://outra.example/checkout", 4000, emptyList(), now, zone) }
  fails("não é a do checkout") { WalletPolicy.check(rules, intent, "https://loja.example.evil.com/checkout", 4000, emptyList(), now, zone) }
  fails("https") { WalletPolicy.check(rules, intent, "http://loja.example/checkout", 4000, emptyList(), now, zone) }
  fails("proibida") { WalletPolicy.check(rules, intent, "https://bloqueada.loja.example/c", 4000, emptyList(), now, zone) }
  fails("permitidas") { WalletPolicy.check(rules.copy(allowed = listOf("outra.example")), intent, url, 4000, emptyList(), now, zone) }
  fails("categoria") { WalletPolicy.check(rules, intent.copy(category = "eletrônicos"), url, 4000, emptyList(), now, zone) }
  fails("limite por compra") { WalletPolicy.check(rules.copy(perPurchase = 3999), intent, url, 4000, emptyList(), now, zone) }
  fails("limite do dia") { WalletPolicy.check(rules, intent, url, 4000, listOf(at("2026-10-28T12:00:00Z") to 4001L), now, zone) }
  fails("limite do mês") { WalletPolicy.check(rules, intent, url, 4000, listOf(at("2026-10-02T12:00:00Z") to 6001L), now, zone) }
  // Which card a bot pays with: only the ones the person allowed for that bot, and the bot names one when there are several.
  val cards = mapOf("a" to "1111", "b" to "2222", "c" to "3333")
  check(WalletPolicy.pickCard(cards, listOf("b"), "") == "b")
  check(WalletPolicy.pickCard(cards, listOf("a", "b"), "2222") == "b")
  fails("não liberou nenhum cartão") { WalletPolicy.pickCard(cards, emptyList(), "") }
  fails("não liberou nenhum cartão") { WalletPolicy.pickCard(cards, listOf("apagado"), "") }
  fails("não pode usar o cartão final 3333") { WalletPolicy.pickCard(cards, listOf("a", "b"), "3333") }
  fails("mais de um cartão liberado") { WalletPolicy.pickCard(cards, listOf("a", "b"), "") }
  fails("Nenhum cartão cadastrado") { WalletPolicy.pickCard(emptyMap(), listOf("a"), "") }
  fails("congelada") { WalletPolicy.check(rules.copy(frozen = true), intent, url, 4000, emptyList(), now, zone) }
  fails("ainda não foram definidas") { WalletPolicy.check(rules.copy(perDay = 0), intent, url, 4000, emptyList(), now, zone) }
  // The day and the month turn at midnight on the phone's clock (Brasília is UTC-3), with the time given, not waited for.
  val spent = listOf(at("2026-10-10T20:00:00Z") to 6001L)
  fails("limite do mês") { WalletPolicy.check(rules, intent, url, 4000, spent, at("2026-11-01T02:59:00Z"), zone) }
  check(WalletPolicy.check(rules, intent, url, 4000, spent, at("2026-11-01T03:00:00Z"), zone) == 6000L)
  check(WalletPolicy.money(123456789) == "R$ 1.234.567,89")
}`);
    execFileSync(kotlinCompiler, [join(dir, 'Policy.kt'), join(dir, 'Main.kt'), '-include-runtime', '-d', join(dir, 'test.jar')], { stdio: 'pipe', timeout: 90000 });
    execFileSync('java', ['-jar', join(dir, 'test.jar')], { stdio: 'pipe', timeout: 10000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkout lido no Chrome: total único visível é obrigatório', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-checkout-'));
  const browser = new BrowserSession(directory);
  t.after(async () => { await browser.close(); await rm(directory, { recursive: true, force: true }); });
  await browser.start();
  await browser.page.setContent('<div>Subtotal</div><div>R$ 35,00</div><div>Total do pedido</div><div>R$ 40,00</div><iframe srcdoc="<input autocomplete=cc-number>"></iframe>');
  assert.deepEqual(await browser.page.evaluate(readCheckoutTotal), { total: 4000 });
  // The phone's browser reads the total with the very same code.
  assert.equal(readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/assets/checkout-total.js', import.meta.url), 'utf8').trim(), readCheckoutTotal.toString());
  await browser.page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div>Total</div><div>R$ 41,00</div>'));
  assert.deepEqual(await browser.page.evaluate(readCheckoutTotal), { total: null });
  await browser.page.setContent('<div>Total</div><div style="display:none">R$ 40,00</div>');
  assert.deepEqual(await browser.page.evaluate(readCheckoutTotal), { total: null });
  await browser.page.setContent('<div data-order-total="R$ 40,00">R$ 41,00</div>');
  assert.deepEqual(await browser.page.evaluate(readCheckoutTotal), { total: 4100 });
});
