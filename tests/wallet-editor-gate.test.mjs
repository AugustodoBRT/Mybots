import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const kotlinCompiler = '/opt/intellij-idea-ultimate-edition/plugins/Kotlin/kotlinc/bin/kotlinc';
const base = new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/', import.meta.url);

test('wallet editor invalidates in-flight commands and waits for in-flight gestures', { skip: !existsSync(kotlinCompiler) }, () => {
  const source = readFileSync(new URL('WalletEditorGate.kt', base), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'mybots-wallet-gate-'));
  try {
    writeFileSync(join(dir, 'Gate.kt'), source);
    writeFileSync(join(dir, 'Main.kt'), `package expo.modules.termuxbridge
fun main() {
  val old = WalletEditorGate.token()
  check(WalletEditorGate.open())
  check(runCatching { WalletEditorGate.token() }.isFailure)
  check(runCatching { WalletEditorGate.action(old) { error("must not act") } }.isFailure)
  WalletEditorGate.close()
  check(runCatching { WalletEditorGate.check(old) }.isFailure)
  val next = WalletEditorGate.token()
  check(runCatching { WalletEditorGate.check(next) }.isSuccess)
  WalletEditorGate.beginGesture(next)
  check(!WalletEditorGate.open())
  WalletEditorGate.endGesture()
  check(WalletEditorGate.open())
  WalletEditorGate.close()
  check(runCatching { WalletEditorGate.beginGesture(next) }.isFailure)
}`);
    execFileSync(kotlinCompiler, [join(dir, 'Gate.kt'), join(dir, 'Main.kt'), '-include-runtime', '-d', join(dir, 'test.jar')], { stdio: 'pipe', timeout: 60000 });
    execFileSync('java', ['-jar', join(dir, 'test.jar')], { stdio: 'pipe', timeout: 10000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both editors and phone access use the gate; wallet rules are excluded from backup and transfer', () => {
  const phone = readFileSync(new URL('MyBotsAccess.kt', base), 'utf8');
  const card = readFileSync(new URL('CardEditor.kt', base), 'utf8');
  const rules = readFileSync(new URL('WalletGuard.kt', base), 'utf8');
  for (const source of [card, rules]) { assert.match(source, /WalletEditorGate\.open\(\)/); assert.match(source, /WalletEditorGate\.close\(\)/); }
  assert.match(phone, /editorToken\.set\(WalletEditorGate\.token\(\)\)/);
  assert.match(phone, /WalletEditorGate\.check\(editorToken\.get\(\)/);
  assert.match(phone, /WalletEditorGate\.beginGesture\(token\)/);
  const backup = readFileSync(new URL('../mobile/android/app/src/main/res/xml/backup_rules.xml', import.meta.url), 'utf8');
  const extraction = readFileSync(new URL('../mobile/android/app/src/main/res/xml/data_extraction_rules.xml', import.meta.url), 'utf8');
  assert.equal((backup.match(/mybots_wallet\.xml/g) || []).length, 1);
  assert.equal((extraction.match(/mybots_wallet\.xml/g) || []).length, 2);
});
