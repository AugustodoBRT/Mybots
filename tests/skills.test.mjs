import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { skillProposal } from '../supervisor/skills.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Estado esperado não chegou.'); }
const JOBS = `export async function run(input, kit) {
  kit.log('procurando', input.cidade);
  const items = [{ vaga: 'Estágio em TI', empresa: 'Acme', email: 'rh@acme.com.br', link: 'https://acme.com.br/vagas/1' }, { vaga: 'Dev júnior', empresa: 'Beta', email: '', link: 'https://beta.com/j/2' }];
  return { summary: items.length + ' vagas em ' + input.cidade + '.', items };
}`;

async function setup(t, script) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-skills-'));
  const notices = [];
  // The fake IA calls MyBots tools over MCP, like Claude Code does, following the script for each turn.
  const execute = async (bot, prompt, { tools }) => {
    const call = async (body, session) => { const response = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) }); return { session: response.headers.get('mcp-session-id'), body: await response.json() }; };
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const out = [];
    for (const [name, args] of script.shift() || []) { const answer = (await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, init.session)).body.result; out.push(answer.isError ? 'ERRO: ' + answer.content[0].text : answer.content[0].text); }
    return { text: out.join('\n---\n') || 'ok', ...selection, codexSessionId: randomUUID() };
  };
  const app = await createSupervisor({ directory, port: 0, codex, execute, approvalMs: 8000, notify: async (args, options) => { notices.push({ ...args, ...options }); return { notified: true }; } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, notices, directory };
}
const approveAll = app => { const timer = setInterval(() => { for (const card of app.state().approvals) app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: true }).catch(() => {}); }, 30); return () => clearInterval(timer); };
async function say(app, bot, text = 'faz') { const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text }); await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state)); return app.db.bot(bot.id).messages.at(-1).text; }

test('a proposal is checked: name, a run function, real domains and a sane routine time', () => {
  assert.equal(skillProposal({ name: 'buscar_vagas', title: 'Buscar vagas', description: 'Vagas de TI', code: JOBS, sites: ['https://portal.gupy.io/x'], daily_at: '08:00', new_bot: { name: 'Vagas' } }).sites[0], 'portal.gupy.io');
  for (const bad of [{ name: 'Buscar Vagas' }, { code: 'console.log(1)' }, { sites: ['localhost'] }, { sites: ['127.0.0.1'] }, { daily_at: '25:00' }])
    assert.throws(() => skillProposal({ name: 'buscar_vagas', title: 'B', description: 'D', code: JOBS, ...bad }));
});

