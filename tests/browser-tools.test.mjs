import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession } from '../pc/browser-worker.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { personInput } from '../supervisor/browser.mjs';

test('browser arguments reject invalid actions, coordinates, keys, tabs and unsafe URLs', () => {
  for (const args of [{ action: 'script' }, { action: 'click', x: -1, y: 0 }, { action: 'hover', x: 0, y: 801 }, { action: 'key', key: 'Control+A' }, { action: 'drag', x: 1, y: 2 }, { action: 'scroll', x: 0, y: 0, dy: 5001 }]) assert.throws(() => toolArguments('browser.act', args));
  for (const args of [{ action: 'other' }, { action: 'switch', tab: 0 }, { action: 'close', tab: 1.5 }, { action: 'new', url: 'http://127.0.0.1' }]) assert.throws(() => toolArguments('browser.tabs', args));
  assert.deepEqual(toolArguments('browser.find', { query: 'enviar' }), { query: 'enviar', limit: 5 });
  assert.throws(() => toolArguments('browser.find', { query: 'a'.repeat(201) }));
  assert.throws(() => toolArguments('browser.find', { query: 'a', limit: 21 }));
  assert.throws(() => toolArguments('browser.screenshot', { marks: 'true' }));
  assert.throws(() => personInput({ type: 'tab', tab: 6 }));
  assert.deepEqual(personInput({ type: 'tab', tab: 2, injected: true }), { type: 'tab', tab: 2 });
  assert.equal(toolArguments('browser.wait', { url: '/ready' }).url, '/ready');
});

test('Chrome: hover, scroll, drag, find, same-origin frames, marks, popup tabs and live switching', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-browser-tools-'));
  const s = new BrowserSession(directory);
  t.after(async () => { await s.close(); await rm(directory, { recursive: true, force: true }); });
  await s.start();
  await s.page.setContent(`<style>#menu a {display:none} #menu:hover a {display:block} #menu {width:150px;height:80px} #drag {width:100px;height:50px} #space {height:2000px}</style>
    <div id="menu">Menu<a href="#item">Item secreto</a></div><form><input aria-label="Nome"><button>Enviar</button></form>
    <button type="button" onclick="window.open('about:blank')">Nova aba</button>
    <div id="drag" onmousedown="this.dataset.down='yes'" onmouseup="if(this.dataset.down) this.textContent='B A'">A B</div><iframe srcdoc="<button>Dentro</button>"></iframe><div id="space"></div>
    <script>addEventListener('scroll', () => { if (!document.querySelector('#more')) {const p=document.createElement('p');p.id='more';p.textContent='Mais itens';document.body.append(p)} })</script>`);
  const read = await s.command('read');
  assert.ok(!read.elements.some(el => el.label === 'Item secreto'));
  await s.command('act', { action: 'hover', x: 20, y: 20 });
  assert.ok((await s.command('read')).elements.some(el => el.label === 'Item secreto'));
  const found = await s.command('find', { query: 'botão enviar' });
  assert.equal(found.elements[0].label, 'Enviar'); assert.ok(found.elements[0].box);
  assert.equal((await s.command('inspect', { action: 'click', x: found.elements[0].box.x + 2, y: found.elements[0].box.y + 2 })).kind, 'submit');
  const inside = (await s.command('read')).elements.find(el => el.label === 'Dentro');
  assert.ok(inside.frame.startsWith('frame:')); await s.command('click', { id: inside.id });
  const drag = await s.page.locator('#drag').boundingBox();
  await s.command('act', { action: 'drag', x: drag.x + 5, y: drag.y + 5, toX: drag.x + 70, toY: drag.y + 20 });
  assert.equal(await s.page.locator('#drag').innerText(), 'B A');
  const shot = await s.command('screenshot', { marks: true });
  assert.equal(Buffer.from(shot.image, 'base64')[0], 0xff); assert.equal(shot.width, 1280); assert.equal(shot.height, 800);
  assert.equal(await s.page.locator('[data-mybots-marks]').count(), 0);
  await s.command('act', { action: 'scroll', x: 700, y: 400, dy: 2000 });
  await s.page.waitForFunction(() => document.querySelector('#more'));
  assert.match((await s.command('read')).text, /Mais itens/);
  const popupPromise = s.context.waitForEvent('page');
  await s.page.getByText('Nova aba', { exact: true }).click();
  const popup = await popupPromise; await popup.setContent('<title>Popup</title><p>Segunda aba</p>');
  assert.equal((await s.command('tabs', { action: 'list' })).tabs.length, 2);
  const frames = []; s.frame = frame => frames.push(frame); await s.view(true);
  await s.command('tabs', { action: 'switch', tab: 2 });
  assert.match((await s.command('read')).text, /Segunda aba/);
  await s.command('tabs', { action: 'new', url: 'https://example.com' });
  for (let i = 0; i < 100 && !frames.some(f => f.url === 'https://example.com/'); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(frames.some(f => f.url === 'https://example.com/'));
  assert.equal(frames.filter(f => f.image).at(-1).tabs.length, 3);
  await s.command('tabs', { action: 'new' }); await s.command('tabs', { action: 'new' });
  await assert.rejects(s.command('tabs', { action: 'new' }), /5 abas/);
  await s.command('tabs', { action: 'close', tab: 5 });
  assert.equal((await s.command('tabs', { action: 'list' })).tabs.length, 4);
  await s.view(false);
});

