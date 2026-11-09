'use strict';
// A Codex reply through `codex app-server` (the protocol the editors use) instead of `codex exec`: the same sandbox, tools and
// instructions, but with approvals "on-request", like Codex in the person's own terminal. When the IA wants to step out of its
// sandbox (write outside the bot's folder, run something the sandbox blocks), the request goes to MyBots, which decides with the
// same rules as for Claude's bots: allowed, refused (keys, passwords) or an approval card on the phone. Before, `codex exec` ran with
// approval_policy="never" and every such request was refused on the spot.
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { spawnCli } = require('./cli-bin.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The flags of `codex exec` that have no meaning for the server (or are given by the protocol instead).
const EXEC_ONLY = new Set(['--color', '--json', '--output-last-message', '--sandbox', '--model', '--image']);
const BARE = new Set(['exec', 'resume', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '-']);

/** The server's command line from the same arguments `codex exec` would get: only the settings (-c) and the features (--enable/--disable). */
function serverArguments(execArgs) {
  const out = ['app-server', '--listen', 'stdio://'];
  for (let i = 0; i < execArgs.length; i++) {
    const arg = execArgs[i];
    if (arg === '-c' || arg === '--enable' || arg === '--disable') {
      const value = execArgs[++i];
      out.push(arg, arg === '-c' && value === 'approval_policy="never"' ? 'approval_policy="on-request"' : value);
    } else if (EXEC_ONLY.has(arg)) i++;
    else if (!BARE.has(arg) && !UUID.test(arg)) continue;
  }
  return out;
}

/**
 * The person's own Codex settings (~/.codex/config.toml) are loaded by the server (it has no --ignore-user-config): their MCP servers
 * are turned off one by one, so a bot only has MyBots' tools. Plugins and apps are already off by feature.
 */
async function ownServersOff(home) {
  let text = ''; try { text = await readFile(join(home || process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'); } catch { return []; }
  const names = new Set([...text.matchAll(/^\s*\[\s*mcp_servers\.("?)([A-Za-z0-9_-]+)\1\s*\]/gm)].map(match => match[2]).filter(name => name !== 'mybots-tools'));
  return [...names].flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]);
}

/** Asks MyBots about one approval request of the IA; anything but a clear yes is a no. */
async function askMyBots(tools, request) {
  if (!tools?.endpoint || !tools?.token) return false;
  try {
    const response = await fetch(tools.endpoint + '/tools/approval', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(15 * 60000) });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.allow === true;
  } catch { return false; }
}
const commandText = command => (Array.isArray(command) ? command.join(' ') : String(command || '')).replace(/^\/usr\/bin\/bash -lc /, '').replace(/^['"]|['"]$/g, '').slice(0, 2000);

/**
 * One reply. `execArgs` are the arguments `codex exec` would get for this turn (chatArguments); `progress` is the tracker of what the
 * person sees. Resolves to { text, sessionId, usage, calls } like the exec runner's parts.
 */
async function serverReply({ binary, execArgs, settings, input, images = [], workspace, tools, wrap, env, signal, onSession, onProcess, onDelta, progress, idleMs, maxMs }) {
  const args = [...serverArguments(execArgs), ...await ownServersOff(env?.CODEX_HOME)];
  return new Promise((resolve, reject) => {
    const child = spawnCli(binary, args, wrap, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...process.env, ...(env || {}), ...(tools ? { MYBOTS_RUN_TOKEN: tools.token, MYBOTS_RUN_ENDPOINT: tools.endpoint } : {}) } });
    let next = 0, buffer = '', stderr = '', settled = false, sessionId = settings.codexSessionId || null, threadId = null, turnId = null;
    let finalText = '', lastText = '', usage = null, calls = 1, context = null, failure = '';
    const pending = new Map();
    const kill = sig => { try { if (process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch {} };
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(idle); clearTimeout(timer); signal?.removeEventListener('abort', abort);
      kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 2000).unref();
      for (const { reject: fail } of pending.values()) fail(new Error('O Codex encerrou.'));
      if (error) { error.codexSessionId = sessionId; if (stderr && !error.output) error.output = stderr; reject(error); } else resolve(value);
    };
    let idle; const alive = () => { clearTimeout(idle); idle = setTimeout(() => finish(new Error('O Codex ficou tempo demais sem dar sinal e foi interrompido. A conversa continua disponível; peça para continuar.')), idleMs); };
    const timer = setTimeout(() => finish(new Error('O Codex ficou tempo demais sem dar sinal e foi interrompido. A conversa continua disponível; peça para continuar.')), maxMs);
    const abort = () => { if (threadId && turnId) write({ id: ++next, method: 'turn/interrupt', params: { threadId, turnId } }); setTimeout(() => finish(new Error('A resposta foi interrompida.')), 1500); };
    signal?.addEventListener('abort', abort, { once: true });
    const write = message => { try { child.stdin.write(JSON.stringify(message) + '\n'); } catch {} };
    const call = (method, params) => new Promise((ok, fail) => { const id = ++next; pending.set(id, { resolve: ok, reject: fail }); write({ id, method, params }); });

    // What the IA asks the person, answered by MyBots. Unknown requests are refused, never left hanging.
    const answer = async message => {
      const p = message.params || {};
      try {
        if (message.method === 'item/commandExecution/requestApproval' || message.method === 'execCommandApproval') {
          const command = commandText(p.command);
          progress.step(`Pedindo permissão: ${command.slice(0, 120)}`);
          const allow = await askMyBots(tools, { kind: 'command', command, cwd: String(p.cwd || workspace || ''), reason: String(p.reason || '').slice(0, 500) });
          write({ id: message.id, result: message.method === 'execCommandApproval' ? { decision: allow ? 'approved' : 'denied' } : { decision: allow ? 'accept' : 'decline' } });
        } else if (message.method === 'item/fileChange/requestApproval' || message.method === 'applyPatchApproval') {
          const path = String(p.grantRoot || Object.keys(p.fileChanges || {})[0] || workspace || '');
          progress.step('Pedindo permissão para editar arquivos');
          const allow = await askMyBots(tools, { kind: 'file', path, reason: String(p.reason || '').slice(0, 500) });
          write({ id: message.id, result: message.method === 'applyPatchApproval' ? { decision: allow ? 'approved' : 'denied' } : { decision: allow ? 'accept' : 'decline' } });
        } else if (message.method === 'mcpServer/elicitation/request') write({ id: message.id, result: { action: 'decline' } });
        else write({ id: message.id, error: { code: -32601, message: 'O MyBots não atende este pedido.' } });
      } catch { write({ id: message.id, error: { code: -32603, message: 'Recusado.' } }); }
    };

    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      alive(); buffer += chunk;
      if (buffer.length > 4_000_000) { finish(new Error('O Codex devolveu um evento grande demais.')); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== undefined && message.method) { answer(message); continue; }
        if (message.id !== undefined) { const waiting = pending.get(message.id); pending.delete(message.id); if (message.error) waiting?.reject(Object.assign(new Error(message.error.message || 'O Codex recusou o pedido.'), { output: JSON.stringify(message.error) })); else waiting?.resolve(message.result); continue; }
        const p = message.params || {}, item = p.item || {};
        if (message.method === 'item/started') {
          if (item.type === 'commandExecution') progress.step(`Rodando ${commandText(item.command)}`);
          if (item.type === 'mcpToolCall') progress.step(`Usando ${item.tool || 'uma ferramenta'}`);
          if (item.type === 'fileChange') progress.step('Editando arquivos');
        }
        if (message.method === 'item/completed') {
          if (/^(commandExecution|mcpToolCall|fileChange|webSearch|dynamicToolCall)$/.test(item.type || '')) calls++;
          if (item.type === 'agentMessage' && item.text) {
            lastText = String(item.text);
            if (item.phase === 'final_answer') finalText = lastText; else progress.message(lastText);
            try { onDelta?.(lastText.slice(0, 20000)); } catch {}
          }
        }
        if (message.method === 'thread/tokenUsage/updated' && p.tokenUsage) {
          const total = p.tokenUsage.total || {}, last = p.tokenUsage.last || {};
          usage = { input: total.inputTokens || 0, cached: total.cachedInputTokens || 0, output: (total.outputTokens || 0) + (total.reasoningOutputTokens || 0), session: true, resumed: Boolean(settings.codexSessionId) };
          if (last.inputTokens > 0) context = last.inputTokens;
        }
        if (message.method === 'error' && !p.willRetry) failure = p.error?.message || 'O Codex não concluiu a resposta.';
        if (message.method === 'turn/completed') {
          const turn = p.turn || {};
          if (turn.status === 'completed') {
            const text = (finalText || lastText).trim();
            if (!text) finish(new Error('O Codex devolveu uma resposta vazia.'));
            else finish(null, { text, sessionId, usage: usage ? { ...usage, calls, ...(context ? { context } : {}) } : null });
          } else if (turn.status === 'interrupted') finish(new Error('A resposta foi interrompida.'));
          else finish(Object.assign(new Error(turn.error?.message || failure || 'O Codex não concluiu a resposta.'), { output: turn.error?.message || failure }));
        }
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', error => finish(error));
    child.on('close', code => { if (!settled) finish(Object.assign(new Error('O Codex não conseguiu concluir a resposta.'), { output: stderr || `saiu com ${code}` })); });
    if (child.pid) { try { onProcess(child.pid); } catch (error) { finish(error); return; } }
    alive();

    (async () => {
      await call('initialize', { clientInfo: { name: 'mybots', version: '1' } });
      write({ method: 'initialized' });
      // The sandbox and approval mode come from the settings above (-c); the protocol repeats them so a resumed thread gets them too.
      const sandbox = (execArgs.find(arg => /^sandbox_mode=/.test(arg)) || '').match(/"([^"]+)"/)?.[1] || 'workspace-write';
      const common = { cwd: workspace, sandbox, approvalPolicy: 'on-request', model: settings.model || null };
      const opened = sessionId ? await call('thread/resume', { threadId: sessionId, ...common }) : await call('thread/start', common);
      threadId = opened?.thread?.id;
      if (!UUID.test(threadId || '')) throw new Error('O Codex não abriu a conversa.');
      if (sessionId && sessionId !== threadId) throw new Error('O Codex abriu outra sessão. A conversa não foi retomada.');
      sessionId = threadId; await onSession(sessionId);
      const started = await call('turn/start', { threadId, input: [{ type: 'text', text: input }, ...images.filter(path => typeof path === 'string' && path).map(path => ({ type: 'localImage', path }))],
        ...(settings.model ? { model: settings.model } : {}), ...(settings.reasoningEffort ? { effort: settings.reasoningEffort } : {}) });
      turnId = started?.turn?.id || null;
      if (signal?.aborted) abort();
    })().catch(error => finish(error));
  });
}

module.exports = { serverReply, serverArguments, ownServersOff };
