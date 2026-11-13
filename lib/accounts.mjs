import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROVIDER_NAMES } from './models.mjs';
import { aiBinary } from './ai-runtimes.mjs';
import cli from './cli-bin.cjs';

/**
 * Several logins of the same IA on one device (two Claude, two Codex...). The IA's own login folder is the "default" account
 * and is never touched; each extra account is a folder of its own, handed to the IA's command through the variable it already
 * reads for that (CODEX_HOME, CLAUDE_CONFIG_DIR...). A bot says which account it uses by the account's id (a short name), so two
 * devices with an account of the same name understand each other even though each holds its own login.
 */
export const DEFAULT_ACCOUNT = 'default';
const MAX_ACCOUNTS = 8, MAX_LABEL = 40;

/** The environment that points one IA's command at an account folder. */
export const ACCOUNT_ENV = {
  codex: dir => ({ CODEX_HOME: dir }),
  claude: dir => ({ CLAUDE_CONFIG_DIR: dir }),
  // opencode keeps its login and settings under the XDG folders.
  opencode: dir => ({ XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') }),
  // Antigravity keeps what it needs under the home folder.
  agy: dir => ({ HOME: dir, USERPROFILE: dir })
};
const LOGIN = { codex: 'codex login', claude: 'claude auth login', opencode: 'opencode auth login', agy: 'agy' };
// Windows: the official way to install each one from PowerShell (Claude's and agy's installers need no Node.js).
const INSTALL_WINDOWS = { claude: 'irm https://claude.ai/install.ps1 | iex', codex: 'npm install -g @openai/codex', agy: 'irm https://antigravity.google/cli/install.ps1 | iex', opencode: 'npm install -g opencode-ai' };

const slug = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const quote = text => `"${String(text).replace(/(["\\$`])/g, '\\$1')}"`;

export function createAccounts(root = process.env.MYBOTS_ACCOUNTS || join(homedir(), '.mybots-accounts')) {
  const file = () => join(root, 'accounts.json');
  const read = () => { try { const data = JSON.parse(readFileSync(file(), 'utf8')); return Array.isArray(data.accounts) ? data.accounts.filter(item => PROVIDER_NAMES[item?.provider] && /^[a-z0-9-]{1,24}$/.test(item.id || '')) : []; } catch { return []; } };
  const write = list => { mkdirSync(root, { recursive: true, mode: 0o700 }); try { chmodSync(root, 0o700); } catch {} writeFileSync(file(), JSON.stringify({ accounts: list }), { mode: 0o600 }); };
  const dir = (provider, id) => join(root, provider, id);

  return {
    root: () => root,
    /** The extra accounts of one IA (or of all). The default account is implicit and not listed. */
    list: provider => read().filter(item => !provider || item.provider === provider).map(({ id, provider, label, createdAt }) => ({ id, provider, label, createdAt })),
    find: (provider, id) => read().find(item => item.provider === provider && item.id === id) || null,
    dir,
    /** The folder of an account, or null for the default account and for a name this device does not have. */
    folder(provider, id) { return id && id !== DEFAULT_ACCOUNT && this.find(provider, id) ? dir(provider, id) : null; },
    /** The environment a command of this account runs with; null means the IA's own login (the default account). MYBOTS_ACCOUNT_DIR tells the phone's wrappers which folder to share with proot. */
    env(provider, id) { const folder = this.folder(provider, id); return folder && ACCOUNT_ENV[provider] ? { ...ACCOUNT_ENV[provider](folder), MYBOTS_ACCOUNT_DIR: folder } : null; },
    add(provider, label) {
      if (!ACCOUNT_ENV[provider]) throw new Error('Escolha uma IA válida.');
      const name = String(label || '').trim().slice(0, MAX_LABEL);
      const base = slug(name);
      if (!base || base === DEFAULT_ACCOUNT) throw new Error('Dê um nome à conta, por exemplo "Trabalho" ou "Pessoal".');
      const list = read();
      if (list.filter(item => item.provider === provider).length >= MAX_ACCOUNTS) throw new Error(`Cada IA aceita até ${MAX_ACCOUNTS} contas extras.`);
      if (list.some(item => item.provider === provider && item.label.toLowerCase() === name.toLowerCase())) throw new Error('Já existe uma conta com esse nome.');
      let id = base; for (let n = 2; list.some(item => item.provider === provider && item.id === id); n++) id = `${base.slice(0, 21)}-${n}`;
      const account = { id, provider, label: name, createdAt: new Date().toISOString() };
      mkdirSync(dir(provider, id), { recursive: true, mode: 0o700 }); try { chmodSync(dir(provider, id), 0o700); } catch {}
      write([...list, account]);
      return { id, provider, label: name, createdAt: account.createdAt };
    },
    /** Forgets an account and deletes its login folder. */
    remove(provider, id) {
      const list = read(); const found = list.find(item => item.provider === provider && item.id === id);
      if (!found) throw new Error('Essa conta não existe neste aparelho.');
      write(list.filter(item => item !== found)); rmSync(dir(provider, id), { recursive: true, force: true });
      return { id, provider };
    },
    /** What the person types in a terminal to log this account in: the account's variables, then the IA's own login command. */
    loginCommand(provider, id, platform = process.platform, locate = binary => cli.locateCommand(binary)) {
      const env = this.env(provider, id); if (!env) throw new Error('Essa conta não existe neste aparelho.');
      const skip = platform === 'win32' ? 'HOME' : 'USERPROFILE';   // each system reads only one of the two
      const entries = Object.entries(env).filter(([key]) => key !== skip && key !== 'MYBOTS_ACCOUNT_DIR');
      if (platform === 'win32') {
        // By its full path: installers often leave the folder out of the PATH (Claude's does), and PowerShell refuses npm's .ps1 launchers.
        const file = locate(aiBinary(provider));
        if (!file) throw new Error(`Instale o ${PROVIDER_NAMES[provider] || provider} neste computador primeiro. No PowerShell: ${INSTALL_WINDOWS[provider]}. Depois peça o comando de entrar de novo.`);
        const [, ...rest] = LOGIN[provider].split(' ');
        return [...entries.map(([key, value]) => `$env:${key}="${value}"`), ['&', `"${file}"`, ...rest].join(' ')].join('; ');
      }
      return entries.map(([key, value]) => `${key}=${quote(value)}`).join(' ') + ' ' + LOGIN[provider];
    }
  };
}

// The accounts of this machine, shared by everything in the process (the supervisor and the computer's node).
export const accounts = createAccounts();
