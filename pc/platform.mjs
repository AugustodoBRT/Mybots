import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// What differs between Linux, Windows and macOS for the computer's node, in one place.

/** The node's own folder: ~/.mybots-pc on Linux (as always), %APPDATA%\MyBots on Windows, Application Support on macOS. */
export function dataDirectory(platform = process.platform, env = process.env, home = homedir()) {
  if (env.MYBOTS_PC_HOME) return env.MYBOTS_PC_HOME;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'MyBots');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'MyBots');
  return join(home, '.mybots-pc');
}

/** Where the panic button listens: a unix socket in the folder, or a named pipe on Windows (which has no unix sockets in files). */
export function panicEndpoint(directory, platform = process.platform) {
  return platform === 'win32' ? `\\\\.\\pipe\\mybots-panic-${createHash('sha1').update(directory).digest('hex').slice(0, 16)}` : join(directory, 'panic.sock');
}

/** The commands of the bots run inside bubblewrap on Linux only. Elsewhere there is no isolation (yet): every command and every write
 *  outside the bot's folder goes through an approval card, and the app says so. */
export const hasIsolation = (platform = process.platform) => platform === 'linux';

/** Controlling the screen and keyboard (ydotool, hyprctl, grim, wl-copy) exists for Linux/Wayland only for now. */
export const hasDesktopControl = (platform = process.platform) => platform === 'linux';
