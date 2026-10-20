import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';

const NAME = /^[a-z0-9-]{1,40}$/;

// Secrets are AES-256-GCM files outside every bot workspace. The key lives in the app's Android
// Keystore-backed storage and only reaches the supervisor in memory, after WebSocket authentication.
export class Vault {
  constructor(directory) {
    this.folder = join(directory, 'secrets');
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    this.key = null;
  }
  get locked() { return !this.key; }
  seal(key, value) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
  }
  open(key, text) {
    const box = JSON.parse(text); const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  }
  /** Returns true when the key opened existing secrets, false when they were set aside for a new key. */
  unlock(encoded) {
    const key = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
    if (!key || key.length !== 32) throw new Error('Chave de segredos inválida.');
    const check = join(this.folder, 'check.enc');
    let matched = true;
    if (existsSync(check)) {
      try { this.open(key, readFileSync(check, 'utf8')); }
      catch {
        // A reinstalled app has a new key: keep the unreadable files aside instead of deleting them.
        matched = false;
        const aside = join(this.folder, `orphaned-${Date.now()}`); mkdirSync(aside, { mode: 0o700 });
        for (const file of readdirSync(this.folder)) if (file.endsWith('.enc')) renameSync(join(this.folder, file), join(aside, file));
      }
    }
    if (!existsSync(check)) this.writeFile(check, this.seal(key, 'mybots'));
    this.key = key;
    return matched;
  }
  writeFile(path, text) { writeFileSync(path + '.tmp', text, { mode: 0o600 }); renameSync(path + '.tmp', path); }
  path(name) { if (!NAME.test(name)) throw new Error('Nome de segredo inválido.'); return join(this.folder, name + '.enc'); }
  write(name, value) {
    if (this.locked) throw new Error('Abra o MyBots para liberar as credenciais.');
    this.writeFile(this.path(name), this.seal(this.key, value));
  }
  read(name) {
    if (this.locked) throw new Error('Abra o MyBots para liberar as credenciais.');
    const path = this.path(name);
    return existsSync(path) ? this.open(this.key, readFileSync(path, 'utf8')) : null;
  }
  remove(name) { rmSync(this.path(name), { force: true }); }
}
