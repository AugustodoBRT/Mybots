import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// The "Atualizar as IAs" button: an official build is downloaded, checked against the published sha256 and becomes the one MyBots runs,
// without touching what the system installed. Here GitHub is a fake that serves a small build made by the test (no network).
test('updating an IA: checked download, refusal of a tampered file, the new build in use and the previous one kept', { skip: process.platform !== 'linux' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-ai-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const saved = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, CODEX_BIN: process.env.CODEX_BIN, PATH: process.env.PATH, fetch: globalThis.fetch };
  t.after(() => { for (const key of ['XDG_DATA_HOME', 'CODEX_BIN', 'PATH']) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; globalThis.fetch = saved.fetch; });
  process.env.XDG_DATA_HOME = join(home, 'data'); delete process.env.CODEX_BIN;
  // The system's Codex: an old one on the PATH.
  await mkdir(join(home, 'bin')); await writeFile(join(home, 'bin', 'codex'), '#!/bin/sh\necho "codex-cli 0.100.0"\n'); await chmod(join(home, 'bin', 'codex'), 0o755);
  process.env.PATH = join(home, 'bin') + ':' + process.env.PATH;
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const build = async version => {
    const dir = join(home, 'build-' + version); await mkdir(dir);
    await writeFile(join(dir, `codex-${arch}-unknown-linux-musl`), `#!/bin/sh\necho "codex-cli ${version}"\n`); await chmod(join(dir, `codex-${arch}-unknown-linux-musl`), 0o755);
    execFileSync('tar', ['-czf', join(home, version + '.tar.gz'), '-C', dir, `codex-${arch}-unknown-linux-musl`]);
    return readFile(join(home, version + '.tar.gz'));
  };
  let release, file, published;
  globalThis.fetch = async url => {
    if (String(url).includes('/releases/latest')) return new Response(JSON.stringify({ tag_name: 'rust-v' + release, assets: [{ name: `codex-${arch}-unknown-linux-musl.tar.gz`, browser_download_url: 'https://example.com/codex.tgz', digest: 'sha256:' + published, size: file.length }] }), { status: 200 });
    return new Response(file, { status: 200 });
  };
  const ai = await import('../lib/ai-runtimes.mjs?' + Date.now());
  assert.equal(ai.aiBinary('codex'), 'codex', 'before any update, the system one');

  // A tampered download is refused and nothing changes.
  release = '0.200.0'; file = await build('0.200.0'); published = createHash('sha256').update('outra coisa').digest('hex');
  let result = await ai.aiUpdate({ keys: ['codex'] });
  assert.equal(result.results[0].ok, false); assert.match(result.results[0].message, /não confere com o hash/);
  assert.equal(ai.aiBinary('codex'), 'codex');

  // The right one goes in, and MyBots runs it from then on.
  published = createHash('sha256').update(file).digest('hex');
  result = await ai.aiUpdate({ keys: ['codex'] });
  assert.deepEqual([result.results[0].ok, result.results[0].from, result.results[0].version], [true, '0.100.0', '0.200.0']);
  assert.match(ai.aiBinary('codex'), /mybots\/ai\/codex\/0\.200\.0\//);
  const status = await ai.aiStatus();
  const codex = status.ais.find(item => item.key === 'codex');
  assert.deepEqual([codex.installed, codex.latest, codex.source], ['0.200.0', '0.200.0', 'mybots']);

  // Asked again with nothing new: nothing is downloaded.
  result = await ai.aiUpdate({ keys: ['codex'] });
  assert.equal(result.results[0].message, 'Já está na versão mais nova.');

  // A newer one: in use at once, the previous one kept for a reply that may still be running with it.
  release = '0.201.0'; file = await build('0.201.0'); published = createHash('sha256').update(file).digest('hex');
  result = await ai.aiUpdate({ keys: ['codex'] });
  assert.equal(result.results[0].version, '0.201.0');
  assert.match(ai.aiBinary('codex'), /0\.201\.0/);
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(join(home, 'data', 'mybots', 'ai', 'codex')).filter(name => /^\d/.test(name)).sort(), ['0.200.0', '0.201.0']);
  // The person's own setting (CODEX_BIN) still wins.
  process.env.CODEX_BIN = '/opt/meu/codex'; assert.equal(ai.aiBinary('codex'), '/opt/meu/codex');
});

