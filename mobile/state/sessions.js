// A conversation with the Chefe is split in sessions: each time the app is opened and the first message is sent, or the
// person writes /clear, a system line says a new session began. The session's name comes from what the person said first.
const GAP = 6 * 3600 * 1000;
const START = /^Nova sessão (iniciada ao abrir o app|da IA iniciada a pedido)/;
export const OPENED_LINE = 'Nova sessão iniciada ao abrir o app. A conversa, as memórias e as pendências continuam; só as mensagens mais recentes vão para a sessão nova.';
export const startsSession = message => message?.role === 'system' && START.test(message.text || '');
export const openedLine = message => message?.role === 'system' && /^Nova sessão iniciada ao abrir o app/.test(message.text || '');

const title = messages => {
  const first = messages.find(item => item.role === 'user' && (item.text || '').trim());
  const text = (first?.text || '').replace(/\s+/g, ' ').trim();
  return text ? (text.length > 56 ? text.slice(0, 55).trimEnd() + '…' : text) : 'Conversa sem título';
};

/** Newest first. `messages` oldest first, as the chat holds them. */
export function sessionsOf(messages) {
  const out = []; let current = [];
  const close = () => { const real = current.filter(item => item.role !== 'system'); if (real.length) out.push({ id: real[0].id, title: title(real), at: real[0].createdAt, count: real.length, messages: current }); current = []; };
  // Conversations from before the sessions began have no dividing line: a pause of six hours or more splits them.
  let before = NaN;
  for (const message of messages) {
    const at = Date.parse(message.createdAt);
    if (startsSession(message) || (Number.isFinite(before) && Number.isFinite(at) && at - before > GAP)) close();
    current.push(message); if (Number.isFinite(at)) before = at;
  }
  close();
  return out.reverse();
}
