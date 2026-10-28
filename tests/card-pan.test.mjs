import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { redactCardNumbers } from '../supervisor/card-pan.mjs';
import { BrowserSession } from '../pc/browser-worker.mjs';

const ordinary = [
  'Fale com +55 31 99999-8888',
  'https://loja.com/p?t=1730086400000',
  'Código de barras 7891000315507',
  'Pedido 2026102800012345',
  'https://loja.com/4242424242424242?t=4242424242424242',
  'loja.com/p?t=4242424242424242', 'loja.com/4242424242424242',
  'a4242424242424242', '4242424242424242b', '4242424242424241'
];
const protectedNumbers = ['4242 4242 4242 4242', '4242424242424242'];

test('PAN detection on the PC and its serialized page code requires a known brand, Luhn, text boundaries and no URL', () => {
  const session = new BrowserSession('/tmp/card-pan-test');
  const embedded = new Function(`return (${redactCardNumbers.toString()})`)();
  for (const value of ordinary) for (const redact of [redactCardNumbers, embedded, input => session.redact(input)]) assert.equal(redact(value), value);
  for (const value of protectedNumbers) for (const redact of [redactCardNumbers, embedded, input => session.redact(input)]) assert.equal(redact(value), '[cartão protegido]');
  assert.equal(redactCardNumbers('9999999999999999'), '9999999999999999');
});

test('Android accessibility executes the same PAN cases without marking a telephone as a card', { skip: !existsSync('/opt/intellij-idea-ultimate-edition/plugins/Kotlin/kotlinc/bin/kotlinc') }, () => {
  const file = readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/MyBotsAccess.kt', import.meta.url), 'utf8');
  const card = file.split('internal object CardProtection {')[1].split('\n}\n')[0];
  const dir = mkdtempSync(join(tmpdir(), 'mybots-card-kotlin-'));
  try {
    const kotlin = `class AccessibilityNodeInfo(val text: CharSequence?, val viewIdResourceName: String? = null, val hintText: CharSequence? = null, val contentDescription: CharSequence? = null)\nobject Build { object VERSION { const val SDK_INT = 35 } }\ninternal object CardProtection {${card}\n}\nfun main() {\n${ordinary.map(value => `  check(CardProtection.redact(${JSON.stringify(value)}) == ${JSON.stringify(value)})\n  check(!CardProtection.sensitive(AccessibilityNodeInfo(${JSON.stringify(value)})))`).join('\n')}\n${protectedNumbers.map(value => `  check(CardProtection.redact(${JSON.stringify(value)}) == "[cartão protegido]")\n  check(CardProtection.sensitive(AccessibilityNodeInfo(${JSON.stringify(value)})))`).join('\n')}\n${['cardapio-busca', 'discard-reason', 'scorecard', 'credit-simulator', 'gift-card-code', 'billing-name', 'billing-address'].map(value => `  check(!CardProtection.sensitive(AccessibilityNodeInfo("", viewIdResourceName = ${JSON.stringify(value)})))`).join('\n')}\n  check(CardProtection.sensitive(AccessibilityNodeInfo("987", hintText = "cvv")))\n}`;
    writeFileSync(join(dir, 'Main.kt'), kotlin);
    execFileSync('/opt/intellij-idea-ultimate-edition/plugins/Kotlin/kotlinc/bin/kotlinc', [join(dir, 'Main.kt'), '-include-runtime', '-d', join(dir, 'test.jar')], { stdio: 'pipe', timeout: 60000 });
    execFileSync('java', ['-jar', join(dir, 'test.jar')], { stdio: 'pipe', timeout: 10000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PC browser page reads keep ordinary numbers and mask genuine card numbers', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-pan-browser-'));
  const session = new BrowserSession(dir);
  try {
    await session.start();
    await session.page.setContent([...ordinary.slice(0, 7), ...protectedNumbers].map(value => `<p>${value}</p>`).join(''));
    const result = await session.command('read');
    for (const value of ordinary.slice(0, 7)) assert.ok(result.text.includes(value), `${value} deve continuar visível`);
    assert.equal(result.text.split("\n").filter(line => line.trim() === "[cartão protegido]").length, protectedNumbers.length);
  } finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }
});
