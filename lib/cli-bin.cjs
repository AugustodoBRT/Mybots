const { spawn, execFile, execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { win32 } = require('node:path');

/**
 * How the AIs' commands (codex, claude, agy, opencode) are started.
 *
 * On Linux and macOS the name is enough. On Windows npm installs them as .cmd shims, and Node cannot start a .cmd without a
 * shell (newer Node refuses with EINVAL, and a shell would put the prompt on a command line). So the shim is read, the
 * JavaScript behind it is found and run with Node itself, with the arguments handed over untouched. A real .exe is run as it is.
 * Also hides the console window that every child would flash on Windows.
 */
// npm's cmd-shim ends with:  "%_prog%"  "%dp0%\node_modules\pkg\bin\tool.js" %*
const SHIM_SCRIPT = /"%dp0%\\([^"\r\n]+\.(?:c|m)?js)"\s+%\*/i;
const SHIM_EXE = /"%dp0%\\([^"\r\n]+\.exe)"\s+%\*/i;

// The PATH that Windows keeps in the registry. An installer (agy, claude, npm) writes there, but a program already open, like the
// MyBots, keeps the PATH it started with until it is restarted: reading it again finds what was installed after the app opened.
let registryCache = { at: 0, folders: [] };
function registryPath(env = process.env, now = Date.now()) {
  if (now - registryCache.at < 30000) return registryCache.folders;
  const folders = [];
  for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    try {
      const out = String(execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }));
      const value = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out)?.[1] || '';
      folders.push(...value.split(';').map(item => item.trim()).filter(Boolean));
    } catch {}
  }
  registryCache = { at: now, folders: folders.map(folder => expand(folder, env)) };
  return registryCache.folders;
}
const expand = (text, env) => text.replace(/%([^%]+)%/g, (whole, name) => { const key = Object.keys(env).find(item => item.toLowerCase() === name.toLowerCase()); return key ? env[key] : whole; });
// Where the official installers put the AIs' commands, in case the PATH does not have them yet.
const knownFolders = env => [env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'agy', 'bin'), env.USERPROFILE && win32.join(env.USERPROFILE, '.local', 'bin'),
  env.APPDATA && win32.join(env.APPDATA, 'npm'), env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')].filter(Boolean);
// Programs of the Microsoft Store (the Codex/ChatGPT app puts a codex.exe there): they cannot run hidden and often refuse to run
// outside their own app, so they are never used; the person installs the command-line version instead.
const STORE = /\\WindowsApps(\\|$)/i;

// npm's Codex is a small codex.js that starts the real codex.exe without hiding it. Run as Node by the MyBots (a program with no
// console), that codex.exe would get a console window of its own on the screen. So the codex.exe it would start is run directly,
// with the two variables codex.js would give it.
function codexNative(script, exists, arch) {
  if (!/[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js$/i.test(script)) return null;
  const root = win32.dirname(win32.dirname(script)), cpu = arch === 'arm64' ? 'arm64' : 'x64', triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const inside = ['vendor', triple, 'bin', 'codex.exe'];
  const found = [win32.join(root, 'node_modules', '@openai', 'codex-win32-' + cpu, ...inside), win32.join(win32.dirname(root), 'codex-win32-' + cpu, ...inside), win32.join(root, ...inside)].find(path => exists(path));
  return found ? { command: found, args: [], env: { CODEX_MANAGED_PACKAGE_ROOT: root, CODEX_MANAGED_BY_NPM: '1' } } : null;
}

function resolveCommand(binary, { platform = process.platform, env = process.env, exists = existsSync, read = readFileSync, execPath = process.execPath, registry = registryPath, arch = process.arch } = {}) {
  if (platform !== 'win32') return { command: binary, args: [], env: null };
  const withFolder = /[\\/]/.test(binary);
  const names = /\.(exe|com|cmd|bat)$/i.test(binary) ? [binary] : ['.exe', '.com', '.cmd'].map(extension => binary + extension);
  const seen = new Set();
  const folders = withFolder ? [''] : [...String(env.PATH || env.Path || '').split(';'), ...registry(env), ...knownFolders(env)]
    .map(folder => folder.trim()).filter(folder => folder && !STORE.test(folder) && !seen.has(folder.toLowerCase()) && seen.add(folder.toLowerCase()));
  for (const folder of folders) for (const name of names) {
    const full = withFolder ? name : win32.join(folder, name);
    if (!exists(full)) continue;
    if (/\.(exe|com)$/i.test(full)) return { command: full, args: [], env: null };
    let text = ''; try { text = String(read(full, 'utf8')); } catch { continue; }
    const base = win32.dirname(full);
    const script = SHIM_SCRIPT.exec(text);
    // Node runs it as plain Node: this very program when it is Electron (ELECTRON_RUN_AS_NODE), a real node.exe otherwise.
    if (script) {
      const native = codexNative(win32.join(base, script[1]), exists, arch);
      if (native) return native;
      return { command: execPath, args: [win32.join(base, script[1])], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
    const native = SHIM_EXE.exec(text);
    if (native) return { command: win32.join(base, native[1]), args: [], env: null };
    return { command: full, args: [], env: null, unresolved: true };   // a shim of another kind: the caller gets the system's own error
  }
  return { command: binary, args: [], env: null };
}

function prepare(binary, args, options = {}, wrap = null) {
  // Inside a wrapper (bubblewrap, Linux only) the command is the wrapper's business.
  if (wrap) return { command: wrap[0], args: [...wrap.slice(1), binary, ...args], options: { windowsHide: true, ...options } };
  const resolved = resolveCommand(binary);
  const env = resolved.env ? { ...(options.env || process.env), ...resolved.env } : options.env;
  return { command: resolved.command, args: [...resolved.args, ...args], options: { windowsHide: true, ...options, ...(env ? { env } : {}) } };
}

const spawnCli = (binary, args, wrap, options) => { const run = prepare(binary, args, options, wrap); return spawn(run.command, run.args, run.options); };
const execFileCli = (binary, args, options, callback) => { const run = prepare(binary, args, options); return execFile(run.command, run.args, run.options, callback); };
const execFileSyncCli = (binary, args, options) => { const run = prepare(binary, args, options); return execFileSync(run.command, run.args, run.options); };

module.exports = { resolveCommand, prepare, spawnCli, execFileCli, execFileSyncCli };
