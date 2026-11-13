import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { resolveCommand, prepare } = createRequire(import.meta.url)('../lib/cli-bin.cjs');

// What npm writes for a global package on Windows (cmd-shim), as of npm 7 and later.
const SHIM = tool => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${tool}" %*\r\n`;
const fake = files => ({ exists: path => path in files, read: path => files[path] });
const NPM = 'C:\\Users\\Ana\\AppData\\Roaming\\npm';
const env = { PATH: `C:\\Windows\\System32;${NPM};C:\\Tools` };

test('on Linux and macOS the name is used as it is', () => {
  for (const platform of ['linux', 'darwin']) assert.deepEqual(resolveCommand('codex', { platform }), { command: 'codex', args: [], env: null });
});

test('Windows: an npm .cmd shim becomes Node running the script behind it, with no shell', () => {
  const files = { [`${NPM}\\codex.cmd`]: SHIM('node_modules\\@openai\\codex\\bin\\codex.js'), [`${NPM}\\claude.cmd`]: SHIM('node_modules\\@anthropic-ai\\claude-code\\cli.js') };
  const options = { platform: 'win32', env, execPath: 'C:\\Program Files\\MyBots\\MyBots.exe', ...fake(files) };
  assert.deepEqual(resolveCommand('codex', options), { command: 'C:\\Program Files\\MyBots\\MyBots.exe', args: [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`], env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(resolveCommand('claude', options).args[0], `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`);
});

test('Windows: PATH order decides, and inside one folder .exe comes before .cmd; the name can carry its extension or a folder', () => {
  const files = { 'C:\\Tools\\claude.exe': '', [`${NPM}\\claude.cmd`]: SHIM('cli.js'), [`${NPM}\\codex.exe`]: '', [`${NPM}\\codex.cmd`]: SHIM('x.js'), 'D:\\Apps\\agy.exe': '' };
  const first = { platform: 'win32', env: { PATH: `C:\\Tools;${NPM}` }, ...fake(files) };
  assert.deepEqual(resolveCommand('claude', first), { command: 'C:\\Tools\\claude.exe', args: [], env: null });      // the earlier folder wins
  assert.equal(resolveCommand('claude', { ...first, env }).args[0], `${NPM}\\cli.js`);                                // here the npm folder comes first
  assert.equal(resolveCommand('codex', { ...first, env }).command, `${NPM}\\codex.exe`);                              // same folder: .exe before .cmd
  assert.equal(resolveCommand('claude.exe', first).command, 'C:\\Tools\\claude.exe');
  assert.equal(resolveCommand('D:\\Apps\\agy.exe', first).command, 'D:\\Apps\\agy.exe');
  assert.deepEqual(resolveCommand('nada', first), { command: 'nada', args: [], env: null });
});

test('Windows: a shim that points at a native program runs it; a shim of another kind is flagged, never run through a shell', () => {
  const native = '@ECHO off\r\n"%dp0%\\vendor\\tool.exe"  %*\r\n';
  const options = { platform: 'win32', env, ...fake({ [`${NPM}\\a.cmd`]: native.replace('"%dp0%\\vendor\\tool.exe"  %*', '"%dp0%\\vendor\\tool.exe" %*'), [`${NPM}\\b.cmd`]: '@echo off\r\nsome other thing\r\n' }) };
  assert.deepEqual(resolveCommand('a', options), { command: `${NPM}\\vendor\\tool.exe`, args: [], env: null });
  const odd = resolveCommand('b', options); assert.equal(odd.unresolved, true); assert.equal(odd.command, `${NPM}\\b.cmd`);
});

test('arguments are handed over untouched (a prompt with quotes, spaces and shell characters), and the Windows console stays hidden', () => {
  const prompt = 'faça "isso" & depois | aquilo; $(rm -rf /) %PATH% ^ `x`';
  const run = prepare('codex', ['exec', prompt], { cwd: '/x' });
  assert.deepEqual(run.args.slice(-2), ['exec', prompt]); assert.equal(run.options.windowsHide, true); assert.equal(run.options.cwd, '/x'); assert.equal(run.options.shell, undefined);
  const wrapped = prepare('codex', ['exec', prompt], {}, ['/usr/bin/bwrap', '--die-with-parent']);
  assert.equal(wrapped.command, '/usr/bin/bwrap'); assert.deepEqual(wrapped.args, ['--die-with-parent', 'codex', 'exec', prompt]);
});

const { nodeRun } = createRequire(import.meta.url)('../lib/node-binary.cjs');
test('MyBots\' own children: a real launcher is used; a .cmd launcher (Windows) is replaced by this program run as plain Node', () => {
  assert.deepEqual(nodeRun({ MYBOTS_NODE: '/home/ana/.mybots-pc/bin/node' }), { command: '/home/ana/.mybots-pc/bin/node', env: null });
  for (const launcher of ['C:\\Users\\Ana\\AppData\\Roaming\\MyBots\\bin\\node.cmd', 'x.BAT']) assert.deepEqual(nodeRun({ MYBOTS_NODE: launcher }), { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.deepEqual(nodeRun({}), { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } });
});

test('Windows: what was installed after the app opened is found (registry PATH and the installers\' folders), and Store apps are never used', () => {
  const local = 'C:\\Users\\Ana\\AppData\\Local', store = `${local}\\Microsoft\\WindowsApps`;
  const files = { [`${store}\\codex.exe`]: '', [`${local}\\agy\\bin\\agy.exe`]: '', 'D:\\Novo\\claude.exe': '' };
  const options = { platform: 'win32', env: { PATH: `C:\\Windows\\System32;${store}`, LOCALAPPDATA: local, USERPROFILE: 'C:\\Users\\Ana' }, ...fake(files), registry: () => ['D:\\Novo'] };
  assert.deepEqual(resolveCommand('codex', options), { command: 'codex', args: [], env: null });   // the Codex app's copy is not used
  assert.equal(resolveCommand('agy', options).command, `${local}\\agy\\bin\\agy.exe`);              // the official installer's folder
  assert.equal(resolveCommand('claude', options).command, 'D:\\Novo\\claude.exe');                   // the PATH saved after the app opened
});

test('Windows: npm\'s Codex runs its own codex.exe directly, so no console window opens for it', () => {
  const root = `${NPM}\\node_modules\\@openai\\codex`, exe = `${root}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  const files = { [`${NPM}\\codex.cmd`]: SHIM('node_modules\\@openai\\codex\\bin\\codex.js'), [exe]: '' };
  const options = { platform: 'win32', env, arch: 'x64', registry: () => [], ...fake(files) };
  assert.deepEqual(resolveCommand('codex', options), { command: exe, args: [], env: { CODEX_MANAGED_PACKAGE_ROOT: root, CODEX_MANAGED_BY_NPM: '1' } });
  const run = prepare('codex', ['exec'], {});
  assert.equal(run.options.windowsHide, true);
});
