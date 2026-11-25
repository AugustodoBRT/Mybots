// Opens a visible terminal already running one command: the AI's official installer or its own login, which the person
// watches and answers there. The command is always one of pc/doctor.mjs's, never text coming from a page.
const { spawn } = require('node:child_process');

// -EncodedCommand carries the command whole: no quoting between cmd, start and PowerShell. `start` takes the window's title
// only between quotes (without them it would open a program called MyBots), so the arguments go to cmd exactly as written.
const windows = command => ['cmd.exe', ['/d', '/c', 'start', '"MyBots"', 'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')]];
const mac = command => ['osascript', ['-e', 'on run argv', '-e', 'tell application "Terminal" to do script (item 1 of argv)', '-e', 'tell application "Terminal" to activate', '-e', 'end run', command]];
const linux = command => {
  const script = ['sh', '-c', `${command}; echo; echo "Pode fechar esta janela."; exec "\${SHELL:-sh}"`];
  return [['x-terminal-emulator', ['-e', ...script]], ['gnome-terminal', ['--', ...script]], ['konsole', ['-e', ...script]], ['kitty', script], ['alacritty', ['-e', ...script]], ['foot', script], ['xterm', ['-e', ...script]]];
};
const candidates = (command, platform = process.platform) => platform === 'win32' ? [windows(command)] : platform === 'darwin' ? [mac(command)] : linux(command);

/** True when a terminal opened; false when this system has none we know (the page then shows the command to copy). */
async function openTerminal(command, { env = process.env, platform = process.platform, run = spawn } = {}) {
  for (const [program, args] of candidates(command, platform)) {
    const opened = await new Promise(resolve => {
      try {
        const child = run(program, args, { env, detached: true, stdio: 'ignore', windowsHide: platform === 'win32', windowsVerbatimArguments: platform === 'win32' });
        child.once('error', () => resolve(false)); child.once('spawn', () => { child.unref(); resolve(true); });
      } catch { resolve(false); }
    });
    if (opened) return true;
  }
  return false;
}
module.exports = { openTerminal, candidates };
