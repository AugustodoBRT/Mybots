/**
 * Which render node Chromium uses. By default it is left to Chromium, which takes the card the screen compositor draws with (on a notebook
 * with an AMD and an NVIDIA card where Hyprland draws on the NVIDIA, forcing the AMD one made the window open black: v0.71.16-17).
 * MYBOTS_GPU_NODE=/dev/dri/renderDNNN forces one by hand (the person's choice); anything else, or "auto", leaves it to Chromium.
 * Returns the render node to force, or null.
 */
function chooseRenderNode({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'linux') return null;
  return /^\/dev\/dri\/renderD\d+$/.test(env.MYBOTS_GPU_NODE || '') ? env.MYBOTS_GPU_NODE : null;
}

module.exports = { chooseRenderNode };
