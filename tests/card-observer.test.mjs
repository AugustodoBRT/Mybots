import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession } from '../pc/browser-worker.mjs';

const field = readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/assets/card-field.js', import.meta.url), 'utf8');
const fill = readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/assets/card-fill.js', import.meta.url), 'utf8').trim().replace('__MYBOTS_CARD_FIELD__', field.trim());
const observer = readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/assets/card-observer.js', import.meta.url), 'utf8').replace('__MYBOTS_CARD_FIELD__', field).replace('__MYBOTS_CARD_FILL__', fill);

test('WebView card observer remembers true fields through edits/removal and ignores ordinary inputs', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-card-observer-'));
  const session = new BrowserSession(dir);
  try {
    await session.start();
    await session.page.setContent('<input id="pan" autocomplete="cc-number"><input id="security" autocomplete="cc-csc"><input id="billing-name"><input id="gift-card-code"><iframe srcdoc="<input id=inside autocomplete=cc-csc>"></iframe>');
    await session.page.evaluate(() => { window.messages = []; window.mybotsCardSecret = { postMessage: value => window.messages.push(JSON.parse(value)), addEventListener: () => {} }; });
    await session.page.evaluate(observer);
    await session.page.evaluate(() => {
      const pan = document.querySelector('#pan'), cvv = document.querySelector('#security');
      pan.value = '4242 4242 4242 4242'; cvv.value = '987';
      pan.value = ''; cvv.value = '654'; cvv.remove();
      document.querySelector('#billing-name').value = 'Joana';
      document.querySelector('#gift-card-code').value = 'GIFT-CODE';
    });
    const values = await session.page.evaluate(() => window.messages);
    assert.ok(values.some(item => item.kind === 'number' && item.value === '4242 4242 4242 4242'));
    assert.ok(values.some(item => item.kind === 'security' && item.value === '987'));
    assert.ok(values.some(item => item.kind === 'security' && item.value === '654'));
    assert.ok(!values.some(item => item.value === 'Joana' || item.value === 'GIFT-CODE'));
    assert.equal(await session.page.evaluate(() => typeof window.__mybotsCardObserve), 'boolean');
    const child = session.page.frames().find(frame => frame !== session.page.mainFrame());
    await child.evaluate(() => { window.messages = []; window.mybotsCardSecret = { postMessage: value => window.messages.push(JSON.parse(value)), addEventListener: () => {} }; });
    await child.evaluate(observer);
    await child.locator('#inside').fill('123');
    assert.ok((await child.evaluate(() => window.messages)).some(item => item.kind === 'security' && item.value === '123'));
  } finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }
});
