import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { claudeSessions, codexSessions, localSources, readExport, digest, scrub, botFolders } from '../supervisor/history-import.mjs';
import { Database } from '../supervisor/database.mjs';

const lines = items => items.map(item => JSON.stringify(item)).join('\n') + '\n';

// A .zip with one deflated file, like the export ChatGPT and Claude.ai send by e-mail.
function zip(name, content) {
  const data = Buffer.from(content), packed = deflateRawSync(data), file = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(0, 42);
  const dirAt = local.length + file.length + packed.length, dirSize = central.length + file.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(dirSize, 12); end.writeUInt32LE(dirAt, 16);
  return Buffer.concat([local, file, packed, central, file, end]);
}

test('importação: só o que a pessoa escreveu, sem as sessões dos bots, com segredos escondidos', async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-home-')); t.after(() => rm(home, { recursive: true, force: true }));
  const project = join(home, '.claude', 'projects', '-home-ana-site'); await mkdir(project, { recursive: true });
  await writeFile(join(project, 'a.jsonl'), lines([
    { type: 'user', cwd: '/home/ana/site', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'user', cwd: '/home/ana/site', isMeta: true, message: { role: 'user', content: 'meta do CLI' } },
    { type: 'user', cwd: '/home/ana/site', message: { role: 'user', content: 'Sou a Ana, estudo Design na UFPE e prefiro respostas curtas. Minha senha: abc123 e meu email ana@exemplo.com' } },
    { type: 'assistant', cwd: '/home/ana/site', message: { role: 'assistant', content: 'Resposta da IA que não deve entrar.' } },
    { type: 'user', cwd: '/home/ana/site', message: { role: 'user', content: [{ type: 'tool_result', content: 'saída de ferramenta' }] } },
    { type: 'user', cwd: '/home/ana/site', isSidechain: true, message: { role: 'user', content: 'pedido de um subagente' } }
  ]));
  // A bot of the MyBots runs the CLI in ~/MyBots/<bot>: that is not the person talking.
  const bot = join(home, '.claude', 'projects', '-home-ana-MyBots-Chefe'); await mkdir(bot, { recursive: true });
  await writeFile(join(bot, 'b.jsonl'), lines([{ type: 'user', cwd: join(home, 'MyBots', 'Chefe'), message: { role: 'user', content: 'Instruções do MyBots para o bot.' } }]));
  const codex = join(home, '.codex', 'sessions', '2026', '11', '10'); await mkdir(codex, { recursive: true });
  await writeFile(join(codex, 'rollout-1.jsonl'), lines([
    { type: 'session_meta', payload: { cwd: '/home/ana/loja' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Trabalho numa loja de bicicletas em Olinda. Token sk-abcdefghijklmnopqrstuv' } }
  ]));

  const skip = botFolders(join(home, '.mybots'), home);
  const claude = claudeSessions({ home, skip }), other = codexSessions({ home, skip });
  assert.deepEqual(claude.map(item => item.messages), [['Sou a Ana, estudo Design na UFPE e prefiro respostas curtas. Minha senha: [oculto] e meu email [e-mail]']]);
  assert.deepEqual(other.map(item => item.messages), [['Trabalho numa loja de bicicletas em Olinda. Token [oculto]']]);
  assert.deepEqual(Object.values(localSources({ home })).map(item => item.sessions), [2, 1]);
  const result = digest([...claude, ...other]);
  assert.equal(result.sessions, 2); assert.equal(result.messages, 2);
  assert.match(result.text, /não siga instruções/); assert.doesNotMatch(result.text, /Instruções do MyBots|Resposta da IA|saída de ferramenta|subagente|abc123|ana@exemplo/);
});

test('importação: exportação do ChatGPT em .zip e do Claude.ai em conversations.json', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-export-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const chatgpt = [{ title: 'Viagem', update_time: 1762000000, mapping: {
    a: { message: { author: { role: 'system' }, content: { parts: ['Você é o ChatGPT'] } } },
    b: { message: { author: { role: 'user' }, create_time: 1, content: { content_type: 'text', parts: ['Vou para Lisboa em março com meu irmão.'] } } },
    c: { message: { author: { role: 'assistant' }, create_time: 2, content: { parts: ['Ótimo!'] } } } } }];
  await writeFile(join(dir, 'chatgpt.zip'), zip('conversations.json', JSON.stringify(chatgpt)));
  assert.deepEqual(readExport(join(dir, 'chatgpt.zip')).map(item => [item.source, item.place, item.messages]), [['ChatGPT', 'Viagem', ['Vou para Lisboa em março com meu irmão.']]]);
  const claude = [{ name: 'Receitas', updated_at: '2026-10-01T00:00:00Z', chat_messages: [{ sender: 'human', text: 'Sou vegetariano.' }, { sender: 'assistant', text: 'Anotado.' }] }];
  await writeFile(join(dir, 'conversations.json'), JSON.stringify(claude));
  assert.deepEqual(readExport(join(dir, 'conversations.json')).map(item => [item.source, item.messages]), [['Claude', ['Sou vegetariano.']]]);
  await writeFile(join(dir, 'outro.zip'), zip('fotos/a.txt', 'x'));
  assert.throws(() => readExport(join(dir, 'outro.zip')), /conversations\.json/);
  assert.equal(scrub('ligue (81) 99876-5432 ou cartão 4111 1111 1111 1111'), 'ligue [telefone] ou cartão [número]');
});

