const { execFile } = require('node:child_process');
const { createBatcher } = require('./stream-batch.cjs');
const { runCli } = require('./cli-run.cjs');
const { skillGuidance } = require('./agent-skills.cjs');
const { deviceGuidance, termuxGuidance, phoneGuidance, progressTracker, PROGRESS_GUIDANCE, IDLE_MS, MAX_MS, SKILL_IDLE_MS } = require('./codex-runner.cjs');
const SESSION = /^ses_[A-Za-z0-9]{8,60}$/;
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// `opencode models --verbose` prints "provider/model" and then the model's JSON (name, capabilities, variants).
// A variant (reasoning level) becomes the bot's reasoning effort; models that cannot call tools are left out.
function parseModels(text) {
  const models = [], lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i].trim();
    if (!/^[\w.-]+\/[^\s{}]{1,120}$/.test(id) || lines[i + 1]?.trim() !== '{') continue;
    let end = i + 1; while (end < lines.length && lines[end] !== '}') end++;
    let info; try { info = JSON.parse(lines.slice(i + 1, end + 1).join('\n')); } catch { continue; }
    i = end;
    if (info.status && info.status !== 'active' || info.capabilities?.toolcall === false) continue;
    const efforts = Object.keys(info.variants || {}).filter(key => EFFORT_ORDER.includes(key)).sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
    models.push({ provider: 'opencode', model: id, displayName: `${info.name || id.split('/')[1]}${id.startsWith('opencode/') ? '' : ` · ${id.split('/')[0]}`}`, isDefault: false, efforts, defaultEffort: efforts.includes('medium') ? 'medium' : efforts[0] || null });
  }
  return models;
}

function discoverModels(binary = 'opencode', { timeout = 40000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, ['models', '--verbose'], { timeout, encoding: 'utf8', maxBuffer: 20_000_000 }, (error, stdout) => {
      if (error) return reject(Object.assign(new Error(error.code === 'ENOENT' || error.code === 127 ? 'O opencode não foi encontrado.' : 'Não consegui listar os modelos do opencode.'), { code: error.code }));
      const models = parseModels(stdout);
      if (!models.length) reject(new Error('O opencode não listou modelos. Confira os provedores com opencode auth.')); else resolve(models);
    });
  });
}

// Free by default (the person's choice): everything is allowed; a bot that may not touch the computer loses the shell and file edits.
function configFor(tools) {
  const computer = tools?.computer !== false;
  return { permission: computer ? { '*': 'allow' } : { '*': 'allow', bash: 'deny', edit: 'deny', external_directory: 'deny' },
    // The MyBots tools come over the supervisor's HTTP MCP with the run's token (no node needed where opencode runs: in Termux it lives in a proot Debian).
    ...(tools?.endpoint && tools.token ? { mcp: { 'mybots-tools': { type: 'remote', url: tools.endpoint + '/mcp', headers: { Authorization: 'Bearer ' + tools.token }, enabled: true, timeout: 130000 } } } : {}) };
}

function opencodeArguments({ model, reasoningEffort, codexSessionId } = {}, prompt) {
  if (codexSessionId && !SESSION.test(codexSessionId)) throw new Error('O identificador da sessão do opencode é inválido.');
  if (model && !/^[\w.-]+\/[^\s]{1,120}$/.test(model)) throw new Error('O modelo do opencode precisa estar no formato provedor/modelo.');
  return ['run', '--format', 'json', ...(model ? ['-m', model] : []), ...(reasoningEffort ? ['--variant', reasoningEffort] : []), ...(codexSessionId ? ['-s', codexSessionId] : []), '--', prompt];
}

function friendlyOpencodeError(output) {
  if (/api key|unauthorized|401|forbidden|403|not authenticated|auth/i.test(output)) return 'O opencode recusou as credenciais do provedor. Confira com opencode auth login.';
  if (/quota|rate.?limit|429|usage limit|insufficient|credit/i.test(output)) return 'O limite de uso do provedor do opencode foi atingido. Tente novamente mais tarde ou escolha outro modelo.';
  if (/model.*(not found|not available|invalid|unsupported)|unknown model|ProviderModelNotFound/i.test(output)) return 'O opencode não encontrou este modelo ou nível de raciocínio. Escolha outra combinação.';
  if (/network|connection|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(output)) return 'O opencode não conseguiu se conectar. Confira a internet e tente novamente.';
  return 'O opencode não conseguiu concluir a resposta. Confira o modelo e o login do provedor e tente novamente.';
}

