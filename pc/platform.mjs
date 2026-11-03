import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// What differs between Linux, Windows and macOS for the computer's node, in one place.

/** The node's own folder: ~/.mybots-pc on Linux (as always), %APPDATA%\MyBots on Windows, Application Support on macOS. */
export function dataDirectory(platform = process.platform, env = process.env, home = homedir()) {
  if (env.MYBOTS_PC_HOME) return env.MYBOTS_PC_HOME;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'MyBots');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'MyBots');
  return join(home, '.mybots-pc');
}

/**
 * Extra addresses the phone should try (MYBOTS_PC_ADVERTISE, comma separated): the computer's Tailscale address when Tailscale runs
 * without a network interface (userspace networking), where it cannot be found by looking at the interfaces. Plain hosts and IPs only.
 */
export function extraAddresses(env = process.env) {
  return String(env.MYBOTS_PC_ADVERTISE || '').split(',').map(item => item.trim()).filter(item => /^[0-9a-z.:-]{1,253}$/i.test(item)).slice(0, 4);
}

/** Where the panic button listens: a unix socket in the folder, or a named pipe on Windows (which has no unix sockets in files). */
export function panicEndpoint(directory, platform = process.platform) {
  return platform === 'win32' ? `\\\\.\\pipe\\mybots-panic-${createHash('sha1').update(directory).digest('hex').slice(0, 16)}` : join(directory, 'panic.sock');
}

/** Stops a process and everything it started. Linux and macOS signal the process group; Windows has no groups, so taskkill takes the tree. */
export function killTree(pid, signal = 'SIGKILL', platform = process.platform, { run = execFileSync, kill = process.kill.bind(process) } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (platform === 'win32') { try { run('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } }
  try { kill(-pid, signal); return true; } catch { try { kill(pid, signal); return true; } catch { return false; } }
}

/**
 * A desktop notice. Linux: libnotify (with Aprovar/Recusar buttons when `actions` and the server supports them); Windows: a toast by
 * PowerShell; macOS: osascript. The text travels in the environment, never inside a command, so nothing in it can run.
 */
export function noticeCommand(title, text, { actions = false } = {}, platform = process.platform) {
  if (platform === 'win32') {
    const script = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; "
      + "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); "
      + "$nodes = $xml.GetElementsByTagName('text'); $nodes.Item(0).AppendChild($xml.CreateTextNode($env:MYBOTS_TITLE)) | Out-Null; $nodes.Item(1).AppendChild($xml.CreateTextNode($env:MYBOTS_TEXT)) | Out-Null; "
      + "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($xml))";
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], env: { MYBOTS_TITLE: title, MYBOTS_TEXT: text }, actions: false };
  }
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', 'display notification (system attribute "MYBOTS_TEXT") with title (system attribute "MYBOTS_TITLE")'], env: { MYBOTS_TITLE: title, MYBOTS_TEXT: text }, actions: false };
  return { command: 'notify-send', args: ['--app-name=MyBots', ...(actions ? ['--wait', '--action=approve=Aprovar', '--action=reject=Recusar'] : []), '--', title, text], env: null, actions };
}

/** Opens a file or folder with the system's default program. */
export function openCommand(target, platform = process.platform) {
  if (platform === 'win32') return { command: 'explorer.exe', args: [target] };
  if (platform === 'darwin') return { command: 'open', args: [target] };
  return { command: 'xdg-open', args: [target] };
}

/** The commands of the bots run inside bubblewrap on Linux only. Elsewhere there is no isolation (yet): every command and every write
 *  outside the bot's folder goes through an approval card, and the app says so. */
export const hasIsolation = (platform = process.platform) => platform === 'linux';

/** Controlling the screen and keyboard (ydotool, hyprctl, grim, wl-copy) exists for Linux/Wayland only for now. */
export const hasDesktopControl = (platform = process.platform) => platform === 'linux';
