import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'mybots-desktop', CHROME = 'mybots-browser', PARK = 'special:mybots';

// The running Hyprland, even when this process started before it (the signature changes with every session).
function signature(env = process.env) {
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return env.HYPRLAND_INSTANCE_SIGNATURE;
  const root = join(env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`, 'hypr');
  try { return readdirSync(root).filter(name => existsSync(join(root, name, '.socket.sock'))).sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0] || null; } catch { return null; }
}

// The bots' Chrome opens as a real window only where it can be docked, and never inside a test run.
export const realWindowWanted = (env = process.env) => env.MYBOTS_REAL_BROWSER !== '0' && !env.NODE_TEST_CONTEXT && Boolean(signature(env));

/**
 * The bots' Chrome is a real window. On Hyprland the node keeps it out of sight (a special workspace) and, when the
 * person opens it, lays it exactly over the area of the MyBots window that asks for it, so it behaves as a part of
 * the window: real mouse, real selection, real keyboard, real speed. Elsewhere `available` is false and nothing here runs.
 */
export function createDock({ run, appClass = APP, browserClass = CHROME, env = process.env } = {}) {
  const sig = signature(env);
  const hypr = run || ((...args) => new Promise((resolve, reject) => execFile('hyprctl', args, { timeout: 3000, env: { ...env, HYPRLAND_INSTANCE_SIGNATURE: sig } }, (error, out) => error ? reject(error) : resolve(String(out)))));
  const available = Boolean(run || sig);
  let docked = null, timer = null;
  const clients = async () => JSON.parse(await hypr('clients', '-j'));
  const find = list => {
    const app = list.find(item => item.class === appClass && item.mapped !== false);
    const chrome = list.filter(item => item.class === browserClass).sort((a, b) => (a.focusHistoryID ?? 99) - (b.focusHistoryID ?? 99))[0];
    return { app, chrome };
  };
  // Where the Chrome window goes: the app window's area minus what the app keeps for its own controls.
  const place = (app, inset) => {
    const left = inset.left || 0, top = inset.top || 0, right = inset.right || 0, bottom = inset.bottom || 0;
    return { x: Math.round(app.at[0] + left), y: Math.round(app.at[1] + top), width: Math.max(200, Math.round(app.size[0] - left - right)), height: Math.max(120, Math.round(app.size[1] - top - bottom)) };
  };
  const apply = async (app, chrome, inset) => {
    const box = place(app, inset), id = `address:${chrome.address}`;
    const same = chrome.floating && chrome.workspace.id === app.workspace.id && chrome.at[0] === box.x && chrome.at[1] === box.y && chrome.size[0] === box.width && chrome.size[1] === box.height;
    if (same) return box;
    await hypr('--batch', [
      `dispatch movetoworkspacesilent ${app.workspace.id},${id}`, chrome.floating ? '' : `dispatch setfloating ${id}`,
      `dispatch resizewindowpixel exact ${box.width} ${box.height},${id}`, `dispatch movewindowpixel exact ${box.x} ${box.y},${id}`,
      `setprop ${id} rounding 0`, `setprop ${id} bordersize 0`, `dispatch alterzorder top,${id}`
    ].filter(Boolean).join(' ; '));
    return box;
  };
  const park = async chrome => { if (chrome && chrome.workspace?.name !== PARK) await hypr('dispatch', 'movetoworkspacesilent', `${PARK},address:${chrome.address}`); };
  const follow = () => {
    clearInterval(timer);
    timer = setInterval(async () => {
      if (!docked) return;
      try {
        const { app, chrome } = find(await clients());
        if (!app) { await undock(); return; }
        if (chrome) await apply(app, chrome, docked.inset);
      } catch {}
    }, 150); timer.unref?.();
  };
  async function dock(inset = {}) {
    if (!available) throw new Error('Este computador não deixa o navegador entrar na janela.');
    const { app, chrome } = find(await clients());
    if (!app) throw new Error('A janela do MyBots não foi encontrada.');
    if (!chrome) throw new Error('O navegador dos bots ainda não abriu.');
    docked = { inset }; const box = await apply(app, chrome, inset);
    await hypr('dispatch', 'focuswindow', `address:${chrome.address}`).catch(() => {});
    follow(); return box;
  }
  async function undock() {
    docked = null; clearInterval(timer); timer = null;
    const { app, chrome } = find(await clients());
    await park(chrome);
    if (app) await hypr('dispatch', 'focuswindow', `address:${app.address}`).catch(() => {});
  }
  // New Chrome windows of the bots open parked, never over what the person is doing.
  async function prepare() {
    if (!available) return;
    await hypr('keyword', 'windowrule', `match:class ^(${browserClass})$, workspace ${PARK} silent`).catch(() => {});
  }
  return { available, prepare, dock, undock, place, find, get docked() { return Boolean(docked); }, close() { clearInterval(timer); timer = null; docked = null; } };
}
