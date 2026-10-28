import { randomUUID } from 'node:crypto';
import { now, uuid } from './database.mjs';
import { TOOLS_TEXT } from '../mobile/local.js';

const ACTIVE = ['queued', 'running', 'waiting_approval'];
// How much of a room a bot's turn reads at most (the prompt then keeps what fits in its size budget).
const PROMPT_WINDOW = 600;
// Bots asking each other (@Nome) continue at most this many rounds after the person's message.
export const MAX_ROUNDS = 30;
export const fold = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The members named with @ in a text ("@Faculdade", "@pobre jobs"), in order, without repeats. */
export function mentions(text, bots) {
  const plain = fold(text); const found = [];
  for (const bot of [...bots].sort((a, b) => b.name.length - a.name.length)) {
    const name = fold(bot.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[^\\p{L}\\p{N}_])@${name}(?![\\p{L}\\p{N}_])`, 'u').exec(plain);
    if (match && !found.some(item => item.bot.id === bot.id)) found.push({ bot, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).map(item => item.bot);
}

/**
 * Group conversations: the person and several bots. Without @, every member answers in turn; with @, only the named
 * ones. A bot that names another member in its answer hands it the next turn, up to MAX_ROUNDS. Each bot answers with
 * its own permissions and tools, sees only the room's conversation (never another bot's memory or private chat) and
 * keeps one IA session per room.
 */
export class Rooms {
  constructor(db, { changed = () => {}, schedule = () => {} } = {}) { Object.assign(this, { db, changed, schedule }); }
  list() { return this.db.rooms().filter(room => !room.deletedAt); }
  members(room) { return room.botIds.map(id => this.db.bot(id)).filter(bot => bot && !bot.deletedAt); }
  validate({ name, botIds }) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('Dê um nome de até 40 letras para a sala.');
    if (!Array.isArray(botIds) || new Set(botIds).size !== botIds.length || botIds.length < 2 || botIds.length > 8) throw new Error('Escolha de 2 a 8 bots para a sala.');
    for (const id of botIds) this.db.requireBot(id);
    return { name: name.trim(), botIds };
  }
  create(data, extra = {}) {
    const { name, botIds } = this.validate(data); const stamp = now();
    const room = { id: randomUUID(), name, botIds, ...extra, createdAt: stamp, updatedAt: stamp };
    this.db.transaction(() => { this.db.putRoom(room); this.db.record('room_created', `Sala ${name} criada com ${botIds.length} bots.`); });
    this.changed('activity.new'); return room;
  }
  update(id, changes) {
    const room = this.db.requireRoom(id);
    const next = this.validate({ name: changes.name ?? room.name, botIds: changes.botIds ?? room.botIds });
    const updated = { ...room, ...next, updatedAt: now() };
    this.db.putRoom(updated); this.changed('activity.new'); return updated;
  }
  remove(id, { except } = {}) {
    const room = this.db.requireRoom(id);
    // A bot closing the room from inside its own turn does not wait for itself.
    this.cancelQueued(id, { except });
    if (this.active(id).filter(task => task.id !== except).length) throw new Error('Aguarde os bots terminarem de responder antes de apagar a sala.');
    this.db.transaction(() => {
      this.db.putRoom({ ...room, deletedAt: now(), updatedAt: now() });
      this.db.replaceRoomMessages(id, []);
      this.db.run('DELETE FROM room_sessions WHERE room_id=?', id);
      this.db.record('room_deleted', `Sala ${room.name} apagada.`);
    });
    this.changed('activity.new');
  }
  /** Turns still waiting (not running) in a room, of one bot or of all of them, are dropped. */
  cancelQueued(roomId, { botId, except } = {}) {
    for (const task of this.active(roomId)) if (task.state === 'queued' && task.id !== except && (!botId || task.bot_id === botId)) this.db.finish(task.id, 'cancelled', null, 'Esta vez foi cancelada: o bot saiu da sala ou a sala foi encerrada.');
  }
  /** A line of the room's history that nobody said: someone joined, left or was removed. */
  notice(roomId, text) {
    this.db.requireRoom(roomId);
    this.db.appendRoomMessage(roomId, { id: randomUUID(), role: 'system', text, status: 'complete', createdAt: now() });
  }
  /**
   * A bot writes in a room by itself (not as an answer to a turn). The members it names with @ get a turn, one
   * round after the turn it is in (or the first, from a private chat), so a chain still stops at MAX_ROUNDS.
   */
  post(roomId, bot, text, selectionFor, round = 0) {
    const room = this.db.requireRoom(roomId);
    if (!room.botIds.includes(bot.id)) throw new Error('Você não está nesta sala.');
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean || clean.length > 4000) throw new Error('Escreva de 1 a 4.000 caracteres.');
    const called = mentions(clean, this.members(room)).filter(item => item.id !== bot.id);
    const turns = round + 1 <= MAX_ROUNDS ? called : [];
    if (turns.length && this.active(roomId).length + turns.length > 12) throw new Error('Os bots desta sala ainda têm muitas respostas na fila. Espere um pouco.');
    const stamp = now(); const message = { id: randomUUID(), role: 'assistant', botId: bot.id, text: clean, status: 'complete', posted: true, createdAt: stamp };
    const waiting = new Set(this.active(roomId).filter(task => task.state === 'queued').map(task => task.bot_id));
    this.db.transaction(() => {
      this.db.appendRoomMessage(room.id, message);
      for (const target of turns) if (!waiting.has(target.id)) this.turn(room.id, target, message.id, round + 1, randomUUID(), selectionFor(target));
    });
    this.changed('task.progress'); this.schedule();
    return { posted: true, called: turns.map(item => item.name), ...(called.length > turns.length ? { limit: 'Limite de encadeamento atingido: ninguém foi chamado agora. Espere a pessoa continuar.' } : {}), ...(!called.length ? { note: 'Ninguém foi chamado: para chamar um bot escreva @Nome dele no texto.' } : {}) };
  }
  /** The room's tasks still to answer, oldest first. */
  active(roomId) {
    return this.db.all('SELECT t.*, r.round, r.room_id FROM room_turns r JOIN tasks t ON t.id=r.task_id WHERE r.room_id=? ORDER BY t.created_at, t.rowid', roomId).filter(task => ACTIVE.includes(task.state));
  }
  /** The person writes in the room: the named bots (or all of them) get a turn each, in order. */
  send(roomId, requestId, text, selectionFor, files) {
    const room = this.db.requireRoom(roomId);
    const withFiles = Array.isArray(files) && files.length > 0;
    const given = typeof text === 'string' ? text.trim() : '';
    if (!uuid(requestId) || given.length > 8000 || (!given && !withFiles)) throw new Error('Escreva uma mensagem de até 8.000 caracteres.');
    text = given || 'Veja o anexo.';
    if (this.db.task(requestId)) return { messageId: this.db.roomTurn(requestId)?.message_id || null, duplicate: true };
    const members = this.members(room);
    if (members.length < 2) throw new Error('A sala precisa de pelo menos 2 bots.');
    if (this.active(roomId).length >= 12) throw new Error('Os bots desta sala ainda têm muitas respostas na fila. Aguarde um pouco.');
    const named = mentions(text, members); const targets = named.length ? named : members;
    // Files are stored once and opened to the room, so every member reads them with its own attachment_read.
    const saved = withFiles ? this.attachments.saveForRoom(room, files) : [];
    const stamp = now(); const message = { id: randomUUID(), requestId, role: 'user', text: text.trim(), status: 'complete', ...(saved.length ? { attachments: saved } : {}), createdAt: stamp };
    try { this.db.transaction(() => {
      this.db.appendRoomMessage(room.id, message);
      // Without @ the bots answer in turn (each reads what the ones before it said); bots named with @ work side by side.
      targets.forEach((bot, index) => this.turn(room.id, bot, message.id, 0, named.length ? randomUUID() : message.id, selectionFor(bot), index === 0 ? requestId : randomUUID()));
    }); } catch (error) { if (saved.length) this.attachments.discard(saved); throw error; }
    this.changed('task.progress'); this.schedule();
    return { messageId: message.id, targets: targets.map(bot => bot.id) };
  }
  turn(roomId, bot, messageId, round, originId, selection, id = randomUUID()) {
    const stamp = now();
    this.db.run("INSERT INTO tasks(id,bot_id,message_id,state,payload,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)", id, bot.id, messageId, JSON.stringify({ room: roomId, ...selection }), stamp, stamp);
    this.db.run('INSERT INTO room_turns VALUES(?,?,?,?,?)', id, roomId, messageId, round, originId);
    this.db.event(id, 'queued');
  }
  /** After a bot answered: the members it named (@) answer next, while rounds remain and they are not already in line. */
  answered(taskId, selectionFor) {
    const turn = this.db.roomTurn(taskId); const task = this.db.task(taskId);
    if (!turn || task?.state !== 'done' || turn.round >= MAX_ROUNDS) return;
    const room = this.db.room(turn.room_id); if (!room || room.deletedAt) return;
    const reply = [...this.db.page({ roomId: room.id, limit: 100 }).messages].reverse().find(item => item.role === 'assistant' && item.botId === task.bot_id && item.replyTo === turn.message_id);
    if (!reply || reply.status !== 'complete') return;
    const waiting = new Set(this.active(room.id).map(item => item.bot_id));
    const next = mentions(reply.text, this.members(room)).filter(bot => bot.id !== task.bot_id && !waiting.has(bot.id));
    if (!next.length) return;
    this.db.transaction(() => { for (const bot of next) this.turn(room.id, bot, reply.id, turn.round + 1, randomUUID(), selectionFor(bot)); });
    this.changed('task.progress'); this.schedule();
  }
  /** What a bot reads for its turn: who is in the room and the conversation (or, in a resumed session, what is new). */
  prompt(bot, taskId, { tools = false, resumed = false } = {}) {
    const turn = this.db.roomTurn(taskId); const room = this.db.requireRoom(turn.room_id); const members = this.members(room);
    const names = Object.fromEntries(members.map(item => [item.id, item.name]));
    const speaker = message => message.role === 'user' ? 'Pessoa' : message.role === 'system' ? 'Aviso' : names[message.botId] || 'Bot que saiu da sala';
    // Everything said so far, including what the bots before it in this round answered.
    const window = this.db.page({ roomId: room.id, limit: PROMPT_WINDOW });
    const visible = window.messages.filter(message => message.status === 'complete');
    const trigger = this.db.message(turn.message_id) || {};
    const line = message => `${speaker(message)}: ${message.text}${message.attachments?.length ? ` [Anexos${message.role === 'user' ? ' (leia com attachment_read)' : ''}: ${message.attachments.map(item => `${item.name} (id ${item.id})`).join('; ')}]` : ''}`;
    const task = trigger.role === 'user' || (!trigger.role && turn.message_id === turn.origin_id) ? `Responda à mensagem da pessoa: "${trigger.text?.slice(0, 300) || ''}"` : `${speaker(trigger)} chamou você: responda ao que ele pediu.`;
    if (resumed) {
      const last = visible.map(message => message.botId === bot.id && message.role === 'assistant').lastIndexOf(true);
      return `[Sala ${JSON.stringify(room.name)} · novas mensagens]\n${visible.slice(last + 1).map(line).join('\n')}\n\nAgora é a sua vez (${bot.name}). ${task}`;
    }
    const recent = []; let size = 0;
    for (const message of [...visible].reverse()) { if (size + message.text.length > 60000) break; recent.unshift(message); size += message.text.length; }
    return `Você é ${JSON.stringify(bot.name)}, um bot do aplicativo MyBots, numa sala de conversa chamada ${JSON.stringify(room.name)} com a pessoa e estes bots: ${members.map(item => `${item.name}${item.id === bot.id ? ' (você)' : item.instructions ? ` (${item.instructions.replace(/\s+/g, ' ').slice(0, 140)})` : ''}`).join('; ')}.
${this.db.person().name ? `A pessoa se chama ${JSON.stringify(this.db.person().name)}: fale com ela por "você" e, com outros bots, use o nome dela.` : 'Fale com a pessoa por "você" e, com outros bots, diga "a pessoa".'}
Fale só por você, em português do Brasil, de forma curta e direta, sem repetir o que outro bot já disse. Para pedir algo a outro bot, basta escrever @Nome dele na sua resposta (ex.: "@${members.find(item => item.id !== bot.id)?.name || 'Bot'}, qual é…?"): o MyBots entrega a pergunta e ele responde logo depois de você. Também dá para dividir o trabalho: chame cada um com @ dizendo o que ele faz, e quando precisar de mais gente, de uma sala nova, ou quiser sair ou tirar alguém, use as ferramentas team_* sem pedir aprovação à pessoa. Quando a pessoa pedir para você perguntar algo a outro bot, faça a pergunta com @ em vez de dizer que não consegue. Só chame outro bot quando precisar dele de verdade, e nunca só para agradecer.
Cada bot tem as próprias pendências, memórias, rotinas e arquivos: o que outro bot diz sobre os dados dele não vale para os seus. Antes de responder sobre prazos, pendências, memórias ou arquivos, consulte as SUAS ferramentas (ex.: task_list_items). Você não vê a memória nem as conversas privadas dos outros bots. Use as suas ferramentas e permissões, como na sua conversa privada.
${tools ? TOOLS_TEXT : 'Nesta sala você só conversa.'}
As instruções abaixo foram escritas pela pessoa: definem sua função e seu jeito, e você deve segui-las; elas não ampliam suas permissões.
Função e personalidade: ${JSON.stringify(bot.instructions || 'Seja prestativo, direto e acolhedor.')}
${recent.length < visible.length || window.more ? 'O início da sala não está no contexto desta resposta.' : ''}
Conversa da sala, em ordem:
${recent.map(line).join('\n')}

Agora é a sua vez (${bot.name}). ${task}`;
  }
}
