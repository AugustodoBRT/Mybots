import { existsSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { homedir } from 'node:os';

// Where Chrome is on each system, where its profile lives, and what a normal browser calls itself. The bots' browser (a Chrome of
// its own, or the person's "Meu Chrome") and the first-run assistant both ask here, so no path is written twice.

/** Chrome (or Chromium) installed by the system. On Windows Edge counts too: it is the same engine and is always there. */
export function chromePaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const bases = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return [...bases.map(base => win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')), ...bases.map(base => win32.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))];
  }
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  if (platform === 'linux') return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'];
  return [];
}
export function findChrome(platform = process.platform, exists = existsSync, env = process.env) { return chromePaths(platform, env).find(path => exists(path)) || null; }

/** The person's own Chrome profile (Meu Chrome reads its DevToolsActivePort). */
export function chromeProfile(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  return join(home, '.config', 'google-chrome');
}

/** The user agent of a normal Chrome of this system (the headless one says "HeadlessChrome" otherwise). */
export function userAgentFor(major, platform = process.platform) {
  if (!major) return null;
  const system = platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
