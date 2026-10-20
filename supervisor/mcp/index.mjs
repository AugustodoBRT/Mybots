import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { SERVER_INFO } from './catalog.mjs';

const endpoint = process.env.MYBOTS_RUN_ENDPOINT || '';
const token = process.env.MYBOTS_RUN_TOKEN || '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || !/^[0-9a-f]{64}$/.test(token)) process.exit(1);
const bridgeId = randomUUID();
const post = async (path, body) => {
  const response = await fetch(endpoint + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ bridgeId, ...body }), signal: AbortSignal.timeout(130000) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Ferramenta indisponível.');
  return data;
};
const claimed = post('/tools/claim', {});
claimed.catch(() => {});
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
async function handle(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return;
  if (request.id === undefined) return;
  try {
    let result;
    if (request.method === 'initialize') {
      await claimed; result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER_INFO };
    } else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') { await claimed; result = { tools: (await post('/tools/list', {})).tools }; }
    else if (request.method === 'tools/call') {
      await claimed;
      try {
        const value = await post('/tools/call', { callId: randomUUID(), name: request.params?.name, args: request.params?.arguments || {} });
        result = { content: value?.mcpContent || [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
    } else { send({ id: request.id, error: { code: -32601, message: 'Método não permitido.' } }); return; }
    send({ id: request.id, result });
  } catch { send({ id: request.id, error: { code: -32603, message: 'Conexão da ferramenta encerrada ou não autorizada.' } }); }
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (line.length > 16000) { send({ id: null, error: { code: -32600, message: 'Pedido grande demais.' } }); return; }
  try { void handle(JSON.parse(line)); } catch { send({ id: null, error: { code: -32700, message: 'JSON inválido.' } }); }
});
