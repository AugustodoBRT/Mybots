// Opt-in check: one real Codex request, using the account already logged in on this device.
import { Codex } from '../lib/codex.mjs';
import { selectionFor } from '../lib/models.mjs';

const codex = new Codex();
const status = await codex.status();
if (!status.loggedIn) throw new Error(status.message);
const selection = selectionFor(await codex.models(), process.env.MYBOTS_EFFORT ? {
  model: process.env.MYBOTS_MODEL, reasoningEffort: process.env.MYBOTS_EFFORT
} : {});
const bot = { ...selection, name: 'Teste', instructions: 'Seja breve.', messages: [
  { id: 'one', role: 'user', text: 'Meu apelido nesta conversa é Pingo.', status: 'complete' },
  { id: 'two', role: 'assistant', text: 'Combinado, Pingo.', status: 'complete' },
  { id: 'three', role: 'user', text: 'Qual é meu apelido? Responda somente o apelido.', status: 'pending' }
] };
const reply = await codex.reply(bot, 'three');
if (!reply.text.includes('Pingo')) throw new Error('O Codex respondeu, mas o teste de contexto não passou.');
console.log(`Conversa real com Codex: OK. Contexto entre mensagens: OK. Modelo: ${reply.model}; raciocínio: ${reply.reasoningEffort}.`);
