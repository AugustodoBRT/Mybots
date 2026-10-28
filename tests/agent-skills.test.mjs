import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import skills from '../lib/agent-skills.cjs';
import claude from '../lib/claude-runner.cjs';
import codex from '../lib/codex-runner.cjs';
import { sandboxFor, computerFor } from '../pc/server.mjs';
import { createSupervisor } from '../supervisor/index.mjs';

const { discover, enabledFor, skillGuidance, commandInside, insideSkill, frontmatter } = skills;
const selection = { model: 'test', reasoningEffort: 'low' };
const fakeCodex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }], limits: async () => null };

async function homeWithSkills(t) {
  const home = await mkdtemp(join(tmpdir(), 'mybots-skills-home-')); t.after(() => rm(home, { recursive: true, force: true }));
  const make = async (root, name, text) => { await mkdir(join(home, root, name), { recursive: true }); await writeFile(join(home, root, name, 'SKILL.md'), text); };
  await make('.claude/skills', 'explainer-video', '---\nname: explainer-video\ndescription: Make a premium animated video\n  on any topic.\n---\n# Video\n');
  await make('.agents/skills', 'folded', '---\nname: folded\ndescription: >\n  First line\n  second line\n---\n');
  await make('.codex/skills', 'quoted', '---\nname: "quoted"\ndescription: \'Has: a colon\'\n---\n');
  // The same skill linked from two other folders is found once; a folder without SKILL.md and a broken link are skipped.
  await symlink(join(home, '.claude/skills/explainer-video'), join(home, '.agents/skills/explainer-video'));
  await symlink(join(home, '.claude/skills/explainer-video'), join(home, '.codex/skills/explainer-video'));
  await mkdir(join(home, '.claude/skills/empty'), { recursive: true });
  await symlink(join(home, 'nowhere'), join(home, '.claude/skills/broken'));
  for (const dir of ['.ssh', '.codex', '.claude', 'MyBots/Dev']) await mkdir(join(home, dir), { recursive: true });
  return home;
}

test('discovery follows links, counts a skill once, reads the frontmatter and skips what is broken', async t => {
  const home = await homeWithSkills(t);
  const found = discover(undefined, home);
  assert.deepEqual(found.map(item => item.name).sort(), ['explainer-video', 'folded', 'quoted']);
  const video = found.find(item => item.name === 'explainer-video');
  assert.equal(video.path, join(home, '.claude/skills/explainer-video'));
  assert.equal(video.description, 'Make a premium animated video on any topic.');
  assert.equal(found.find(item => item.name === 'folded').description, 'First line second line');
  assert.equal(found.find(item => item.name === 'quoted').description, 'Has: a colon');
  assert.deepEqual(frontmatter('sem frontmatter'), {});
  assert.deepEqual(discover(['nao/existe'], home), []);
});

test('only the skills turned on, and still on this disk, are used', async t => {
  const home = await homeWithSkills(t); const found = discover(undefined, home);
  const video = found.find(item => item.name === 'explainer-video');
  assert.deepEqual(enabledFor({}, found), []);
  assert.deepEqual(enabledFor({ skills: [{ path: '/etc' }, { path: join(home, '.ssh') }] }, found), []);
  const [on] = enabledFor({ skills: [{ path: video.path }, { path: '/etc' }] }, found);
  assert.equal(on.name, 'explainer-video'); assert.equal(on.write, false);
  assert.equal(enabledFor({ skills: [{ path: video.path, write: true }] }, found)[0].write, true);
});

