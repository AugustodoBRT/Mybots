import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './lib/store.mjs';
import { Codex } from './lib/codex.mjs';
import { selectionFor } from './lib/models.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'] };

function equal(a, b) {
  const left = Buffer.from(a || ''), right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function body(request, limit = 24000) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw Object.assign(new Error('Envie dados em JSON.'), { status: 415 });
  let data = '';
  request.setEncoding('utf8');
  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > limit) throw Object.assign(new Error('A mensagem é grande demais.'), { status: 413 });
  }
  try { return JSON.parse(data); } catch { throw Object.assign(new Error('O pedido contém JSON inválido.'), { status: 400 }); }
}

export function createApp({ directory = join(ROOT, '.data'), codex = new Codex(),
  host = process.env.MYBOTS_HOST || '127.0.0.1', accessToken = process.env.MYBOTS_TOKEN } = {}) {
  const store = new Store(directory);
  const token = accessToken || randomBytes(32).toString('hex');
  const active = new Map();
  let connection = { available: false, loggedIn: false, message: 'Verificando Codex…' };
  let models = [], modelsError = '', modelsLoadedAt = 0;
  let check;
  async function refreshConnection() {
    if (!check) check = (async () => {
      connection = await codex.status();
      if (!connection.loggedIn) return;
      if (models.length && Date.now() - modelsLoadedAt < 300000) return;
      try {
        models = await codex.models();
        modelsLoadedAt = Date.now();
        modelsError = '';
      } catch (error) { modelsError = error.message; }
    })().finally(() => { check = undefined; });
    await check;
  }
  const json = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const address = server.address();
    const localHost = `127.0.0.1:${address.port}`;
    const lanHost = `${host}:${address.port}`;
    const requestHost = request.headers.host;
    if (![localHost, `localhost:${address.port}`, lanHost].includes(requestHost)) {
      return json(response, 403, { error: 'Endereço não autorizado.' });
    }
    const url = new URL(request.url, `http://${requestHost}`);
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('mybots='))?.slice(7);
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const nativeAuth = equal(bearer, token);
    if (request.method === 'GET' && url.pathname === '/' && equal(url.searchParams.get('key'), token)) {
      response.writeHead(303, { Location: '/', 'Set-Cookie': `mybots=${token}; HttpOnly; SameSite=Strict; Path=/` });
      return response.end();
    }
    if (!nativeAuth && !equal(cookie, token)) {
      if (url.pathname.startsWith('/api/')) return json(response, 401, { error: 'Abra o endereço completo mostrado no terminal para acessar seu MyBots.' });
      response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Abra o endereço completo mostrado no terminal onde você iniciou o MyBots.');
    }
    if (request.method !== 'GET' && (request.headers['x-mybots'] !== '1' ||
      (!nativeAuth && request.headers.origin && request.headers.origin !== `http://${requestHost}`))) {
      return json(response, 403, { error: 'Este pedido não veio do MyBots.' });
    }
    try {
      if (request.method === 'GET' && FILES[url.pathname]) {
        const [name, type] = FILES[url.pathname];
        response.writeHead(200, { 'Content-Type': type });
        return response.end(await readFile(join(ROOT, 'public', name)));
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        let defaultSelection = null;
        try { defaultSelection = selectionFor(models); } catch { /* Require an explicit choice if no default is available. */ }
        return json(response, 200, { bots: store.bots.filter(bot => !bot.deletedAt), deletedBots: store.bots.filter(bot => bot.deletedAt), active: [...active.keys()], connection, models, modelsError, defaultSelection,
          device: process.platform === 'android' || process.env.TERMUX_VERSION ? 'No celular' : 'No computador' });
      }
      if (request.method === 'POST' && url.pathname === '/api/connection') {
        modelsLoadedAt = 0;
        await refreshConnection();
        return json(response, 200, connection);
      }
      if (request.method === 'POST' && url.pathname === '/api/sync') {
        if (active.size) return json(response, 409, { error: 'Aguarde as respostas em andamento antes de sincronizar.' });
        const data = await body(request, 20_000_000);
        if (!data || !Array.isArray(data.bots)) throw new Error('O backup enviado pelo celular não tem um formato válido.');
        return json(response, 200, { bots: store.mergeBots(data.bots) });
      }
      if (request.method === 'POST' && url.pathname === '/api/bots') {
        const data = await body(request);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Informe os dados do bot.');
        if (data.model !== undefined || data.reasoningEffort !== undefined) {
          await refreshConnection();
          const selection = selectionFor(models, data);
          return json(response, 201, store.configure(store.create(data), selection));
        }
        return json(response, 201, store.create(data));
      }
      const deleteMatch = url.pathname.match(/^\/api\/bots\/([0-9a-f-]{36})\/delete$/);
      if (request.method === 'POST' && deleteMatch) {
        if (active.has(deleteMatch[1])) return json(response, 409, { error: 'Aguarde a resposta terminar antes de apagar o bot.' });
        store.delete(deleteMatch[1]);
        return json(response, 200, { deleted: true });
      }
      const settingsMatch = url.pathname.match(/^\/api\/bots\/([0-9a-f-]{36})\/settings$/);
      if (request.method === 'POST' && settingsMatch) {
        const bot = store.get(settingsMatch[1]);
        if (!bot || bot.deletedAt) return json(response, 404, { error: 'Bot não encontrado.' });
        if (active.has(bot.id)) return json(response, 409, { error: 'Aguarde a resposta antes de trocar o modelo.' });
        const data = await body(request);
        if (!data || typeof data.model !== 'string') throw new Error('Escolha um modelo.');
        await refreshConnection();
        // Recheck after the catalog refresh: a send might have started while it was loading.
        if (active.has(bot.id)) return json(response, 409, { error: 'Aguarde a resposta antes de trocar o modelo.' });
        return json(response, 200, store.configure(bot, selectionFor(models, data), data));
      }
      const match = url.pathname.match(/^\/api\/bots\/([0-9a-f-]{36})\/messages$/);
      if (request.method === 'POST' && match) {
        const bot = store.get(match[1]);
        if (!bot || bot.deletedAt) return json(response, 404, { error: 'Bot não encontrado.' });
        if (active.has(bot.id)) return json(response, 409, { error: 'Aguarde o bot terminar de responder.' });
        const data = await body(request);
        const text = data?.text;
        if (typeof text !== 'string' || !text.trim() || text.trim().length > 8000) throw new Error('Escreva uma mensagem de até 8.000 caracteres.');
        // Reserve the bot before any await, including the login check.
        const controller = new AbortController();
        active.set(bot.id, controller);
        try {
          await refreshConnection();
          if (!connection.loggedIn) return json(response, 503, { error: connection.message });
          const selection = selectionFor(models, bot);
          if (!bot.model) store.configure(bot, selection);
          const snapshot = { ...bot, ...selection };
          const message = store.addMessage(bot, 'user', text.trim(), 'pending', selection);
          const work = async () => {
            try {
              const reply = await codex.reply(snapshot, message.id, controller.signal);
              if (reply.codexSessionId) bot.codexSessionId = reply.codexSessionId;
              message.status = 'complete';
              store.addMessage(bot, 'assistant', reply.text, 'complete', {
                model: reply.model || selection.model,
                reasoningEffort: reply.reasoningEffort ?? selection.reasoningEffort
              });
            } catch (error) {
              if (error.codexSessionId) bot.codexSessionId = error.codexSessionId;
              message.status = 'error';
              message.error = error.message;
              store.save();
            } finally { active.delete(bot.id); }
          };
          controller.work = work().catch(() => { console.error('Não foi possível salvar o resultado da conversa. Confira o espaço em disco.'); });
          // work owns the reservation from here until the result is persisted.
          return json(response, 202, { messageId: message.id });
        } finally {
          if (!bot.messages.some(message => message.status === 'pending')) active.delete(bot.id);
        }
      }
      return json(response, 404, { error: 'Página não encontrada.' });
    } catch (error) {
      if (response.headersSent) return response.end();
      const status = error.status || (error.code ? 500 : 400);
      json(response, status, { error: status === 500 ? 'Não foi possível salvar os dados. Confira o espaço livre no aparelho.' : error.message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const jobs = [...active.values()];
    for (const controller of jobs) controller.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await Promise.allSettled(jobs.map(controller => controller.work));
    store.close();
  };
  return { server, store, token, refreshConnection, close };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT deve ser um número entre 1024 e 65535.');
  const app = createApp({ directory: resolve(process.env.MYBOTS_DATA_DIR || join(ROOT, '.data')) });
  app.server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Confira se o MyBots já está aberto.` : 'Não foi possível iniciar o MyBots.');
    app.store.close();
    process.exitCode = 1;
  });
  const bind = process.env.MYBOTS_BIND || '127.0.0.1';
  app.server.listen(port, bind, () => {
    const address = process.env.MYBOTS_HOST || '127.0.0.1';
    const access = process.env.MYBOTS_MOBILE === '1'
      ? `API local disponível em http://${address}:${port} (acesso autenticado pelo app).`
      : `Abra neste aparelho:\n  http://127.0.0.1:${port}/?key=${app.token}`;
    console.log(`\n  MyBots · seus bots, suas conversas\n\n  ${access}\n\n  Conversas salvas neste computador. CTRL+C para encerrar.\n`);
    void app.refreshConnection();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close().then(() => process.exit()));
}