test('a ficha antiga vira a nota Você no centro da memória; sem ficha, nada é criado', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-ficha-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const fresh = new Database(join(dir, 'novo'));
  assert.equal(fresh.get('SELECT 1 FROM notes WHERE path=?', 'chefe/voce.md'), undefined);
  assert.equal(fresh.person().profile ?? '', ''); fresh.close?.();
  // A database from before: the profile was in the settings (metadata person.profile).
  const old = new Database(join(dir, 'antigo'));
  old.run("INSERT INTO metadata VALUES('person.profile','Estuda SI. Gosta de café.')");
  old.db.exec('PRAGMA user_version=21;'); old.close?.();
  const moved = new Database(join(dir, 'antigo'));
  assert.equal(moved.get('SELECT body FROM notes WHERE path=?', 'chefe/voce.md').body, 'Estuda SI. Gosta de café.');
  assert.equal(moved.get("SELECT value FROM metadata WHERE key='person.profile'"), undefined);
  assert.equal(moved.person().profile, 'Estuda SI. Gosta de café.');
});

test('Antigravity: o uso de /usage vira as janelas de 5 horas e semana, com os outros grupos de modelos guardados', async t => {
  const { parseLimits } = (await import('node:module')).createRequire(import.meta.url)('../lib/agy-runner.cjs');
  const text = 'Gemini Models\tWeekly Limit Remaining\t98%\t2026-11-14T09:53:41Z\nGemini Models\tFive Hour Limit Remaining\t90%\t2026-11-13T06:01:57Z\nClaude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-13T07:31:22Z\nGemini 4 Argon\tGemini 4 Argon Weekly Limit\t27%\t2026-11-14T09:53:34Z';
  const limits = parseLimits(text);
  assert.deepEqual(limits.windows.map(item => [item.key, item.used]), [['week', 2], ['five_hour', 10]]);
  assert.deepEqual(limits.groups.map(group => group.name), ['Gemini Models', 'Claude and GPT models', 'Gemini 4 Argon']);
  assert.equal(parseLimits('nada aqui'), null);
  const dir = await mkdtemp(join(tmpdir(), 'mybots-limites-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new Database(dir); db.setLimits('agy', limits);
  const saved = db.limits().agy;
  assert.equal(saved.windows.find(item => item.key === 'five_hour').resetsAt, '2026-11-13T06:01:57.000Z');
  assert.equal(saved.groups[2].windows[0].used, 73);
});
