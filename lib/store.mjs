import { validateProfile } from '../supervisor/tool-policy.mjs';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.file = join(directory, 'bots.json');
    this.lockFile = join(directory, 'store.lock');
    this.lock();
    try {
      try {
        this.bots = JSON.parse(readFileSync(this.file, 'utf8'));
        if (!Array.isArray(this.bots) || this.bots.some(bot => !bot.id || !Array.isArray(bot.messages))) {
          throw new Error('Formato inválido');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('Não foi possível ler bots.json. Seus dados foram preservados; confira o arquivo antes de reiniciar.');
        this.bots = [];
      }
      // A process interruption must never leave a conversation permanently busy.
      for (const bot of this.bots) {
        for (const message of bot.messages) {
          if (message.status === 'pending') {
            message.status = 'error';
            message.error = 'O app foi encerrado antes da resposta. Envie a mensagem novamente.';
          }
        }
      }
      this.save();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  lock() {
    try {
      const descriptor = openSync(this.lockFile, 'wx', 0o600);
      writeFileSync(descriptor, String(process.pid));
      closeSync(descriptor);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(this.lockFile, 'utf8'));
      if (!Number.isInteger(pid) || pid < 1) throw new Error('O arquivo store.lock é inválido. Confira se outro MyBots está aberto.');
      try {
        process.kill(pid, 0);
      } catch (checkError) {
        if (checkError.code !== 'ESRCH') throw checkError;
        unlinkSync(this.lockFile);
        return this.lock();
      }
      throw new Error('Já existe um MyBots usando esta pasta de dados.');
    }
  }

  close() { unlinkSync(this.lockFile); }

  save() {
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify(this.bots, null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.file);
  }

  create({ name, instructions = '', color = 'green', avatar = 'orbit', autonomy = 'ask' }) {
    validateProfile({ avatar, autonomy });
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('Escolha um nome de até 40 caracteres.');
    if (typeof instructions !== 'string' || instructions.length > 2000) throw new Error('As instruções devem ter até 2.000 caracteres.');
    if (!['green', 'blue', 'purple', 'orange'].includes(color)) throw new Error('Escolha uma das cores disponíveis.');
    const now = new Date().toISOString();
    const bot = { id: randomUUID(), name: name.trim(), instructions: instructions.trim(), color, avatar, autonomy,
      createdAt: now, updatedAt: now, messages: [] };
    this.bots.push(bot);
    try { this.save(); } catch (error) { this.bots.pop(); throw error; }
    return bot;
  }

  get(id) { return this.bots.find(bot => bot.id === id); }

  delete(id) {
    const bot = this.get(id);
    if (!bot || bot.deletedAt) throw new Error('Bot não encontrado.');
    if (bot.messages.some(message => message.status === 'pending')) throw new Error('Aguarde a resposta terminar antes de apagar o bot.');
    const index = this.bots.indexOf(bot);
    this.bots[index] = { ...bot, deletedAt: new Date().toISOString(), messages: [], codexSessionId: undefined };
    try { this.save(); } catch (error) { this.bots[index] = bot; throw error; }
  }

  configure(bot, { model, reasoningEffort }, changes = {}) {
    validateProfile(changes);
    const previous = { ...bot };
    const updated = { ...bot, model, reasoningEffort, updatedAt: new Date().toISOString() };
    for (const field of ['name','instructions','color','avatar','autonomy']) if (changes[field] !== undefined) updated[field] = changes[field];
    if (typeof updated.name !== 'string' || !updated.name.trim() || updated.name.trim().length > 40 || typeof updated.instructions !== 'string' || updated.instructions.length > 2000 || !['green','blue','purple','orange'].includes(updated.color)) throw new Error('Perfil inválido.');
    updated.name = updated.name.trim(); updated.instructions = updated.instructions.trim();
    if (updated.name !== bot.name || updated.instructions !== bot.instructions) updated.codexSessionId = undefined;
    Object.assign(bot, updated);
    try { this.save(); } catch (error) { for (const key of Object.keys(bot)) delete bot[key]; Object.assign(bot, previous); throw error; }
    return bot;
  }

  addMessage(bot, role, text, status = 'complete', settings = {}) {
    const previous = bot.updatedAt;
    const message = { id: randomUUID(), role, text, status, ...settings, createdAt: new Date().toISOString() };
    bot.messages.push(message);
    bot.updatedAt = message.createdAt;
    try { this.save(); } catch (error) { bot.messages.pop(); bot.updatedAt = previous; throw error; }
    return message;
  }

  mergeBots(incoming) {
    const fail = () => { throw new Error('O backup enviado pelo celular não tem um formato válido.'); };
    const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const validId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
    if (!Array.isArray(incoming) || incoming.length > 200) fail();
    const next = new Map(this.bots.map(bot => [bot.id, structuredClone(bot)]));
    for (const source of incoming) {
      validateProfile(source || {});
      if (!source || !validId(source.id) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 40 ||
        typeof source.instructions !== 'string' || source.instructions.length > 2000 ||
        !['green', 'blue', 'purple', 'orange'].includes(source.color) || !validDate(source.createdAt) || !validDate(source.updatedAt) ||
        !Array.isArray(source.messages) || source.messages.length > 2000) fail();
      if (source.model !== undefined && (typeof source.model !== 'string' || source.model.length > 120)) fail();
      if (source.reasoningEffort !== undefined && source.reasoningEffort !== null && typeof source.reasoningEffort !== 'string') fail();
      const existing = next.get(source.id);
      const messages = new Map((existing?.messages || []).map(message => [message.id, message]));
      for (const message of source.messages) {
        if (!message || !validId(message.id) || !['user', 'assistant'].includes(message.role) ||
          typeof message.text !== 'string' || message.text.length > 500_000 ||
          !['pending', 'complete', 'error'].includes(message.status) || !validDate(message.createdAt)) fail();
        const value = { id: message.id, role: message.role, text: message.text,
          status: message.status === 'pending' ? 'error' : message.status, createdAt: message.createdAt };
        if (message.error && typeof message.error === 'string') value.error = message.error.slice(0, 2000);
        if (typeof message.model === 'string' && message.model.length <= 120) value.model = message.model;
        if (typeof message.reasoningEffort === 'string' && message.reasoningEffort.length <= 40) value.reasoningEffort = message.reasoningEffort;
        const old = messages.get(value.id);
        const rank = item => ({ pending: 0, error: 1, complete: 2 }[item.status] || 0);
        if (!old || rank(value) > rank(old)) messages.set(value.id, value);
      }
      if (source.deletedAt !== undefined && !validDate(source.deletedAt)) fail();
      if (source.restoredAt !== undefined && !validDate(source.restoredAt)) fail();
      const restoredAt = [existing?.restoredAt, source.restoredAt].filter(Boolean).sort().at(-1);
      const deletion = [existing?.deletedAt, source.deletedAt].filter(Boolean).sort().at(-1);
      const deletedAt = deletion && (!restoredAt || deletion > restoredAt) ? deletion : undefined;
      const newer = !existing || source.updatedAt > existing.updatedAt ? source : existing;
      next.set(source.id, { id: source.id, name: newer.name.trim(), instructions: newer.instructions.trim(), color: newer.color, ...(newer.avatar ? { avatar: newer.avatar } : {}), ...(newer.autonomy ? { autonomy: newer.autonomy } : {}),
        createdAt: existing?.createdAt || source.createdAt, updatedAt: [existing?.updatedAt, source.updatedAt].filter(Boolean).sort().at(-1),
        ...((newer.model ?? existing?.model) === undefined ? {} : { model: newer.model ?? existing.model }),
        ...(newer.reasoningEffort === undefined && existing?.reasoningEffort === undefined ? {} : { reasoningEffort: newer.reasoningEffort === undefined ? existing.reasoningEffort : newer.reasoningEffort }),
        ...(existing?.codexSessionId ? { codexSessionId: existing.codexSessionId } : {}),
        ...(deletedAt ? { deletedAt, codexSessionId: undefined } : {}), ...(restoredAt ? { restoredAt } : {}),
        messages: deletedAt ? [] : [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    }
    const previous = this.bots;
    this.bots = [...next.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    try { this.save(); } catch (error) { this.bots = previous; throw error; }
    return this.bots;
  }
}
