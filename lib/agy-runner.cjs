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

// Antigravity's usage windows: `agy -p /usage` prints one line per group and window, tab separated, for example
// "Gemini Models<TAB>Five Hour Limit Remaining<TAB>98%<TAB>2026-11-13T06:01:57Z". The app shows the Gemini group, the one its
// own models use, as the 5 h and week windows (like Codex and Claude); every group goes along in `groups` for the details.
function parseLimits(text) {
  const groups = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const [group, label, percent, resetsAt] = line.split('\t').map(item => (item || '').trim());
    const left = Number(String(percent).replace('%', ''));
    if (!group || !Number.isFinite(left) || !/remaining|limit/i.test(label || '')) continue;
    const key = /five.?hour|5.?h/i.test(label) ? 'five_hour' : /week/i.test(label) ? 'week' : null; if (!key) continue;
    if (!groups.has(group)) groups.set(group, []);
    const windows = groups.get(group); if (!windows.some(item => item.key === key)) windows.push({ key, used: Math.max(0, Math.min(100, 100 - left)), ...(Date.parse(resetsAt) ? { resetsAt: new Date(resetsAt).toISOString() } : {}) });
  }
  if (!groups.size) return null;
  const main = [...groups.keys()].find(name => /gemini/i.test(name) && groups.get(name).length > 1) || [...groups.keys()][0];
  return { plan: null, windows: groups.get(main), groups: [...groups].map(([name, windows]) => ({ name, windows })).slice(0, 8), checkedAt: new Date().toISOString() };
}
function readLimits(binary = 'agy', { timeout = 60000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFileCli(binary, ['-p', '/usage'], { timeout, encoding: 'utf8', maxBuffer: 1_000_000, ...(env ? { env: { ...process.env, ...env } } : {}) }, (error, stdout) => {
      const limits = parseLimits(stdout);
      if (limits) resolve(limits); else reject(error || new Error('O Antigravity não informou os limites desta conta.'));
    });
  });
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

