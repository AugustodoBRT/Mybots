import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// `script(bot, prompt, call)` is the model of each bot: it may call tools through its own run, like the MCP bridge does.
async function setup(t, script = bot => `Sou ${bot.name}.`) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-team-'));
  const calls = []; let app;
  const execute = async (bot, prompt, { tools }) => {
    const bridgeId = randomUUID(); app.tools.context(tools.token, bridgeId, true);
    const call = (name, args = {}) => app.tools.callMcp(tools.token, { bridgeId, callId: randomUUID(), name, args });
    calls.push({ bot: bot.name, prompt });
    const text = await script(bot, prompt, call);
    return { text, ...selection, codexSessionId: bot.codexSessionId || randomUUID() };
  };
  app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const make = (name, extra = {}) => app.rpc('bot.create', { name, instructions: `Bot ${name}.`, access: 'full', ...selection, ...extra });
  const idle = () => until(() => !app.db.tasks().some(task => ['queued', 'running', 'waiting_approval'].includes(task.state)));
  const chat = async (bot, text) => { await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text }); await idle(); };
  // The person already chose the IA of these bots: the one question asked, the first option (the recommendation) tapped.
  const allow = (maker, names) => {
    app.tools.team.chooseModels({}, { bots: names, recommended: { provider: 'codex' }, alternatives: [] }, maker);
    const decision = app.tools.decisions.open(maker.id).at(-1); const reply = app.tools.decisions.reply;
    app.tools.decisions.reply = () => {}; try { app.tools.decisions.answer(decision.id, { option: 1 }); } finally { app.tools.decisions.reply = reply; }
  };
  return { app, calls, make, idle, chat, allow };
}

test('the person sends files to a room: every member reads them with its own tools, and the message shows them', async t => {
  const seen = {};
  const f = await setup(t, async (bot, prompt, call) => {
    const id = /Anexos \(leia com attachment_read\): [^()]*\(id ([0-9a-f-]{36})\)/.exec(prompt)?.[1];
    if (id) seen[bot.name] = (await call('attachment_read', { id })).text;
    return `Li ${bot.name}.`;
  });
  const [a, b] = [await f.make('Ana'), await f.make('Beto')];
  const room = await f.app.rpc('room.create', { name: 'Trabalho', botIds: [a.id, b.id] });
  const data = Buffer.from('Questão 1: derive x²').toString('base64');
  await assert.rejects(f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: 'x', attachments: [{ name: 'a.exe', mime: 'application/x-msdownload', data }] }), /executáveis/);
  assert.equal(f.app.db.roomMessages(room.id).length, 0);
  // Only a file, no text.
  const request = randomUUID();
  await f.app.rpc('room.send', { roomId: room.id, requestId: request, attachments: [{ name: 'lista.txt', mime: 'text/plain', data }] });
  await f.idle();
  const message = f.app.db.roomMessages(room.id)[0];
  assert.equal(message.text, 'Veja o anexo.'); assert.deepEqual(message.attachments.map(file => file.name), ['lista.txt']);
  assert.deepEqual(seen, { Ana: 'Questão 1: derive x²', Beto: 'Questão 1: derive x²' });
  // The app opens it like a private chat's file; a bot outside the room cannot read it.
  assert.equal((await f.app.rpc('file.read', { id: message.attachments[0].id })).name, 'lista.txt');
  const c = await f.make('Carla');
  await assert.rejects(f.app.attachments?.read?.(c.id, message.attachments[0].id) ?? Promise.reject(new Error('não encontrado')), /não encontrado/);
  // A retry of the same request does not store the files again.
  await f.app.rpc('room.send', { roomId: room.id, requestId: request, attachments: [{ name: 'lista.txt', mime: 'text/plain', data }] });
  assert.equal(f.app.db.all('SELECT * FROM attachments').length, 1);
});

test('a bot makes a bot and a room, calls the others, and leaves on its own, with no approval card', async t => {
  const f = await setup(t, async (bot, prompt, call) => {
    if (bot.name === 'Chefe' && /monte um time/.test(prompt)) {
      const list = await call('team_bots'); assert.deepEqual(list.bots.map(item => item.name).sort(), ['Chefe', 'Vagas']);
      const made = await call('team_create_bot', { name: 'Redator', instructions: 'Escreve textos curtos.' });
      assert.equal(made.access, 'full');
      const room = await call('team_create_room', { name: 'Projeto', bots: ['Vagas', 'redator'], message: '@Vagas ache 3 vagas e @Redator escreva o resumo.' });
      assert.deepEqual(room.first.called, ['Vagas', 'Redator']);
      return 'Montei a sala Projeto.';
    }
    if (bot.name === 'Redator') { await call('team_leave_room', { room: 'Projeto' }); return 'Resumo pronto, saindo.'; }
    return `Feito, ${bot.name}.`;
  });
  const chefe = await f.make('Chefe'); await f.make('Vagas');
  f.allow(chefe, ['Redator']);
  await f.chat(chefe, 'monte um time');
  const room = f.app.db.rooms().find(item => item.name === 'Projeto');
  assert.equal(room.createdBy, chefe.id);
  assert.deepEqual(f.app.db.bots().map(bot => bot.name).sort(), ['Chefe', 'Redator', 'Vagas']);
  // The two called bots answered in the room; the Redator then left and the room says so.
  const texts = f.app.db.roomMessages(room.id).map(item => item.role === 'system' ? 'Aviso: ' + item.text : item.text);
  assert.ok(texts.some(text => /Feito, Vagas\./.test(text)) && texts.some(text => /Resumo pronto/.test(text)));
  assert.deepEqual(room.botIds.length, 2); assert.ok(texts.some(text => /Redator saiu da sala\./.test(text)));
  assert.equal((await f.app.rpc('state.get')).approvals.length, 0);
  // The Redator was told who called it.
  assert.match(f.calls.find(call => call.bot === 'Redator').prompt, /Chefe chamou você/);
});

