// The IAs installed on this device (Codex, Claude Code, Antigravity, opencode): their versions, and updating them from the app, on the
// computer and on the phone, without a terminal or an administrator password. Like OpenBot: on Linux, Codex and opencode are the
// official builds from their GitHub releases, checked against the sha256 GitHub publishes and kept in a folder of MyBots
// (~/.local/share/mybots/ai/<ia>/<version>); Claude Code and Antigravity update themselves (`claude update`, `agy update`). On the
// phone's Termux, Codex is Termux's own package and the others live in a Debian of proot-distro, reached by MyBots' wrappers.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, renameSync, chmodSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import cli from './cli-bin.cjs';

const run = promisify(execFile);
// The AIs' own commands go through cli-bin: on Windows it finds them (npm shims, PATH saved after the app opened) and hides the window.
const runCli = (binary, args, options) => new Promise((resolve, reject) => cli.execFileCli(binary, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
export const AI_KEYS = ['codex', 'claude', 'agy', 'opencode'];
export const AI_NAMES = { codex: 'Codex', claude: 'Claude Code', agy: 'Antigravity', opencode: 'opencode' };
const ENV = { codex: 'CODEX_BIN', claude: 'CLAUDE_BIN', agy: 'AGY_BIN', opencode: 'OPENCODE_BIN' };
const termux = () => Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('com.termux'));
export const runtimesRoot = (home = homedir()) => join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'mybots', 'ai');
// The official builds MyBots keeps itself (Linux, x64 or arm64).
const ARCH = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
const RELEASES = {
  codex: { repo: 'openai/codex', asset: () => `codex-${ARCH}-unknown-linux-musl.tar.gz`, binary: name => name.startsWith('codex-') && !name.endsWith('.tar.gz') ? name : null, version: tag => tag.replace(/^rust-v/, '') },
  opencode: { repo: 'sst/opencode', asset: () => `opencode-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`, binary: name => name === 'opencode' ? name : null, version: tag => tag.replace(/^v/, '') }
};
const managedSupported = key => Boolean(RELEASES[key]) && process.platform === 'linux' && !termux() && Boolean(ARCH);

/** The build of this IA that MyBots keeps, when there is one (its path), else null. */
export function managedBinary(key, root = runtimesRoot()) {
  try { const current = JSON.parse(readFileSync(join(root, key, 'current.json'), 'utf8')); const path = join(root, key, current.version, current.binary); return statSync(path).isFile() ? path : null; } catch { return null; }
}
/** The command to run an IA: the one the person set (CODEX_BIN…), else the build MyBots keeps, else the one on the PATH. */
export function aiBinary(key) { return process.env[ENV[key]] || managedBinary(key) || key; }