test('the index reaches Claude and Codex the same way, private chat or room, and is absent when nothing is on', async t => {
  const home = await homeWithSkills(t); const found = discover(undefined, home);
  const on = enabledFor({ skills: [{ path: found.find(item => item.name === 'explainer-video').path, write: true }] }, found);
  const workspace = join(home, 'MyBots/Dev');
  const tools = { endpoint: 'http://127.0.0.1:1', token: 'x', entry: '/tmp/e.mjs', device: 'pc', computer: computerFor({ folders: [], full: false }, workspace, home, on), skills: on };
  const claudeArgs = claude.claudeArguments({ model: 'haiku' }, randomUUID(), tools);
  const claudeText = claudeArgs[claudeArgs.indexOf('--append-system-prompt') + 1];
  const codexArgs = codex.chatArguments('/tmp/out', { model: 'test' }, tools);
  const codexText = JSON.parse(codexArgs.find(arg => arg.startsWith('developer_instructions=')).slice('developer_instructions='.length));
  for (const text of [claudeText, codexText]) {
    assert.match(text, /explainer-video: Make a premium animated video on any topic\./);
    assert.ok(text.includes(join(on[0].path, 'SKILL.md')));
    assert.match(text, /leia o SKILL\.md dela antes de qualquer outra coisa/);
  }
  // The folder is looked into by Claude (--add-dir) and writable for Codex only because "pode melhorar" is on.
  assert.ok(claudeArgs.some((arg, index) => arg === '--add-dir' && claudeArgs[index + 1] === on[0].path));
  assert.ok(codexArgs.includes(`sandbox_workspace_write.writable_roots=${JSON.stringify([on[0].path])}`));
  const readOnly = codex.chatArguments('/tmp/out', { model: 'test' }, { ...tools, computer: computerFor({ folders: [], full: false }, workspace, home, [{ ...on[0], write: false }]), skills: [{ ...on[0], write: false }] });
  assert.ok(!readOnly.some(arg => arg.startsWith('sandbox_workspace_write.writable_roots')));
  assert.match(JSON.parse(readOnly.find(arg => arg.startsWith('developer_instructions=')).slice(23)), /somente leitura/);
  // The graphics card needs Codex's own sandbox out of the way (it would mount a private /dev); the other levels keep it.
  assert.ok(codexArgs.includes('workspace-write') && !codexArgs.includes('danger-full-access'));
  const withGpu = codex.chatArguments('/tmp/out', { model: 'test' }, { ...tools, gpu: true });
  assert.ok(withGpu.includes('danger-full-access') && !withGpu.includes('workspace-write'));
  assert.ok(codex.chatArguments('/tmp/out', { model: 'test' }, { endpoint: 'http://127.0.0.1:1', token: 'x', entry: '/tmp/e.mjs', gpu: true }).includes('read-only'), 'GPU alone, with no computer access, opens nothing');
  // Off: no index at all.
  const none = { ...tools, skills: [], computer: computerFor({ folders: [], full: false }, workspace, home, []) };
  assert.ok(!claude.claudeArguments({ model: 'haiku' }, randomUUID(), none).join(' ').includes('Skills ligadas'));
  assert.ok(!codex.chatArguments('/tmp/out', { model: 'test' }, none).join(' ').includes('Skills ligadas'));
  assert.equal(skillGuidance([]), '');
});

test('a bot with skills may stay quiet for many minutes; the Claude shell limit follows', async t => {
  const home = await homeWithSkills(t); const [skill] = discover(undefined, home).filter(item => item.name === 'folded');
  const tools = { endpoint: 'http://127.0.0.1:1', token: 'x', entry: '/tmp/e.mjs', device: 'pc', computer: computerFor({ folders: [], full: false }, join(home, 'MyBots/Dev'), home, [skill]), skills: [skill] };
  const settings = JSON.parse(claude.claudeArguments({ model: 'haiku' }, randomUUID(), tools).at(-1 - 0) && claude.claudeArguments({ model: 'haiku' }, randomUUID(), tools)[claude.claudeArguments({ model: 'haiku' }, randomUUID(), tools).indexOf('--settings') + 1]);
  assert.equal(settings.env.BASH_DEFAULT_TIMEOUT_MS, '2400000');
  assert.ok(codex.SKILL_IDLE_MS > codex.IDLE_MS);
  const plain = claude.claudeArguments({ model: 'haiku' }, randomUUID(), { ...tools, skills: [] });
  assert.equal(JSON.parse(plain[plain.indexOf('--settings') + 1]).env.BASH_DEFAULT_TIMEOUT_MS, undefined);
});

