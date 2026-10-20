import { command } from './codex.mjs';
import runner from './claude-runner.cjs';

export class Claude {
  constructor(binary = process.env.CLAUDE_BIN || 'claude') { this.binary = binary; }

  async models() { return runner.CLAUDE_MODELS.map(item => ({ ...item, efforts: [...item.efforts] })); }

  /** The claude.ai connectors of the logged-in account (names and state only; URLs and other servers are left out). */
  async connectors() {
    const { code, stdout } = await command(this.binary, ['mcp', 'list'], { timeout: 60000 });
    if (code !== 0) throw new Error('Não consegui consultar os conectores do Claude.');
    return stdout.split('\n').map(line => /^claude\.ai ([^:]{1,60}):.* - (.+)$/.exec(line.trim())).filter(Boolean)
      .map(([, name, state]) => ({ name, connected: /connected/i.test(state) && !/fail|auth/i.test(state), needsAuth: /auth/i.test(state) }));
  }

  async status() {
    try {
      // Only the exit code is used: the JSON output includes the account e-mail.
      const { code } = await command(this.binary, ['auth', 'status'], { timeout: 20000 });
      return { available: code !== 127, loggedIn: code === 0,
        message: code === 0 ? 'Claude conectado' : code === 127 ? 'Instale o Claude Code no Termux para usar o Claude.' : 'Entre no Claude pelo terminal com claude e /login.' };
    } catch (error) {
      return { available: false, loggedIn: false,
        message: error.code === 'ENOENT' ? 'Instale o Claude Code no Termux para usar o Claude.' : 'Não foi possível verificar o login do Claude.' };
    }
  }
}
