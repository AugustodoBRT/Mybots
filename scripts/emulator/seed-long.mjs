// Usage: node seed-long.mjs [chat=5000] [room=3000] — a bot whose chat has thousands of messages and a room with
// thousands more (Markdown, tables, files), written straight into the emulator's database to measure opening and scrolling.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SupervisorClient } from '../../mobile/supervisor-client.js';
import WS from '../../supervisor/node_modules/ws/index.js';

const [chatCount = 5000, roomCount = 3000] = process.argv.slice(2).map(Number);
const token = readFileSync(new URL('../../.build-tools/emulator-state/token', import.meta.url), 'utf8').trim();
const client = new SupervisorClient({ WebSocketClass: WS });
await client.connect({ port: 43219, token });
const state = await client.call('state.get');
const selection = state.defaultSelection || {};
const bot = state.bots.find(item => item.name === 'Histórico longo') || await client.call('bot.create', { name: 'Histórico longo', instructions: 'Bot de teste com uma conversa enorme.', ...selection });
const other = state.bots.find(item => item.name === 'Sala parceiro') || await client.call('bot.create', { name: 'Sala parceiro', instructions: 'Segundo bot da sala longa.', ...selection });
const room = state.rooms?.find(item => item.name === 'Sala longa') || await client.call('room.create', { name: 'Sala longa', botIds: [bot.id, other.id] });
client.close();

const at = index => new Date(Date.now() - (chatCount + roomCount - index) * 60000).toISOString();
// What bots really write: titles, lists, tables, code and sometimes a file.
const text = (index, who) => [
  `## ${who} · mensagem ${index}`,
  index % 4 === 0 ? `| Matéria | Prazo | Nota |\n|---|---|---|\n| Cálculo | ${(index % 28) + 1}/11 | ${(index % 10)}.5 |\n| Física | ${(index % 27) + 2}/11 | ${(index % 9) + 1}.0 |` : '',
  index % 5 === 1 ? '- **Item** um\n- Item `dois`\n- Item três com acentuação: ação, pão, você' : '',
  index % 7 === 2 ? '```js\nconst soma = (a, b) => a + b;\nconsole.log(soma(2, 3));\n```' : '',
  `Texto corrido da mensagem ${index}, longo o bastante para quebrar em algumas linhas na tela do celular e parecer uma resposta de verdade.`
].filter(Boolean).join('\n\n');
const file = index => index % 25 === 3 ? { attachments: [{ id: randomUUID(), name: `relatorio-${index}.pdf`, mime: 'application/pdf', size: 48213 }] } : {};
const rows = { messages: [], room: [] };
for (let index = 0; index < chatCount; index++) {
  const mine = index % 2 === 0;
  rows.messages.push({ id: randomUUID(), role: mine ? 'user' : 'assistant', text: mine ? `Pergunta ${index}: me lembra do prazo?` : text(index, 'Histórico longo'), status: 'complete', createdAt: at(index), ...(mine ? {} : file(index)) });
}
for (let index = 0; index < roomCount; index++) {
  const who = index % 3; const message = { id: randomUUID(), role: who === 0 ? 'user' : 'assistant', status: 'complete', createdAt: at(chatCount + index) };
  rows.room.push(who === 0 ? { ...message, text: `@Histórico longo e @Sala parceiro, item ${index}?` } : { ...message, botId: who === 1 ? bot.id : other.id, text: text(index, who === 1 ? 'Histórico longo' : 'Sala parceiro'), ...file(index) });
}
// Runs in Termux with its own Node: one transaction, the same tables the supervisor uses.
const program = `
const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const db = new DatabaseSync(process.env.HOME + '/.mybots/mybots.db'); db.exec('PRAGMA busy_timeout=10000; BEGIN IMMEDIATE');
const message = db.prepare('INSERT INTO messages(id,bot_id,body) VALUES(?,?,?)'); const line = db.prepare('INSERT INTO room_messages(id,room_id,body,created_at) VALUES(?,?,?,?)');
for (const item of rows.messages) message.run(item.id, ${JSON.stringify(bot.id)}, JSON.stringify(item));
for (const item of rows.room) line.run(item.id, ${JSON.stringify(room.id)}, JSON.stringify(item), item.createdAt);
const stamp = new Date().toISOString(); const body = JSON.parse(db.prepare('SELECT body FROM rooms WHERE id=?').get(${JSON.stringify(room.id)}).body);
db.prepare('UPDATE rooms SET body=?, updated_at=? WHERE id=?').run(JSON.stringify({ ...body, updatedAt: stamp }), stamp, ${JSON.stringify(room.id)});
db.exec('COMMIT');
console.log(JSON.stringify({ chat: db.prepare('SELECT count(*) c FROM messages WHERE bot_id=?').get(${JSON.stringify(bot.id)}).c, room: db.prepare('SELECT count(*) c FROM room_messages WHERE room_id=?').get(${JSON.stringify(room.id)}).c }));`;
const adb = new URL('../../.build-tools/android-sdk/platform-tools/adb', import.meta.url).pathname; const home = '/data/data/com.termux/files';
const push = (name, content) => { const result = spawnSync(adb, ['shell', `run-as com.termux sh -c 'cat > ${home}/usr/tmp/${name}'`], { input: content }); if (result.status) throw new Error(String(result.stderr)); };
push('seed-long.json', JSON.stringify(rows)); push('seed-long.cjs', program);
const result = spawnSync(adb, ['shell', `run-as com.termux ${home}/usr/bin/env -i HOME=${home}/home PREFIX=${home}/usr PATH=${home}/usr/bin TMPDIR=${home}/usr/tmp LD_PRELOAD=${home}/usr/lib/libtermux-exec-ld-preload.so ${home}/usr/bin/node ${home}/usr/tmp/seed-long.cjs ${home}/usr/tmp/seed-long.json`], { encoding: 'utf8' });
process.stdout.write(`Bot ${bot.id} · sala ${room.id}\n${result.stdout}${result.stderr}`);
spawnSync(adb, ['shell', `run-as com.termux rm -f ${home}/usr/tmp/seed-long.json ${home}/usr/tmp/seed-long.cjs`]);
