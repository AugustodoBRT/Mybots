// A conversation with the Chefe is split in sessions, like chats in Claude: every message carries the session it belongs to
// (the supervisor stamps it), a new one begins when the app is opened and something is said, or with /clear, and picking an old
// one continues it. What came before sessions existed is one session called "base". The name is a short title the IA wrote after
// the first answer (kept in the line that opened the session); until then, the start of the first thing the person said.
const HIDDEN = /^(Nova sessão iniciada ao abrir o app|Sessão retomada)/;
/** The lines that only mark a session (opened by the app, picked again): not shown in the chat. */
export const openedLine = message => message?.role === 'system' && HIDDEN.test(message.text || '');

const short = text => {
  const one = (text || '').replace(/\s+/g, ' ').trim();
  return one ? (one.length > 56 ? one.slice(0, 55).trimEnd() + '…' : one) : 'Conversa sem título';
};

/** Newest activity first. `messages` oldest first, as the chat holds them. Each has { id, title, at, last, count, messages }. */
export function sessionsOf(messages) {
  const groups = new Map();
  for (const message of messages) {
    const id = message.session || 'base';
    let group = groups.get(id);
    if (!group) groups.set(id, group = { id, title: '', messages: [] });
    group.messages.push(message);
    if (message.title && !group.title) group.title = String(message.title);
  }
  const out = [];
  for (const group of groups.values()) {
    const real = group.messages.filter(item => item.role !== 'system');
    if (!real.length) continue;
    const first = real.find(item => item.role === 'user' && (item.text || '').trim());
    out.push({ id: group.id, title: group.title || short(first?.text), at: real[0].createdAt, last: real[real.length - 1].createdAt, count: real.length, messages: group.messages });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}
