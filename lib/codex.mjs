import cli from './cli-bin.cjs';
import { discoverModels, readLimits } from './models.mjs';

import runner from './codex-runner.cjs';
import { promptFor } from '../mobile/local.js';
export { promptFor } from '../mobile/local.js';
export const chatArguments = runner.chatArguments;

export function command(binary, args, { input, cwd, timeout = 180000, signal, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = cli.spawnCli(binary, args, null, { cwd, stdio: ['pipe', 'pipe', 'pipe'], signal, ...(env ? { env: { ...process.env, ...env } } : {}) });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    let killTimer;
    const stop = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    timer.unref();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', error => {
      if (error.name === 'AbortError') return; // Wait for close after cancellation so cleanup happens after the process exits.
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop); reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
      if (timedOut) reject(new Error('O Codex demorou mais que o esperado. Tente enviar a mensagem novamente.'));
      else if (signal?.aborted) reject(new Error('A resposta foi interrompida.'));
      else resolve({ code, stdout, stderr });
    });
    signal?.addEventListener('abort', stop, { once: true });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

export function friendlyError(output) {
  if (/401|unauthorized|not logged in|sign in|not authenticated/i.test(output)) return 'Entre no Codex pelo terminal com codex login e tente novamente.';
  if (/usage.limit|quota|rate.limit|limit reached|insufficient_quota/i.test(output)) return 'O limite de uso da sua conta foi atingido. Confira os limites do Codex antes de tentar novamente.';
  if (/model.*not.*(support|available|exist)|not.*access.*model|unsupported.*(model|reasoning)|reasoning.*not.*support|invalid.*reasoning/i.test(output)) return 'A conta recusou este modelo ou nível de raciocínio. Escolha outra combinação e tente novamente.';
  if (/network|connection|dns|resolve|request failed|stream disconnected/i.test(output)) return 'O Codex não conseguiu se conectar. Confira a internet e tente novamente.';
  if (/unexpected argument|unrecognized|unknown flag/i.test(output)) return 'Esta versão do Codex não aceita a configuração de conversa. Atualize o Codex e tente novamente.';
  return 'O Codex não conseguiu concluir a resposta. Confira codex login status no terminal e tente novamente.';
}

export class Codex {
  // `env` points the command at one account's login folder (lib/accounts.mjs); without it the Codex's own login is used.
  constructor(binary = process.env.CODEX_BIN || 'codex', env = null) { this.binary = binary; this.env = env; }

  models() { return discoverModels(this.binary, { env: this.env }); }
  limits() { return readLimits(this.binary, { env: this.env }); }

  async status() {
    try {
      const { code } = await command(this.binary, ['login', 'status'], { timeout: 10000, env: this.env });
      return { available: true, loggedIn: code === 0,
        message: code === 0 ? 'Codex conectado' : 'Faça login no terminal com codex login.' };
    } catch (error) {
      return { available: error.code !== 'ENOENT', loggedIn: false,
        message: error.code === 'ENOENT' ? 'Instale o Codex neste aparelho para conversar.' : 'Não foi possível verificar o login do Codex.' };
    }
  }

  async reply(bot, messageId, signal) {
    try {
      if (!bot.model) throw new Error('Escolha um modelo antes de conversar.');
      return await runner.runReply(bot, promptFor(bot, messageId), { binary: this.binary, signal, env: this.env });
    } catch (error) {
      if (error.output) error.message = friendlyError(error.output);
      if (error.code === 'ENOENT') error.message = 'O comando codex não foi encontrado. Instale o Codex neste aparelho.';
      throw error;
    }
  }
}
