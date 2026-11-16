import test from 'node:test';
import assert from 'node:assert/strict';
import { showDiagnostics, diagnosticText } from '../mobile/diagnostics.js';

test('offline Android diagnostics remain visible and copyable without calling the supervisor', async () => {
  const shown = []; let calls = 0;
  await showDiagnostics({ readDeviceInfo: async () => 'POCO · Linux exit=1\nproot: fatal error', call: () => { calls++; throw Error('disconnected'); }, connected: false, publish: text => shown.push(text) });
  assert.equal(calls, 0); assert.match(shown.at(-1), /POCO/); assert.match(shown.at(-1), /proot: fatal error/); assert.match(shown.at(-1), /diretamente do aparelho/);
});

test('a lost connection cannot replace local diagnostics with an RPC error', async () => {
  const shown = [];
  await showDiagnostics({ readDeviceInfo: async () => 'Local report', call: async () => { assert.equal(shown[0], 'Local report'); throw Error('supervisor disconnected'); }, connected: true, publish: text => shown.push(text) });
  assert.match(shown.at(-1), /^Local report/); assert.match(shown.at(-1), /complementar indisponível/);
});

test('a hung supervisor does not hold the diagnostic button indefinitely', async () => {
  const shown = [];
  await showDiagnostics({ readDeviceInfo: async () => 'Android report', call: () => new Promise(() => {}), connected: true, publish: text => shown.push(text), timeoutMs: 10 });
  assert.match(shown.at(-1), /^Android report/); assert.match(shown.at(-1), /não respondeu/);
});

test('successful diagnostics append supervisor details, and credentials are hidden', async () => {
  const shown = []; const secret = 'a'.repeat(64);
  await showDiagnostics({ readDeviceInfo: async () => `Android\nAuthorization: Bearer ${secret}`, call: async () => ({ report: 'Node running\naccess_token="secret_value"' }), connected: true, publish: text => shown.push(text) });
  assert.match(shown.at(-1), /Node running/); assert.doesNotMatch(shown.join('\n'), /secret_value|a{64}/);
  assert.doesNotMatch(diagnosticText('encryptedToken: encrypted_payload password=secret_password'), /encrypted_payload|secret_password/);
});

test('quoted credentials with spaces and escaped quotes cannot leak in diagnostic text', () => {
  const value = diagnosticText('password="top secret phrase"\n{"access_token":"abc def","senha":"another secret"}\npassword=unquoted_secret');
  assert.doesNotMatch(value, /top|secret|phrase|abc|def|another|unquoted/);
});

test('zero padding in a crash log cannot truncate the following error on Android', () => {
  assert.equal(diagnosticText('before\u0000\u0000after\u0007\ncrash'), 'beforeafter\ncrash');
});