test('Android embeds the browser reader and inspection with additional card protection', async () => {
  const { readFile } = await import('node:fs/promises');
  const { readPage, inspectPoint, markPage } = await import('../supervisor/browser-page.mjs');
  const native = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/BotBrowser.kt', import.meta.url), 'utf8');
  for (const [name, fn] of [['READ_PAGE', readPage], ['POINT_JS', inspectPoint], ['MARK_JS', markPage]]) {
    let embedded = native.split(`private val ${name} = """`)[1].split('""".trimIndent()')[0].replaceAll("${'$'}", () => '$');
    if (name === 'READ_PAGE') {
      assert.match(embedded, /el\.type === 'password' \|\| \(\$CARD_JS\)\(el\)/);
      embedded = embedded.replace("el.type === 'password' || ($CARD_JS)(el)", "el.type === 'password'");
    }
    if (name === 'POINT_JS') {
      assert.match(embedded, /\(\$CARD_JS\)\(el\) \? 'campo protegido'/);
      embedded = embedded.replace("el && ($CARD_JS)(el) ? 'campo protegido' : (el?.getAttribute('aria-label') || el?.textContent || el?.name || '')", "el?.getAttribute('aria-label') || el?.textContent || el?.name || ''")
        .replace("el?.type === 'password' || el && ($CARD_JS)(el)", "el?.type === 'password'");
    }
    assert.equal(embedded, fn.toString());
  }
  const action = native.split('private val ACT_JS = """')[1].split('""".trimIndent()')[0];
  assert.equal(typeof new Function(`return (${action})`)(), 'function');
  const { runInNewContext } = await import('node:vm');
  const document = { elementFromPoint: () => ({ closest: () => ({ target: '_blank' }) }) };
  assert.match(JSON.parse(runInNewContext(`(${action})({ action: 'click', x: 10, y: 10 })`, { document })).error, /só quando o bot responde pelo computador/);
  const click = native.split('private val CLICK_JS = """')[1].split('""".trimIndent()')[0].replace('$FIND', 'const el = document.elementFromPoint(0, 0);');
  assert.match(JSON.parse(runInNewContext(`(${click})(1)`, { document })).error, /só quando o bot responde pelo computador/);
  const card = (await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/card-field.js', import.meta.url), 'utf8')).trim();
  const { CARD_FIELD_SOURCE } = await import('../pc/browser-worker.mjs');
  assert.equal(CARD_FIELD_SOURCE, card);
  assert.match(native, /context\.assets\.open\("card-field\.js"\)/);
  const inspect = native.split('private val INSPECT_JS = """')[1].split('""".trimIndent()')[0].replace('$FIND', '').replaceAll('$CARD_JS', () => card);
  const result = runInNewContext(`(${inspect})(1)`, { el: { tagName: 'INPUT', value: 'senha-protegida', placeholder: 'Senha', getAttribute: key => key === 'type' ? 'password' : '' }, location: { href: 'https://example.com' } });
  assert.equal(JSON.parse(result).kind, 'password'); assert.doesNotMatch(result, /senha-protegida/);
  const cardResult = runInNewContext(`(${inspect})(1)`, { el: { tagName: 'INPUT', value: '987', placeholder: '', getAttribute: key => key === 'autocomplete' ? 'cc-csc' : '' }, location: { href: 'https://example.com' } });
  assert.equal(JSON.parse(cardResult).kind, 'password'); assert.doesNotMatch(cardResult, /987/);


});

test('Android and PC share conservative card fields and mask frames only on checkout pages', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const { CARD_FIELD_SOURCE } = await import('../pc/browser-worker.mjs');
  const native = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/BotBrowser.kt', import.meta.url), 'utf8');
  const card = runInNewContext(`(${CARD_FIELD_SOURCE})`);
  const element = (id = '', autocomplete = '', value = '') => ({ tagName: 'INPUT', id, name: '', placeholder: '', value, getAttribute: key => key === 'autocomplete' ? autocomplete : '' });
  for (const id of ['cardapio-busca', 'discard-reason', 'scorecard', 'credit-simulator', 'gift-card-code', 'billing-name', 'billing-address']) assert.equal(card(element(id)), '', id);
  for (const [id, autocomplete] of [['card-number', ''], ['card_cvv', ''], ['', 'cc-number'], ['', 'cc-csc']]) assert.ok(card(element(id, autocomplete)), `${id} ${autocomplete}`);
  const type = native.split('private val TYPE_JS = """')[1].split('""".trimIndent()')[0].replace('$FIND', '').replaceAll('$CARD_JS', () => CARD_FIELD_SOURCE);
  for (const id of ['cardapio-busca', 'discard-reason', 'scorecard', 'credit-simulator', 'gift-card-code', 'billing-name', 'billing-address']) {
    const el = element(id); el.focus = () => {}; el.scrollIntoView = () => {}; el.dispatchEvent = () => {}; el.tagName = 'INPUT';
    const context = { el, Event: class {}, InputEvent: class {}, HTMLInputElement: class { set value(v) { this._value = v; } } };
    const result = JSON.parse(runInNewContext(`(${type})({ text: 'livre' })`, context));
    assert.ok(!result.error, `${id}: ${result.error}`); assert.equal(el._value, 'livre');
  }
  const cvv = element('', 'cc-csc', '987');
  assert.match(JSON.parse(runInNewContext(`(${type})({ text: '456' })`, { el: cvv })).error, /protegidos/);
  const mask = native.split('private val MASK_JS get() = """')[1].split('""".trimIndent()')[0].replaceAll('$CARD_JS', () => CARD_FIELD_SOURCE).replaceAll('$MARK_JS', '() => {}').replaceAll('$READ_PAGE', '() => ({elements:[]})');
  const box = el => Object.assign(el, { getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }) });
  const iframe = src => box({ tagName: 'IFRAME', src });
  const calc = (fields, frames) => JSON.parse(runInNewContext(`(${mask})({marks:false,codes:[]})`, { URL, document: { baseURI: 'https://loja.com/', querySelectorAll: selector => selector === 'iframe' ? frames : fields } })).boxes.length;
  assert.equal(calc([], [iframe('https://youtube.com/embed/video'), iframe('https://maps.google.com/map')]), 0);
  assert.equal(calc([], [iframe('https://js.stripe.com/v3/checkout')]), 1);
  assert.equal(calc([box(element('', 'cc-number'))], [iframe('https://youtube.com/embed/video')]), 2);
  assert.equal(calc([], [iframe('https://stripe.com.evil.example/embed')]), 0);
});
