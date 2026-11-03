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

function resolveCommand(binary, { platform = process.platform, env = process.env, exists = existsSync, read = readFileSync, execPath = process.execPath } = {}) {
  if (platform !== 'win32') return { command: binary, args: [], env: null };
  const withFolder = /[\\/]/.test(binary);
  const names = /\.(exe|com|cmd|bat)$/i.test(binary) ? [binary] : ['.exe', '.com', '.cmd'].map(extension => binary + extension);
  const folders = withFolder ? [''] : String(env.PATH || env.Path || '').split(';').filter(Boolean);
  for (const folder of folders) for (const name of names) {
    const full = withFolder ? name : win32.join(folder, name);
    if (!exists(full)) continue;
    if (/\.(exe|com)$/i.test(full)) return { command: full, args: [], env: null };
    let text = ''; try { text = String(read(full, 'utf8')); } catch { continue; }
    const base = win32.dirname(full);
    const script = SHIM_SCRIPT.exec(text);
    // Node runs it as plain Node: this very program when it is Electron (ELECTRON_RUN_AS_NODE), a real node.exe otherwise.
    if (script) return { command: execPath, args: [win32.join(base, script[1])], env: { ELECTRON_RUN_AS_NODE: '1' } };
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
