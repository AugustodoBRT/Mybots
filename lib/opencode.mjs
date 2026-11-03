import opencodeRunner from './opencode-runner.cjs';

/** opencode: it works with whatever providers the person set up (`opencode auth login`), including its free models. */
export class Opencode {
  constructor(binary = process.env.OPENCODE_BIN || 'opencode', env = null) { this.binary = binary; this.env = env; this.cache = null; }
  async models({ refresh = false } = {}) {
    if (!refresh && this.cache && Date.now() - this.cache.at < 300000) return this.cache.models.map(item => ({ ...item, efforts: [...item.efforts] }));
    const models = await opencodeRunner.discoverModels(this.binary, { env: this.env }); this.cache = { at: Date.now(), models };
    return models.map(item => ({ ...item, efforts: [...item.efforts] }));
  }
  async status() {
    try { await this.models({ refresh: true }); return { available: true, loggedIn: true, message: 'opencode conectado' }; }
    catch (error) {
      const missing = error.code === 'ENOENT' || error.code === 127;
      return { available: !missing, loggedIn: false, message: missing ? 'Instale o opencode para usá-lo.' : 'Configure um provedor no opencode com opencode auth login.' };
    }
  }
}
