import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createCipheriv, publicEncrypt } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { BrowserSession } from '../pc/browser-worker.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
const CARD = '4242424242424242', CVV = '987';
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// The app's browser host: answers "pay" like BotBrowser.kt, after its own rules (WalletPolicy.kt) said yes or no.
function fakeApp(app, answer) {
  const seen = []; let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const response = await fetch(`http://127.0.0.1:${app.port}/device/browser`, { headers: { Authorization: 'Bearer ' + app.token } });
        if (response.status !== 200) break;
        for (const command of (await response.json()).commands) {
          seen.push(command);
          let body; try { body = { id: command.id, ok: true, value: answer(command) }; } catch (error) { body = { id: command.id, ok: false, error: error.message }; }
          await fetch(`http://127.0.0.1:${app.port}/device/browser/result`, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        }
      } catch { break; }
    }
  })();
  return { seen, stop: () => { stopped = true; } };
}

async function setup(t, access, answer) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-wallet-'));
  const app = await createSupervisor({ directory, port: 0, codex, approvalMs: 3000, notify: async () => ({ notified: true }), execute: async () => ({ text: 'Ok.', ...selection }) });
  const phone = fakeApp(app, answer);
  t.after(async () => { phone.stop(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  await until(() => app.state().browser.available);
  const bot = await app.rpc('bot.create', { name: 'Compras', access, ...selection });
  const open = () => {
    const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Compre o livro', selection).id); const cap = app.tools.open(task, new AbortController().signal, 'phone'); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(cap.close);
    return { task, call: (name, args = {}) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args }) };
  };
  const card = async () => { await until(() => app.state().approvals.length === 1); return app.state().approvals[0]; };
  const respond = async approved => { const item = await card(); await app.rpc('approval.respond', { approvalId: item.id, actionHash: item.actionHash, approved, always: false }); return item; };
  return { app, bot, phone, open, card, respond };
}

const purchase = { store: 'loja.example', items: ['Livro de receitas'], category: 'livros', total: 89.9 };
const paid = command => command.op === 'pay' ? { url: 'https://loja.example/checkout', title: 'Pagamento', paid: true, card: 'final 4242', total: 'R$ 89,90' } : { url: 'https://loja.example/checkout', title: 'Pagamento' };

test('browser_pay validates what the bot declares and converts reais to centavos', () => {
  assert.deepEqual(toolArguments('browser.pay', purchase), { ...purchase, total: 8990 });
  assert.throws(() => toolArguments('browser.pay', { ...purchase, total: 89.999 }), /duas casas/);
  assert.throws(() => toolArguments('browser.pay', { ...purchase, total: -1 }), /total/);
  assert.throws(() => toolArguments('browser.pay', { ...purchase, items: [] }), /items/);
  assert.throws(() => toolArguments('browser.pay', { ...purchase, card: CARD }), /não permitido/);
});

test('below Livre every purchase asks, without "Sempre permitir"; the app gets the intent in centavos and the activity records it', async t => {
  const f = await setup(t, 'full', paid);
  const run = f.open();
  const pending = run.call('browser_pay', purchase);
  const item = await f.respond(true);
  assert.equal(item.title, 'Pagar R$ 89,90 com a carteira'); assert.equal(item.canAlways, false);
  assert.match(item.summary, /Loja: loja\.example/); assert.match(item.summary, /Livro de receitas/);
  const result = await pending;
  assert.equal(result.paid, true); assert.equal(result.card, 'final 4242'); assert.match(result.next, /finalizar/);
  const sent = f.phone.seen.find(command => command.op === 'pay');
  assert.deepEqual(sent.args.intent, { ...purchase, total: 8990 }); assert.equal(sent.args.botName, 'Compras');
  assert.match(f.app.state().activity.map(entry => entry.detail).join('\n'), /Compras pagou R\$ 89,90 em loja\.example: Livro de receitas/);
  // A second purchase asks again: approvals for paying are never remembered.
  const again = run.call('browser_pay', purchase);
  await f.respond(false);
  await assert.rejects(again, /recusada/);
  assert.equal(f.phone.seen.filter(command => command.op === 'pay').length, 1);
});

