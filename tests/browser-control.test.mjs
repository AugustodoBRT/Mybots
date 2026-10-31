import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession } from '../pc/browser-worker.mjs';

const real = { skip: !existsSync('/usr/bin/google-chrome-stable'), timeout: 30000 };
async function session(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-control-'));
  const s = new BrowserSession(directory);
  t.after(async () => { await s.close(); await rm(directory, { recursive: true, force: true }); });
  await s.start(); return s;
}
test('mobile viewport uses CSS size and density, persists per origin and restores desktop', real, async t => {
  const s = await session(t);
  await s.page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><input>');
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2 });
  assert.deepEqual(await s.page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio, navigator.maxTouchPoints]), [360,640,2,5]);
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2, desktop: true });
  assert.equal(await s.page.evaluate(() => innerWidth), 1280);
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2 });
  assert.equal(s.desktop, true);
  await s.deviceView({ restore: true });
  assert.deepEqual(await s.page.evaluate(() => [innerWidth,innerHeight,devicePixelRatio,navigator.maxTouchPoints]), [1280,800,1,0]);
});

test('the computer window fits the page to its own area as a desktop browser, with the mouse and no touch', real, async t => {
  const s = await session(t);
  await s.page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><input>');
  await s.input({ type: 'viewport', width: 1500, height: 777, deviceScaleFactor: 1, fit: true });
  assert.deepEqual(await s.page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio, navigator.maxTouchPoints]), [1500, 777, 1, 0]);
  assert.deepEqual(s.viewportSize(), { width: 1500, height: 777 });
  assert.equal(s.desktop, true);
  await s.deviceView({ restore: true });
  assert.equal(s.fit, false);
});

test('real touch dispatch reaches the page and preserves start/move/end', real, async t => {
  const s = await session(t);
  await s.page.setContent('<meta name="viewport" content="width=device-width"><script>window.touches=[]; for(const k of ["touchstart","touchmove","touchend"]) document.addEventListener(k,e=>touches.push(e.type));</script>');
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2 });
  for (const phase of ['touchStart','touchMove','touchEnd']) await s.input({ type: 'touch', phase, points: phase === 'touchEnd' ? [] : [{ x: .5, y: phase === 'touchMove' ? .4 : .5, id: 0 }] });
  await s.page.waitForFunction(() => touches.length === 3);
  assert.deepEqual(await s.page.evaluate(() => touches), ['touchstart','touchmove','touchend']);
});

test('coordinates undo zoom, pan and quarter-turn rotation and clamp outside touches', async () => {
  const { framePoint, zoomAt, touchPoint } = await import('../mobile/browser-coordinates.js');
  assert.deepEqual(touchPoint({ locationX:180,locationY:320 }, { x:10,y:53,width:360,height:640 }, { scale:1 }), { id:0,x:.5,y:.5 });
  for (const rotation of [0,90,180,270]) for (const scale of [1,2,4]) {
    const width = 360, height = 640, translateX = 17, translateY = -29, px = 90, py = 240, a = rotation * Math.PI / 180;
    const x = width / 2 + translateX + scale * ((px - width / 2) * Math.cos(a) - (py - height / 2) * Math.sin(a));
    const y = height / 2 + translateY + scale * ((px - width / 2) * Math.sin(a) + (py - height / 2) * Math.cos(a));
    const actual = framePoint({ x,y,width,height,translateX,translateY,scale,rotation });
    assert.ok(Math.abs(actual.x - .25) < 1e-10); assert.ok(Math.abs(actual.y - .375) < 1e-10);
  }
  const view = zoomAt({ scale: 1, translateX: 0, translateY: 0 }, { x: 90,y: 160 }, 3,360,640);
  assert.deepEqual(framePoint({ x:90,y:160,width:360,height:640,...view }), { x:.25,y:.25 });
  assert.deepEqual(framePoint({ x:-100,y:900,width:360,height:640 }), { x:0,y:1 });
});