test('rules: no stronger bot than its maker, only its own rooms, at least two members, limits, and the switch', async t => {
  let step;
  const f = await setup(t, async (bot, prompt, call) => step ? step(bot, call) : 'ok');
  const medio = await f.make('Medio', { access: 'ask' }); const other = await f.make('Outro', { access: 'ask' }); const lone = await f.make('Solto', { access: 'ask' });
  const room = await f.app.rpc('room.create', { name: 'Fechada', botIds: [other.id, lone.id] });
  f.allow(medio, ['Forte', 'Fraco', 'Clone 0', 'Clone 1', 'Clone 2', 'Clone 3', 'Clone 4', 'Clone 5']);
  const run = async body => { step = body; let failure; step = async (bot, call) => { try { await body(call); } catch (error) { failure = error; } return 'ok'; }; await f.chat(medio, 'vai'); if (failure) throw failure; };
  await run(call => call('team_create_bot', { name: 'Forte', access: 'full' }));
  await run(async call => { assert.equal((await call('team_create_bot', { name: 'Fraco', access: 'basic' })).access, 'full'); });
  await assert.rejects(run(call => call('team_create_bot', { name: 'fraco' })), /Já existe/);
  // A room the bot is not in and did not make.
  await assert.rejects(run(call => call('team_add_to_room', { room: 'Fechada', bot: 'Fraco' })), /só mexe em salas/);
  // Its own room: at least two members, add and remove.
  await run(async call => {
    await call('team_create_room', { name: 'Minha', bots: ['Outro'] });
    await assert.rejects(call('team_leave_room', { room: 'Minha' }), /pelo menos 2/);
    await call('team_add_to_room', { room: 'Minha', bot: 'Fraco' });
    assert.deepEqual((await call('team_rooms')).rooms.map(item => item.name), ['Minha']);
    await call('team_remove_from_room', { room: 'Minha', bot: 'Outro' });
    await call('team_leave_room', { room: 'Minha' }).then(() => assert.fail('devia recusar'), error => assert.match(error.message, /pelo menos 2/));
    await call('team_close_room', { room: 'Minha' });
  });
  assert.ok(f.app.db.rooms().find(item => item.name === 'Minha').deletedAt);
  // No ceiling per turn: six bots in one go.
  await run(async call => { for (let i = 0; i < 6; i++) await call('team_create_bot', { name: 'Clone ' + i }); });
  assert.equal(f.app.db.bots().filter(bot => bot.name.startsWith('Clone ')).length, 6);
  // The switch is the person's: off blocks even Acesso total; Pouco acesso needs it on.
  await f.app.rpc('grants.set', { botId: medio.id, tool: 'team', allowed: false });
  await run(call => call('team_bots'));
  const basic = await f.make('Basico', { access: 'basic' });
  await f.chat(basic, 'x');
  step = async (bot, call) => { assert.ok(true); return 'ok'; };
  assert.equal(f.app.tools.policy(basic.id, 'team'), 'allow');
  await f.app.rpc('grants.set', { botId: basic.id, tool: 'team', allowed: true });
  assert.equal(f.app.tools.policy(basic.id, 'team'), 'allow');
});

test('a chain of calls made with team_post ends without any limit of rounds', async t => {
  let count = 0;
  const f = await setup(t, async (bot, prompt, call) => ++count >= 40 ? 'Pronto.' : bot.name === 'Ping' ? (await call('team_post', { room: 'Eco', text: 'ping @Pong' }).catch(() => null), 'Chamei.') : 'Devolvo para @Ping.');
  const ping = await f.make('Ping'); const pong = await f.make('Pong');
  await f.app.rpc('room.create', { name: 'Eco', botIds: [ping.id, pong.id] });
  await f.app.rpc('room.send', { roomId: f.app.db.rooms()[0].id, requestId: randomUUID(), text: '@Ping vai' });
  await f.idle();
  assert.ok(f.app.db.task(f.app.db.all('SELECT task_id FROM room_turns').at(-1).task_id).state === 'done');
});