function guidanceFor(tools) {
  const termux = Boolean(tools?.termux), computer = Boolean(tools?.computer);
  return [tools && 'As ferramentas do MyBots (servidor mybots-tools) são a forma de conversar com o app, navegar e guardar coisas para a pessoa; use-as quando o pedido envolver isso.',
    tools && PROGRESS_GUIDANCE.trim(), tools && deviceGuidance(tools.device, tools.computer, false, tools.desktop, false, tools.browserMode).trim(),
    termux && termuxGuidance(false).trim(), tools?.phone && phoneGuidance().trim(), computer && skillGuidance(tools.skills).trim()].filter(Boolean).join(' ');
}

async function runReply(settings, input, { binary = 'opencode', signal, onSession = async () => {}, onProcess = () => {}, onProgress = () => {}, onDelta, workspace, tools, wrap, idleMs = tools?.skills?.length ? SKILL_IDLE_MS : IDLE_MS, maxMs = MAX_MS } = {}) {
  try {
    const guidance = guidanceFor(tools);
    const args = opencodeArguments(settings, guidance ? `[Instruções do MyBots] ${guidance}\n\n${input}` : input);
    const draft = onDelta ? createBatcher(onDelta) : null; const progress = progressTracker(onProgress);
    let session = settings.codexSessionId || null, confirmed = false, sessionWrite = Promise.resolve(), lastText = '', eventError = '', sessionError = '', finished = false;
    const usage = { input: 0, cached: 0, output: 0 };
    const run = await runCli({ binary, args, wrap, signal, cwd: workspace, onProcess, idleMs, maxMs,
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(configFor(tools)) },
      onEvent: (event, stop) => {
        if (typeof event.sessionID === 'string' && SESSION.test(event.sessionID)) {
          if (settings.codexSessionId && event.sessionID !== settings.codexSessionId) { sessionError = 'O opencode abriu outra sessão. A conversa não foi retomada.'; stop(); return; }
          session = event.sessionID;
          if (!confirmed) { confirmed = true; sessionWrite = sessionWrite.then(() => onSession(session)); sessionWrite.catch(() => stop()); }
        }
        const part = event.part || {};
        if (event.type === 'text' && typeof part.text === 'string') { lastText = part.text.trim(); if (draft && lastText.length <= 20000) draft.set(lastText); }
        else if (event.type === 'tool_use') {
          if (lastText) { progress.message(lastText); lastText = ''; }
          draft?.set('');
          const input = part.state?.input || {};
          progress.step(part.tool === 'bash' ? `Rodando ${String(input.command || '').slice(0, 140)}` : /^(edit|write|patch)$/.test(part.tool || '') ? `Editando ${String(input.filePath || input.path || '').split('/').pop()}` : `Usando ${String(part.tool || 'uma ferramenta').slice(0, 60)}`);
        } else if (event.type === 'step_finish') {
          const t = part.tokens || {};
          usage.input += (t.input || 0) + (t.cache?.read || 0) + (t.cache?.write || 0); usage.cached += t.cache?.read || 0; usage.output += (t.output || 0) + (t.reasoning || 0);
          if (part.reason === 'stop') finished = true;
        } else if (event.type === 'error') eventError = String(event.error?.data?.message || event.error?.message || event.message || 'erro').slice(0, 500);
      } });
    draft?.clear(); await sessionWrite;
    if (run.timedOut) throw new Error('O opencode ficou tempo demais sem dar sinal e foi interrompido. A conversa continua disponível; peça para continuar.');
    if (run.aborted) throw new Error('A resposta foi interrompida.');
    if (sessionError) throw new Error(sessionError);
    if (run.code === 127 && !confirmed) throw Object.assign(new Error('O opencode não foi encontrado neste aparelho.'), { code: 'ENOENT' });
    if (run.tooBig) throw new Error('O opencode devolveu um evento grande demais.');
    if (eventError || run.code !== 0 || !finished) throw Object.assign(new Error('O opencode não conseguiu concluir a resposta.'), { output: `${eventError}\n${run.stderr}` });
    if (!confirmed || !session) throw new Error('O opencode encerrou sem confirmar a sessão.');
    if (!lastText) throw new Error('O opencode devolveu uma resposta vazia.');
    return { text: lastText, codexSessionId: session, model: settings.model, reasoningEffort: settings.reasoningEffort, usage };
  } catch (error) {
    error.codexSessionId = settings.codexSessionId || undefined;
    if (error.output) { error.message = friendlyOpencodeError(error.output); delete error.output; }
    if (error.code === 'ENOENT') error.message = 'O opencode não foi encontrado neste aparelho.';
    throw error;
  }
}

module.exports = { parseModels, discoverModels, configFor, opencodeArguments, friendlyOpencodeError, guidanceFor, runReply };