test('codex installs codex-code-mode-host alongside codex and repairs an already-current version missing it', { skip: process.platform !== 'linux' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-ai-host-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const saved = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, CODEX_BIN: process.env.CODEX_BIN, fetch: globalThis.fetch };
  t.after(() => { for (const key of ['XDG_DATA_HOME', 'CODEX_BIN']) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; globalThis.fetch = saved.fetch; });
  const root = join(home, 'data', 'mybots', 'ai');
  process.env.XDG_DATA_HOME = join(home, 'data'); delete process.env.CODEX_BIN;
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const tar = async (name, binName, body) => {
    const dir = join(home, 'pack-' + name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, binName), body); await chmod(join(dir, binName), 0o755);
    execFileSync('tar', ['-czf', join(home, name + '.tar.gz'), '-C', dir, binName]);
    const bytes = await readFile(join(home, name + '.tar.gz'));
    return { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
  };
  const main = await tar('main', `codex-${arch}-unknown-linux-musl`, '#!/bin/sh\necho "codex-cli 0.210.0"\n');
  const host = await tar('host', `codex-code-mode-host-${arch}-unknown-linux-musl`, '#!/bin/sh\necho "host"\n');
  globalThis.fetch = async url => {
    if (String(url).includes('/releases/latest')) return new Response(JSON.stringify({
      tag_name: 'rust-v0.210.0',
      assets: [
        { name: `codex-${arch}-unknown-linux-musl.tar.gz`, browser_download_url: 'https://example.com/main.tgz', digest: 'sha256:' + main.sha, size: main.bytes.length },
        { name: `codex-code-mode-host-${arch}-unknown-linux-musl.tar.gz`, browser_download_url: 'https://example.com/host.tgz', digest: 'sha256:' + host.sha, size: host.bytes.length }
      ]
    }), { status: 200 });
    return new Response(String(url).includes('host.tgz') ? host.bytes : main.bytes, { status: 200 });
  };
  const ai = await import('../lib/ai-runtimes.mjs?' + Date.now());
  const first = await ai.aiUpdate({ keys: ['codex'] });
  assert.equal(first.results[0].ok, true);
  assert.equal(ai.missingRuntimeParts(root), false);
  const hostPath = join(root, 'codex', '0.210.0', 'codex-code-mode-host');
  assert.match(await readFile(hostPath, 'utf8'), /host/);

  // Simulate an existing phone already on 0.210.0 without codex-code-mode-host: aiUpdate repairs it without bumping version.
  await rm(hostPath);
  assert.equal(ai.missingRuntimeParts(root), true);
  const repaired = await ai.aiUpdate({ keys: ['codex'] });
  assert.equal(repaired.results[0].ok, true);
  assert.equal(ai.missingRuntimeParts(root), false);
  assert.match(await readFile(hostPath, 'utf8'), /host/);
});

test('embedded Codex migrates the login install even at the latest version and stops using the legacy wrapper', { skip: process.platform !== 'linux' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-ai-phone-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const keys = ['HOME', 'XDG_DATA_HOME', 'MYBOTS_HOME', 'MYBOTS_EMBEDDED', 'CODEX_BIN', 'PATH'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])), fetch = globalThis.fetch;
  t.after(() => { for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; globalThis.fetch = fetch; });
  Object.assign(process.env, { HOME: home, XDG_DATA_HOME: join(home, 'data'), MYBOTS_HOME: join(home, '.mybots'), MYBOTS_EMBEDDED: '1', CODEX_BIN: join(home, '.mybots', 'codex-wrapper') });
  const bin = join(home, '.local', 'bin');
  await mkdir(bin, { recursive: true }); await mkdir(process.env.MYBOTS_HOME);
  process.env.PATH = bin + ':' + saved.PATH;
  const body = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.210.0"; else exec "$(dirname "$0")/codex-code-mode-host"; fi\n';
  await writeFile(join(bin, 'codex'), body); await chmod(join(bin, 'codex'), 0o755);
  await writeFile(process.env.CODEX_BIN, `#!/bin/sh\nexec "${join(bin, 'codex')}" "$@"\n`); await chmod(process.env.CODEX_BIN, 0o755);
  const ai = await import('../lib/ai-runtimes.mjs?phone=' + Date.now());
  assert.throws(() => execFileSync(ai.aiBinary('codex'), ['tool-probe'], { stdio: 'pipe' }), /codex-code-mode-host/, 'the old phone install cannot start tools');
  assert.equal(ai.missingRuntimeParts(), true, 'startup must detect the non-managed phone install too');

  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const asset = async (name, content) => {
    const folder = join(home, name); await mkdir(folder);
    await writeFile(join(folder, name), content);
    execFileSync('tar', ['-czf', folder + '.tgz', '-C', folder, name]);
    const bytes = await readFile(folder + '.tgz');
    return { name: name + '.tar.gz', browser_download_url: 'https://example.com/' + name, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), bytes };
  };
  const main = await asset(`codex-${arch}-unknown-linux-musl`, body);
  const host = await asset(`codex-code-mode-host-${arch}-unknown-linux-musl`, '#!/bin/sh\necho "phone tools work"\n');
  globalThis.fetch = async url => String(url).includes('/releases/latest')
    ? new Response(JSON.stringify({ tag_name: 'rust-v0.210.0', assets: [main, host] }))
    : new Response(String(url) === main.browser_download_url ? main.bytes : host.bytes);
  const result = await ai.aiUpdate({ keys: ['codex'] });
  assert.equal(result.results[0].ok, true);
  assert.equal(ai.missingRuntimeParts(), false);
  assert.match(ai.aiBinary('codex'), /mybots\/ai\/codex\/0\.210\.0\//);
  assert.equal(execFileSync(ai.aiBinary('codex'), ['tool-probe'], { encoding: 'utf8' }).trim(), 'phone tools work');
  const status = (await ai.aiStatus({ check: false })).ais.find(item => item.key === 'codex');
  assert.equal(status.source, 'mybots');
  assert.equal(status.managed, true);

  // Only the app-generated bridge gives way; explicit overrides and PC bridges still win.
  process.env.CODEX_BIN = '/opt/custom/codex'; assert.equal(ai.aiBinary('codex'), '/opt/custom/codex');
  process.env.CODEX_BIN = join(home, '.mybots', 'codex-wrapper'); delete process.env.MYBOTS_EMBEDDED;
  assert.equal(ai.aiBinary('codex'), process.env.CODEX_BIN);
});

