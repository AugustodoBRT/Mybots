import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// The accounts of the process live in a folder chosen before anything loads.
const root = await mkdtemp(join(tmpdir(), 'mybots-accounts-'));
process.env.MYBOTS_ACCOUNTS = root;
const { createAccounts, accounts } = await import('../lib/accounts.mjs');
const { Codex } = await import('../lib/codex.mjs');
const { Claude } = await import('../lib/claude.mjs');
const { runReply } = await import('../supervisor/queue.mjs');
const { sandboxFor } = await import('../pc/server.mjs');
const { createSupervisor } = await import('../supervisor/index.mjs');
const { SupervisorClient } = await import('../mobile/supervisor-client.js');
const WS = (await import('../supervisor/node_modules/ws/index.js')).default;
test.after(() => rm(root, { recursive: true, force: true }));

const selection = { model: 'test', reasoningEffort: 'low' };
const fakeCli = async (dir, name, body) => { const file = join(dir, name); await writeFile(file, `#!${process.execPath}\n${body}`, { mode: 0o700 }); return file; };

test('extra accounts: names become ids, the folder is private, duplicates and limits are refused, removing deletes the login', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mybots-acc-unit-')); const own = createAccounts(folder);
  assert.deepEqual(own.list(), []);
  const work = own.add('codex', 'Trabalho'); assert.equal(work.id, 'trabalho');
  assert.equal((await stat(own.dir('codex', 'trabalho'))).mode & 0o777, 0o700);
  assert.equal(own.add('claude', 'Trabalho').id, 'trabalho');   // another IA may reuse the name
  assert.throws(() => own.add('codex', ' trabalho '), /Já existe/);
  assert.equal(own.add('codex', 'Pessoal é bom!').id, 'pessoal-e-bom');
  assert.throws(() => own.add('codex', ''), /Dê um nome/); assert.throws(() => own.add('codex', 'default'), /Dê um nome/); assert.throws(() => own.add('nada', 'x'), /IA válida/);
  assert.deepEqual(own.list('codex').map(item => item.id), ['trabalho', 'pessoal-e-bom']);
  // Each IA reads the variable it already has for this; the default account (and a name this device lacks) has no environment.
  assert.deepEqual(own.env('codex', 'trabalho'), { CODEX_HOME: own.dir('codex', 'trabalho'), MYBOTS_ACCOUNT_DIR: own.dir('codex', 'trabalho') });
  assert.deepEqual(own.env('claude', 'trabalho'), { CLAUDE_CONFIG_DIR: own.dir('claude', 'trabalho'), MYBOTS_ACCOUNT_DIR: own.dir('claude', 'trabalho') });
  assert.deepEqual(Object.keys(own.env('opencode', own.add('opencode', 'Casa').id)).sort(), ['MYBOTS_ACCOUNT_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']);
  assert.equal(own.env('codex', 'default'), null); assert.equal(own.env('codex', undefined), null); assert.equal(own.env('codex', 'outra'), null);
  assert.equal(own.loginCommand('codex', 'trabalho', 'linux'), `CODEX_HOME="${own.dir('codex', 'trabalho')}" codex login`);
  assert.match(own.loginCommand('claude', 'trabalho', 'win32'), /^\$env:CLAUDE_CONFIG_DIR="[^"]+"; claude auth login$/);
  assert.throws(() => own.loginCommand('codex', 'outra'), /não existe/);
  // It survives a restart (a new object over the same folder) and removing deletes the folder.
  assert.deepEqual(createAccounts(folder).list('codex').map(item => item.id), ['trabalho', 'pessoal-e-bom']);
  own.remove('codex', 'trabalho'); assert.equal(existsSync(own.dir('codex', 'trabalho')), false); assert.throws(() => own.remove('codex', 'trabalho'), /não existe/);
  for (let n = 0; n < 8; n++) try { own.add('agy', 'Conta ' + n); } catch { /* the limit */ }
  assert.throws(() => own.add('agy', 'Mais uma'), /até 8/);
  await rm(folder, { recursive: true, force: true });
});

test('a command runs with the account\'s login folder, and without it with the IA\'s own', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-acc-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, 'home.txt');
  const bin = await fakeCli(dir, 'fake.cjs', `require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.CODEX_HOME || '(nenhum)'); process.exit(process.env.CODEX_HOME ? 0 : 1);`);
  const env = { CODEX_HOME: join(dir, 'conta') };
  assert.equal((await new Codex(bin, env).status()).loggedIn, true); assert.equal(await readFile(marker, 'utf8'), env.CODEX_HOME);
  const outside = await new Codex(bin).status(); assert.equal(outside.loggedIn, false);   // no variable set: the IA's own login (here: none)
  const claudeBin = await fakeCli(dir, 'claude.cjs', `require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.CLAUDE_CONFIG_DIR || '(nenhum)'); process.exit(0);`);
  assert.equal((await new Claude(claudeBin, { CLAUDE_CONFIG_DIR: '/x/y' }).status()).loggedIn, true); assert.equal(await readFile(marker, 'utf8'), '/x/y');
});

