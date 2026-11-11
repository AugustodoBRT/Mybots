import { aiBinary } from './ai-runtimes.mjs';
import { command } from './codex.mjs';
import runner from './claude-runner.cjs';

export class Claude {
  // Without a binary given, the IA's current one at each call (an update from the app takes effect without restarting).
  get binary() { return this.fixedBinary || aiBinary('claude'); }
  set binary(value) { this.fixedBinary = value; }
  constructor(binary = null, env = null) { this.fixedBinary = binary; this.env = env; }

  async models() { return runner.CLAUDE_MODELS.map(item => ({ ...item, efforts: [...item.efforts] })); }
  /** "claude-opus-5-5" → "5.5": the version shown next to an alias once a reply confirmed it. */
  static version(modelId) { const match = /^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(modelId || ''); return match ? match[1] + (match[2] ? '.' + match[2] : '') : null; }

  /** The subscription's windows: Claude Code reports them only with a reply, so this asks Haiku for one word. */
  async limits() {
    const reply = await runner.runReply({ model: 'haiku', reasoningEffort: 'low' }, 'Responda só: ok', { binary: this.binary, env: this.env });
    if (!reply.limits) throw new Error('O Claude não informou os limites desta conta.');
    return reply.limits;
  }

  /** The claude.ai connectors of the logged-in account (names and state only; URLs and other servers are left out). */
  async connectors() {
    const { code, stdout } = await command(this.binary, ['mcp', 'list'], { timeout: 60000, env: this.env });
    if (code !== 0) throw new Error('Não consegui consultar os conectores do Claude.');
    return stdout.split('\n').map(line => /^claude\.ai ([^:]{1,60}):.* - (.+)$/.exec(line.trim())).filter(Boolean)
      .map(([, name, state]) => ({ name, connected: /connected/i.test(state) && !/fail|auth/i.test(state), needsAuth: /auth/i.test(state) }));
  }

  async status() {
    try {
      // Only the exit code is used: the JSON output includes the account e-mail.
      const { code } = await command(this.binary, ['auth', 'status'], { timeout: 20000, env: this.env });
      return { available: code !== 127, loggedIn: code === 0,
        message: code === 0 ? 'Claude conectado' : process.env.MYBOTS_EMBEDDED ? 'Conecte uma IA em Ajustes → IAs e contas.' : code === 127 ? 'Instale o Claude Code no Termux para usar o Claude.' : 'Entre no Claude pelo terminal com claude e /login.' };
    } catch (error) {
      return { available: false, loggedIn: false,
        message: error.code === 'ENOENT' ? 'Instale o Claude Code no Termux para usar o Claude.' : 'Não foi possível verificar o login do Claude.' };
    }
  }
}
