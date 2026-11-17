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

/**
 * When the graphics card cannot be used (a driver that does not match the kernel module after a system update, a card that fell off the
 * bus), Chromium's graphics process crashes three times on every start and WebGL goes away: the bots' 3D bodies cannot be drawn.
 * Chromium can draw WebGL on the processor instead (SwiftShader). The window notices the failure once, writes down which kernel and
 * driver it happened with, and restarts with the card switched off; the day the kernel or the driver changes it tries the card again.
 */
const { release } = require('node:os');
const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const WEEK = 7 * 24 * 3600 * 1000;
/** The pieces that make the card work or not: the system and the loaded NVIDIA module. */
function gpuSignature({ platform = process.platform, kernel = release(), read = readFileSync } = {}) {
  let driver = '';
  if (platform === 'linux') { try { driver = String(read('/proc/driver/nvidia/version', 'utf8')).split('\n')[0].trim(); } catch {} }
  return `${platform}|${kernel}|${driver}`.slice(0, 300);
}
/** Whether a failure written down earlier still holds: the same system and driver, and not a week old. */
function softwareGlWanted({ file, signature, now = Date.now(), read = readFileSync, env = process.env } = {}) {
  if (env.MYBOTS_SOFTWARE_GL === '0') return false;
  if (env.MYBOTS_SOFTWARE_GL === '1') return true;
  try { const saved = JSON.parse(read(file, 'utf8')); return saved.signature === signature && now - Date.parse(saved.at) < WEEK; } catch { return false; }
}
function markSoftwareGl(file, signature, { now = Date.now(), write = writeFileSync } = {}) { try { write(file, JSON.stringify({ signature, at: new Date(now).toISOString() }), { mode: 0o600 }); return true; } catch { return false; } }
function clearSoftwareGl(file, { remove = unlinkSync } = {}) { try { remove(file); } catch {} }
/** The switches that draw WebGL on the processor and leave the broken graphics process unstarted. */
const SOFTWARE_GL_SWITCHES = [['disable-gpu'], ['enable-unsafe-swiftshader']];
/** `app.getGPUFeatureStatus()` says WebGL is not available (the graphics process failed or the card is on the blocklist). */
function webglBroken(status) {
  if (!status || typeof status !== 'object') return false;
  return ['webgl', 'webgl2'].some(key => typeof status[key] === 'string' && !status[key].startsWith('enabled'));
}

module.exports = { chooseRenderNode, gpuSignature, softwareGlWanted, markSoftwareGl, clearSoftwareGl, SOFTWARE_GL_SWITCHES, webglBroken };
