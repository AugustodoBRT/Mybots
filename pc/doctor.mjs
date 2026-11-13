import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { localStatus } from './server.mjs';
import { findChrome } from './chrome.mjs';
import { aiBinary } from '../lib/ai-runtimes.mjs';
import cli from '../lib/cli-bin.cjs';

// What the first-run assistant shows: which AIs are installed and logged in on this computer, and whether Chrome is there.
export const AIS = [
  // On Windows a new PowerShell refuses npm's .ps1 launchers (scripts are disabled by default); the .cmd one always runs.
  { key: 'codex', name: 'Codex (ChatGPT)', install: 'npm install -g @openai/codex', login: process.platform === 'win32' ? 'codex.cmd login' : 'codex login', link: 'https://github.com/openai/codex' },
  { key: 'claude', name: 'Claude Code', install: process.platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'npm install -g @anthropic-ai/claude-code', login: 'claude auth login', link: 'https://claude.com/claude-code' },
  // The command-line Antigravity (agy), not the Antigravity app: the official installer of each system (antigravity.google/docs/getting-started).
  { key: 'agy', name: 'Antigravity (agy)', install: process.platform === 'win32' ? 'irm https://antigravity.google/cli/install.ps1 | iex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash', login: 'agy', link: 'https://antigravity.google/docs/getting-started' },
  { key: 'opencode', name: 'opencode', install: 'npm install -g opencode-ai', login: process.platform === 'win32' ? 'opencode.cmd auth login' : 'opencode auth login', link: 'https://opencode.ai' }
];

export { findChrome };

function windowsLogin(item) {
  if (process.platform !== 'win32') return {};
  const file = cli.locateCommand(aiBinary(item.key)); if (!file) return {};
  const [, ...rest] = item.login.replace(/^(\S+)\.cmd/, '$1').split(' ');
  return { login: ['&', `"${file}"`, ...rest].join(' ') };
}

export async function doctor() {
  const { connections } = await localStatus();
  return {
    platform: process.platform, home: homedir(),
    // On Windows the login goes by the full path: installers often leave their folder out of the PATH of a new terminal.
    ais: AIS.map(item => ({ ...item, ...windowsLogin(item), available: connections[item.key]?.available === true, loggedIn: connections[item.key]?.loggedIn === true, message: connections[item.key]?.message || '' })),
    chrome: findChrome()
  };
}
