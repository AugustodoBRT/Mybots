import { aiBinary } from './ai-runtimes.mjs';
import agyRunner from './agy-runner.cjs';

/** Antigravity (agy): its login is the Google account made with `agy`; if the models list, the account is in. */
export class Agy {
  // Without a binary given, the IA's current one at each call (an update from the app takes effect without restarting).
  get binary() { return this.fixedBinary || aiBinary('agy'); }
  set binary(value) { this.fixedBinary = value; }
  constructor(binary = null, env = null) { this.fixedBinary = binary; this.env = env; this.cache = null; }
  async models({ refresh = false } = {}) {
    if (!refresh && this.cache && Date.now() - this.cache.at < 300000) return this.cache.models.map(item => ({ ...item, efforts: [...item.efforts] }));
    const models = await agyRunner.discoverModels(this.binary, { env: this.env }); this.cache = { at: Date.now(), models };
    return models.map(item => ({ ...item, efforts: [...item.efforts] }));
  }
  async status() {
    try { await this.models({ refresh: true }); return { available: true, loggedIn: true, message: 'Antigravity conectado' }; }
    catch (error) {
      const missing = error.code === 'ENOENT' || error.code === 127;
      return { available: !missing, loggedIn: false, message: missing ? 'Instale o Antigravity (agy) para usá-lo.' : 'Entre no Antigravity pelo terminal com agy.' };
    }
  }
}
