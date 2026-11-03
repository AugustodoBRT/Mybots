const { execFileCli } = require('./cli-bin.cjs');
const { createBatcher } = require('./stream-batch.cjs');
const { runCli } = require('./cli-run.cjs');
const { skillGuidance } = require('./agent-skills.cjs');
const { deviceGuidance, termuxGuidance, phoneGuidance, progressTracker, PROGRESS_GUIDANCE, IDLE_MS, MAX_MS, SKILL_IDLE_MS } = require('./codex-runner.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const SUFFIX = new RegExp(`^(.+)-(${EFFORT_ORDER.join('|')})$`);

// `agy models` prints "id<TAB>Name" and makes every reasoning level its own model ("gemini-4-argon-high"): the level
// becomes the bot's reasoning effort and the id without it the model.
function parseModels(text) {
  const groups = new Map();
  for (const line of String(text || '').split('\n')) {
    const [id, name] = line.split('\t').map(part => part?.trim());
    if (!id || !name || !/^[\w.-]{1,80}$/.test(id)) continue;
    const match = SUFFIX.exec(id), base = match ? match[1] : id, effort = match ? match[2] : null;
    const group = groups.get(base) || { provider: 'agy', model: base, displayName: name.replace(/\s*\((?:Low|Medium|High|XHigh|Max)\)\s*$/i, ''), isDefault: false, efforts: [], defaultEffort: null };
    if (effort && !group.efforts.includes(effort)) group.efforts.push(effort);
    groups.set(base, group);
  }
  return [...groups.values()].map(item => {
    item.efforts.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
    item.defaultEffort = item.efforts.includes('medium') ? 'medium' : item.efforts[0] || null;
    return item;
  });
}

function discoverModels(binary = 'agy', { timeout = 40000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFileCli(binary, ['models'], { timeout, encoding: 'utf8', maxBuffer: 1_000_000, ...(env ? { env: { ...process.env, ...env } } : {}) }, (error, stdout) => {
      if (error) return reject(Object.assign(new Error(error.code === 'ENOENT' || error.code === 127 ? 'O Antigravity (agy) não foi encontrado.' : 'Não consegui listar os modelos do Antigravity.'), { code: error.code }));
      const models = parseModels(stdout);
      if (!models.length) reject(new Error('O Antigravity não listou modelos. Confira o login com agy.')); else resolve(models);
    });
  });
}

function agyArguments({ model, reasoningEffort, codexSessionId } = {}, prompt, tools) {
  if (codexSessionId && !UUID.test(codexSessionId)) throw new Error('O identificador da conversa do Antigravity é inválido.');
  const folders = tools?.computer ? [...(tools.computer.full ? [tools.computer.home] : tools.computer.folders || []), ...(tools.computer.skillDirs || [])].filter(Boolean) : [];
  return ['--output-format', 'stream-json', '--dangerously-skip-permissions', ...folders.flatMap(path => ['--add-dir', path]),
    ...(model ? ['--model', reasoningEffort ? `${model}-${reasoningEffort}` : model] : []),
    ...(codexSessionId ? ['--conversation', codexSessionId] : []), `-p=${prompt}`];
}

function friendlyAgyError(output) {
  if (/not logged in|login|sign.?in|oauth|unauthenticated|credentials|401/i.test(output)) return 'Entre no Antigravity pelo terminal com agy, depois tente novamente.';
  if (/quota|rate.?limit|resource.?exhausted|429|usage limit/i.test(output)) return 'O limite de uso do Antigravity foi atingido. Tente novamente mais tarde ou use outro modelo.';
  if (/model.*(not found|not available|invalid|unsupported)|unknown model/i.test(output)) return 'O Antigravity recusou este modelo ou nível de raciocínio. Escolha outra combinação.';
  if (/network|connection|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|unavailable/i.test(output)) return 'O Antigravity não conseguiu se conectar. Confira a internet e tente novamente.';
  return 'O Antigravity não conseguiu concluir a resposta. Confira o login com agy e tente novamente.';
}

// The MyBots tools reach agy as an MCP server it starts itself (stdio). agy keeps its MCP list in its own settings, so the
// server is registered once; the run's token and address travel in the environment agy passes down to it.
const registered = new Map();
// Where agy runs inside another system (Termux's proot Debian), the node of this process cannot run there: MYBOTS_MCP_NODE names the one it has.
const mcpNode = () => process.env.MYBOTS_MCP_NODE || require('./node-binary.cjs').nodeBinary();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function ensureMcp(binary, entry) {
  const key = binary + '\0' + mcpNode() + '\0' + entry;
  if (!registered.has(key)) registered.set(key, new Promise((resolve, reject) => {
    execFileCli(binary, ['mcp', 'list'], { timeout: 30000, encoding: 'utf8' }, (listError, listed) => {
      if (!listError && new RegExp(`^mybots-tools\\s+stdio\\s+enabled\\s+${escape(mcpNode())} ${escape(entry)}\\s*$`, 'm').test(listed)) return resolve();
      execFileCli(binary, ['mcp', 'add', 'mybots-tools', mcpNode(), entry], { timeout: 30000 }, error => error ? reject(new Error('Não consegui registrar as ferramentas do MyBots no Antigravity.')) : resolve());
    });
  }).catch(error => { registered.delete(key); throw error; }));
  return registered.get(key);
}