test('the sandbox shows only the skill folder where the IA\'s login is hidden, and the GPU only when allowed', async t => {
  const home = await homeWithSkills(t); const found = discover(undefined, home);
  const video = found.find(item => item.name === 'explainer-video');
  const dev = await mkdtemp(join(tmpdir(), 'mybots-dev-')); t.after(() => rm(dev, { recursive: true, force: true }));
  for (const name of ['dri', 'nvidia0', 'nvidiactl', 'nvidia-uvm', 'null', 'tty']) await mkdir(join(dev, name), { recursive: true });
  const plain = sandboxFor('codex', home, '/usr/bin/bwrap', undefined, { dev });
  assert.ok(plain.includes(join(home, '.claude')) && !plain.includes(video.path), 'no skill, no folder');
  assert.ok(!plain.includes('--dev-bind', 1) || !plain.some(arg => arg.startsWith(dev)), 'no GPU unless allowed');
  const readOnly = sandboxFor('codex', home, '/usr/bin/bwrap', undefined, { skills: [{ ...video, write: false }], dev });
  const at = readOnly.findIndex((arg, index) => arg === '--ro-bind' && readOnly[index + 1] === video.path && readOnly[index + 2] === video.path);
  assert.ok(at > readOnly.indexOf('--tmpfs'), 'mounted after the folders that hide ~/.claude');
  assert.ok(readOnly.lastIndexOf('--tmpfs') < at && readOnly.includes(join(home, '.claude')));
  // The folder is the only thing under ~/.claude that comes back; the credentials folder itself stays hidden.
  assert.ok(!readOnly.some((arg, index) => ['--bind', '--ro-bind'].includes(arg) && readOnly[index + 1] === join(home, '.claude')));
  const writable = sandboxFor('codex', home, '/usr/bin/bwrap', undefined, { skills: [{ ...video, write: true }], dev });
  assert.ok(writable.some((arg, index) => arg === '--bind' && writable[index + 1] === video.path));
  const gpu = sandboxFor('claude', home, '/usr/bin/bwrap', undefined, { gpu: true, dev });
  for (const name of ['dri', 'nvidia0', 'nvidiactl', 'nvidia-uvm']) assert.ok(gpu.some((arg, index) => arg === '--dev-bind' && gpu[index + 1] === join(dev, name)), name);
  assert.ok(!gpu.includes(join(dev, 'null')) && !gpu.includes(join(dev, 'tty')));
  assert.ok(gpu.indexOf('--dev') < gpu.indexOf('--dev-bind', 5), 'after the private /dev');
});

