// Usage: node post-notification.mjs "<app>" "<title>" "<text>" — a phone notification arriving at the supervisor, as the app's listener sends it.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const token = readFileSync(new URL('../../.build-tools/emulator-state/token', import.meta.url), 'utf8').trim();
const [app, title, text] = process.argv.slice(2);
const event = { id: randomUUID(), package: app === 'Gmail' ? 'com.google.android.gm' : 'test.' + app.toLowerCase(), app, title, text, subText: '', category: 'email', time: Date.now() };
const answer = await fetch('http://127.0.0.1:43219/device/events', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [event] }) });
console.log(answer.status, await answer.text());