test('a bot\'s turn runs with the login of the account it chose', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-acc-run-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, 'turn.txt');
  const bin = await fakeCli(dir, 'codex.cjs', `if(process.argv[2]==='features'){console.log('shell_tool stable true');process.exit(0);}require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.CODEX_HOME || '(nenhum)'); process.exit(1);`);
  const previous = process.env.CODEX_BIN; process.env.CODEX_BIN = bin; t.after(() => { if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous; });
  const account = accounts.add('codex', 'Trabalho');
  await assert.rejects(runReply({ id: randomUUID(), name: 'Lua', provider: 'codex', aiAccount: account.id, ...selection }, 'oi', { workspace: dir }));
  assert.equal(await readFile(marker, 'utf8'), accounts.dir('codex', account.id));
  await assert.rejects(runReply({ id: randomUUID(), name: 'Lua', provider: 'codex', ...selection }, 'oi', { workspace: dir }));
  assert.notEqual(await readFile(marker, 'utf8'), accounts.dir('codex', account.id));   // no account chosen: the default login
  await assert.rejects(runReply({ id: randomUUID(), name: 'Lua', provider: 'codex', aiAccount: 'sumiu', ...selection }, 'oi', { workspace: dir }));
  assert.notEqual(await readFile(marker, 'utf8'), accounts.dir('codex', account.id));   // a name this device does not have falls back to the default
  accounts.remove('codex', account.id);
});

test('the sandbox hides every account and mounts back only the one in use, and hides the default login of its own IA', async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-acc-home-')); t.after(() => rm(home, { recursive: true, force: true }));
  for (const folder of ['.codex', '.claude', '.mybots-pc', '.mybots-accounts/codex/trabalho']) await mkdir(join(home, folder), { recursive: true });
  const accountsRoot = join(home, '.mybots-accounts'), accountDir = join(accountsRoot, 'codex', 'trabalho');
  const tmpfs = args => args.flatMap((arg, index) => arg === '--tmpfs' ? [args[index + 1]] : []);
  const plain = sandboxFor('codex', home, '/bin/true', join(home, '.mybots-pc'), { accountsRoot });
  assert.ok(tmpfs(plain).includes(accountsRoot)); assert.ok(!tmpfs(plain).includes(join(home, '.codex')));   // the IA's own login stays for its own turn
  assert.ok(!plain.includes('--bind'));
  const using = sandboxFor('codex', home, '/bin/true', join(home, '.mybots-pc'), { accountsRoot, accountDir });
  assert.ok(tmpfs(using).includes(accountsRoot)); assert.ok(tmpfs(using).includes(join(home, '.codex')));
  const at = using.indexOf('--bind'); assert.deepEqual(using.slice(at, at + 3), ['--bind', accountDir, accountDir]);
  assert.ok(at > using.lastIndexOf(accountsRoot) - 1);   // mounted after the folder that hides it
});