async function encrypted(s, edit) {
  const { publicEncrypt, randomBytes, createCipheriv } = await import('node:crypto');
  const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from('mybots-input'));
  const data = Buffer.concat([cipher.update(JSON.stringify(edit)), cipher.final()]);
  return { type: 'encrypted', key: publicEncrypt({ key: s.inputKeys.publicKey, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
test('focus binding carries only type and rectangle; accents and IME corrections arrive directly; secret is absent from every output', real, async t => {
  const s = await session(t), events = []; s.frame = f => events.push(f);
  await s.page.setContent('<meta name="viewport" content="width=device-width"><input id="normal"><input type="password" id="pw"><p id="echo"></p>');
  await s.input({ type: 'viewport', width: 360,height:640,deviceScaleFactor:2 });
  await s.page.locator('#normal').focus();
  await s.page.waitForFunction(() => document.activeElement.id === 'normal');
  for (let i = 0; i < 100 && !events.some(e => e.focus?.active); i++) await new Promise(r => setTimeout(r,5));
  assert.ok(events.some(e => e.focus?.type === 'text' && !e.focus.secret && e.focus.rect.width > 0));
  assert.deepEqual(await s.input(await encrypted(s, { delete:0,text:'acao' })), { sent:true });
  await s.input(await encrypted(s, { delete:4,text:'ação e café' }));
  assert.equal(await s.page.locator('#normal').inputValue(), 'ação e café');
  await s.page.locator('#pw').focus();
  for (let i = 0; i < 100 && !events.some(e => e.focus?.secret); i++) await new Promise(r => setTimeout(r,5));
  assert.ok(events.some(e => e.focus?.type === 'password' && e.focus.secret));
  const secret = 'Senha-v55-çã-7!';
  const response = await s.input(await encrypted(s, { delete:0,text:secret,secret:true }));
  assert.equal(await s.page.locator('#pw').inputValue(), secret);
  await s.page.evaluate(value => { document.title = value; document.querySelector('#echo').textContent = value; }, secret);
  const read = await s.command('read');
  await s.view(true, { interactive:true,maxWidth:360,maxHeight:640 });
  await s.input({ type:'key',key:'Tab' });
  assert.ok(!JSON.stringify({ response, read, events:events.map(({ image, ...f }) => f) }).includes(secret));
  await s.view(false);
  await assert.rejects(s.input({ type:'encrypted', key:'bad',iv:'bad',tag:'bad',data:'bad' }), /protegido/);
});

test('a password typed letter by letter is protected whole, and ordinary letters elsewhere stay readable', real, async t => {
  const s = await session(t);
  await s.page.setContent('<title>Entrar no site</title><meta name="viewport" content="width=device-width"><input type="password" id="pw"><p id="echo">Bem-vinde de novo</p>');
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2 });
  await s.page.locator('#pw').focus();
  for (const letter of 'Segredo9') await s.input(await encrypted(s, { delete: 0, text: letter }));
  assert.equal(await s.page.locator('#pw').inputValue(), 'Segredo9');
  await s.page.evaluate(() => { document.querySelector('#echo').textContent += ' · Segredo9'; });
  const read = await s.command('read');
  assert.match(read.title, /^Entrar no site$/); assert.match(read.text, /Bem-vinde de novo/);
  assert.ok(!read.text.includes('Segredo9') && read.text.includes('[senha protegida]'));
  assert.deepEqual([...s.secrets].filter(secret => secret.startsWith('S')), ['Segredo9']);
});

test('card fields and echoes are hidden from browser output and screenshot, including iframe fields', real, async t => {
  const s = await session(t);
  await s.page.setContent(`<input autocomplete="cc-number" value="4242 4242 4242 4242"><input id="cvv" value="987" aria-label="987"><input placeholder="Número do cartão" value="4242424242424242"><p>4242 4242 4242 4242 / 987</p><iframe srcdoc='<input autocomplete="cc-exp" value="12/30">'></iframe>`);
  const read = await s.command('read');
  assert.doesNotMatch(JSON.stringify(read), /4242 4242 4242 4242|987|12\/30/);
  const number = read.elements.find(item => item.kind === 'input');
  const cvv = read.elements.find(item => item.label === 'Campo de cartão' && item.id !== number.id);
  assert.equal((await s.command('inspect', { id: cvv.id })).label, 'Campo de cartão');
  assert.doesNotMatch(JSON.stringify(await s.command('inspect', { action: 'click', x: cvv.box.x + 2, y: cvv.box.y + 2 })), /987/);
  assert.equal(read.elements.filter(item => item.label === 'Campo de cartão').length, 4);
  await assert.rejects(s.command('type', { id: number.id, text: 'anything' }), /cartão/);
  const shot = await s.command('screenshot');
  const pixel = await s.page.evaluate(async ({ image, box }) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + image; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    return [...context.getImageData(Math.round(box.x + box.w / 2), Math.round(box.y + box.h / 2), 1, 1).data];
  }, { image: shot.image, box: number.box });
  assert.ok(pixel.slice(0, 3).every(channel => channel < 20), `campo não estava tapado: ${pixel}`);
});