// The Gemini models, when they do not find a tool at once, go hunting for it on the disk (find, mount, the agy settings) and even
// edit mcp_config.json. The MyBots tools are already loaded, so the guidance says so and the run is cut short if it keeps hunting.
const AGY_GUIDANCE = 'As ferramentas do MyBots já estão carregadas: chame-as direto pelo nome (por exemplo browser_read e browser_click). Nunca procure ferramentas pelo disco: não rode find, mount ou which para descobri-las, não leia nem edite mcp_config.json nem as pastas ~/.gemini e ~/.mybots-accounts. Se uma ferramenta do MyBots falhar, pare e conte o erro exato à pessoa em vez de tentar consertar o ambiente. Entre uma etapa e outra escreva no máximo uma frase curta, sem repetir o que já disse, sem reler o que acabou de escrever e sem tirar screenshot ou reler a página sem necessidade. Tudo o que você escreve aparece para a pessoa: use português simples e calmo, sem exclamações nem letras maiúsculas de empolgação, e nunca escreva ids de elementos, coordenadas, números de passo, caminhos de arquivos de captura nem comentários sobre o seu próprio raciocínio; pense em silêncio e escreva só o que a pessoa precisa ler. A resposta final conta o resultado em poucas frases.';
// Hunting for the tools: a shell command that searches the disk for them, or touching the agy settings / the accounts folder.
// Not a snoop: reading what agy itself saved for the run (its scratch and "brain" folders under ~/.gemini), which the model does
// to look at screenshots and downloads; cutting the run there made it "stop" for no reason.
const SNOOP = /mcp_config|\.mybots-accounts|antigravity-cli|\b(?:mount|find|locate|which)\b/;
// agy's own tools (shell and files); every other tool is one of the MyBots tools.
const AGY_OWN_TOOLS = /^(?:run_command|command_status|send_command_input|view_file(?:_outline)?|write_to_file|(?:multi_)?replace_file_content|list_dir|grep_search|find_by_name|read_url_content|search_web)$/;
const OWN_FILES = /[\\/]\.gemini[\\/](?:antigravity[\\/])?(?:brain|scratch|artifacts|conversations|tmp)[\\/]/;
// A reply that only announces the next step ("Vou abrir a página…") when the model ended its turn without doing it.
const ANNOUNCES = /^(?:vou|vamos|irei|agora vou|em seguida,? vou|preciso|primeiro,? vou|let me|i(?:'ll| will))\b/i;
const MAX_NUDGES = 3;
// The model sometimes thinks out loud in the answer itself: element ids, coordinates, step numbers, paths of the pictures it took,
// shouting ("BINGO!!"). That is its notebook, not something to show; it is kept out of the conversation.
const LEAK = /steps\/\d+|media_\d+|\bid:\s*\d+|\bstep(?:_index)?\s?\d+|scrollIntoView|"x"\s*:|\bbox\b\s*[:=]|[\\/]\.gemini[\\/]|\bbrain[\\/]|\btranscript\b|\bbrowser_(?:read|click|find|act|type)\b|\bBINGO\b|\bOLHA (?:QUE|AS|ISSO|O)\b|\bVAMOS VER\b|!!/gi;
const hits = text => (String(text).match(LEAK) || []).length;
/** An in-between message that is notebook rather than news: any trace of it, too long, or shouting. */
const thinkingAloud = text => hits(text) >= 1 || String(text).length > 280 || /\b[A-ZÀ-Ý]{5,}\b[^.]*!/.test(String(text));
/** A final answer made of the notebook: several traces of it. */
const notebook = text => hits(text) >= 2;
const CLEAN = 'Sua última resposta mostrou o seu raciocínio interno (ids, coordenadas, passos). Reescreva só o resultado para a pessoa: o que foi feito e o que falta, em 2 a 5 frases simples, sem ids, coordenadas, números de passo, caminhos de arquivos nem exclamações. Não chame ferramentas agora.';
const NOTEBOOK_FALLBACK = 'Parei aqui: o texto que eu ia mostrar eram só anotações técnicas minhas. Mande "continua" que eu sigo de onde parei, ou pergunte o que quer saber.';
// agy sometimes goes silent (the model call hangs): after this long without a line it is stopped and the conversation resumed, instead of waiting 10 minutes to fail.
const AGY_IDLE_MS = 4 * 60000;
const RESUME = 'Você ficou parado sem responder. Continue de onde parou, chamando a ferramenta do MyBots do próximo passo. Se a tarefa já está pronta, responda só com o resultado.';
const NUDGE = 'Você terminou o turno só anunciando o próximo passo. Faça agora o que disse, chamando a ferramenta do MyBots. Se a tarefa já está pronta, ou se algo impede de continuar, responda só com o resultado ou com o motivo.';
const MAX_SNOOPS = 3;

function guidanceFor(tools) {
  const termux = Boolean(tools?.termux), computer = Boolean(tools?.computer);
  return [tools && AGY_GUIDANCE, tools && 'As ferramentas do MyBots (servidor mybots-tools) são a forma de conversar com o app, navegar e guardar coisas para a pessoa; use-as quando o pedido envolver isso.',
    tools && PROGRESS_GUIDANCE.trim(), tools && deviceGuidance(tools.device, tools.computer, false, tools.desktop, false, tools.browserMode).trim(),
    termux && termuxGuidance(false).trim(), tools?.phone && phoneGuidance().trim(), computer && skillGuidance(tools.skills).trim()].filter(Boolean).join(' ');
}

/**
 * agy's result.usage is the whole conversation's running total (resuming it, the numbers only grow), and its input_tokens leave the
 * cached part out. MyBots counts input with the cached part in it and keeps per-session totals (database turnTokens): `session` makes
 * it record only what this turn added.
 */
function agyUsage(u = {}, calls = 1, resumedFrom = null, context = 0) {
  const cached = u.cache_read_tokens || 0;
  return { input: (u.input_tokens || 0) + cached, cached, output: (u.output_tokens || 0) + (u.thinking_tokens || 0), calls, session: true, resumed: Boolean(resumedFrom), ...(context > 0 ? { context } : {}) };
}

async function runReply(settings, input, { binary = 'agy', signal, onSession = async () => {}, onProcess = () => {}, onProgress = () => {}, onDelta, workspace, tools, wrap, env: accountEnv = null, idleMs = tools?.skills?.length ? SKILL_IDLE_MS : AGY_IDLE_MS, maxMs = MAX_MS, nudges = 0 } = {}) {
  try {
    if (tools?.entry) await ensureMcp(binary, tools.entry);
    const guidance = guidanceFor(tools);
    const args = agyArguments(settings, guidance ? `[Instruções do MyBots] ${guidance}\n\n${input}` : input, tools);
    const draft = onDelta ? createBatcher(onDelta) : null; const progress = progressTracker(onProgress);
    let snoops = 0, conversation = settings.codexSessionId || null, confirmed = false, sessionWrite = Promise.resolve(), result = null, step = -1, text = '', lastText = '', tooled = false, eventError = '', calls = 1, context = 0;
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
        // Each model call reports its own usage: the last one's prompt is how big the conversation is now.
        if (event.event === 'step_update' && update?.usage && update.state === 'DONE') context = (update.usage.input_tokens || 0) + (update.usage.cache_read_tokens || 0) || context;
        if (event.event === 'step_update' && update) {
          if (update.step_type === 'agent_response') {
            if (update.step_index !== step) { step = update.step_index; text = ''; }
            if (typeof update.text_delta === 'string') { text += update.text_delta; if (draft && text.length <= 20000) draft.set(text); }
            if (update.state === 'DONE') { lastText = text.trim(); tooled = false; }
          } else if (update.step_type === 'tool' && update.state === 'ACTIVE') {
            // What it said before using a tool is shown as a message; the tool is a step under "Pensando".
            if (lastText && !tooled) { if (thinkingAloud(lastText)) progress.step('Analisando a página'); else progress.message(lastText); lastText = ''; }
            tooled = true; calls++; draft?.set('');
            const info = update.tool_info || {}, params = info.parameters || {};
            const target = String(params.CommandLine || params.TargetFile || params.AbsolutePath || params.File || '');
            // Any tool that is not the shell or a file tool is one of the MyBots tools working: the hunt, if there was one, is over.
            if (!AGY_OWN_TOOLS.test(info.name || '')) snoops = 0;
            else if (tools && !OWN_FILES.test(target) && SNOOP.test(target) && (/mcp_config/.test(target) || ++snoops > MAX_SNOOPS)) { eventError = `O Antigravity ficou procurando as ferramentas do MyBots no disco (${target.slice(0, 100)}) em vez de usá-las e foi interrompido. Tente de novo.`; stop(); return; }
            progress.step(info.name === 'run_command' ? `Rodando ${String(params.CommandLine || '').slice(0, 140)}` : /file|write|replace|edit/.test(info.name || '') ? `Editando ${String(params.TargetFile || params.AbsolutePath || '').split('/').pop()}` : `Usando ${String(info.name || update.tool_name || 'uma ferramenta').slice(0, 60)}`);
          }
        }
        if (event.event === 'result') result = event.result || event;
      } });
    draft?.clear(); await sessionWrite; progress.flush?.();
    if (run.timedOut && tools && conversation && confirmed && !run.aborted && nudges < MAX_NUDGES) {
      progress.step('O Antigravity parou de responder; retomando a conversa');
      return runReply({ ...settings, codexSessionId: conversation }, RESUME, { binary, signal, onSession, onProcess, onProgress, onDelta, workspace, tools, wrap, env: accountEnv, idleMs, maxMs, nudges: nudges + 1 });
    }
    if (run.timedOut) throw new Error('O Antigravity ficou tempo demais sem dar sinal e foi interrompido. A conversa continua disponível; peça para continuar.');
    if (run.aborted) throw new Error('A resposta foi interrompida.');
    if (eventError) throw new Error(eventError);
    if (run.code === 127 && !result) throw Object.assign(new Error('O Antigravity (agy) não foi encontrado neste aparelho.'), { code: 'ENOENT' });
    if (run.tooBig) throw new Error('O Antigravity devolveu um evento grande demais.');
    if (!result || (result.status && result.status !== 'SUCCESS') || run.code !== 0) throw Object.assign(new Error('O Antigravity não conseguiu concluir a resposta.'), { output: `${result?.error || result?.response || ''}\n${run.stderr}` });
    if (!confirmed || !conversation) throw new Error('O Antigravity encerrou sem confirmar a conversa.');
    let reply = (lastText || (typeof result.response === 'string' ? result.response : '')).trim();
    if (!reply) throw new Error('O Antigravity devolveu uma resposta vazia.');
    // The answer is the model's notebook: it is asked once or twice to say it properly; if it still will not, a short honest line replaces it.
    if (tools && notebook(reply)) {
      if (nudges < MAX_NUDGES) return runReply({ ...settings, codexSessionId: conversation }, CLEAN, { binary, signal, onSession, onProcess, onProgress, onDelta, workspace, tools, wrap, env: accountEnv, idleMs, maxMs, nudges: nudges + 1 });
      reply = NOTEBOOK_FALLBACK;
    }
    const u = result.usage || {};
    // The model ended its turn by only announcing the next step: the same conversation is told to carry it out (a few times at most).
    if (tools && nudges < MAX_NUDGES && reply.length < 400 && ANNOUNCES.test(reply)) {
      progress.message(reply); progress.flush();
      const next = await runReply({ ...settings, codexSessionId: conversation }, NUDGE, { binary, signal, onSession, onProcess, onProgress, onDelta, workspace, tools, wrap, env: accountEnv, idleMs, maxMs, nudges: nudges + 1 });
      // The usage is the conversation's running total, so the later run's already includes this one: only the calls add up.
      next.usage = { ...next.usage, calls: (next.usage.calls || 1) + calls };
      return next;
    }
    return { text: reply, codexSessionId: conversation, model: settings.model, reasoningEffort: settings.reasoningEffort, usage: agyUsage(u, calls, settings.codexSessionId, context) };
  } catch (error) {
    error.codexSessionId = settings.codexSessionId || undefined;
    if (error.output) { error.message = friendlyAgyError(error.output); delete error.output; }
    if (error.code === 'ENOENT') error.message = 'O Antigravity (agy) não foi encontrado neste aparelho.';
    throw error;
  }
}

module.exports = { SNOOP, OWN_FILES, ANNOUNCES, thinkingAloud, notebook, MAX_SNOOPS, parseModels, discoverModels, agyArguments, friendlyAgyError, ensureMcp, guidanceFor, runReply, parseLimits, readLimits };
