import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, randomBytes, randomUUID, constants } from 'node:crypto';
import { join } from 'node:path';

const GONE_DAYS = 90;
const UUID = /^[0-9a-fA-F-]{36}$/;
const keyOf = item => `${item.host}\n${item.username}`;
const stamp = item => Number(item.updatedAt ?? item.createdAt ?? 0) || 0;

/** "https://sig.cefetmg.br/sigaa/x" or "sig.cefetmg.br" → "sig.cefetmg.br". */
export function hostOf(site) {
  const text = String(site || '').trim();
  let host = '';
  try { host = new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase().replace(/\.$/, ''); } catch {}
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new Error('Informe o endereço do site, como sig.cefetmg.br.');
  return host;
}

/**
 * The saved site logins of this computer (the phone keeps its own in the Android Keystore). Both are the same vault to the
 * person: the node moves the entries between them whenever they see each other (`merge`), newest change per site and user
 * wins, and a deleted login leaves a mark so it is deleted on the other side too. The file is AES-256-GCM, its key a
 * file next to it, both inside ~/.mybots-pc, which the bots' sandbox shows empty. Only the browser worker ever fills a
 * password into a page; the model never receives one.
 */
export class Passwords {
  constructor(directory, now = () => Date.now()) {
    this.folder = join(directory, 'secrets'); this.now = now;
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    this.keyFile = join(this.folder, 'passwords.key'); this.dataFile = join(this.folder, 'passwords.enc');
    if (!existsSync(this.keyFile)) { writeFileSync(this.keyFile + '.tmp', randomBytes(32), { mode: 0o600 }); renameSync(this.keyFile + '.tmp', this.keyFile); }
    try { chmodSync(this.keyFile, 0o600); } catch {}
    this.key = readFileSync(this.keyFile);
  }
  load() {
    try {
      const box = JSON.parse(readFileSync(this.dataFile, 'utf8'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(box.iv, 'base64')); decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
      const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
      return { entries: Array.isArray(data.entries) ? data.entries : [], gone: Array.isArray(data.gone) ? data.gone : [] };
    } catch { return { entries: [], gone: [] }; }
  }
  store(state) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    writeFileSync(this.dataFile + '.tmp', JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
    renameSync(this.dataFile + '.tmp', this.dataFile);
  }
  /** What a screen may show: site, user and bots; never the password. */
  list() { return this.load().entries.map(({ id, host, username, bots, createdAt }) => ({ id, host, username, bots, createdAt })); }
  save({ site, username = '', password, bots = null }) {
    const host = hostOf(site);
    if (typeof username !== 'string' || username.length > 200 || typeof password !== 'string' || !password || password.length > 500) throw new Error('Preencha a senha (até 500 caracteres) e o usuário (até 200).');
    if (bots !== null && (!Array.isArray(bots) || bots.some(id => typeof id !== 'string' || !UUID.test(id)))) throw new Error('Bot inválido.');
    const state = this.load(); const at = this.now();
    const entry = { id: randomUUID(), host, username, password, bots, createdAt: at, updatedAt: at };
    state.entries = [...state.entries.filter(item => keyOf(item) !== keyOf(entry)), entry];
    state.gone = state.gone.filter(item => keyOf(item) !== keyOf(entry));
    this.store(state); return { id: entry.id, host, username };
  }
  remove(id) {
    const state = this.load(); const found = state.entries.find(item => item.id === id); if (!found) return false;
    state.entries = state.entries.filter(item => item !== found);
    state.gone = [...state.gone.filter(item => keyOf(item) !== keyOf(found)), { host: found.host, username: found.username, updatedAt: this.now() }];
    this.store(state); return true;
  }
  /** Everything, passwords included, for the other vault of the same person (phone ↔ computer). Never for a bot. */
  export() { return this.load(); }
  /** Takes the other side's entries and deletions in; newest change per site and user wins. Returns the merged whole and whether this side changed. */
  merge(incoming) {
    const state = this.load();
    const entries = new Map(state.entries.map(item => [keyOf(item), item])), gone = new Map(state.gone.map(item => [keyOf(item), item]));
    let changed = false;
    const clean = item => item && typeof item.host === 'string' && typeof item.username === 'string' && item.username.length <= 200 && /^[a-z0-9.-]{3,253}$/.test(item.host);
    for (const item of Array.isArray(incoming?.entries) ? incoming.entries.slice(0, 5000) : []) {
      if (!clean(item) || typeof item.password !== 'string' || !item.password || item.password.length > 500) continue;
      const bots = item.bots === null || item.bots === undefined ? null : Array.isArray(item.bots) ? item.bots.filter(id => typeof id === 'string' && UUID.test(id)) : null;
      const next = { id: UUID.test(String(item.id)) ? item.id : randomUUID(), host: item.host, username: item.username, password: item.password, bots, createdAt: Number(item.createdAt) || stamp(item), updatedAt: stamp(item) };
      const key = keyOf(next), mine = entries.get(key), mark = gone.get(key);
      if ((mine && stamp(mine) >= next.updatedAt) || (mark && stamp(mark) >= next.updatedAt)) continue;
      entries.set(key, next); gone.delete(key); changed = true;
    }
    for (const item of Array.isArray(incoming?.gone) ? incoming.gone.slice(0, 5000) : []) {
      if (!clean(item)) continue;
      const key = keyOf(item), at = stamp(item), mine = entries.get(key), mark = gone.get(key);
      if (mine && stamp(mine) >= at) continue;
      if (mine) { entries.delete(key); changed = true; }
      if (!mark || stamp(mark) < at) { gone.set(key, { host: item.host, username: item.username, updatedAt: at }); changed = true; }
    }
    const old = this.now() - GONE_DAYS * 86400000;
    const merged = { entries: [...entries.values()], gone: [...gone.values()].filter(item => stamp(item) > old) };
    if (changed) this.store(merged);
    return { changed, ...merged };
  }
  /** The login a bot may use on this page (https only, the saved site or one of its subdomains, only the bots the person chose), or null. */
  forPage(botId, url) {
    let uri; try { uri = new URL(String(url)); } catch { return null; }
    if (uri.protocol !== 'https:') return null;
    const host = uri.hostname.toLowerCase().replace(/\.$/, '');
    return this.load().entries.filter(item => host === item.host || host.endsWith('.' + item.host))
      .filter(item => !Array.isArray(item.bots) || item.bots.includes(botId))
      .sort((a, b) => b.host.length - a.host.length)[0] || null;
  }
  /** The one-use envelope only the browser worker can open (its public key and the challenge came with the request). */
  envelope(entry, { url, challenge, publicKey }) {
    const key = randomBytes(32), iv = randomBytes(12);
    const bytes = Buffer.from(JSON.stringify({ url, challenge, username: entry.username, password: entry.password }), 'utf8');
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(challenge, 'utf8'));
      const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
      const rsa = publicEncrypt({ key: createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
      return { key: rsa.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    } finally { bytes.fill(0); key.fill(0); }
  }
}
