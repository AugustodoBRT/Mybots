import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chooseRenderNode, gpuSignature, softwareGlWanted, markSoftwareGl, SOFTWARE_GL_SWITCHES, webglBroken } = createRequire(import.meta.url)('../desktop/electron/gpu.js');

test('the render node is left to Chromium unless the person forces one: a forced card the screen is not drawn with makes the window open black', () => {
  assert.equal(chooseRenderNode({ platform: 'linux', env: {} }), null, 'no choice of ours by default, even with two cards');
  assert.equal(chooseRenderNode({ platform: 'linux', env: { MYBOTS_GPU_NODE: 'auto' } }), null);
  assert.equal(chooseRenderNode({ platform: 'linux', env: { MYBOTS_GPU_NODE: '/dev/dri/renderD128' } }), '/dev/dri/renderD128');
  assert.equal(chooseRenderNode({ platform: 'linux', env: { MYBOTS_GPU_NODE: '/etc/passwd' } }), null, 'only a render node path is accepted');
  assert.equal(chooseRenderNode({ platform: 'win32', env: { MYBOTS_GPU_NODE: '/dev/dri/renderD128' } }), null);
});

test('a card that failed is written down with the system and driver; software WebGL holds only for that same system, for a week', () => {
  const read = text => () => text; const driver = 'NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  615.78.08  Release Build';
  const before = gpuSignature({ platform: 'linux', kernel: '7.2.11', read: read(driver + '\nGCC version: x') });
  assert.equal(before, `linux|7.2.11|${driver}`, 'only the first line of the driver file');
  assert.notEqual(gpuSignature({ platform: 'linux', kernel: '7.3.4', read: read(driver) }), before, 'a new kernel is a new system');
  assert.notEqual(gpuSignature({ platform: 'linux', kernel: '7.2.11', read: read(driver.replace('615.78.08', '620.70.06')) }), before, 'a new driver too');
  assert.equal(gpuSignature({ platform: 'win32', kernel: '10', read: () => { throw new Error('não existe'); } }), 'win32|10|');
  let saved = null; const write = (file, text) => { saved = { file, text }; };
  assert.equal(markSoftwareGl('/x/gpu.json', before, { now: Date.parse('2026-11-17T20:00:00Z'), write }), true); assert.equal(saved.file, '/x/gpu.json');
  const file = '/x/gpu.json', env = {};
  const wanted = (signature, now) => softwareGlWanted({ file, signature, now: Date.parse(now), read: () => saved.text, env });
  assert.equal(wanted(before, '2026-11-17T20:30:00Z'), true, 'same system: stays on software');
  assert.equal(wanted(gpuSignature({ platform: 'linux', kernel: '7.3.4', read: read(driver.replace('615.78.08', '620.70.06')) }), '2026-11-17T20:30:00Z'), false, 'after the reboot the card is tried again');
  assert.equal(wanted(before, '2026-11-25T20:30:00Z'), false, 'a week later it tries the card again');
  assert.equal(softwareGlWanted({ file, signature: before, read: () => { throw new Error('sem arquivo'); }, env }), false, 'nothing written down');
  assert.equal(softwareGlWanted({ file, signature: before, read: () => saved.text, env: { MYBOTS_SOFTWARE_GL: '0' } }), false, 'the person can switch it off');
  assert.equal(softwareGlWanted({ file, signature: before, read: () => { throw new Error('x'); }, env: { MYBOTS_SOFTWARE_GL: '1' } }), true, 'or force it');
  assert.deepEqual(SOFTWARE_GL_SWITCHES, [['disable-gpu'], ['enable-unsafe-swiftshader']]);
});

test('WebGL counts as broken only when Chromium says it is not enabled', () => {
  assert.equal(webglBroken({ webgl: 'enabled', webgl2: 'enabled' }), false);
  assert.equal(webglBroken({ webgl: 'enabled_on', webgl2: 'enabled_on' }), false);
  assert.equal(webglBroken({ webgl: 'disabled_off', webgl2: 'disabled_off' }), true);
  assert.equal(webglBroken({ webgl: 'unavailable_software' }), true);
  assert.equal(webglBroken({}), false, 'no information: leave it alone');
  assert.equal(webglBroken(null), false);
});