test('reading a skill, running its scripts and saving into one that may be improved never open an approval card; the rest does', () => {
  const list = [{ path: '/home/p/.claude/skills/explainer-video', write: false }, { path: '/home/p/.claude/skills/other', write: true }];
  const root = list[0].path;
  assert.ok(insideSkill(list, root + '/SKILL.md') && insideSkill(list, root + '/engine/a.js'));
  assert.ok(!insideSkill(list, root + '-evil/x') && !insideSkill(list, '/home/p/.claude/.credentials.json') && !insideSkill(list, root + '/../../.credentials.json'));
  assert.ok(!insideSkill(list, root + '/x', true) && insideSkill(list, list[1].path + '/x', true));
  for (const ok of [`${root}/setup.sh`, `bash ${root}/setup.sh`, `cd ${root} && node ${root}/render.js`, `FOO=1 ${root}/.venv/bin/python ${root}/a.py --x 1`, `cd ${root}; cat references/a.json | head`.replace(' | head', ''), `cd ${root}; ls .venv/bin/python models; ./setup.sh`, `cd ${root} && bash setup.sh`, `ls ${root}/engine`]) assert.ok(commandInside(list, ok), ok);
  for (const bad of [`${root}/a.sh; rm -rf ~`, `${root}/a.sh | sh`, `${root}/a.sh > /etc/x`, `cat $(echo ${root})`, 'ls', 'node render.js', `bash ${root}/a.sh && curl x`, `cd / && ${root}/a.sh`, `${root}/a.sh &`, '', 'cat references/a.json', `cd ${root}; cat ../../.credentials.json`, `cd ${root}; mkdir -p /tmp/x`, `cd ${root}; rm -rf .`, `cd ${root}; cat /home/p/.ssh/id_rsa`, `cd ${root}; ./a.sh; ls ~`, `cd ${root}; FOO=1 rm x`, `cd ${root}; env rm x`, `cd ${root}; python3 -c "import os"`, `cd ${root}; curl x`])
    assert.equal(commandInside(list, bad), false, bad);
});

test('the profile accepts skills and the GPU only in a safe shape', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-skills-profile-'));
  const app = await createSupervisor({ directory: dir, port: 0, codex: fakeCodex });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Video', ...selection, home: 'pc' });
  // The computer is offline here: turning a skill on needs it, turning everything off does not.
  await assert.rejects(app.rpc('bot.update', { botId: bot.id, skills: [{ path: '/home/p/.claude/skills/x' }] }), /Conecte o computador/);
  assert.deepEqual((await app.rpc('bot.update', { botId: bot.id, skills: [] })).skills, []);
  assert.equal((await app.rpc('bot.update', { botId: bot.id, gpu: true })).gpu, true);
  await assert.rejects(app.rpc('bot.update', { botId: bot.id, gpu: 'sim' }), /placa de vídeo/);
  assert.equal((await app.rpc('agent.skills', {})).offline, true);
});

test('on Médio, the computer asks for everything except the skill turned on: no card to read it, run its scripts or save into one marked to improve', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-skills-perm-'));
  const app = await createSupervisor({ directory: dir, port: 0, codex: fakeCodex });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  let bot = await app.rpc('bot.create', { name: 'Video', access: 'ask', ...selection, home: 'pc' });
  const root = '/home/p/.claude/skills/explainer-video';
  bot = app.db.configure(bot.id, selection, { skills: [{ path: root, write: false }, { path: '/home/p/.claude/skills/learner', write: true }] });
  const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Oi', selection).id);
  const cap = app.tools.open(task, new AbortController().signal, 'pc'); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
  t.after(cap.close);
  const permission = (tool_name, input) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name: 'permission', args: { tool_name, input } });
  assert.equal((await permission('Read', { file_path: root + '/SKILL.md' })).behavior, 'allow');
  assert.equal((await permission('Bash', { command: `cd ${root} && bash ${root}/setup.sh` })).behavior, 'allow');
  assert.equal((await permission('Write', { file_path: '/home/p/.claude/skills/learner/lessons.md', content: 'x' })).behavior, 'allow');
  // The login, a skill that is read-only for writing, and anything else still follow the level (and the keys stay refused).
  assert.equal((await permission('Read', { file_path: '/home/p/.claude/.credentials.json' })).behavior, 'deny');
  const ask = async (tool, input) => { const pending = permission(tool, input); const until = Date.now() + 5000; while (!app.state().approvals.length && Date.now() < until) await new Promise(r => setTimeout(r, 20)); const [card] = app.state().approvals; await app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: false }); return (await pending).behavior; };
  assert.equal(await ask('Write', { file_path: root + '/SKILL.md', content: 'x' }), 'deny');
  assert.equal(await ask('Bash', { command: 'ls /home/p' }), 'deny');
  assert.equal(await ask('Read', { file_path: '/home/p/outro/arquivo.txt' }), 'deny');
});
