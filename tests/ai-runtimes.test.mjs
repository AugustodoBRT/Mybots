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
