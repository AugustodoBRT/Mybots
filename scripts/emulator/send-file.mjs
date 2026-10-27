// Usage: node send-file.mjs <botId> <file> "message" — sends a message with an attached file, as the app's ＋ button does, and waits for the reply.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SupervisorClient } from '../../mobile/supervisor-client.js';
import WS from '../../supervisor/node_modules/ws/index.js';
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', png: 'image/png', txt: 'text/plain', csv: 'text/csv' };
const token = readFileSync(new URL('../../.build-tools/emulator-state/token', import.meta.url), 'utf8').trim();
const [botId, path, text] = process.argv.slice(2);
const client = new SupervisorClient({ WebSocketClass: WS });
await client.connect({ port: 43219, token });
const requestId = randomUUID();
await client.call('chat.send', { botId, requestId, text, attachments: [{ name: basename(path), mime: MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream', data: readFileSync(path).toString('base64') }] });
let task;
for (let i = 0; i < 150; i++) { task = (await client.call('tasks.list')).find(item => item.id === requestId); if (['done', 'failed'].includes(task?.state)) break; await new Promise(r => setTimeout(r, 4000)); }
const last = (await client.call('chat.page', { botId })).messages.at(-1);
process.stdout.write(`[${task?.state}]\n${last.text || last.error}\n`, () => { client.close(); process.exit(); });
