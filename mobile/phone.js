import { readTermuxJson } from './termux-data.js';
import { createId, emptyLocalStore, promptFor } from './local.js';

export const activePhoneBots = store => store.bots.filter(bot => !bot.deletedAt && bot.messages.some(message => message.status === 'pending' || message.awaitingResponse)).map(bot => bot.id);

export function createPhoneClient({ read, write, run, onStore = () => {} }) {
  let queue = Promise.resolve(), recovering = false;
  const update = change => {
    const work = queue.then(async () => {
      const store = (await read()) || emptyLocalStore();
      const next = change(store);
      await write(next);
      onStore(next);
      return next;
    });
    queue = work.catch(() => {});
    return work;
  };
  const recover = async () => {
    if (recovering) return;
    recovering = true;
    try {
      const store = await read();
      for (const bot of (store?.bots || []).filter(item => !item.deletedAt)) {
        for (const message of bot.messages.filter(item => item.awaitingResponse || item.status === 'pending')) {
          let response;
          if (!message.requestId) response = { status: 'error', error: 'Esta resposta antiga foi interrompida. Tente novamente.' };
          else {
            response = await readTermuxJson(run, 'recover', { requestId: message.requestId });
            if (response.requestId !== message.requestId) throw new Error('O Termux devolveu outro pedido.');
            if (response.status === 'running') continue;
            if (response.status === 'missing') {
              if (Date.now() < message.responseDeadline) continue;
              response = { ...response, status: 'error', error: 'O pedido não foi encontrado no Termux. Tente novamente.' };
            }
          }
          if (!['complete', 'error'].includes(response.status) || (response.status === 'complete' && (!response.text?.trim() || !response.codexSessionId))) {
            throw new Error('O resultado salvo no Termux está incompleto.');
          }
          await update(current => ({ ...current, bots: current.bots.map(item => {
            if (item.id !== bot.id) return item;
            const pending = item.messages.find(value => value.id === message.id);
            if (!pending || (!pending.awaitingResponse && pending.status !== 'pending')) return item;
            const now = new Date().toISOString();
            const messages = item.messages.map(value => value.id === message.id ? { ...value, awaitingResponse: false,
              status: response.status === 'complete' ? 'complete' : 'error', error: response.error } : value);
            if (response.status === 'complete' && !messages.some(value => value.id === message.requestId)) {
              messages.push({ id: message.requestId, role: 'assistant', text: response.text, status: 'complete',
                model: response.model, reasoningEffort: response.reasoningEffort, createdAt: now });
            }
            return { ...item, ...(response.codexSessionId ? { codexSessionId: response.codexSessionId } : {}), updatedAt: now, messages };
          }) }));
        }
      }
    } finally { recovering = false; }
  };
  const send = async (botId, text, selection, onPending = () => {}) => {
    const requestId = createId(), messageId = createId(), now = new Date().toISOString();
    let workingBot;
    await update(store => {
      const bot = store.bots.find(item => item.id === botId);
      if (!bot || bot.deletedAt || activePhoneBots(store).includes(botId)) throw new Error('Aguarde a resposta atual terminar.');
      const message = { id: messageId, requestId, role: 'user', text: text.trim(), status: 'pending', awaitingResponse: true,
        ...selection, createdAt: now, responseDeadline: Date.now() + (['max', 'ultra'].includes(selection.reasoningEffort) ? 680000 : 260000) };
      workingBot = { ...bot, ...selection, updatedAt: now, messages: [...bot.messages, message] };
      return { ...store, mode: 'phone', bots: store.bots.map(item => item.id === botId ? workingBot : item) };
    });
    onPending();
    try {
      const result = await run('reply', { requestId, prompt: promptFor(workingBot, messageId), codexSessionId: workingBot.codexSessionId, ...selection });
      if (result.exitCode !== 0 || result.errorMessage) throw new Error('O Termux não confirmou o pedido. A resposta salva será conferida novamente.');
      await recover();
    } catch (error) {
      // A callback timeout does not mean the Termux process stopped; keep recovery enabled.
      const notStarted = ['TERMUX_PERMISSION', 'TERMUX_MISSING', 'TERMUX_REQUEST', 'TERMUX_START', 'MYBOTS_NOT_READY'].includes(error.code);
      await update(store => ({ ...store, bots: store.bots.map(bot => bot.id !== botId ? bot : { ...bot,
        messages: bot.messages.map(message => message.id !== messageId || !message.awaitingResponse ? message : {
          ...message, status: 'error', error: error.message, awaitingResponse: !notStarted }) }) }));
      throw error;
    }
  };
  return { update, recover, send };
}
