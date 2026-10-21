import { randomUUID } from 'node:crypto';
import { uuid } from '../database.mjs';
import { SERVER_INFO } from './catalog.mjs';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const KNOWN = ['ping', 'tools/list', 'tools/call'];

// Minimal Streamable HTTP MCP (JSON responses, no SSE) for CLIs that cannot spawn the stdio bridge,
// e.g. Claude Code inside proot-distro. The run token is the bearer; Mcp-Session-Id is the bridge claim.
export async function handleMcp(request, response, tools) {
  const reply = (status, body, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    response.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const runToken = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
  if (request.headers.origin || !tools.runs.has(runToken)) return reply(403, { error: 'Autorização de execução inválida ou encerrada.' });
  if (request.method !== 'POST') return reply(405, undefined, { Allow: 'POST' });
  let message;
  try {
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > 400000) throw new Error('size'); chunks.push(chunk); }
    message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Pedido inválido.' } }); }
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Pedido inválido.' } });
  if (message.id === undefined) return reply(202);
  const send = result => reply(200, { jsonrpc: '2.0', id: message.id, result });
  const fail = (code, text) => reply(200, { jsonrpc: '2.0', id: message.id, error: { code, message: text } });
  try {
    if (message.method === 'initialize') {
      const bridgeId = randomUUID();
      tools.context(runToken, bridgeId, true);
      const version = VERSIONS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : VERSIONS[1];
      return reply(200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: SERVER_INFO } }, { 'Mcp-Session-Id': bridgeId });
    }
    if (!KNOWN.includes(message.method)) return fail(-32601, 'Método não permitido.');
    const bridgeId = request.headers['mcp-session-id'];
    if (!uuid(bridgeId)) return reply(400, { jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Sessão MCP ausente.' } });
    tools.context(runToken, bridgeId);
    if (message.method === 'ping') return send({});
    if (message.method === 'tools/list') return send({ tools: tools.toolList(runToken, bridgeId) });
    try {
      const value = await tools.callMcp(runToken, { bridgeId, callId: randomUUID(), name: message.params?.name, args: message.params?.arguments || {} });
      return send({ content: value?.mcpContent || [{ type: 'text', text: JSON.stringify(value) }] });
    } catch (error) { return send({ isError: true, content: [{ type: 'text', text: error.message }] }); }
  } catch { return fail(-32603, 'Conexão da ferramenta encerrada ou não autorizada.'); }
}
