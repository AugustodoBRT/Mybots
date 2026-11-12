#!/usr/bin/env node
// Os relatos do MyBots: quem usa o app manda um pedido de melhoria ou um problema (texto e, se quiser, uma foto) e o dono
// lê tudo numa página protegida por senha. É um serviço à parte do relé, que continua só encaminhando bytes cifrados.
//
//   POST /relatos/enviar          aberto (o app manda daqui); limites por endereço, por dia e de espaço em disco
//   GET  /relatos                 a página do dono (senha)
//   GET  /relatos/api/lista       os relatos (senha)
//   GET  /relatos/foto/<id>       a foto de um relato (senha)
//   POST /relatos/api/estado      novo / visto / resolvido (senha)
//   POST /relatos/api/apagar      apaga um relato (senha)
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIMITS = { body: 8 * 1024 * 1024, image: 5 * 1024 * 1024, text: 4000, perHour: 6, perDay: 300, disk: 1024 * 1024 * 1024, failures: 10 };
const STATES = ['novo', 'visto', 'resolvido'];
const PLATFORMS = ['android', 'pc', 'iphone', 'web'];
const ID = /^[0-9]{13}-[a-f0-9]{8}$/;
const IMAGES = { 'image/jpeg': [[0xff, 0xd8, 0xff]], 'image/png': [[0x89, 0x50, 0x4e, 0x47]], 'image/webp': [[0x52, 0x49, 0x46, 0x46]] };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const here = dirname(fileURLToPath(import.meta.url));
const clip = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';

