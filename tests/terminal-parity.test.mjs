import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';
import { sandboxFor } from '../pc/server.mjs';
import { safeUrl, localDevUrl } from '../supervisor/browser.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
const { serverArguments, ownServersOff } = createRequire(import.meta.url)('../lib/codex-server.cjs');

// The bots should work like the person does in their own terminal: Codex asks instead of refusing, the person's GitHub only when
// given, the site the bot is building opens in its browser, and nothing reaches the keys.
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'T', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };

test('GitHub is the person\'s choice per bot: without it the token and gh stay hidden, with it they are there', { skip: process.platform !== 'linux' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-home-')); t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.config', 'gh'), { recursive: true }); await writeFile(join(home, '.git-credentials'), 'https://u:segredo@github.com\n');
  await writeFile(join(home, '.npmrc'), 'prefix=~/.npm-global\n'); await writeFile(join(home, '.netrc'), 'machine x login u password p\n');
  const off = sandboxFor('codex', home, '/usr/bin/bwrap', join(home, '.mybots-pc'), { github: false }).join(' ');
  const on = sandboxFor('codex', home, '/usr/bin/bwrap', join(home, '.mybots-pc'), { github: true }).join(' ');
  assert.match(off, new RegExp(`--tmpfs ${join(home, '.config', 'gh')}`)); assert.match(off, new RegExp(`--ro-bind /dev/null ${join(home, '.git-credentials')}`));
  assert.doesNotMatch(on, new RegExp(`--tmpfs ${join(home, '.config', 'gh')}`)); assert.doesNotMatch(on, new RegExp(`/dev/null ${join(home, '.git-credentials')}`));
  // Other files with passwords are hidden from every bot; a plain .npmrc (settings only) stays, so npm install keeps working.
  for (const args of [off, on]) { assert.match(args, new RegExp(`/dev/null ${join(home, '.netrc')}`)); assert.doesNotMatch(args, new RegExp(`/dev/null ${join(home, '.npmrc')}`)); }
});

test('the site the bot is building opens in its browser on the computer; this computer\'s other ports never do', () => {
  for (const url of ['http://localhost:5173/', 'http://127.0.0.1:3000/app', 'http://localhost:8000']) { assert.equal(localDevUrl(url), true); assert.ok(safeUrl(url, { local: true })); }
  for (const url of ['http://localhost:3230/', 'http://127.0.0.1:22/', 'http://localhost/', 'http://u:p@localhost:5173/']) { assert.equal(localDevUrl(url), false); assert.throws(() => safeUrl(url, { local: true }), /portas de desenvolvimento/); }
  assert.throws(() => safeUrl('http://localhost:5173/'), /portas de desenvolvimento/, 'without the local flag, nothing local');
  assert.equal(toolArguments('browser.open', { url: 'http://localhost:5173/' }).url, 'http://localhost:5173/');
});

test('Codex asks on request, like in the terminal, with only MyBots\' own tools', async t => {
  const exec = ['exec', '--sandbox', 'workspace-write', '--color', 'never', 'resume', '01a1c143-bc4c-7640-9da7-4c3d80baec18', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"',
    '--ignore-user-config', '--json', '--output-last-message', '/tmp/x', '--disable', 'plugins', '--enable', 'skip_host_skill_discovery', '--model', 'gpt-x', '--image', '/tmp/a.png', '-'];
  assert.deepEqual(serverArguments(exec), ['app-server', '--listen', 'stdio://', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="on-request"', '--disable', 'plugins', '--enable', 'skip_host_skill_discovery']);
  const home = await mkdtemp(join(tmpdir(), 'mybots-codexhome-')); t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'config.toml'), 'model = "x"\n[mcp_servers.blender]\ncommand = "b"\n[mcp_servers."computer_use"]\ncommand = "c"\n[mcp_servers.mybots-tools]\ncommand = "m"\n');
  assert.deepEqual(await ownServersOff(home), ['-c', 'mcp_servers.blender.enabled=false', '-c', 'mcp_servers.computer_use.enabled=false']);
});

test('what Codex asks goes by the same rules as Claude\'s commands: allowed with full access, keys refused, GitHub only when turned on', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-approval-'));
  const app = await createSupervisor({ directory, port: 0, codex, approvalMs: 5000, execute: async () => ({ text: 'x', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('state.get');
  const bot = app.db.create({ name: 'Dev', home: 'pc' }, selection);
  const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Trabalhe', selection).id);
  const cap = app.tools.open(task, undefined, 'pc'); t.after(() => cap.close());
  const ask = body => fetch(`http://127.0.0.1:${app.port}/tools/approval`, { method: 'POST', headers: { Authorization: 'Bearer ' + cap.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  assert.equal((await ask({ kind: 'command', command: 'touch ~/.cache/x', reason: 'fora da pasta' })).allow, true);
  assert.equal((await ask({ kind: 'command', command: 'cat ~/.ssh/id_ed25519' })).allow, false, 'keys never');
  // With full access (the person's choice since 0.53), a risky command passes like Claude's do; only keys are never reachable.
  assert.equal((await ask({ kind: 'command', command: 'sudo pacman -Syu' })).allow, true);
  assert.equal((await ask({ kind: 'file', path: '~/.gnupg/pubring.kbx' })).allow, false);
  // GitHub stays off until the person turns it on for this bot.
  assert.equal(app.tools.policy(bot.id, 'github'), 'deny');
  await app.rpc('grants.set', { botId: bot.id, tool: 'github', allowed: true });
  assert.equal(app.tools.policy(bot.id, 'github'), 'allow');
  const refused = await fetch(`http://127.0.0.1:${app.port}/tools/approval`, { method: 'POST', headers: { Authorization: 'Bearer ' + 'f'.repeat(64), 'Content-Type': 'application/json' }, body: '{"kind":"command","command":"ls"}' });
  assert.equal(refused.status, 403, 'only a running reply can ask');
});
