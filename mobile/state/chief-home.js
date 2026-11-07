import { instant } from '../routine-text.js';

// Resolve Home against the latest snapshot so a promotion on another device takes effect here too.
export function destination(data, route = { kind: 'home' }) {
  const chief = data?.bots?.find(bot => bot.isChief && !bot.deletedAt);
  if (route.kind === 'team') return { selected: null, roomId: null, team: true };
  if (route.kind === 'room' && data?.rooms?.some(room => room.id === route.id && !room.deletedAt))
    return { selected: null, roomId: route.id, team: false };
  if (route.kind === 'bot' && data?.bots?.some(bot => bot.id === route.id && !bot.deletedAt))
    return { selected: route.id, roomId: null, team: false };
  return { selected: chief?.id || null, roomId: null, team: false };
}

export function teamStatus(data, now = Date.now()) {
  const bots = (data.bots || []).filter(bot => !bot.deletedAt);
  const waiting = new Set((data.approvals || []).map(item => item.botId));
  const zone = data.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const soon = (data.pendingItems || []).filter(item => {
    if (item.state !== 'open' || !item.due) return false;
    const [date, time] = item.due.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = (time || '00:00').split(':').map(Number);
    const start = instant(year, month - 1, day, hour, minute, zone);
    const end = time ? start : instant(year, month - 1, day + 1, 0, 0, zone) - 1;
    return end >= now && start <= now + 86400000;
  }).length;
  return {
    working: bots.filter(bot => data.active?.includes(bot.id) && !waiting.has(bot.id) && data.presence?.[bot.id]?.online !== false).length,
    waiting: bots.filter(bot => waiting.has(bot.id)).length, soon
  };
}

const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function delegationCards({ data, chats, roomEvents = [] }) {
  const chief = data?.bots?.find(bot => bot.isChief && !bot.deletedAt);
  if (!chief) return [];
  const cards = [];
  for (const room of data.rooms || []) {
    if (!room.botIds?.includes(chief.id) || room.deletedAt) continue;
    const members = data.bots.filter(bot => bot.id !== chief.id && room.botIds.includes(bot.id));
    const messages = new Map();
    // A truncated list preview can cut a longer @name in half.
    const last = room.lastMessage;
    if (last?.id && last.text?.length < 280) messages.set(last.id, last);
    for (const msg of [...(room.messages || []), ...(chats[room.id]?.messages || []), ...roomEvents.filter(e => e.roomId === room.id)]) messages.set(msg.id, msg);
    const requests = new Map();
    for (const msg of messages.values()) {
      if (msg.botId !== chief.id || msg.role !== 'assistant' || msg.status !== 'complete' || msg.progress) continue;
      const text = fold(msg.text || '');
      const targets = members.filter(bot => {
        const name = fold(bot.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(^|[^\\p{L}\\p{N}_])@' + name + '(?![\\p{L}\\p{N}_])', 'u').test(text);
      });
      if (!targets.length) continue;
      requests.set(msg.id, targets);
      cards.push({ id: msg.id, at: msg.createdAt, roomId: room.id, room: room.name, label: 'O Chefe chamou ' + targets.map(bot => bot.name).join(', ') });
    }
    for (const msg of messages.values()) {
      const target = requests.get(msg.replyTo)?.find(bot => bot.id === msg.botId);
      if (target && msg.role === 'assistant' && msg.status === 'complete' && !msg.progress)
        cards.push({ id: msg.id, at: msg.createdAt, roomId: room.id, room: room.name, label: target.name + ' respondeu' });
    }
  }
  return cards.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
}