test('the supervisor lists the accounts, adds one with its login command, sees the login and lets a bot choose it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-acc-sup-'));
  // The default Codex is logged out; an account is logged in when its folder has an auth.json.
  const bin = await fakeCli(dir, 'codex.cjs', `const fs=require('fs');if(process.argv[2]==='login'){process.exit(process.env.CODEX_HOME&&fs.existsSync(process.env.CODEX_HOME+'/auth.json')?0:1);}process.exit(1);`);
  const codex = { binary: bin, status: async () => ({ available: true, loggedIn: false, message: 'Faça login' }), models: async () => [] };
  // Claude is always in the catalog, so a bot can be made with it to choose an account.
  const claudeSelection = { provider: 'claude', model: 'sonnet', reasoningEffort: 'low' };
  const claude = { binary: bin, status: async () => ({ available: true, loggedIn: true, message: 'ok' }), models: async () => [{ ...claudeSelection, displayName: 'Sonnet', efforts: ['low'], defaultEffort: 'low', isDefault: true }] };
  const app = await createSupervisor({ directory: join(dir, 'sup'), port: 0, codex, claude, execute: async bot => ({ text: 'ok', codexSessionId: randomUUID(), ...selection }) });
  const client = new SupervisorClient({ WebSocketClass: WS }); await client.connect({ port: app.port, token: app.token });
  t.after(async () => { client.close(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  let state = await client.call('connection.refresh');
  assert.equal(state.aiAccounts.here.name, 'Este celular'); assert.deepEqual(state.aiAccounts.here.accounts.codex, [{ id: 'default', label: 'Conta principal', loggedIn: false, default: true }]);
  assert.equal(state.connections.codex.loggedIn, false);
  const added = await client.call('ai.accounts', { where: 'here', op: 'add', provider: 'codex', label: 'Faculdade' });
  assert.equal(added.account.id, 'faculdade'); assert.match(added.command, /^CODEX_HOME=".+" codex login$/);
  assert.deepEqual(added.accounts.codex.map(item => [item.id, item.loggedIn]), [['default', false], ['faculdade', false]]);
  // The person logs in by the command (here: the file the real login would write); verifying shows it, and the IA now counts as connected.
  await writeFile(join(accounts.dir('codex', 'faculdade'), 'auth.json'), '{}');
  const verified = await client.call('ai.accounts', { where: 'here', op: 'verify', provider: 'codex' });
  assert.deepEqual(verified.accounts.codex.map(item => [item.id, item.loggedIn]), [['default', false], ['faculdade', true]]);
  state = await client.call('state.get'); assert.equal(state.aiAccounts.here.accounts.codex.find(item => item.id === 'faculdade').loggedIn, true);
  assert.equal(state.connections.codex.loggedIn, true);   // an IA is connected when any account is
  // A bot chooses the account; a session of another account is dropped; the default is the absence of a choice; garbage is refused.
  const bot = await client.call('bot.create', { name: 'Lua', ...claudeSelection, aiAccount: 'faculdade' }); assert.equal(bot.aiAccount, 'faculdade');
  app.db.run("UPDATE bots SET body=json_set(body,'$.codexSessionId','sessao-antiga') WHERE id=?", bot.id);
  const other = await client.call('bot.update', { botId: bot.id, ...claudeSelection, aiAccount: '' }); assert.equal(other.aiAccount, undefined); assert.equal(other.codexSessionId, undefined);
  await assert.rejects(client.call('bot.update', { botId: bot.id, ...claudeSelection, aiAccount: '../etc' }), /conta de IA válida/);
  await assert.rejects(client.call('ai.accounts', { where: 'here', op: 'add', provider: 'codex', label: 'Faculdade' }), /Já existe/);
  await client.call('ai.accounts', { where: 'here', op: 'remove', provider: 'codex', id: 'faculdade' });
  assert.equal((await client.call('state.get')).aiAccounts.here.accounts.codex.length, 1);
  assert.equal(existsSync(accounts.dir('codex', 'faculdade')), false);
});

test('on the phone the Claude wrapper shares the account folder with proot and carries its variable, and only for an extra account', async t => {
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'mybots-acc-wrap-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const prefix = join(dir, 'prefix'); await mkdir(join(prefix, 'var/lib/proot-distro/containers/deb/rootfs/root/.local/bin'), { recursive: true });
  await writeFile(join(prefix, 'var/lib/proot-distro/containers/deb/rootfs/root/.local/bin/claude'), ''); await mkdir(join(dir, 'bin')); await mkdir(join(dir, 'home'));
  await writeFile(join(dir, 'bin/proot-distro'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  const run = extra => spawnSync('bash', [new URL('../supervisor/claude-wrapper.sh', import.meta.url).pathname, '--oi'], { encoding: 'utf8', env: { HOME: join(dir, 'home'), PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, PREFIX: prefix, ...extra } }).stdout.trim().split('\n');
  assert.deepEqual(run({ MYBOTS_ACCOUNT_DIR: '/c/acc', CLAUDE_CONFIG_DIR: '/c/acc' }), ['login', 'deb', '--bind', '/c/acc:/c/acc', '--', 'env', 'CLAUDE_CONFIG_DIR=/c/acc', '/root/.local/bin/claude', '--oi']);
  assert.deepEqual(run({}), ['login', 'deb', '--', '/root/.local/bin/claude', '--oi']);
});

test('a connected Claude with no usage numbers gets them on its own, once, and the sidebar data carries both windows', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-claude-limits-'));
  let asked = 0;
  const claudeSelection = { provider: 'claude', model: 'sonnet', reasoningEffort: 'low' };
  const claude = { status: async () => ({ available: true, loggedIn: true, message: 'ok' }), models: async () => [{ ...claudeSelection, displayName: 'Sonnet', efforts: ['low'], defaultEffort: 'low', isDefault: true }],
    limits: async () => { asked++; return { plan: 'max', windows: [{ key: 'five_hour', used: 30, resetsAt: Date.now() + 3600000 }, { key: 'week', used: 60, resetsAt: Date.now() + 86400000 }] }; } };
  const codex = { status: async () => ({ available: true, loggedIn: false, message: '' }), models: async () => [] };
  const app = await createSupervisor({ directory: join(dir, 'sup'), port: 0, codex, claude, execute: async () => ({ text: 'ok', ...selection }) });
  const client = new SupervisorClient({ WebSocketClass: WS }); await client.connect({ port: app.port, token: app.token });
  t.after(async () => { client.close(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  await client.call('connection.refresh');
  for (let i = 0; i < 100 && !asked; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(asked, 1);
  const usage = (await client.call('state.get')).usage;
  assert.deepEqual(usage.limits.claude.windows.map(item => [item.key, item.used]), [['five_hour', 30], ['week', 60]]);
  await client.call('connection.refresh'); await new Promise(r => setTimeout(r, 100));
  assert.equal(asked, 1);   // fresh numbers: it does not ask again
});
