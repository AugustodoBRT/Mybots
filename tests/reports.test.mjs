import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReports } from '../relay/reports.mjs';

const PASSWORD = 'senha-de-teste-123';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const auth = (password = PASSWORD) => ({ Authorization: 'Basic ' + Buffer.from('dono:' + password).toString('base64') });

async function setup(t, limits) {
  const dir = await mkdtemp(join(tmpdir(), 'mybots-relatos-'));
  const reports = createReports({ dir, password: PASSWORD, port: 0, limits });
  const base = `http://127.0.0.1:${await reports.listen()}`;
  t.after(async () => { await reports.close(); await rm(dir, { recursive: true, force: true }); });
  const send = body => fetch(base + '/relatos/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { dir, base, send };
}

test('relato com foto chega, aparece só com a senha e muda de estado', async t => {
  const { base, send, dir } = await setup(t);
  const sent = await send({ text: 'O botão de enviar sumiu', image: { mime: 'image/png', data: PNG.toString('base64') }, version: '0.94.2', platform: 'android', device: 'Pixel' });
  assert.equal(sent.status, 201); assert.equal(sent.headers.get('access-control-allow-origin'), '*');
  const { id } = await sent.json();
  assert.equal((await fetch(base + '/relatos/api/lista')).status, 401);
  assert.equal((await fetch(base + '/relatos/api/lista', { headers: auth('errada-errada') })).status, 401);
  const list = await (await fetch(base + '/relatos/api/lista', { headers: auth() })).json();
  assert.equal(list.reports.length, 1);
  assert.deepEqual({ ...list.reports[0], createdAt: undefined, image: undefined }, { id, createdAt: undefined, image: undefined, state: 'novo', text: 'O botão de enviar sumiu', version: '0.94.2', platform: 'android', device: 'Pixel' });
  const photo = await fetch(base + '/relatos/foto/' + id, { headers: auth() });
  assert.equal(photo.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PNG);
  // Sem o cabeçalho próprio (um site qualquer tentando usar a senha guardada no navegador), nada muda.
  assert.equal((await fetch(base + '/relatos/api/estado', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id, state: 'visto' }) })).status, 403);
  const post = (path, body) => fetch(base + '/relatos/api/' + path, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'X-Relatos': '1' }, body: JSON.stringify(body) });
  assert.equal((await post('estado', { id, state: 'resolvido' })).status, 200);
  assert.equal((await (await fetch(base + '/relatos/api/lista', { headers: auth() })).json()).reports[0].state, 'resolvido');
  assert.equal((await post('apagar', { id })).status, 200);
  assert.deepEqual(await readdir(dir), []);
  const page = await fetch(base + '/relatos', { headers: auth() });
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/); assert.match(await page.text(), /Relatos/);
});

test('relato sem texto, foto falsa e envio em excesso são recusados', async t => {
  const { send } = await setup(t, { perHour: 2 });
  assert.equal((await send({ text: '   ' })).status, 400);
  assert.equal((await send({ text: 'oi', image: { mime: 'image/png', data: Buffer.from('<script>').toString('base64') } })).status, 400);
  assert.equal((await send({ text: 'um' })).status, 201);
  assert.equal((await send({ text: 'dois' })).status, 201);
  assert.equal((await send({ text: 'três' })).status, 429);
});

test('sem espaço, os resolvidos mais antigos saem e os novos ficam', async t => {
  const { base, send } = await setup(t, { disk: 2500 });
  const first = (await (await send({ text: 'a'.repeat(900) })).json()).id;
  await fetch(base + '/relatos/api/estado', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'X-Relatos': '1' }, body: JSON.stringify({ id: first, state: 'resolvido' }) });
  assert.equal((await send({ text: 'b'.repeat(900) })).status, 201);
  const list = await (await fetch(base + '/relatos/api/lista', { headers: auth() })).json();
  assert.deepEqual(list.reports.map(item => item.text[0]), ['b']);
  assert.equal((await send({ text: 'c'.repeat(900) })).status, 507);
});
