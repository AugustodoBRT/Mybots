import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { Passwords } from '../supervisor/passwords.mjs';
import { createSync } from '../pc/sync.mjs';

const BOT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const made = async t => { const dir = await mkdtemp(join(tmpdir(), 'mybots-pw-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const clock = () => { let now = 1000; const tick = () => (now += 10); tick.set = value => { now = value; }; return Object.assign(() => tick(), { set: value => { now = value; } }); };

test('the computer vault keeps logins encrypted on disk, lists them without the password and finds them by site, subdomain and bot', async t => {
  const dir = await made(t); const vault = new Passwords(dir);
  vault.save({ site: 'https://sig.cefetmg.br/sigaa/x', username: 'ana', password: 'segredo-123', bots: [BOT] });
  vault.save({ site: 'exemplo.com', username: '', password: 'outra' });
  assert.deepEqual(vault.list().map(item => [item.host, item.username, 'password' in item]), [['sig.cefetmg.br', 'ana', false], ['exemplo.com', '', false]]);
  assert.ok(!(await readFile(join(dir, 'secrets', 'passwords.enc'), 'utf8')).includes('segredo-123'));
  assert.equal((await stat(join(dir, 'secrets', 'passwords.key'))).mode & 0o077, 0);
  assert.equal(vault.forPage(BOT, 'https://sig.cefetmg.br/sigaa/verTelaLogin.do;jsessionid=A.B').password, 'segredo-123');
  assert.equal(vault.forPage(BOT, 'https://www.sig.cefetmg.br/').username, 'ana');
  assert.equal(vault.forPage(OTHER, 'https://sig.cefetmg.br/'), null, 'only the bots the person chose');
  assert.equal(vault.forPage(BOT, 'http://sig.cefetmg.br/'), null, 'https only');
  assert.equal(vault.forPage(BOT, 'https://evilsig.cefetmg.br.outro.com/'), null);
  assert.equal(vault.forPage(OTHER, 'https://exemplo.com/').password, 'outra', 'a login for every bot');
  assert.equal(new Passwords(dir).forPage(BOT, 'https://exemplo.com/').password, 'outra', 'reopened from disk');
  assert.throws(() => vault.save({ site: 'não é site', password: 'x' }), /endereço do site/);
  assert.throws(() => vault.save({ site: 'a.com', password: '' }), /senha/);
});

test('the envelope for the browser worker opens only with its private key and carries the page and challenge', async t => {
  const dir = await made(t); const vault = new Passwords(dir);
  const entry = vault.save({ site: 'sig.cefetmg.br', username: 'ana', password: 'p4ss' }); assert.ok(entry.id);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const challenge = 'c'.repeat(32), url = 'https://sig.cefetmg.br/login';
  const box = vault.envelope(vault.forPage(BOT, url), { url, challenge, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') });
  assert.deepEqual(Object.keys(box).sort(), ['data', 'iv', 'key', 'tag']);
  // The same steps pc/browser-worker.mjs takes.
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(box.key, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64')); decipher.setAAD(Buffer.from(challenge)); decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString());
  assert.deepEqual(saved, { url, challenge, username: 'ana', password: 'p4ss' });
  const wrong = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64')); wrong.setAAD(Buffer.from('d'.repeat(32))); wrong.setAuthTag(Buffer.from(box.tag, 'base64'));
  assert.throws(() => { wrong.update(Buffer.from(box.data, 'base64')); wrong.final(); });
  assert.equal(constants.RSA_PKCS1_OAEP_PADDING, 4);
});

test('two vaults become one: the newest change per site and user wins, deletions travel, and merging again changes nothing', async t => {
  const a = new Passwords(await made(t), clock()), b = new Passwords(await made(t), clock());
  a.save({ site: 'sig.cefetmg.br', username: 'ana', password: 'velha' });
  a.save({ site: 'so-no-a.com', username: 'x', password: 'a' });
  b.save({ site: 'so-no-b.com', username: 'y', password: 'b' });
  const exchange = () => { const fromB = b.merge(a.export()); a.merge(fromB); };
  exchange();
  assert.deepEqual(a.list().map(item => item.host).sort(), b.list().map(item => item.host).sort());
  assert.equal(a.list().length, 3);
  // B changes the password later; A deletes another login later still.
  b.save({ site: 'sig.cefetmg.br', username: 'ana', password: 'nova' });
  a.remove(a.list().find(item => item.host === 'so-no-a.com').id);
  exchange();
  assert.equal(a.forPage(BOT, 'https://sig.cefetmg.br/').password, 'nova');
  assert.equal(b.forPage(BOT, 'https://sig.cefetmg.br/').password, 'nova');
  for (const vault of [a, b]) assert.deepEqual(vault.list().map(item => item.host).sort(), ['sig.cefetmg.br', 'so-no-b.com']);
  assert.equal(b.merge(a.export()).changed, false); assert.equal(a.merge(b.export()).changed, false);
  // Saving again after a deletion brings the login back everywhere.
  a.save({ site: 'so-no-a.com', username: 'x', password: 'de-novo' }); exchange();
  assert.equal(b.forPage(BOT, 'https://so-no-a.com/').password, 'de-novo');
  // Rubbish from the other side is ignored.
  assert.equal(a.merge({ entries: [{ host: 'ok.com', username: 'u', password: '' }, { host: 'x', username: 'u', password: 'p' }, null], gone: [5] }).changed, false);
});

test('the sync round also meets the two vaults, and a phone app that is closed is not an error', async t => {
  const local = new Passwords(await made(t), clock()), phoneVault = new Passwords(await made(t), clock());
  phoneVault.save({ site: 'sig.cefetmg.br', username: 'ana', password: 'do-celular' });
  local.save({ site: 'do-pc.com', username: 'bob', password: 'do-pc' });
  let open = true; const logged = [];
  const side = (name, handlers) => ({ online: () => true, async call(method, params) { if (method === 'sync.status') return { device: name, schema: 1, counter: 0 }; if (method === 'sync.changes') return { changes: [], next: 0, more: false }; if (method === 'sync.mark' || method === 'sync.apply' || method === 'sync.have') return {}; if (handlers[method]) return handlers[method](params); throw new Error('método ' + method); } });
  const phone = side('phone', { 'passwords.sync': params => { if (!open) throw new Error('O app do celular não está aberto agora.'); return phoneVault.merge(params); } });
  const pc = side('local', { 'passwords.export': () => local.export(), 'passwords.merge': params => local.merge(params) });
  const sync = createSync({ directory: await made(t), phone, local: pc, log: line => logged.push(line), intervalMs: 3600000 });
  t.after(() => sync.close());
  open = false; await sync.now(); assert.equal(local.list().length, 1); assert.deepEqual(logged.filter(line => /Senhas/.test(line)), []);
  open = true; await sync.now();
  assert.deepEqual(local.list().map(item => item.host).sort(), ['do-pc.com', 'sig.cefetmg.br']);
  assert.deepEqual(phoneVault.list().map(item => item.host).sort(), ['do-pc.com', 'sig.cefetmg.br']);
});
