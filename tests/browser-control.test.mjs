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
