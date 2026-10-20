const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'browser_use',
  'computer_use', 'multi_agent', 'memories', 'view_image', 'image_generation', 'sleep_tool', 'goals', 'shell_snapshot', 'skill_mcp_dependency_install', 'remote_plugin'];
const featureCache = new Map();

// Codex aborts on unknown feature names, so only pass the ones this installed version knows.
function knownFeatures(binary) {
  if (!featureCache.has(binary)) featureCache.set(binary, new Promise((resolve, reject) => {
    const child = spawn(binary, ['features', 'list'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const names = new Set(stdout.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(name => /^[a-z0-9_]+$/.test(name)));
      if (code === 0 && names.has('shell_tool')) resolve(names);
      else reject(new Error('Esta versão do Codex não permite desligar o terminal do bot. Atualize o Codex no Termux para usar ferramentas.'));
    });
  }));
  const pending = featureCache.get(binary);
  pending.catch(() => featureCache.delete(binary));
  return pending;
}

function toolGuidance(accountApps, connectorWrites) {
  return 'Suas ferramentas do MyBots (servidor mybots-tools: notificações do celular, memória, pendências com prazo, rotinas, anexos, SMS, contatos, navegador e outras) ficam na busca de ferramentas: procure por elas antes de dizer que não tem acesso a algo. Você tem um navegador de internet próprio (procure por "browser"): browser_open abre qualquer site, link ou página, browser_read lê, browser_click e browser_type usam a página. Use-o sempre que pedirem para abrir, acessar, entrar ou consultar um site; nunca diga que não consegue navegar. Ferramentas que devolvem imagem (attachment_read de imagem ou de PDF escaneado, browser_screenshot): no script, percorra r.content e chame image(c) para cada imagem e text(c.text) para o texto; text(r) sozinho descarta a imagem.' +
    (accountApps ? ' Para e-mail, agenda, Drive e outros serviços da conta da pessoa, use os apps conectados da conta (servidor codex_apps, por exemplo gmail_search_emails); email_search do MyBots é só para a caixa conectada por senha de app nos Ajustes. ' + (connectorWrites ? 'Este bot tem acesso total: pode agir nos apps da conta quando a pessoa pedir.' : 'Ações que alteram algo nos apps da conta são bloqueadas: diga isso em vez de tentar contornar.') : '');
}

function chatArguments(output, { model, reasoningEffort, codexSessionId } = {}, tools, features) {
  if (codexSessionId && !UUID.test(codexSessionId)) throw new Error('O identificador da sessão do Codex é inválido.');
  const args = ['exec', '--sandbox', 'read-only', '--color', 'never'];
  // Resume has its own config parser: security and MCP overrides must follow the subcommand.
  if (codexSessionId) args.push('resume', codexSessionId);
  args.push('--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', '--output-last-message', output,
    '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '-c', 'web_search="disabled"');
  // Account apps (ChatGPT connectors) only when the bot was granted them: reads run, writes need an
  // approval that approval_policy="never" refuses, and destructive or open-world tools stay off.
  const accountApps = Boolean(tools?.connectors);
  for (const feature of DISABLED_FEATURES) if ((!features || features.has(feature)) && !(accountApps && feature === 'apps')) args.push('--disable', feature);
  // Full access lets the apps act too: the person chose "faz tudo" for this bot.
  if (accountApps && tools.connectorWrites) args.push('-c', 'apps._default.destructive_enabled=true', '-c', 'apps._default.open_world_enabled=true', '-c', 'apps._default.default_tools_approval_mode="auto"');
  else if (accountApps) args.push('-c', 'apps._default.destructive_enabled=false', '-c', 'apps._default.open_world_enabled=false', '-c', 'apps._default.default_tools_approval_mode="writes"');
  // Sent on every turn, resumed ones included: newer Codex hides MCP tools behind tool search.
  if (tools) args.push('-c', `developer_instructions=${JSON.stringify(toolGuidance(accountApps, Boolean(tools.connectorWrites)))}`);
  if (!features || features.has('skip_host_skill_discovery')) args.push('--enable', 'skip_host_skill_discovery');
  if (tools) {
    args.push('-c', `mcp_servers.mybots-tools={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(tools.entry)}],env_vars=["MYBOTS_RUN_TOKEN","MYBOTS_RUN_ENDPOINT"],required=true,startup_timeout_sec=20,tool_timeout_sec=130,default_tools_approval_mode="approve"}`);
  }
  if (model) args.push('--model', model);
  if (reasoningEffort) args.push('-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  args.push('-');
  return args;
}

async function runReply(settings, input, { binary = 'codex', signal, onSession = async () => {}, onProcess = () => {}, workspace, tools } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chat-'));
  let sessionId = settings.codexSessionId;
  try {
    const output = join(directory, 'reply.txt');
    const args = chatArguments(output, settings, tools, await knownFeatures(binary));
    let stderr = '', buffer = '', completed = false, eventError = '', sessionWrite = Promise.resolve();
    let timedOut = false, killTimer;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: workspace || directory, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
        env: { ...process.env, ...(tools ? { MYBOTS_RUN_TOKEN: tools.token, MYBOTS_RUN_ENDPOINT: tools.endpoint } : {}) } });
      const kill = signal => {
        try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {}
      };
      const stop = () => {
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 2000);
        killTimer.unref();
      };
      const timer = setTimeout(() => { timedOut = true; stop(); }, ['max', 'ultra'].includes(settings.reasoningEffort) ? 600000 : 180000);
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
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'thread.started' && UUID.test(event.thread_id || '')) {
            if (sessionId && sessionId !== event.thread_id) { eventError = 'O Codex abriu outra sessão. A conversa não foi retomada.'; stop(); }
            else { sessionId = event.thread_id; sessionWrite = sessionWrite.then(() => onSession(sessionId)); sessionWrite.catch(() => stop()); }
          }
          if (event.type === 'turn.completed') completed = true;
          if (event.type === 'turn.failed') eventError = 'O Codex não concluiu a resposta.';
        }
        if (buffer.length > 2_000_000) { eventError = 'O Codex devolveu um evento grande demais.'; stop(); }
      });
      if (child.pid) { try { onProcess(child.pid); } catch (error) { stop(); reject(error); } }
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop); resolve(code); });
    });
    await sessionWrite;
    if (timedOut) throw new Error('O Codex demorou mais que o esperado. A conversa continua disponível.');
    if (signal?.aborted) throw new Error('A resposta foi interrompida.');
    if (eventError) throw new Error(eventError);
    if (result !== 0) throw Object.assign(new Error('O Codex não conseguiu concluir a resposta.'), { output: stderr });
    if (!sessionId || !completed) throw new Error('O Codex encerrou sem confirmar a sessão e a resposta.');
    const text = (await readFile(output, 'utf8')).trim();
    if (!text) throw new Error('O Codex devolveu uma resposta vazia.');
    return { text, codexSessionId: sessionId, model: settings.model, reasoningEffort: settings.reasoningEffort };
  } catch (error) {
    error.codexSessionId = sessionId;
    throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

module.exports = { chatArguments, runReply, knownFeatures };
