import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from '../supervisor/database.mjs';
import { Queue } from '../supervisor/queue.mjs';
import { Rooms } from '../supervisor/rooms.mjs';
import { Team } from '../supervisor/team.mjs';
import { Tools } from '../supervisor/tools.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import agentSkills from '../lib/agent-skills.cjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const temp = (t, prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

// 13/11/2026: the design team skipped the skills, Google Stitch and the boldness that were asked, and the chief said it was all covered.
test('the chief lists what was asked, marks each item, and its answer ends with the list once every item is marked', async t => {
  const dir = temp(t, 'mybots-checklist-');
  const db = new Database(dir), tools = new Tools(db);
  t.after(() => { try { db.close(); } catch {} });
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const sol = db.create({ name: 'Sol' }, selection);
  const prompts = [];
  const execute = async (bot, prompt, options) => {
    const bridgeId = randomUUID(); tools.context(options.tools.token, bridgeId, true);
    const call = (name, args = {}) => tools.callMcp(options.tools.token, { name, args, bridgeId, callId: randomUUID() });
    if (!bot.isChief) return { text: `${bot.name}: fiz as telas, mas não abri o Stitch.` };
    prompts.push(prompt);
    if (/Retorno automático/.test(prompt)) {
      assert.match(prompt, /Checklist do pedido, ainda em aberto:[\s\S]{0,8}1\. Usar o Google Stitch[\s\S]{0,8}2\. Instalar skills de design/);
      await call('team_check', { item: 2, done: true });
      await assert.rejects(call('team_check', { item: 1, done: false }), /por que/);
      const last = await call('team_check', { item: 1, done: false, note: 'o Sol não abriu o site; precisa do seu login do Google' });
      assert.deepEqual(last.open, []);
      return { text: 'Terminamos as telas.' };
    }
    const list = await call('team_checklist', { items: ['Usar o Google Stitch', 'Instalar skills de design'] });
    assert.deepEqual(list.items, ['1. Usar o Google Stitch', '2. Instalar skills de design']);
    await call('team_ask', { bot: 'Sol', text: 'Faça as telas no Google Stitch (obrigatório).' });
    return { text: 'Pedi ao Sol.' };
  };
  const queue = new Queue(db, execute, tools);
  const rooms = new Rooms(db, { schedule: () => queue.schedule() });
  queue.rooms = rooms; tools.team = new Team(db, { rooms, schedule: () => queue.schedule() });
  queue.on('changed', change => { if (change?.event === 'task.done') tools.team.settled(change.taskId); });
  db.enqueue(chief.id, randomUUID(), 'Redesenhe as telas no Stitch e instale skills.', selection);
  try {
    queue.schedule();
    for (let n = 0; n < 200 && !/^Terminamos/.test(db.latest(chief.id, 'assistant')?.text || ''); n++) await new Promise(resolve => setTimeout(resolve, 25));
    const answers = db.page({ botId: chief.id, limit: 20 }).messages.filter(item => item.role === 'assistant').map(item => item.text);
    assert.equal(answers[0], 'Pedi ao Sol.', 'nothing added while items are open');
    assert.equal(answers.at(-1), 'Terminamos as telas.\n\n**O que você pediu**\n- ✗ Usar o Google Stitch: o Sol não abriu o site; precisa do seu login do Google\n- ✓ Instalar skills de design');
    // Only once.
    assert.equal(tools.team.closingNote(chief.id), '');
    assert.throws(() => tools.team.checklist({}, { items: ['x'] }, sol), /Só o Chefe/);
  } finally { await queue.close(); }
  assert.throws(() => toolArguments('team.checklist', { items: [] }), /de 1 a 20/);
  assert.throws(() => toolArguments('team.check', { item: 0, done: true }), /item/);
});

test('the chief sees the computer\'s skills, turns one on for a bot, and installs a new one only after the person approves', async t => {
  const dir = temp(t, 'mybots-skills-');
  const db = new Database(dir), tools = new Tools(db);
  t.after(() => { try { db.close(); } catch {} });
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const palco = db.create({ name: 'Palco' }, selection);
  tools.team = new Team(db, { rooms: new Rooms(db), schedule: () => {} });
  const skills = [{ id: '/home/x/.gemini/config/skills/impeccable', name: 'impeccable', description: 'Design sem cara de IA.', path: '/home/x/.gemini/config/skills/impeccable', source: '~/.gemini/config/skills' }];
  const installed = [];
  tools.agentSkills = { list: async () => skills, install: async source => { installed.push(source); return { installed: [{ name: 'taste' }], alreadyThere: [] }; } };
  const run = { botId: chief.id, taskId: randomUUID() };
  assert.deepEqual((await tools.teamSkills({ query: 'design' })).skills, [{ name: 'impeccable', description: 'Design sem cara de IA.', from: '~/.gemini/config/skills', usedBy: [] }]);
  const on = await tools.teamEnableSkill(run, chief, { bot: 'Palco', skill: 'Impeccable' });
  assert.equal(on.changed, true);
  assert.deepEqual(db.bot(palco.id).skills, [{ path: skills[0].path, write: true }]);
  assert.deepEqual((await tools.teamSkills()).skills[0].usedBy, ['Palco']);
  assert.equal((await tools.teamEnableSkill(run, chief, { bot: 'Palco', skill: 'impeccable' })).changed, false);
  await assert.rejects(tools.teamEnableSkill(run, chief, { bot: 'Palco', skill: 'stitch' }), /team_install_skill/);
  assert.equal((await tools.teamEnableSkill(run, chief, { bot: 'Palco', skill: 'impeccable', on: false })).changed, true);
  assert.deepEqual(db.bot(palco.id).skills, []);

  // Installing asks first: refused, nothing is downloaded; approved, it is.
  const cards = []; let answer = false;
  tools.ask = async (_run, tool, card) => { cards.push({ tool, ...card }); return answer; };
  tools.requireGrant = () => {};
  await assert.rejects(tools.teamInstallSkill(run, chief, { url: 'https://github.com/leonxlnx/taste-skill' }, 'h'), /reason/);
  await assert.rejects(tools.teamInstallSkill(run, chief, { url: 'https://evil.example/x', reason: 'r' }, 'h'), /GitHub/);
  await assert.rejects(tools.teamInstallSkill(run, chief, { url: 'https://github.com/leonxlnx/taste-skill', reason: 'Design mais ousado' }, 'h'), /recusou/);
  assert.equal(installed.length, 0);
  assert.equal(cards[0].tool, 'team.install_skill');
  assert.match(cards[0].summary, /Repositório: https:\/\/github.com\/leonxlnx\/taste-skill[\s\S]*Instale só de quem você confia[\s\S]*Por quê: Design mais ousado/);
  answer = true;
  const done = await tools.teamInstallSkill(run, chief, { url: 'https://github.com/leonxlnx/taste-skill', reason: 'Design mais ousado' }, 'h');
  assert.deepEqual(done.installed, ['taste']); assert.equal(installed.length, 1);
});

test('skills come from GitHub only, land in ~/.agents/skills without replacing one that exists, and the Antigravity folder is read too', async t => {
  const { githubSource, installFromGithub, discover } = agentSkills;
  assert.deepEqual(githubSource('https://github.com/anthropics/skills/tree/main/skills/frontend-design'), { owner: 'anthropics', repo: 'skills', ref: 'main', folder: 'skills/frontend-design', url: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design' });
  assert.equal(githubSource('https://github.com/o/r.git', 'pasta/a').folder, 'pasta/a');
  for (const bad of ['http://github.com/o/r', 'https://gitlab.com/o/r', 'https://github.com/o', 'file:///etc']) assert.throws(() => githubSource(bad), /GitHub/);
  assert.throws(() => githubSource('https://github.com/o/r', '../x'), /inválida/);

  // A repository with two skills under skills/, packed as GitHub serves it (one top folder).
  const work = temp(t, 'mybots-skill-repo-'), home = temp(t, 'mybots-skill-home-');
  for (const [name, text] of [['alfa', 'name: alfa\ndescription: Primeira'], ['beta', 'name: beta\ndescription: Segunda']]) {
    mkdirSync(join(work, 'repo-main', 'skills', name), { recursive: true });
    writeFileSync(join(work, 'repo-main', 'skills', name, 'SKILL.md'), `---\n${text}\n---\nFaça assim.`);
  }
  mkdirSync(join(work, 'repo-main', '.git')); writeFileSync(join(work, 'repo-main', 'README.md'), 'oi');
  execFileSync('tar', ['-czf', join(work, 'repo.tar.gz'), '-C', work, 'repo-main']);
  const tarball = readFileSync(join(work, 'repo.tar.gz'));
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return { ok: true, status: 200, headers: new Map([['content-length', String(tarball.length)]]), arrayBuffer: async () => tarball }; };
  mkdirSync(join(home, '.agents', 'skills', 'beta'), { recursive: true }); writeFileSync(join(home, '.agents', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\n---\nMinha versão.');
  const result = await installFromGithub(githubSource('https://github.com/o/repo', 'skills'), { home, fetchImpl });
  assert.equal(urls[0], 'https://codeload.github.com/o/repo/tar.gz/HEAD');
  assert.deepEqual(result.installed.map(skill => skill.name), ['alfa']); assert.deepEqual(result.alreadyThere, ['beta']);
  assert.match(readFileSync(join(home, '.agents', 'skills', 'beta', 'SKILL.md'), 'utf8'), /Minha versão/, 'an existing skill is never replaced');
  await assert.rejects(installFromGithub(githubSource('https://github.com/o/repo', 'nada'), { home, fetchImpl }), /não existe/);
  await assert.rejects(installFromGithub(githubSource('https://github.com/o/repo'), { home, fetchImpl: async () => ({ ok: false, status: 404 }) }), /privado/);

  mkdirSync(join(home, '.gemini', 'config', 'skills', 'impeccable'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'config', 'skills', 'impeccable', 'SKILL.md'), '---\nname: impeccable\ndescription: Sem cara de IA\n---\n');
  assert.ok(discover(agentSkills.ROOTS, home).some(skill => skill.name === 'impeccable' && skill.source === '~/.gemini/config/skills'));
  assert.ok(!existsSync(join(home, '.agents', 'skills', 'alfa', '.git')));
});
