import { desktop } from './desktop';
import { plain } from './components/shared';

// The computer's window tells the person when a bot answers and they are not looking at that conversation
// (another conversation or page open, or the window in the background). Clicking it opens the conversation.
const recent = new Map();
export function notifyReply(payload, { snapshot, openKey, open }) {
  if (!desktop || typeof Notification === 'undefined') return;
  const message = payload?.message;
  if (!message || message.role !== 'assistant' || message.status !== 'complete' || message.progress || !String(message.text || '').trim()) return;
  const roomId = payload.roomId || null, botId = message.botId || payload.botId;
  const key = roomId || botId;
  // The answer to a direct message from the Chefe is for the Chefe, not for the person.
  const data = snapshot?.data;
  const chief = data?.bots?.find(bot => bot.isChief);
  if (!roomId && chief && botId !== chief.id && message.replyTo) return;
  if (globalThis.document?.hasFocus?.() && openKey === key) return;
  const bot = data?.bots?.find(item => item.id === botId), room = roomId ? data?.rooms?.find(item => item.id === roomId) : null;
  // One notice at a time per conversation: a bot that writes several messages in a row does not pile them up.
  const now = Date.now(); if (now - (recent.get(key) || 0) < 4000) return; recent.set(key, now);
  try {
    if (Notification.permission === 'default') Notification.requestPermission();
    if (Notification.permission === 'denied') return;
    const text = plain(message.text);
    const notice = new Notification(room ? `${bot?.name || 'Bot'} · ${room.name}` : bot?.name || 'MyBots', { body: text.length > 160 ? text.slice(0, 159) + '…' : text, tag: key, silent: false });
    notice.onclick = () => { try { globalThis.focus(); } catch {} open(roomId ? { room: roomId } : { bot: botId }); notice.close(); };
  } catch {}
}
