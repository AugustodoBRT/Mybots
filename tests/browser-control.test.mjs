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

test('real touch dispatch reaches the page and preserves start/move/end', real, async t => {
  const s = await session(t);
  await s.page.setContent('<meta name="viewport" content="width=device-width"><script>window.touches=[]; for(const k of ["touchstart","touchmove","touchend"]) document.addEventListener(k,e=>touches.push(e.type));</script>');
  await s.input({ type: 'viewport', width: 360, height: 640, deviceScaleFactor: 2 });
  for (const phase of ['touchStart','touchMove','touchEnd']) await s.input({ type: 'touch', phase, points: phase === 'touchEnd' ? [] : [{ x: .5, y: phase === 'touchMove' ? .4 : .5, id: 0 }] });
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
  await s.page.setContent('<iframe src="https://google.com.evil.test/recaptcha/test"></iframe>');
  assert.equal((await s.page.evaluate(captchaState)).present,false);
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
