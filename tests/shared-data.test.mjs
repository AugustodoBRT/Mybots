import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

// The Chefe's top requests after using MyBots for real: shared tables, decisions with options, changing the team (approved by the
// person), the result of each routine run, and the team's cost.
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

async function setup(t, { clock } = {}) {
  const notices = [], prompts = [];
  const directory = await mkdtemp(join(tmpdir(), 'mybots-shared-'));
  const app = await createSupervisor({ directory, port: 0, codex, approvalMs: 2000, routineTickMs: 60000, clock,
    notify: async (args, options) => { notices.push({ ...args, ...options }); return { notified: true }; },
    execute: async (bot, prompt) => { prompts.push({ bot: bot.name, prompt }); return { text: `Feito por ${bot.name}.`, ...selection }; } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('state.get');
  const chief = app.db.create({ name: 'Chefe', isChief: true, autonomy: 'local' }, selection);
  const vagas = app.db.create({ name: 'Vagas', instructions: 'Procura estágios.', autonomy: 'local' }, selection);
  const runAs = botId => {
    const task = app.db.start(app.db.enqueue(botId, randomUUID(), 'Trabalhe', selection).id); const cap = app.tools.open(task); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(() => { cap.close(); try { app.db.finish(task.id, 'cancelled', null, 'fim'); } catch {} });
    return { task, call: (tool, args = {}) => app.tools.call(cap.token, { bridgeId, callId: randomUUID(), tool, args }) };
  };
  return { app, chief, vagas, runAs, notices, prompts };
}

test('shared tables: every bot reads and writes, duplicates are caught, secrets refused', async t => {
  const f = await setup(t);
  const a = f.runAs(f.vagas.id), b = f.runAs(f.chief.id);
  assert.deepEqual((await a.call('table.list')).tables, []);
  const first = await a.call('table.add', { table: 'candidaturas', row: { empresa: 'Acme', vaga: 'Estágio TI', status: 'enviada' }, unique: ['empresa', 'vaga'] });
  assert.equal(first.added, true);
  const twin = await b.call('table.add', { table: 'candidaturas', row: { empresa: 'acmé', vaga: 'estágio ti', status: 'nova' }, unique: ['empresa', 'vaga'] });
  assert.equal(twin.added, false); assert.equal(twin.duplicate, true); assert.equal(twin.existing.id, first.id);
  await b.call('table.add', { table: 'candidaturas', row: { empresa: 'Beta', vaga: 'Dados', status: 'nova' } });
  const read = await b.call('table.read', { table: 'candidaturas', where: { status: 'ENVIADA' } });
  assert.equal(read.total, 1); assert.equal(read.rows[0]._by, 'Vagas');
  assert.equal((await b.call('table.read', { table: 'candidaturas', query: 'dados' })).rows[0].empresa, 'Beta');
  await b.call('table.update', { table: 'candidaturas', id: first.id, row: { status: 'entrevista' } });
  assert.equal((await a.call('table.read', { table: 'candidaturas', where: { empresa: 'Acme' } })).rows[0].status, 'entrevista');
  await b.call('table.delete', { table: 'candidaturas', id: first.id });
  assert.equal((await a.call('table.list')).tables[0].rows, 1);
  await assert.rejects(a.call('table.add', { table: 'contas', row: { site: 'x', senha: '123' } }), /senha/);
  await assert.rejects(a.call('table.add', { table: 'Com Espaço', row: { a: 1 } }), /Nome de tabela/);
});

test('a decision shows options in the chat, the answer (or written text) goes back to the bot, and it stays in the history', async t => {
  const f = await setup(t);
  const run = f.runAs(f.vagas.id);
  const asked = await run.call('user.decide', { question: 'Qual vaga priorizar?', options: ['Acme', 'Beta'] });
  assert.equal(asked.asked, true);
  const card = f.app.db.messages(f.vagas.id).find(item => item.decision);
  assert.deepEqual(card.decision.options, ['Acme', 'Beta']); assert.equal(card.text, 'Qual vaga priorizar?');
  assert.match(f.notices.at(-1).body, /1\. Acme/);
  f.app.db.finish(run.task.id, 'done', { text: 'Ok.', ...selection });
  await f.app.rpc('decision.answer', { id: asked.id, option: 2 });
  await assert.rejects(f.app.rpc('decision.answer', { id: asked.id, option: 1 }), /já foi respondida/);
  assert.equal(f.app.db.messages(f.vagas.id).find(item => item.decision).decision.answer, 'Beta');
  await until(() => f.prompts.some(item => /A pessoa escolheu: Beta/.test(item.prompt)));
  // Written answer, and the history (the Chefe sees everyone's).
  const second = f.runAs(f.vagas.id);
  const other = await second.call('user.decide', { question: 'Que horário de estudo?', options: ['Manhã'] });
  await f.app.rpc('decision.answer', { id: other.id, text: 'Só depois das 20h' });
  const history = await f.runAs(f.chief.id).call('user.decisions', {});
  assert.deepEqual(history.decisions.map(item => item.answer), ['Só depois das 20h', 'Beta']);
  assert.equal(history.decisions[0].written, true);
  await assert.rejects(f.runAs(f.vagas.id).call('user.decisions', { bot: 'Chefe' }), /Só o Chefe/);
});

test('a decision with a deadline and on_timeout cancel expires and tells the bot, never deciding for the person', async t => {
  let at = Date.now(); const f = await setup(t, { clock: () => at });
  const asked = await f.runAs(f.vagas.id).call('user.decide', { question: 'Mando a candidatura?', options: ['Sim', 'Não'], deadline_hours: 1, on_timeout: 'cancel' });
  at += 2 * 3600000; f.app.decisions().tick();
  assert.equal(f.app.decisions().get(asked.id).state, 'expired');
  assert.match(f.app.db.messages(f.vagas.id).at(-1).text, /Decisão expirada/);
});

test('the Chefe proposes changing a bot and its routines; the person approves; others cannot; results and cost are visible', async t => {
  const f = await setup(t);
  const busy = f.runAs(f.vagas.id);
  await assert.rejects(busy.call('team.update_bot', { bot: 'Chefe', instructions: 'x', reason: 'y' }), /precisa de permissão|exclusiva do Chefe/);
  const run = f.runAs(f.chief.id);
  await assert.rejects(run.call('team.update_bot', { bot: 'Vagas', name: 'X', reason: 'y' }), /trabalhando agora/);
  f.app.db.finish(busy.task.id, 'cancelled', null, 'fim');
  const pending = run.call('team.update_bot', { bot: 'Vagas', instructions: 'Procura estágios de TI em Recife.', reason: 'Focar a busca.' });
  await until(() => f.app.state().approvals.length === 1);
  const approval = f.app.state().approvals[0];
  assert.match(approval.summary, /Instruções antes:\nProcura estágios\./); assert.match(approval.summary, /Por quê: Focar a busca\./);
  await f.app.rpc('approval.respond', { approvalId: approval.id, approved: true, actionHash: approval.actionHash });
  assert.equal((await pending).done, true);
  assert.equal(f.app.db.bot(f.vagas.id).instructions, 'Procura estágios de TI em Recife.');
  // A routine for Vagas, created by the Chefe after approval; its run and its result show up in team_routines.
  const making = run.call('team.routine_update', { bot: 'Vagas', action: 'create', title: 'Busca diária', instructions: 'Procure vagas novas.', trigger: { type: 'interval', everyMinutes: 60 }, reason: 'Rodar sozinho.' });
  await until(() => f.app.state().approvals.length === 1);
  const second = f.app.state().approvals[0]; await f.app.rpc('approval.respond', { approvalId: second.id, approved: true, actionHash: second.actionHash });
  const created = await making;
  f.app.db.finish(run.task.id, 'done', { text: 'Ok.', ...selection });
  for (const task of f.app.db.tasks().filter(item => ['running', 'queued'].includes(item.state))) f.app.db.finish(task.id, 'cancelled', null, 'fim');
  await f.app.rpc('routine.run', { id: created.id });
  await until(async () => (await f.runAs(f.chief.id).call('team.routines', { bot: 'Vagas' })).routines[0]?.runs[0]?.state === 'ok');
  const view = await f.runAs(f.chief.id).call('team.routines', { bot: 'Vagas' });
  assert.equal(view.routines[0].runs[0].summary, 'Feito por Vagas.');
  const usage = await f.runAs(f.chief.id).call('team.usage', {});
  assert.ok(Array.isArray(usage.bots) && Array.isArray(usage.routines));
});