export function createReports({ dir, password, port = 3241, host = '127.0.0.1', limits = {}, now = () => Date.now(), log = () => {} } = {}) {
  if (!dir) throw new Error('Falta a pasta dos relatos.');
  if (!password || password.length < 10) throw new Error('A senha da página precisa ter 10 caracteres ou mais.');
  const max = { ...LIMITS, ...limits };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const secret = createHash('sha256').update(password).digest();
  const sent = new Map();      // endereço -> horários dos últimos envios
  const failed = new Map();    // endereço -> horários das senhas erradas
  let day = { start: now(), count: 0 };

  const recent = (map, address, window) => { const list = (map.get(address) || []).filter(time => now() - time < window); map.set(address, list); return list; };
  const authorized = (request, address) => {
    if (recent(failed, address, 15 * 60000).length >= max.failures) return 'blocked';
    const header = String(request.headers.authorization || '');
    const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':') : '';
    if (given && timingSafeEqual(createHash('sha256').update(given).digest(), secret)) return 'ok';
    if (given) failed.get(address).push(now());
    return 'no';
  };
  const file = id => join(dir, id + '.json');
  const read = id => { try { return JSON.parse(readFileSync(file(id), 'utf8')); } catch { return null; } };
  const write = (id, report) => { const temp = file(id) + '.tmp'; writeFileSync(temp, JSON.stringify(report), { mode: 0o600 }); renameSync(temp, file(id)); };
  const all = () => readdirSync(dir).filter(name => name.endsWith('.json')).map(name => read(name.slice(0, -5))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const remove = report => { rmSync(file(report.id), { force: true }); if (report.image) rmSync(join(dir, report.image.file), { force: true }); };
  const used = () => readdirSync(dir).reduce((sum, name) => { try { return sum + statSync(join(dir, name)).size; } catch { return sum; } }, 0);
  // Sem espaço, os resolvidos mais antigos saem primeiro; os que você ainda não leu nunca são apagados sozinhos.
  const makeRoom = need => {
    let total = used(); if (total + need <= max.disk) return true;
    for (const report of all().filter(item => item.state === 'resolvido').reverse()) { remove(report); total = used(); if (total + need <= max.disk) return true; }
    return false;
  };

  const send = (response, status, body, headers = {}) => {
    const json = !headers['Content-Type'];
    response.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : headers['Content-Type'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    response.end(json ? JSON.stringify(body) : body);
  };
  const body = request => new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    request.on('data', chunk => { size += chunk.length; if (size > max.body) { reject(Object.assign(new Error('Relato grande demais.'), { status: 413 })); request.destroy(); } else parts.push(chunk); });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(Object.assign(new Error('Relato inválido.'), { status: 400 })); } });
    request.on('error', reject);
  });
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };

  async function receive(request, response, address) {
    if (now() - day.start > 86400000) day = { start: now(), count: 0 };
    if (recent(sent, address, 3600000).length >= max.perHour || day.count >= max.perDay) return send(response, 429, { error: 'Muitos relatos seguidos. Tente de novo mais tarde.' }, CORS);
    const input = await body(request);
    const text = clip(input?.text, max.text);
    if (!text) return send(response, 400, { error: 'Escreva o que aconteceu ou o que você gostaria.' }, CORS);
    let image = null;
    if (input.image) {
      const mime = String(input.image.mime || '').toLowerCase(); const data = Buffer.from(String(input.image.data || ''), 'base64');
      if (!IMAGES[mime] || !IMAGES[mime].some(magic => magic.every((byte, index) => data[index] === byte))) return send(response, 400, { error: 'A foto precisa ser JPG, PNG ou WebP.' }, CORS);
      if (data.length > max.image) return send(response, 413, { error: 'A foto é grande demais.' }, CORS);
      image = { mime, data };
    }
    if (!makeRoom((image?.data.length || 0) + text.length + 1000)) return send(response, 507, { error: 'A caixa de relatos está cheia agora. Tente de novo mais tarde.' }, CORS);
    const id = `${now()}-${randomBytes(4).toString('hex')}`;
    const report = { id, createdAt: new Date(now()).toISOString(), state: 'novo', text,
      version: clip(input.version, 40), platform: PLATFORMS.includes(input.platform) ? input.platform : 'web', device: clip(input.device, 120) };
    if (image) { report.image = { file: `${id}.${EXT[image.mime]}`, mime: image.mime, size: image.data.length }; writeFileSync(join(dir, report.image.file), image.data, { mode: 0o600 }); }
    write(id, report);
    sent.get(address).push(now()); day.count++;
    log(`Relato novo (${report.platform}${image ? ', com foto' : ''}).`);
    send(response, 201, { ok: true, id }, CORS);
  }

  const page = name => readFileSync(join(here, name), 'utf8');
  const SECURITY = { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

  const server = createServer(async (request, response) => {
    // Atrás do Caddy toda conexão vem do próprio servidor: o endereço real é o que ele anotou.
    let address = request.socket.remoteAddress || '';
    if (/^(127\.|::1$|::ffff:127\.)/.test(address)) { const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (/^[0-9a-f.:]{3,45}$/i.test(forwarded)) address = forwarded; }
    const path = new URL(request.url, 'http://relatos').pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/relatos/enviar') {
        if (request.method === 'OPTIONS') return send(response, 204, '', { ...CORS, 'Content-Type': 'text/plain' });
        if (request.method !== 'POST') return send(response, 405, { error: 'Use POST.' }, CORS);
        return await receive(request, response, address);
      }
      if (!path.startsWith('/relatos')) return send(response, 404, { error: 'Não encontrado.' });
      const auth = authorized(request, address);
      if (auth === 'blocked') return send(response, 429, { error: 'Senha errada vezes demais. Espere 15 minutos.' });
      if (auth !== 'ok') return send(response, 401, 'Entre com a senha dos relatos.', { 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Basic realm="Relatos do MyBots", charset="UTF-8"' });
      if (request.method === 'GET' && path === '/relatos') return send(response, 200, page('reports-panel.html'), { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY });
      if (request.method === 'GET' && path === '/relatos/painel.js') return send(response, 200, page('reports-panel.js'), { 'Content-Type': 'text/javascript; charset=utf-8', ...SECURITY });
      if (request.method === 'GET' && path === '/relatos/painel.css') return send(response, 200, page('reports-panel.css'), { 'Content-Type': 'text/css; charset=utf-8', ...SECURITY });
      if (request.method === 'GET' && path === '/relatos/api/lista') return send(response, 200, { reports: all(), used: used(), limit: max.disk });
      if (request.method === 'GET' && path.startsWith('/relatos/foto/')) {
        const id = path.slice('/relatos/foto/'.length); const report = ID.test(id) && read(id);
        if (!report?.image) return send(response, 404, { error: 'Sem foto.' });
        return send(response, 200, readFileSync(join(dir, report.image.file)), { 'Content-Type': report.image.mime, 'Content-Disposition': 'inline', ...SECURITY });
      }
      if (request.method === 'POST' && (path === '/relatos/api/estado' || path === '/relatos/api/apagar')) {
        // Um site qualquer não consegue mandar este cabeçalho sem a permissão de CORS, que estas rotas não dão.
        if (request.headers['x-relatos'] !== '1') return send(response, 403, { error: 'Pedido recusado.' });
        const input = await body(request); const report = ID.test(input?.id) && read(input.id);
        if (!report) return send(response, 404, { error: 'Relato não encontrado.' });
        if (path.endsWith('/apagar')) { remove(report); return send(response, 200, { ok: true }); }
        if (!STATES.includes(input.state)) return send(response, 400, { error: 'Estado inválido.' });
        write(report.id, { ...report, state: input.state }); return send(response, 200, { ok: true });
      }
      send(response, 404, { error: 'Não encontrado.' });
    } catch (error) { if (!response.headersSent) send(response, error.status || 500, { error: error.status ? error.message : 'Algo deu errado.' }, path === '/relatos/enviar' ? CORS : {}); }
  });
  server.requestTimeout = 60000;
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { log(`Relatos do MyBots na porta ${server.address().port}.`); resolve(server.address().port); }); }),
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.MYBOTS_REPORTS_DIR || join(process.env.HOME || '.', 'mybots-relatos');
  const passwordFile = process.env.MYBOTS_REPORTS_PASSWORD_FILE;
  const password = passwordFile && existsSync(passwordFile) ? readFileSync(passwordFile, 'utf8').trim() : process.env.MYBOTS_REPORTS_PASSWORD;
  try {
    const reports = createReports({ dir, password, port: Number(process.env.MYBOTS_REPORTS_PORT) || 3241, log: line => console.log(line) });
    await reports.listen();
    const stop = () => reports.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) { console.error('Não foi possível iniciar os relatos:', error.message); process.exit(1); }
}