async function version(binary) {
  try { const { stdout, stderr } = await runCli(binary, ['--version'], { timeout: 20000 }); return (`${stdout} ${stderr}`.match(/\d+\.\d+\.\d+[\w.-]*/) || [null])[0]; } catch { return null; }
}
async function latestRelease(key) {
  const spec = RELEASES[key];
  const response = await fetch(`https://api.github.com/repos/${spec.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mybots' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`O GitHub não respondeu (${response.status}).`);
  const release = await response.json(); const asset = release.assets?.find(item => item.name === spec.asset());
  if (!asset) throw new Error('Esta versão não tem build para este computador.');
  return { version: spec.version(release.tag_name), url: asset.browser_download_url, sha256: String(asset.digest || '').replace(/^sha256:/, ''), size: asset.size };
}

/** What is installed and, when it can be known, the newest version. */
export async function aiStatus({ check = true } = {}) {
  const list = [];
  for (const key of AI_KEYS) {
    const binary = aiBinary(key), installed = await version(binary);
    const item = { key, name: AI_NAMES[key], installed, managed: binary === managedBinary(key), source: binary === managedBinary(key) ? 'mybots' : process.env[ENV[key]] ? 'ponte' : 'sistema' };
    if (check && managedSupported(key)) { try { item.latest = (await latestRelease(key)).version; } catch (error) { item.error = error.message; } }
    item.canUpdate = Boolean(installed) || managedSupported(key);
    list.push(item);
  }
  return { device: termux() ? 'celular' : 'computador', ais: list, checkedAt: new Date().toISOString() };
}

const newer = (a, b) => { const pa = String(a || '').split(/[.-]/).map(Number), pb = String(b || '').split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; };

/** Downloads one official build, checks its sha256 and makes it the one MyBots uses. The previous one stays until the next update. */
async function installRelease(key, root = runtimesRoot()) {
  const release = await latestRelease(key);
  if (!/^[0-9a-f]{64}$/.test(release.sha256)) throw new Error('O GitHub não publicou o hash desta versão; nada foi instalado.');
  const response = await fetch(release.url, { headers: { 'User-Agent': 'mybots' }, signal: AbortSignal.timeout(10 * 60000) });
  if (!response.ok) throw new Error(`Download recusado (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('O arquivo baixado não confere com o hash publicado; nada foi instalado.');
  const folder = join(root, key, release.version), work = join(tmpdir(), `mybots-ai-${key}-${process.pid}-${Date.now()}`);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(work, 'a.tar.gz'), bytes);
    await run('tar', ['-xzf', join(work, 'a.tar.gz'), '-C', work], { timeout: 120000 });
    const binary = readdirSync(work).map(name => RELEASES[key].binary(name)).find(Boolean);
    if (!binary) throw new Error('O pacote não tem o executável esperado.');
    chmodSync(join(work, binary), 0o755);
    if (!await version(join(work, binary))) throw new Error('O executável baixado não abriu neste computador.');
    rmSync(folder, { recursive: true, force: true }); mkdirSync(dirname(folder), { recursive: true });
    mkdirSync(folder, { recursive: true }); renameSync(join(work, binary), join(folder, binary));
    writeFileSync(join(root, key, 'current.json.tmp'), JSON.stringify({ version: release.version, binary, sha256: release.sha256, at: new Date().toISOString() }));
    renameSync(join(root, key, 'current.json.tmp'), join(root, key, 'current.json'));
    // Older builds go, except the one before (a reply may still be running with it).
    const keep = new Set([release.version, ...readdirSync(join(root, key)).filter(name => /^\d/.test(name)).sort((a, b) => newer(a, b) ? -1 : 1).slice(0, 2)]);
    for (const name of readdirSync(join(root, key))) if (/^\d/.test(name) && !keep.has(name)) rmSync(join(root, key, name), { recursive: true, force: true });
    return release.version;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Updates every IA it can on this device. Each one reports on its own: one failing does not stop the others. */
export async function aiUpdate({ keys = AI_KEYS } = {}) {
  const results = [];
  for (const key of keys.filter(item => AI_KEYS.includes(item))) {
    const before = await version(aiBinary(key));
    try {
      if (managedSupported(key)) {
        const latest = await latestRelease(key);
        if (before && !newer(latest.version, before)) { results.push({ key, name: AI_NAMES[key], ok: true, version: before, message: 'Já está na versão mais nova.' }); continue; }
        const installed = await installRelease(key);
        results.push({ key, name: AI_NAMES[key], ok: true, version: installed, from: before, message: `Atualizado para ${installed}.` });
        continue;
      }
      if (!before) { results.push({ key, name: AI_NAMES[key], ok: true, skipped: true, message: 'Não instalado neste aparelho.' }); continue; }
      if (key === 'codex' && termux()) await run('bash', ['-lc', 'apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --only-upgrade codex'], { timeout: 10 * 60000 });
      else if (key === 'claude' || key === 'agy') await runCli(aiBinary(key), ['update'], { timeout: 10 * 60000 });
      else if (key === 'opencode') await runCli(aiBinary(key), ['upgrade'], { timeout: 10 * 60000 });
      else throw new Error('Este aparelho não sabe atualizar esta IA.');
      const after = await version(aiBinary(key));
      results.push({ key, name: AI_NAMES[key], ok: true, version: after, from: before, message: after && after !== before ? `Atualizado para ${after}.` : 'Já está na versão mais nova.' });
    } catch (error) {
      const text = String(error.stderr || error.message || '');
      results.push({ key, name: AI_NAMES[key], ok: false, version: before, message: /permission denied|EACCES|root|sudo/i.test(text) ? 'Esta instalação pede senha de administrador: atualize pelo sistema.' : text.split('\n').find(line => line.trim())?.slice(0, 200) || 'Não consegui atualizar.' });
    }
  }
  return { device: termux() ? 'celular' : 'computador', results, at: new Date().toISOString() };
}