test('bots novos usam por padrão o modelo econômico médio de cada IA (sem perguntar), escolhem IA com imagem quando necessário, e respeitam team_choose_models se chamado', async t => {
  const models = [
    { provider: 'codex', model: 'gpt-5.4', displayName: 'GPT 5.4', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { provider: 'codex', model: 'gpt-6-luna', displayName: 'GPT-6-Luna', isDefault: false, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { provider: 'claude', model: 'sonnet', displayName: 'Sonnet', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { provider: 'claude', model: 'haiku', modelId: 'claude-haiku-5-5', displayName: 'Claude Haiku', isDefault: false, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { provider: 'agy', model: 'gemini-3.1-pro-high', displayName: 'Gemini 3.1 Pro', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { provider: 'agy', model: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', isDefault: false, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }
  ];
  let step;
  const f = await setup(t, async (bot, prompt, call) => step ? step(call) : 'ok');
  f.app.tools.team.catalog = () => models;
  const chefe = await f.make('Chefe');
  const run = async body => { let failure; step = async call => { try { await body(call); } catch (error) { failure = error; } step = null; return 'ok'; }; await f.chat(chefe, 'vai'); if (failure) throw failure; };

  // Creating directly without asking uses each IA's lightweight default model at medium effort.
  await run(async call => {
    await call('team_create_bot', { name: 'Cla', provider: 'claude', instructions: 'Redatora' });
    await call('team_create_bot', { name: 'Cod', provider: 'codex', instructions: 'Analista' });
    await call('team_create_bot', { name: 'Gem', provider: 'agy', instructions: 'Pesquisador' });
    await call('team_create_bot', { name: 'Artista', instructions: 'Especialista em gerar imagens e ilustrações' });
  });
  const cla = f.app.db.bots().find(item => item.name === 'Cla');
  const cod = f.app.db.bots().find(item => item.name === 'Cod');
  const gem = f.app.db.bots().find(item => item.name === 'Gem');
  const artista = f.app.db.bots().find(item => item.name === 'Artista');
  assert.deepEqual({ provider: cla.provider, model: cla.model, effort: cla.reasoningEffort }, { provider: 'claude', model: 'haiku', effort: 'medium' });
  assert.deepEqual({ provider: cod.provider, model: cod.model, effort: cod.reasoningEffort }, { provider: 'codex', model: 'gpt-6-luna', effort: 'medium' });
  assert.deepEqual({ provider: gem.provider, model: gem.model, effort: gem.reasoningEffort }, { provider: 'agy', model: 'gemini-4-hydrogen', effort: 'medium' });
  assert.ok(artista.provider === 'agy' || artista.provider === 'codex', 'bot de imagem escolhe agy ou codex, nunca claude');

  // Optional team_choose_models flow still works when explicitly invoked.
  let asked;
  await run(async call => { asked = await call('team_choose_models', { bots: ['Ana', 'Beto', 'Caio'], recommended: { provider: 'claude', model: 'sonnet', effort: 'high' } }); });
  assert.deepEqual(asked.options, ['Recomendado: Claude · Sonnet · alto', 'Codex · GPT-6-Luna · médio', 'Antigravity · Gemini 4 Hydrogen · médio']);
  const open = f.app.tools.decisions.open(chefe.id);
  assert.equal(open.length, 1); assert.equal(open[0].question, 'Qual IA usar nos 3 bots novos (Ana, Beto, Caio)?');
  await assert.rejects(run(call => call('team_choose_models', { bots: ['Davi'], recommended: { provider: 'codex' } })), /ainda não respondeu/);
  await assert.rejects(run(call => call('team_create_bot', { name: 'Ana' })), /ainda não escolheu/);
  // She picks the second option: all three bots get it.
  const reply = f.app.tools.decisions.reply; f.app.tools.decisions.reply = () => {};
  f.app.tools.decisions.answer(open[0].id, { option: 2 }); f.app.tools.decisions.reply = reply;
  await run(async call => { for (const name of ['Ana', 'Beto', 'Caio']) await call('team_create_bot', { name, instructions: 'x' }); });
  for (const name of ['Ana', 'Beto', 'Caio']) { const bot = f.app.db.bots().find(item => item.name === name); assert.equal(bot.provider, 'codex'); assert.equal(bot.model, 'gpt-6-luna'); assert.equal(bot.reasoningEffort, 'medium'); }
  // She writes her answer: the maker passes the IA she asked for.
  await run(call => call('team_choose_models', { bots: ['Zeca'], recommended: { provider: 'codex' } }));
  f.app.tools.decisions.reply = () => {}; f.app.tools.decisions.answer(f.app.tools.decisions.open(chefe.id)[0].id, { text: 'usa o Claude' }); f.app.tools.decisions.reply = reply;
  await assert.rejects(run(call => call('team_create_bot', { name: 'Zeca' })), /A pessoa escreveu: "usa o Claude"/);
  await run(call => call('team_create_bot', { name: 'Zeca', provider: 'claude' }));
  assert.equal(f.app.db.bots().find(item => item.name === 'Zeca').provider, 'claude');
});