test('card read redacts the value present during the read even if it changed after the previous check', real, async t => {
  const s = await session(t);
  await s.page.setContent('<input id="cvv" value="111" aria-label="111"><p id="echo">111</p>');
  const remember = s.rememberCards.bind(s);
  s.rememberCards = async () => { await remember(); await s.page.evaluate(() => { const input = document.querySelector('#cvv'); input.value = '789'; input.setAttribute('aria-label', '789'); document.querySelector('#echo').textContent = '789'; }); };
  assert.doesNotMatch(JSON.stringify(await s.command('read')), /789/);
});

test('CAPTCHA detector recognizes vendor iframes and reports only a boolean for filled tokens or disappearance', real, async t => {
  const { captchaState } = await import('../supervisor/browser-page.mjs');
  const s = await session(t), events = []; s.frame = f => events.push(f);
  for (const url of ['https://challenges.cloudflare.com/turnstile/test','https://www.google.com/recaptcha/api2/anchor','https://newassets.hcaptcha.com/captcha/test']) {
    await s.page.setContent(`<iframe style="width:300px;height:200px" src="${url}"></iframe><textarea name="g-recaptcha-response"></textarea>`, { waitUntil:'domcontentloaded' });
    const state = await s.page.evaluate(captchaState); assert.equal(state.present,true); assert.equal(state.solved,false); assert.equal(state.rect.width,304);
    await s.checkChallenge();
    await s.page.locator('textarea').evaluate(el => { el.value = 'token-that-must-stay-in-the-page'; });
    await s.checkChallenge(); assert.equal(events.at(-1).captcha.solved,true);
    assert.ok(!JSON.stringify(events).includes('token-that-must-stay-in-the-page'));
    await s.page.locator('textarea').evaluate(el => { el.value = ''; });
    await s.page.locator('iframe').evaluate(el => el.remove());
    await s.checkChallenge(); assert.equal(events.at(-1).captcha.solved,true);
  }
  // reCAPTCHA keeps its large image challenge laid out but hidden; the checkbox below the fold is the one to show.
  await s.page.setViewportSize({ width: 360, height: 640 });
  await s.page.setContent('<div style="visibility:hidden;position:absolute;top:0"><iframe style="width:400px;height:580px" src="https://www.google.com/recaptcha/api2/bframe"></iframe></div><div style="height:1500px"></div><iframe style="width:304px;height:78px;border:0" src="https://www.google.com/recaptcha/api2/anchor"></iframe><div style="height:800px"></div>', { waitUntil:'domcontentloaded' });
  assert.equal((await s.page.evaluate(captchaState)).rect.height, 78);
  assert.equal(await s.page.evaluate(() => scrollY), 0);
  const shown = await s.page.evaluate(captchaState, { reveal: true });
  assert.ok(shown.rect.y > 0 && shown.rect.y + shown.rect.height < 640);
  await s.page.evaluate(() => scrollTo(0, 0)); await s.page.evaluate(captchaState, { reveal: true });
  assert.equal(await s.page.evaluate(() => scrollY), 0);
  // Cloudflare's interstitial hides Turnstile in a closed shadow root.
  await s.page.setContent('<div id="host" style="margin-top:200px"></div><script>document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML = `<iframe style="width:300px;height:65px;border:0" src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/test"></iframe>`;</script>', { waitUntil:'domcontentloaded' });
  assert.equal((await s.page.evaluate(captchaState)).present, false);
  for (let i = 0; i < 50 && !events.at(-1)?.captcha?.present; i++) { await s.checkChallenge(); await new Promise(r => setTimeout(r, 50)); }
  assert.equal(events.at(-1).captcha.present, true); assert.equal(events.at(-1).captcha.rect.width, 300);
  // Leaving the page is not solving it.
  await s.page.setContent('<iframe style="width:300px;height:200px" src="https://www.google.com/recaptcha/api2/anchor"></iframe>', { waitUntil:'domcontentloaded' });
  await s.checkChallenge(); assert.equal(events.at(-1).captcha.present, true);
  await s.page.evaluate(() => { location.hash = 'outra-pagina'; document.querySelector('iframe').remove(); });
  await s.checkChallenge(); assert.equal(events.at(-1).captcha.solved, false);
  await s.page.setContent('<iframe src="https://google.com.evil.test/recaptcha/test"></iframe>');
  assert.equal((await s.page.evaluate(captchaState)).present,false);
});

