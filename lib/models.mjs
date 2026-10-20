import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function normalizeModels(items) {
  const models = new Map();
  for (const item of items) {
    if (!item || item.hidden || typeof item.model !== 'string' || !item.model || (item.inputModalities && !item.inputModalities.includes('text'))) continue;
    const efforts = [...new Set((item.supportedReasoningEfforts || [])
      .map(value => value.reasoningEffort).filter(value => typeof value === 'string' && value.length > 0))];
    models.set(item.model, {
      model: item.model, displayName: item.displayName || item.model, isDefault: Boolean(item.isDefault),
      efforts, defaultEffort: efforts.includes(item.defaultReasoningEffort) ? item.defaultReasoningEffort : efforts[0] || null
    });
  }
  return [...models.values()];
}

export const PROVIDER_NAMES = { codex: 'Codex', claude: 'Claude' };

export function selectionFor(models, { provider, model, reasoningEffort } = {}) {
  if (model !== undefined && (typeof model !== 'string' || !model.trim())) throw new Error('Escolha um modelo válido.');
  if (provider !== undefined && !PROVIDER_NAMES[provider]) throw new Error('Escolha uma IA válida.');
  // Catalog entries without a provider (computer mode) are Codex models.
  const pool = provider ? models.filter(item => (item.provider || 'codex') === provider) : models;
  if (provider && !pool.length) throw new Error(`O ${PROVIDER_NAMES[provider]} não está conectado neste aparelho. Confira o login no Termux ou escolha outra IA.`);
  const preferred = model || (provider ? undefined : process.env.MYBOTS_MODEL);
  const selected = preferred ? pool.find(item => item.model === preferred) : pool.find(item => item.isDefault) || pool[0];
  if (!selected) throw new Error(preferred ? `Este modelo não aparece mais no catálogo do ${PROVIDER_NAMES[provider] || 'Codex'}. Escolha outro modelo.` : 'Não foi possível carregar os modelos. Verifique a conexão com o Codex.');
  const effort = reasoningEffort === undefined ? selected.defaultEffort : reasoningEffort;
  if (selected.efforts.length ? !selected.efforts.includes(effort) : effort !== null) {
    throw new Error('Este nível de raciocínio não é compatível com o modelo. Escolha uma das opções disponíveis.');
  }
  return { ...(selected.provider ? { provider: selected.provider } : {}), model: selected.model, reasoningEffort: effort };
}

/** Read the Codex catalog over its documented RPC; this does not run an inference turn. */
export function discoverModels(binary, { timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['app-server', '--listen', 'stdio://'];
    for (const feature of ['apps', 'plugins', 'hooks', 'browser_use', 'computer_use', 'multi_agent', 'code_mode_host']) {
      args.push('-c', `features.${feature}=false`);
    }
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    const entries = [], cursors = new Set();
    let finished = false, killTimer;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('O Codex demorou para listar os modelos. Clique em atualizar para tentar novamente.')), timeout);
    timer.unref();
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ ...(id === null ? {} : { id }), method, params }) + '\n');
    child.stdin.on('error', () => {});
    child.stderr.resume(); // Diagnostic streams can include account details; never expose them through the API.
    child.on('error', error => finish(new Error(error.code === 'ENOENT' ? 'Instale o Codex neste aparelho.' : 'Não foi possível iniciar o catálogo de modelos do Codex.')));
    child.on('close', () => {
      clearTimeout(killTimer);
      if (!finished) finish(new Error('O Codex encerrou antes de listar os modelos. Confira o login e tente novamente.'));
    });
    lines.on('line', line => {
      if (finished) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.id !== 1 && event.id !== 2) return;
      if (event.error) return finish(new Error('O Codex recusou a consulta de modelos. Confira o login ou atualize o Codex.'));
      if (event.id === 1) {
        send(null, 'initialized', {});
        send(2, 'model/list', { limit: 100, includeHidden: false });
      } else {
        if (!Array.isArray(event.result?.data)) return finish(new Error('O Codex devolveu um catálogo de modelos inválido.'));
        entries.push(...event.result.data);
        const cursor = event.result.nextCursor;
        if (cursor) {
          if (cursors.has(cursor) || cursors.size > 20) return finish(new Error('O Codex não conseguiu concluir a lista de modelos.'));
          cursors.add(cursor);
          send(2, 'model/list', { limit: 100, includeHidden: false, cursor });
        } else {
          const models = normalizeModels(entries);
          if (!models.length) return finish(new Error('O Codex não devolveu modelos de conversa para esta conta.'));
          finish(null, models);
        }
      }
    });
    send(1, 'initialize', { clientInfo: { name: 'mybots', title: 'MyBots', version: '0.1.0' } });
  });
}

/** The ChatGPT plan's Codex usage windows (5 hours and week) over the app-server RPC; no inference turn. */
export function readLimits(binary, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer); lines.close(); child.stdin.end(); child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('O Codex demorou para informar os limites.')), timeout); timer.unref();
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ ...(id === null ? {} : { id }), method, params }) + '\n');
    child.stdin.on('error', () => {}); child.stderr.resume();
    child.on('error', () => finish(new Error('Não foi possível consultar os limites do Codex.')));
    child.on('close', () => finish(new Error('O Codex encerrou antes de informar os limites.')));
    lines.on('line', line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.id === 1) { send(null, 'initialized', {}); send(2, 'account/rateLimits/read', {}); return; }
      if (event.id !== 2) return;
      const limits = event.result?.rateLimits;
      if (event.error || !limits) return finish(new Error('O Codex não informou os limites desta conta.'));
      const windows = [['five_hour', limits.primary], ['week', limits.secondary]].filter(([, item]) => item && Number.isFinite(item.usedPercent))
        .map(([key, item]) => ({ key: item.windowDurationMins >= 1440 ? 'week' : 'five_hour', used: item.usedPercent, resetsAt: Number.isFinite(item.resetsAt) ? item.resetsAt * 1000 : null }));
      finish(null, { plan: typeof limits.planType === 'string' ? limits.planType : null, windows });
    });
    send(1, 'initialize', { clientInfo: { name: 'mybots', title: 'MyBots', version: '0.1.0' } });
  });
}