test('proposing asks the person even on Acesso total; once approved: a new phone bot, a daily routine without IA, and a test run on the phone', async t => {
  const script = [[['skill_propose', { name: 'buscar_vagas', title: 'Buscar vagas', description: 'Estágios e júnior em TI', code: JOBS, sites: ['portal.gupy.io'], example_input: { cidade: 'BH' }, new_bot: { name: 'Vagas' }, daily_at: '08:00' }]]];
  const { app, notices } = await setup(t, script);
  const programmer = await app.rpc('bot.create', { name: 'Programador', ...selection, access: 'full' });
  const sent = app.rpc('chat.send', { botId: programmer.id, requestId: randomUUID(), text: 'cria o bot de vagas' });
  await until(() => app.state().approvals.length === 1);
  const card = app.state().approvals[0];
  assert.equal(card.title, 'Instalar uma habilidade no celular');
  assert.match(card.summary, /portal\.gupy\.io/); assert.match(card.summary, /bot novo no celular: Vagas/); assert.match(card.summary, /todo dia às 08:00, sem usar a IA/); assert.equal(card.canAlways, false);
  await app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: true });
  await sent; await until(() => !app.db.tasks().some(task => ['queued', 'running', 'waiting_approval'].includes(task.state)));
  const reply = JSON.parse(app.db.bot(programmer.id).messages.at(-1).text);
  assert.equal(reply.installed, true); assert.equal(reply.bot, 'Vagas'); assert.equal(reply.testOnPhone.ok, true); assert.match(reply.testOnPhone.result, /2 vagas em BH/);
  const vagas = app.state().bots.find(bot => bot.name === 'Vagas');
  assert.equal(vagas.home, 'phone'); assert.equal(vagas.skills.length, 1);
  const routine = app.state().routines.find(item => item.botId === vagas.id);
  assert.match(routine.label, /Todo dia às 08:00 · habilidade, sem IA/);
  // The routine runs the program itself: a table and a spreadsheet in the chat, and a notice. No IA turn.
  const tasksBefore = app.db.tasks().length;
  await app.rpc('routine.run', { id: routine.id });
  await until(() => app.db.bot(vagas.id).messages.length === 2);
  const [asked, answer] = app.db.bot(vagas.id).messages;
  assert.equal(asked.origin, 'routine'); assert.match(answer.text, /2 vagas em BH\.\n\n- \*\*Estágio em TI\*\* — Acme · rh@acme\.com\.br · \[abrir\]\(https:\/\/acme\.com\.br\/vagas\/1\)/);
  assert.match(answer.attachments[0].name, /Buscar vagas .*\.xlsx$/);
  assert.equal(app.db.tasks().length, tasksBefore);
  await until(() => notices.some(item => /2 vagas em BH/.test(item.body)));
  // The bot that owns it can run it; another bot cannot see it.
  script.push([['skill_run', { name: 'buscar_vagas', input: { cidade: 'Contagem' } }]]);
  assert.match(await say(app, vagas), /2 vagas em Contagem/);
  script.push([['skill_run', { name: 'buscar_vagas' }]]);
  assert.match(await say(app, programmer), /não tem a habilidade buscar_vagas/);
  // Backups keep skills; removing one also removes its routine.
  assert.equal(app.db.snapshot().skillsState.skills.length, 1);
  await app.rpc('skill.remove', { id: vagas.skills[0] });
  assert.equal(app.state().skills.length, 0); assert.equal(app.state().routines.filter(item => item.botId === vagas.id).length, 0);
});

test('a skill runs isolated: no files of the person, no other programs, no raw sockets, only its declared sites, and a time limit', async t => {
  const tryThis = body => `export async function run(input, kit) { ${body} }`;
  const cases = [
    ['ler', tryThis(`const fs = await import('node:fs'); return { summary: fs.readFileSync('/etc/passwd', 'utf8').slice(0, 5) };`), /ERR_ACCESS_DENIED|permission|Access to this API/i],
    ['processo', tryThis(`const cp = await import('node:child_process'); return { summary: String(cp) };`), /não pode usar node:child_process/],
    ['socket', tryThis(`const net = await import('net'); return { summary: String(net) };`), /não pode usar net/],
    ['site', tryThis(`await fetch('https://evil.example.com/x'); return { summary: 'vazou' };`), /só pode acessar portal\.gupy\.io/],
    ['lento', tryThis(`await new Promise(resolve => setTimeout(resolve, 60000));`), /passou de 5 s/],
    ['esquecida', tryThis(`await new Promise(() => {});`), /terminou sem devolver um resultado/],
    ['dados', tryThis(`const fs = await import('node:fs'); fs.writeFileSync('data/visto.txt', 'ok'); return { summary: fs.readFileSync('data/visto.txt', 'utf8') };`), null]
  ];
  const script = [cases.map(([name, code]) => ['skill_propose', { name: `teste_${name}`, title: name, description: 'teste', code, sites: ['portal.gupy.io'], timeout_seconds: 5 }])];
  const { app } = await setup(t, script);
  const bot = await app.rpc('bot.create', { name: 'Testes', ...selection, access: 'full' });
  const stop = approveAll(app);
  const results = (await say(app, bot)).split('\n---\n').map(text => JSON.parse(text).testOnPhone);
  stop();
  cases.forEach(([name, , error], index) => {
    if (error) { assert.equal(results[index].ok, false, name); assert.match(results[index].error, error, name); }
    else assert.deepEqual([results[index].ok, JSON.parse(results[index].result).summary], [true, 'ok'], name);
  });
});
