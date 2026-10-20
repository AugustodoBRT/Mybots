// Usage: node rpc.mjs <method> '<json params>' — talks to the emulator's supervisor like the app does.
import { readFileSync } from 'node:fs';
import { SupervisorClient } from '../../mobile/supervisor-client.js';
import WS from '../../supervisor/node_modules/ws/index.js';
const token = readFileSync(new URL('../../.build-tools/emulator-state/token', import.meta.url), 'utf8').trim();
const client = new SupervisorClient({ WebSocketClass: WS });
await client.connect({ port: 43219, token });
const [method, params = '{}'] = process.argv.slice(2);
let output;
try { output = JSON.stringify(await client.call(method, JSON.parse(params)), null, 1); } catch (error) { output = 'ERRO: ' + error.message; process.exitCode = 1; }
client.close();
// Exiting right after console.log cuts large outputs written to a pipe: wait for stdout to flush.
process.stdout.write(output + '\n', () => process.exit());
