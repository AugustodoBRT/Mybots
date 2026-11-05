const { readdirSync, readlinkSync, existsSync } = require('node:fs');
const { basename } = require('node:path');

/**
 * Notebooks with two graphics cards (an integrated AMD or Intel that draws the screen and an NVIDIA): Chromium picked the NVIDIA render
 * node, and with the bots' tabs (each one a layer of its own) the window went black. The integrated card draws everything fine and lets the
 * NVIDIA one sleep. MYBOTS_GPU_NODE=/dev/dri/renderDNNN picks a node by hand; MYBOTS_GPU_NODE=auto leaves the choice to Chromium.
 * Returns the render node to force, or null to leave Chromium's choice (one card, no NVIDIA, no integrated one, or "auto").
 */
function chooseRenderNode({ platform = process.platform, env = process.env, drm = '/sys/class/drm', exists = existsSync } = {}) {
  if (platform !== 'linux' || /^auto$/i.test(env.MYBOTS_GPU_NODE || '')) return null;
  if (env.MYBOTS_GPU_NODE) return /^\/dev\/dri\/renderD\d+$/.test(env.MYBOTS_GPU_NODE) ? env.MYBOTS_GPU_NODE : null;
  try {
    const nodes = readdirSync(drm).filter(name => /^renderD\d+$/.test(name)).map(name => { try { return { path: `/dev/dri/${name}`, driver: basename(readlinkSync(`${drm}/${name}/device/driver`)) }; } catch { return null; } }).filter(Boolean);
    if (!nodes.some(node => node.driver === 'nvidia')) return null;
    const other = nodes.find(node => ['amdgpu', 'i915', 'xe'].includes(node.driver));
    return other && exists(other.path) ? other.path : null;
  } catch { return null; }
}

module.exports = { chooseRenderNode };
