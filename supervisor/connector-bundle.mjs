import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Connector libraries are too large for the RUN_COMMAND bridge. The app sends this bundle over the
// authenticated WebSocket; only the exact file whose hash ships in the core package is accepted.
export class ConnectorBundle {
  constructor(directory, pinned = readFileSync(new URL('./connectors.sha256', import.meta.url), 'utf8').trim()) {
    if (!/^[0-9a-f]{64}$/.test(pinned)) throw new Error('Hash do pacote de conectores inválido.');
    this.pinned = pinned;
    this.folder = join(directory, 'runtime');
    this.file = join(this.folder, `connectors-${pinned}.mjs`);
  }
  get installed() { return existsSync(this.file); }
  status() { return { installed: this.installed, hash: this.pinned }; }
  install(base64) {
    if (typeof base64 !== 'string' || base64.length > 8_000_000) throw new Error('Pacote de conectores inválido.');
    const bytes = Buffer.from(base64, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== this.pinned) throw new Error('O pacote de conectores não confere com esta versão do MyBots. Nada foi instalado.');
    const source = gunzipSync(bytes, { maxOutputLength: 20_000_000 });
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    writeFileSync(this.file + '.tmp', source, { mode: 0o600 }); renameSync(this.file + '.tmp', this.file);
    return this.status();
  }
  async load() {
    if (!this.installed) throw Object.assign(new Error('Os conectores ainda estão sendo instalados. Abra o MyBots para concluir.'), { code: 'CONNECTORS_MISSING' });
    this.module ||= import(pathToFileURL(this.file).href);
    return this.module;
  }
}