function guidanceFor(tools) {
  const termux = Boolean(tools?.termux), computer = Boolean(tools?.computer);
  return [tools && 'As ferramentas do MyBots (servidor mybots-tools) são a forma de conversar com o app, navegar e guardar coisas para a pessoa; use-as quando o pedido envolver isso.',
    tools && PROGRESS_GUIDANCE.trim(), tools && deviceGuidance(tools.device, tools.computer, false, tools.desktop, false, tools.browserMode).trim(),
    termux && termuxGuidance(false).trim(), tools?.phone && phoneGuidance().trim(), computer && skillGuidance(tools.skills).trim()].filter(Boolean).join(' ');
}

async function runReply(settings, input, { binary = 'agy', signal, onSession = async () => {}, onProcess = () => {}, onProgress = () => {}, onDelta, workspace, tools, wrap, env: accountEnv = null, idleMs = tools?.skills?.length ? SKILL_IDLE_MS : IDLE_MS, maxMs = MAX_MS } = {}) {
  try {
    if (tools?.entry) await ensureMcp(binary, tools.entry);
    const guidance = guidanceFor(tools);
    const args = agyArguments(settings, guidance ? `[Instruções do MyBots] ${guidance}\n\n${input}` : input, tools);
    const draft = onDelta ? createBatcher(onDelta) : null; const progress = progressTracker(onProgress);
    let conversation = settings.codexSessionId || null, confirmed = false, sessionWrite = Promise.resolve(), result = null, step = -1, text = '', lastText = '', tooled = false, eventError = '';
    const run = await runCli({ binary, args, wrap, signal, cwd: workspace, onProcess, idleMs, maxMs,
      env: { ...process.env, ...(accountEnv || {}), ...(tools ? { MYBOTS_RUN_TOKEN: tools.token, MYBOTS_RUN_ENDPOINT: tools.endpoint } : {}) },
      onEvent: (event, stop) => {
        if (event.event === 'init' && event.init) {
          const id = event.conversation_id;
          if (typeof id === 'string' && UUID.test(id)) {
            if (settings.codexSessionId && id !== settings.codexSessionId) { eventError = 'O Antigravity abriu outra conversa. A conversa não foi retomada.'; stop(); return; }
            conversation = id;
            if (!confirmed) { confirmed = true; sessionWrite = sessionWrite.then(() => onSession(id)); sessionWrite.catch(() => stop()); }
          }
        }
        const update = event.step_update;
        if (event.event === 'step_update' && update) {
          if (update.step_type === 'agent_response') {
            if (update.step_index !== step) { step = update.step_index; text = ''; }
            if (typeof update.text_delta === 'string') { text += update.text_delta; if (draft && text.length <= 20000) draft.set(text); }
            if (update.state === 'DONE') { lastText = text.trim(); tooled = false; }
          } else if (update.step_type === 'tool' && update.state === 'ACTIVE') {
            // What it said before using a tool is shown as a message; the tool is a step under "Pensando".
            if (lastText && !tooled) { progress.message(lastText); lastText = ''; }
            tooled = true; draft?.set('');
            const info = update.tool_info || {}, params = info.parameters || {};
            progress.step(info.name === 'run_command' ? `Rodando ${String(params.CommandLine || '').slice(0, 140)}` : /file|write|replace|edit/.test(info.name || '') ? `Editando ${String(params.TargetFile || params.AbsolutePath || '').split('/').pop()}` : `Usando ${String(info.name || update.tool_name || 'uma ferramenta').slice(0, 60)}`);
          }
        }
        if (event.event === 'result') result = event.result || event;
      } });
    draft?.clear(); await sessionWrite; progress.flush?.();
    if (run.timedOut) throw new Error('O Antigravity ficou tempo demais sem dar sinal e foi interrompido. A conversa continua disponível; peça para continuar.');
    if (run.aborted) throw new Error('A resposta foi interrompida.');
    if (eventError) throw new Error(eventError);
    if (run.code === 127 && !result) throw Object.assign(new Error('O Antigravity (agy) não foi encontrado neste aparelho.'), { code: 'ENOENT' });
    if (run.tooBig) throw new Error('O Antigravity devolveu um evento grande demais.');
    if (!result || (result.status && result.status !== 'SUCCESS') || run.code !== 0) throw Object.assign(new Error('O Antigravity não conseguiu concluir a resposta.'), { output: `${result?.error || result?.response || ''}\n${run.stderr}` });
    if (!confirmed || !conversation) throw new Error('O Antigravity encerrou sem confirmar a conversa.');
    const reply = (lastText || (typeof result.response === 'string' ? result.response : '')).trim();
    if (!reply) throw new Error('O Antigravity devolveu uma resposta vazia.');
    const u = result.usage || {};
    return { text: reply, codexSessionId: conversation, model: settings.model, reasoningEffort: settings.reasoningEffort, usage: { input: u.input_tokens || 0, cached: u.cache_read_tokens || 0, output: (u.output_tokens || 0) + (u.thinking_tokens || 0) } };
  } catch (error) {
    error.codexSessionId = settings.codexSessionId || undefined;
    if (error.output) { error.message = friendlyAgyError(error.output); delete error.output; }
    if (error.code === 'ENOENT') error.message = 'O Antigravity (agy) não foi encontrado neste aparelho.';
    throw error;
  }
}

module.exports = { parseModels, discoverModels, agyArguments, friendlyAgyError, ensureMcp, guidanceFor, runReply };
