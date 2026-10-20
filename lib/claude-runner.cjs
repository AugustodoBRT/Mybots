const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Claude Code has no catalog RPC; aliases always resolve to the newest model of each family. modelId is what each
// alias resolved to when this was written (20/10/2026); the first reply on a newer one replaces it in the picker.
const CLAUDE_MODELS = [
  { provider: 'claude', model: 'opus', displayName: 'Claude Opus', modelId: 'claude-opus-5-5', isDefault: false, efforts: EFFORTS, defaultEffort: 'medium' },
  { provider: 'claude', model: 'sonnet', displayName: 'Claude Sonnet', modelId: 'claude-sonnet-5-5', isDefault: false, efforts: EFFORTS, defaultEffort: 'high' },
  { provider: 'claude', model: 'haiku', displayName: 'Claude Haiku', modelId: 'claude-haiku-5-5', isDefault: false, efforts: EFFORTS, defaultEffort: 'medium' },
  { provider: 'claude', model: 'fable', displayName: 'Claude Fable', modelId: 'claude-fable-5-1', isDefault: false, efforts: EFFORTS, defaultEffort: 'high' }
];

function claudeArguments({ model, reasoningEffort, codexSessionId } = {}, sessionId, tools) {
  if (!UUID.test(sessionId || '')) throw new Error('O identificador da sessão do Claude é inválido.');
  // `--tools ""` removes every built-in tool (shell, files, web); only mybots-tools remains.
  // Account connectors (claude.ai Gmail, Calendar, Drive…) load only without --strict-mcp-config, and only for
  // bots granted them. Their calls are not pre-allowed: Claude Code asks the MyBots permission tool, which
  // lets reads through and turns every other action into an approval card.
  const accountApps = Boolean(tools?.connectors);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', ...(accountApps ? [] : ['--strict-mcp-config']),
    '--setting-sources', '', '--disable-slash-commands',
    ...(accountApps ? ['--permission-prompts', 'host', '--permission-prompt-tool', 'mcp__mybots-tools__permission'] : ['--permission-prompts', 'none']),
    '--settings', JSON.stringify({ env: { MCP_TOOL_TIMEOUT: '130000' } })];
  args.push(...(codexSessionId ? ['--resume', sessionId] : ['--session-id', sessionId]));
  // Every account connector loads all its tool definitions into each step (~5–20k tokens each): only the apps the
  // person picked for this bot stay; the others are blocked, which also takes them out of the context.
  if (accountApps && tools.connectorDeny?.length) args.push('--disallowedTools', ...tools.connectorDeny.map(name => 'mcp__claude_ai_' + name.replace(/[^A-Za-z0-9_-]/g, '_')));
  if (tools) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: { 'mybots-tools': { type: 'http', url: tools.endpoint + '/mcp', headers: { Authorization: 'Bearer ' + tools.token } } } }),
      '--allowedTools', 'mcp__mybots-tools');
  }
  // Like Codex's developer instructions: the MyBots tools a bot has, starting with its own browser.
  const guidance = [tools && 'Você tem um navegador de internet próprio (ferramentas mcp__mybots-tools__browser_*): browser_open abre qualquer site, link ou página, browser_read lê, browser_click e browser_type usam a página, browser_upload anexa um arquivo deste bot num campo de envio (sempre com aprovação da pessoa). Use-o sempre que pedirem para abrir, acessar, entrar ou consultar um site; nunca diga que não consegue navegar.',
    accountApps && 'Para e-mail, agenda, Drive e outros serviços da conta da pessoa, use os conectores da conta (ferramentas mcp__claude_ai_*). email_search do MyBots é só para a caixa conectada por senha de app nos Ajustes. Ações que alteram algo pedem a aprovação da pessoa no MyBots; não tente contornar uma recusa.'].filter(Boolean);
  if (guidance.length) args.push('--append-system-prompt', guidance.join(' '));
  if (model) args.push('--model', model);
  if (reasoningEffort) args.push('--effort', reasoningEffort);
  return args;
}

function friendlyClaudeError(output) {
  if (/not logged in|please run \/login|invalid api key|authentication|unauthorized|401|oauth/i.test(output)) return 'Entre no Claude pelo terminal com claude e o comando /login, depois tente novamente.';
  if (/usage limit|rate.limit|limit reached|quota|429|overloaded/i.test(output)) return 'O limite de uso da sua conta Claude foi atingido ou o serviço está ocupado. Tente novamente mais tarde.';
  if (/model.*(not found|not available|invalid|not supported)|does not support.*effort|invalid.*effort/i.test(output)) return 'A conta recusou este modelo ou nível de raciocínio. Escolha outra combinação e tente novamente.';
  if (/network|connection|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(output)) return 'O Claude não conseguiu se conectar. Confira a internet e tente novamente.';
  if (/unknown option|unexpected argument|error: option/i.test(output)) return 'Esta versão do Claude Code não aceita a configuração de conversa. Atualize o Claude Code e tente novamente.';
  return 'O Claude não conseguiu concluir a resposta. Confira o login no terminal e tente novamente.';
}

