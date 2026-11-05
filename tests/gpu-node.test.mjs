import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { chooseRenderNode } = createRequire(import.meta.url)('../desktop/electron/gpu.js');

async function drm(t, cards) {
  const root = await mkdtemp(join(tmpdir(), 'mybots-drm-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, driver] of Object.entries(cards)) { await mkdir(join(root, name, 'device'), { recursive: true }); await mkdir(join(root, 'drivers', driver), { recursive: true }); await symlink(join(root, 'drivers', driver), join(root, name, 'device', 'driver')); }
  return root;
}

test('with an integrated card and an NVIDIA one the integrated render node is forced; otherwise Chromium chooses', async t => {
  const both = await drm(t, { renderD128: 'amdgpu', renderD129: 'nvidia' });
  assert.equal(chooseRenderNode({ drm: both, env: {}, exists: () => true }), '/dev/dri/renderD128');
  const intel = await drm(t, { renderD128: 'nvidia', renderD129: 'i915' });
  assert.equal(chooseRenderNode({ drm: intel, env: {}, exists: () => true }), '/dev/dri/renderD129');
  const onlyNvidia = await drm(t, { renderD128: 'nvidia' });
  assert.equal(chooseRenderNode({ drm: onlyNvidia, env: {}, exists: () => true }), null);
  const onlyAmd = await drm(t, { renderD128: 'amdgpu' });
  assert.equal(chooseRenderNode({ drm: onlyAmd, env: {}, exists: () => true }), null);
  assert.equal(chooseRenderNode({ drm: both, env: {}, exists: () => false }), null, 'a node that is not there is never forced');
  assert.equal(chooseRenderNode({ drm: '/nao/existe', env: {} }), null);
});

test('the person can choose the node by hand or leave it to Chromium, and other systems are never touched', async t => {
  const both = await drm(t, { renderD128: 'amdgpu', renderD129: 'nvidia' });
  assert.equal(chooseRenderNode({ drm: both, env: { MYBOTS_GPU_NODE: '/dev/dri/renderD129' } }), '/dev/dri/renderD129');
  assert.equal(chooseRenderNode({ drm: both, env: { MYBOTS_GPU_NODE: 'auto' }, exists: () => true }), null);
  assert.equal(chooseRenderNode({ drm: both, env: { MYBOTS_GPU_NODE: '/etc/passwd' } }), null, 'only a render node path is accepted');
  assert.equal(chooseRenderNode({ platform: 'win32', drm: both, env: {}, exists: () => true }), null);
  assert.equal(chooseRenderNode({ platform: 'darwin', drm: both, env: {}, exists: () => true }), null);
});