test('an image challenge opened beside the checkbox turns the tab desktop while open, without saving it for the site', real, async t => {
  const s = await session(t), events = []; s.frame = f => events.push(f);
  await s.page.setContent('<meta name="viewport" content="width=device-width"><iframe style="width:304px;height:78px;border:0" src="https://www.google.com/recaptcha/api2/anchor"></iframe><div id="popup" style="position:absolute;left:439px;top:0;visibility:hidden"><iframe style="width:400px;height:580px;border:0" src="https://www.google.com/recaptcha/api2/bframe"></iframe></div>', { waitUntil: 'domcontentloaded' });
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2 });
  await s.checkChallenge(); assert.equal(s.desktop, false);
  await s.page.evaluate(() => { document.querySelector('#popup').style.visibility = 'visible'; });
  await s.checkChallenge(); assert.equal(s.desktop, true);
  assert.deepEqual(await s.page.evaluate(() => [innerWidth, navigator.maxTouchPoints]), [1280, 0]);
  assert.ok(events.some(e => e.desktop === true));
  assert.ok(!Object.values(s.siteViews).includes(true));
  await s.page.evaluate(() => { document.querySelector('#popup').style.visibility = 'hidden'; });
  await s.checkChallenge(); assert.equal(s.desktop, false);
  assert.equal(await s.page.evaluate(() => navigator.maxTouchPoints), 5);
});

test('live input validates gestures and encrypted envelopes without echoing payloads', async () => {
  const { personInput } = await import('../supervisor/browser.mjs');
  for (const input of [
    { type:'touch',phase:'unknown',points:[] },
    { type:'touch',phase:'touchStart',points:[{x:2,y:.5,id:0}] },
    { type:'touch',phase:'touchEnd',points:[{x:.5,y:.5,id:0}] },
    { type:'encrypted',key:'senha-que-nao-pode-sair',iv:'a',tag:'b',data:'c' },
    { type:'viewport',width:Infinity,height:640,deviceScaleFactor:2 }
  ]) assert.throws(() => personInput(input), error => !error.message.includes('senha-que-nao-pode-sair'));
  assert.deepEqual(personInput({ type:'touch',phase:'touchStart',points:[{x:.2,y:.3,id:0,secret:'omitido'}] }), { type:'touch',phase:'touchStart',points:[{x:.2,y:.3,id:0}] });
  const { textEdit } = await import('../mobile/browser-input.js');
  assert.deepEqual(textEdit('acao','ação'), { delete:3,text:'ção' });
  assert.deepEqual(textEdit('Olá 😀','Olá 😃'), { delete:1,text:'😃' });
});

test('ordinary card-like identifiers and billing fields remain readable and typable', real, async t => {
  const s = await session(t);
  const ids = ['cardapio-busca', 'discard-reason', 'scorecard', 'credit-simulator', 'gift-card-code', 'billing-name', 'billing-address'];
  await s.page.setContent(ids.map(id => `<input id="${id}" placeholder="${id}" value="visível-${id}">`).join('') + '<input autocomplete="cc-number" value="12345678901"><input autocomplete="cc-csc" value="12"><p>visível-cc e 12345678901 e 12</p>');
  const read = await s.command('read');
  for (const id of ids) {
    const item = read.elements.find(el => el.label === id);
    assert.ok(item, `campo ${id} deve estar visível`);
    await s.command('type', { id: item.id, text: `editado-${id}` });
    assert.equal(await s.page.locator(`#${id}`).inputValue(), `editado-${id}`);
  }
  assert.equal(s.cardSecrets.size, 0, 'valores curtos não entram no conjunto de segredos');
  const cc = await s.page.locator('[autocomplete="cc-number"]');
  await cc.fill('123456789012'); await s.page.locator('[autocomplete="cc-csc"]').fill('987');
  await s.rememberCards();
  assert.ok(s.cardSecrets.has('123456789012')); assert.ok(s.cardSecrets.has('987'));
  s.cardSite = 'https://outra-loja.example'; await s.rememberCards();
  assert.ok(!s.cardSecrets.has('123456789012') || s.page.url() === 'about:blank');
  await s.page.locator('[autocomplete="cc-number"]').fill(''); await s.page.locator('[autocomplete="cc-csc"]').fill('');
  s.cardSite = 'https://outra-loja.example'; await s.rememberCards();
  assert.equal(s.cardSecrets.size, 0, 'segredos devem ser esquecidos ao mudar de site');
});
