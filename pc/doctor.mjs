import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { localStatus } from './server.mjs';
import { findChrome } from './chrome.mjs';

// What the first-run assistant shows: which AIs are installed and logged in on this computer, and whether Chrome is there.
export const AIS = [
  { key: 'codex', name: 'Codex (ChatGPT)', install: 'npm install -g @openai/codex', login: 'codex login', link: 'https://github.com/openai/codex' },
  { key: 'claude', name: 'Claude Code', install: 'npm install -g @anthropic-ai/claude-code', login: 'claude   (depois /login)', link: 'https://claude.com/claude-code' },
  { key: 'agy', name: 'Antigravity (agy)', install: null, login: 'agy', link: 'https://antigravity.google' },
  { key: 'opencode', name: 'opencode', install: 'npm install -g opencode-ai', login: 'opencode auth login', link: 'https://opencode.ai' }
];

export { findChrome };

export async function doctor() {
  const { connections } = await localStatus();
  return {
    platform: process.platform, home: homedir(),
    ais: AIS.map(item => ({ ...item, available: connections[item.key]?.available === true, loggedIn: connections[item.key]?.loggedIn === true, message: connections[item.key]?.message || '' })),
    chrome: findChrome()
  };
}
