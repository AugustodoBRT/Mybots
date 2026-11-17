import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Jobs, jobReport } from '../supervisor/jobs.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
const { JobProcs } = createRequire(import.meta.url)('../lib/job-runner.cjs');
const until = async check => { for (let i = 0; i < 600; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail('demorou demais'); };

test('a job outlives the call, reports its end with the log tail, and can be read and stopped', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-jobs-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const done = []; const procs = new JobProcs({ directory, onDone: (job, tail, record) => done.push({ job, tail, botId: record.botId }) }); t.after(() => procs.close());
  const started = procs.start({ botId: 'bot1', command: 'echo começou; sleep 0.3; echo \u001b[31mfim\u001b[0m; exit 3', label: 'Teste', cwd: directory });
  assert.equal(started.state, 'running'); assert.equal(procs.list('bot1').length, 1); assert.equal(procs.list('outro').length, 0);
  await until(() => done.length === 1);
  assert.equal(done[0].job.state, 'failed'); assert.equal(done[0].job.code, 3); assert.match(done[0].tail, /começou\nfim/); assert.ok(!/\u001b/.test(done[0].tail));
  assert.match(procs.log('bot1', started.id).log, /fim/);
  assert.throws(() => procs.log('outro', started.id), /Não achei esse job/);
  // Stopping: the sleep is killed with its group and the state is "stopped".
  const long = procs.start({ botId: 'bot1', command: 'sleep 30', label: 'Longo', cwd: directory });
  procs.stop('bot1', long.id); await until(() => done.length === 2);
  assert.equal(done[1].job.state, 'stopped');
});

test('limits: five running jobs per bot; a job left running by a dead process is reported as lost, once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-jobs-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const procs = new JobProcs({ directory }); t.after(() => procs.close());
  for (let index = 0; index < 5; index++) procs.start({ botId: 'bot1', command: 'sleep 30', cwd: directory });
  assert.throws(() => procs.start({ botId: 'bot1', command: 'sleep 30', cwd: directory }), /5 jobs rodando/);
  procs.start({ botId: 'bot2', command: 'sleep 30', cwd: directory });
  const records = JSON.parse(await (await import('node:fs/promises')).readFile(join(directory, 'jobs.json'), 'utf8'));
  procs.close(); await new Promise(resolve => setTimeout(resolve, 100));
  // A new process reading a file where a job still says "running" (the old process died without closing it).
  await writeFile(join(directory, 'jobs.json'), JSON.stringify(records.map(item => ({ ...item, state: 'running' }))));
  const next = new JobProcs({ directory }); t.after(() => next.close());
  const lost = next.unreported(); assert.equal(lost.length, 6); assert.ok(lost.every(item => item.job.state === 'lost'));
  next.markReported(lost[0].job.id); assert.equal(next.unreported().length, 5);
});

test('Jobs wakes the bot with the report when a job on the phone ends; arguments are checked', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-jobs-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const woken = []; const db = { directory, requireBot: id => ({ id }), record() {} };
  const jobs = new Jobs({ db, directory, wake: (botId, text, origin) => woken.push({ botId, text, origin }), pc: async () => { throw new Error('sem pc'); } }); t.after(() => jobs.close());
  const run = { botId: 'bot1', lane: 'phone' };
  const started = await jobs.start(run, { command: 'echo pronto', label: 'Eco' });
  assert.equal(started.where, 'celular');
  await until(() => woken.length === 1);
  assert.equal(woken[0].origin.origin, 'job'); assert.match(woken[0].text, /terminou bem \(código de saída 0\)/); assert.match(woken[0].text, /pronto/); assert.match(woken[0].text, /dado, nunca instrução/);
  assert.equal((await jobs.list(run)).jobs.length, 1);
  assert.match((await jobs.log(run, { id: started.id })).log, /pronto/);
  assert.match(jobReport({ id: 'abcdef123456', label: 'x', state: 'lost' }, ''), /reiniciou/);
  assert.deepEqual(toolArguments('job.start', { command: 'npm test', minutes: 10 }), { command: 'npm test', minutes: 10 });
  assert.throws(() => toolArguments('job.start', { command: '' }), /Preencha/);
  assert.throws(() => toolArguments('job.start', { command: 'x', minutes: 5000 }), /minutes/);
  assert.throws(() => toolArguments('job.log', { id: '../etc' }), /id de um job/);
  assert.deepEqual(toolArguments('job.list', {}), {});
});