test('on Livre paying asks while it is on the list (the default) and not after the person takes it off', async t => {
  const f = await setup(t, 'free', paid);
  const run = f.open();
  const asked = run.call('browser_pay', purchase);
  await f.respond(true); await asked;
  await f.app.rpc('free.set', { ask: ['risky'] });
  await run.call('browser_pay', purchase);
  assert.equal(f.app.state().approvals.length, 0);
  assert.equal(f.phone.seen.filter(command => command.op === 'pay').length, 2);
});

test('a refusal by the app\'s rules reaches the bot as final and is recorded', async t => {
  const f = await setup(t, 'free', command => { if (command.op === 'pay') throw new Error('A compra passa do limite do dia: já foram R$ 60,01 de R$ 80,00.'); return paid(command); });
  await f.app.rpc('free.set', { ask: [] });
  await assert.rejects(f.open().call('browser_pay', purchase), /limite do dia/);
  assert.match(f.app.state().activity.map(entry => entry.detail).join('\n'), /limite do dia/);
});

test('Congelar from the app or the notice stops the paying turn at once', async t => {
  const f = await setup(t, 'free', paid);
  await f.app.rpc('free.set', { ask: [] });
  let paidNow; const done = new Promise(resolve => { paidNow = resolve; });
  const task = f.app.db.enqueue(f.bot.id, randomUUID(), 'Compre', selection);
  f.app.queue.execute = async (bot, prompt, { tools, signal }) => {
    const bridgeId = randomUUID(); f.app.tools.context(tools.token, bridgeId, true);
    await f.app.tools.callMcp(tools.token, { bridgeId, callId: randomUUID(), name: 'browser_pay', args: purchase });
    paidNow();
    // The bot would now click "finalizar"; it is still working when the person freezes the wallet.
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Resposta interrompida.')), { once: true }));
  };
  f.app.queue.schedule();
  await done;
  const answer = await fetch(`http://127.0.0.1:${f.app.port}/device/phone`, { method: 'POST', headers: { Authorization: 'Bearer ' + f.app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'walletFrozen' }) });
  assert.deepEqual(await answer.json(), { frozen: true, stopped: 1 });
  await until(() => f.app.db.task(task.id).state === 'cancelled');
  assert.match(f.app.state().activity.map(entry => entry.detail).join('\n'), /Carteira congelada: o pagamento foi interrompido/);
});