function claudeLimits(info) {
  const windows = info?.unifiedWindows || {};
  const list = [['five_hour', windows.five_hour], ['week', windows.seven_day]].filter(([, item]) => item && Number.isFinite(item.utilization))
    .map(([key, item]) => ({ key, used: item.utilization * 100, resetsAt: Number.isFinite(item.resetsAt) ? item.resetsAt * 1000 : null }));
  return list.length ? { plan: null, windows: list } : null;
}

async function runReply(settings, input, { binary = 'claude', signal, onSession = async () => {}, onProcess = () => {}, workspace, tools } = {}) {
  let sessionId = settings.codexSessionId || randomUUID();
  try {
    const args = claudeArguments(settings, sessionId, tools);
    let stderr = '', buffer = '', result = null, eventError = '', sessionWrite = Promise.resolve(), confirmed = false, limits = null, modelId = null, accountServers = null;
    let timedOut = false, killTimer;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: workspace || process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      const kill = signal => {
        try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {}
      };
      const stop = () => {
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 2000);
        killTimer.unref();
      };
      const timer = setTimeout(() => { timedOut = true; stop(); }, ['max', 'xhigh'].includes(settings.reasoningEffort) ? 600000 : 180000);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let event;
          try { event = JSON.parse(line); } catch { continue; } // Wrappers such as proot may print plain text lines.
          if (event.type === 'system' && event.subtype === 'init') {
            // The exact model the alias resolved to ("opus" → claude-opus-5-5).
            if (typeof event.model === 'string' && /^[\w.-]{1,80}$/.test(event.model)) modelId = event.model;
            // The account's connectors by name ("claude.ai Gmail" → "Gmail"), so the supervisor knows what to block.
            if (Array.isArray(event.mcp_servers)) accountServers = event.mcp_servers.map(item => /^claude\.ai (.{1,60})$/.exec(item?.name || '')?.[1]).filter(Boolean);
            if (event.session_id !== sessionId) { eventError = 'O Claude abriu outra sessão. A conversa não foi retomada.'; stop(); }
            else if (!confirmed) { confirmed = true; sessionWrite = sessionWrite.then(() => onSession(sessionId)); sessionWrite.catch(() => stop()); }
          }
          if (event.type === 'result') result = event;
          // The subscription's usage windows (5 hours, 7 days), sent with each turn.
          if (event.type === 'rate_limit_event') limits = claudeLimits(event.rate_limit_info) || limits;
        }
        if (buffer.length > 2_000_000) { eventError = 'O Claude devolveu um evento grande demais.'; stop(); }
      });
      if (child.pid) { try { onProcess(child.pid); } catch (error) { stop(); reject(error); } }
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop); resolve(code); });
    });
    await sessionWrite;
    if (timedOut) throw new Error('O Claude demorou mais que o esperado. A conversa continua disponível.');
    if (signal?.aborted) throw new Error('A resposta foi interrompida.');
    if (eventError) throw new Error(eventError);
    if (result?.is_error || result?.subtype !== 'success') throw Object.assign(new Error('O Claude não conseguiu concluir a resposta.'), { output: `${typeof result?.result === 'string' ? result.result : ''}\n${stderr}` });
    if (code !== 0) throw Object.assign(new Error('O Claude não conseguiu concluir a resposta.'), { output: stderr });
    if (!confirmed || result.session_id !== sessionId) throw new Error('O Claude encerrou sem confirmar a sessão e a resposta.');
    const text = typeof result.result === 'string' ? result.result.trim() : '';
    if (!text) throw new Error('O Claude devolveu uma resposta vazia.');
    const u = result.usage || {};
    const usage = { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
    return { text, codexSessionId: sessionId, model: settings.model, reasoningEffort: settings.reasoningEffort, usage, ...(limits ? { limits } : {}), ...(modelId ? { modelId } : {}), ...(accountServers ? { accountServers } : {}) };
  } catch (error) {
    // A new session only exists once the CLI confirmed it; otherwise the next attempt starts fresh.
    error.codexSessionId = settings.codexSessionId || undefined;
    // Translate here and drop the raw output so callers never re-map it with Codex messages.
    if (error.output) { error.message = friendlyClaudeError(error.output); delete error.output; }
    if (error.code === 'ENOENT') error.message = 'O Claude Code não foi encontrado no Termux. Veja docs/claude-termux.md.';
    throw error;
  }
}

module.exports = { CLAUDE_MODELS, claudeArguments, friendlyClaudeError, runReply };
