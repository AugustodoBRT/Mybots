import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQr, connectToComputer } from '../mobile/pc-client.js';
import { iphoneLink, PWA_URL } from '../pc/ui.mjs';

const qr = 'mybots://computador?v=1&id=abc123&n=Meu+PC&p=3230&q=3233&c=codigo-12345&a=192.168.0.2%2C100.70.1.2&r=wss%3A%2F%2Fmybots-rele.duckdns.org';

test('the iPhone link carries the pairing in the fragment, and reading it gives the same pairing as the QR', () => {
  const link = iphoneLink(qr);
  assert.ok(link.startsWith(PWA_URL + '#p='));
  assert.equal(new URL(link).search, '');   // nothing goes to the server: only the fragment has it
  assert.deepEqual(parseQr(link), parseQr(qr));
  assert.deepEqual(parseQr(`  ${iphoneLink(qr, 'http://127.0.0.1:8099/')}  `), parseQr(qr));
  assert.throws(() => parseQr('https://example.com/#p=nada'), /não é de um computador/);
  assert.throws(() => parseQr('https://example.com/'), /não é de um computador/);
});

test('a page served over https only uses the relay: the computer\'s plain ws:// address is never tried', async () => {
  const urls = [];
  class Fake { constructor(url) { urls.push(url); setTimeout(() => this.onerror?.(new Error('x')), 0); } close() {} send() {} }
  const target = { id: 'abc123', port: 3233, addresses: ['192.168.0.2'], relay: 'wss://mybots-rele.duckdns.org', secret: 'segredo' };
  const before = globalThis.location;
  try {
    globalThis.location = { protocol: 'https:' };
    await assert.rejects(connectToComputer(Fake, target, { id: 'app-1', name: 'iPhone' }));
    assert.equal(urls.length, 1); assert.ok(urls[0].startsWith('wss://mybots-rele.duckdns.org/?role=guest&room='));
    urls.length = 0; globalThis.location = { protocol: 'http:' };
    await assert.rejects(connectToComputer(Fake, target, { id: 'app-1', name: 'iPhone' }));
    assert.ok(urls.some(url => url.startsWith('ws://192.168.0.2:3233')));   // outside https the direct path is still tried first
  } finally { if (before === undefined) delete globalThis.location; else globalThis.location = before; }
});