// What WalletPay.forComputer does on the phone: the card encrypted to the browser process's one-time key.
function encryptCard(request, card) {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(request.challenge));
  const data = Buffer.concat([cipher.update(JSON.stringify({ url: request.url, challenge: request.challenge, total: request.pageTotal, ...card })), cipher.final()]);
  return { key: publicEncrypt({ key: Buffer.from(request.publicKey, 'base64'), format: 'der', type: 'spki', oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

test('computer: the checkout\'s own total, the card in the page and in the processor\'s frame only, never in reads or pictures', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-pay-'));
  const s = new BrowserSession(directory);
  t.after(async () => { await s.close(); await rm(directory, { recursive: true, force: true }); });
  await s.start();
  const frame = name => `<label>${name}<input autocomplete="cc-csc" id="cvc"></label><input autocomplete="cc-exp" id="exp" placeholder="MM / AA">`;
  await s.context.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: frame('Stripe') }));
  await s.context.route('https://ads.example.net/**', route => route.fulfill({ contentType: 'text/html', body: frame('Anúncio') }));
  await s.context.route('https://example.com/checkout', route => route.fulfill({ contentType: 'text/html', body: `<h1>Pagamento</h1><div>Total do pedido</div><div id="total">R$ 89,90</div>
    <input autocomplete="cc-number" id="pan"><input autocomplete="cc-name" id="holder"><input id="busca" name="cardapio-busca">
    <iframe src="https://js.stripe.com/v3/elements"></iframe><iframe src="https://ads.example.net/frame"></iframe>` }));
  await s.command('open', { url: 'https://example.com/checkout' });
  const card = { number: CARD, cvv: CVV, month: 7, year: 2031, name: 'Joana Teste' };

  const request = await s.command('pay', {});
  assert.equal(request.pageTotal, 8990); assert.equal(request.url, 'https://example.com/checkout');
  const filled = await s.command('pay_fill', encryptCard(request, card));
  assert.equal(filled.paid, true); assert.ok(filled.filled.includes('number') && filled.filled.includes('security'));
  assert.equal(await s.page.locator('#pan').inputValue(), CARD); assert.equal(await s.page.locator('#holder').inputValue(), 'Joana Teste');
  assert.equal(await s.page.locator('#busca').inputValue(), '');
  const stripe = s.page.frames().find(item => item.url().startsWith('https://js.stripe.com')), ads = s.page.frames().find(item => item.url().startsWith('https://ads.example.net'));
  assert.equal(await stripe.locator('#cvc').inputValue(), CVV); assert.equal(await stripe.locator('#exp').inputValue(), '07/31');
  assert.equal(await ads.locator('#cvc').inputValue(), ''); // not a payment processor: never gets the card
  // The page echoes the card: reads, titles and pictures still never carry it.
  await s.page.evaluate(number => { document.title = 'Cartão ' + number; document.body.insertAdjacentHTML('beforeend', `<p>${number.replace(/(\d{4})(?=\d)/g, '$1 ')}</p><p>CVV 987</p>`); }, CARD);
  const read = JSON.stringify(await s.command('read', {}));
  assert.doesNotMatch(read, /4242 ?4242 ?4242 ?4242|987/);
  const shot = await s.command('screenshot', {});
  assert.doesNotMatch(JSON.stringify({ ...shot, image: '' }), /4242424242424242|987/);

  // A replayed or tampered envelope fills nothing, and a total that changed after the request is refused.
  await assert.rejects(s.command('pay_fill', encryptCard(request, card)), /venceu|Nada foi preenchido/);
  const second = await s.command('pay', {});
  await s.page.evaluate(() => { document.querySelector('#total').textContent = 'R$ 899,00'; });
  await assert.rejects(s.command('pay_fill', encryptCard(second, card)), /total da página mudou/);
  const third = await s.command('pay', {});
  await assert.rejects(s.command('pay_fill', encryptCard({ ...third, challenge: 'x'.repeat(32) }, card)), /celular|não confere/);
  // Congelar: the card leaves the fields.
  await s.command('pay_clear', {});
  assert.equal(await s.page.locator('#pan').inputValue(), '');
  assert.equal(await stripe.locator('#cvc').inputValue(), '');
});

test('the card-fill code is one file for the computer and the phone, and the phone\'s frames fill only through the app', async () => {
  const assets = new URL('../mobile/modules/termux-bridge/android/src/main/assets/', import.meta.url);
  const observer = await readFile(new URL('card-observer.js', assets), 'utf8');
  assert.match(observer, /__MYBOTS_CARD_FILL__/); assert.match(observer, /window !== window\.top/);
  const native = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/BotBrowser.kt', import.meta.url), 'utf8');
  assert.match(native, /asset\(context, "card-fill\.js"\)/); assert.match(native, /asset\(context, "checkout-total\.js"\)/);
  assert.match(native, /WalletPay\.authorize\(/);
  // The card is known to the redaction before it is typed, and the rules are checked again just before and after.
  assert.ok(native.indexOf('rememberCard(tab, "number", card.getString("number"))') < native.indexOf('fillScript(context)})($input)'));
  assert.equal((native.match(/WalletPay\.valid\(context, payment\.generation\)/g) || []).length, 2);
});
