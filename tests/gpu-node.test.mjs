import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chooseRenderNode } = createRequire(import.meta.url)('../desktop/electron/gpu.js');

test('the render node is left to Chromium unless the person forces one: a forced card the screen is not drawn with makes the window open black', () => {
  assert.equal(chooseRenderNode({ platform: 'linux', env: {} }), null, 'no choice of ours by default, even with two cards');
  assert.equal(chooseRenderNode({ platform: 'linux', env: { MYBOTS_GPU_NODE: 'auto' } }), null);
  assert.equal(chooseRenderNode({ platform: 'linux', env: { MYBOTS_GPU_NODE: '/dev/dri/renderD128' } }), '/dev/dri/renderD128');
  assert.equal(chooseRenderNode({ platform: 'linux', env: { MYBOTS_GPU_NODE: '/etc/passwd' } }), null, 'only a render node path is accepted');
  assert.equal(chooseRenderNode({ platform: 'win32', env: { MYBOTS_GPU_NODE: '/dev/dri/renderD128' } }), null);
});
