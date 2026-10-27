// The open conversations of the app and the events that change them, without asking the supervisor for the state.
// `chats` holds the loaded pages of each bot or room: { [botId | roomId]: { messages, before, more } }.

/** Whether an event continues what the app has seen: a numbered event must be the next one (`last` null: none yet). */
export const inSequence = (last, seq) => typeof seq !== 'number' || last === null || last === undefined || seq === last + 1;

/** A page from chat.page: the latest one replaces what was loaded, an older one goes on top without repeats. */
export function addPage(chats, key, page, older = false) {
  const current = chats[key];
  if (!older || !current) return { ...chats, [key]: { messages: page.messages, before: page.before, more: page.more } };
  const known = new Set(current.messages.map(message => message.id));
  return { ...chats, [key]: { messages: [...page.messages.filter(message => !known.has(message.id)), ...current.messages], before: page.before ?? current.before, more: page.more } };
}

/** message.added / message.updated on a loaded conversation; others are left alone (they load when opened). */
export function applyMessage(chats, event, { botId, roomId, message } = {}) {
  const key = botId || roomId; const chat = key && chats[key];
  if (!chat || !message?.id) return chats;
  const index = chat.messages.findIndex(item => item.id === message.id);
  if (index >= 0) return { ...chats, [key]: { ...chat, messages: chat.messages.map((item, at) => at === index ? message : item) } };
  return event === 'message.added' ? { ...chats, [key]: { ...chat, messages: [...chat.messages, message] } } : chats;
}

/**
 * The same event on the lists (home, sidebar): the latest message, the count, the unseen ones and the order.
 * `open` is the conversation on screen, whose new messages are already seen.
 */
export function applyToLists(data, event, { botId, roomId, message } = {}, open = null) {
  if (!data || !message?.id) return data;
  const update = item => {
    const added = event === 'message.added';
    const latest = item.lastMessage;
    const shown = roomId && message.role === 'system' ? latest : added || latest?.id === message.id ? message : latest;
    return { ...item, lastMessage: shown, ...(added ? { messageCount: (item.messageCount || 0) + 1, updatedAt: message.createdAt > (item.updatedAt || '') ? message.createdAt : item.updatedAt,
      unread: (botId || roomId) === open || message.role === 'user' ? item.unread || 0 : Math.min((item.unread || 0) + 1, 100) } : {}) };
  };
  if (botId && data.bots?.some(bot => bot.id === botId)) return { ...data, bots: data.bots.map(bot => bot.id === botId ? update(bot) : bot) };
  if (roomId && data.rooms?.some(room => room.id === roomId)) return { ...data, rooms: data.rooms.map(room => room.id === roomId ? update(room) : room).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')) };
  return data;
}

/** bot.updated: the bot's new profile (with its list summary); a deleted bot leaves the list. */
export function applyBot(data, { botId, bot } = {}) {
  if (!data?.bots || !botId) return data;
  const rest = data.bots.filter(item => item.id !== botId);
  if (!bot || bot.deletedAt) return { ...data, bots: rest };
  return { ...data, bots: [...rest, bot].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')) };
}

/** task.progress with a step: what the bot is doing now, shown under its name. */
export function applyStep(data, { taskId, step } = {}) {
  if (!data?.tasks?.some(task => task.id === taskId)) return data;
  return { ...data, tasks: data.tasks.map(task => { if (task.id !== taskId) return task; const { step: old, ...rest } = task; return step ? { ...rest, step } : rest; }) };
}
