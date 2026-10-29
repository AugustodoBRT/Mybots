import { useSyncExternalStore } from 'react';
import { appStore } from './state/store';
import { createDirector } from '../lib/mimo-mood.mjs';

// Feeds lib/mimo-mood.mjs with what the app knows about each bot (working, waiting for a decision, offline, the reply being written,
// the latest message) and tells the faces which expression to wear. Starts when the first face asks, stops when the last one leaves.
const director = createDirector(); const listeners = new Set(); const roomSeen = new Map(); let unsubscribe = null, timer = null;
const notify = () => listeners.forEach(listener => listener());

function feed() {
  const { data, drafts } = appStore.getSnapshot(); if (!data?.bots) return;
  let changed = false;
  for (const bot of data.bots) {
    if (bot.deletedAt) continue;
    const asleep = data.presence?.[bot.id]?.online === false, waiting = Boolean(data.approvals?.some(item => item.botId === bot.id)), working = Boolean(data.active?.includes(bot.id)) && !asleep;
    let draft = drafts?.[bot.id]?.length || 0; for (const key in drafts || {}) if (key.endsWith(':' + bot.id)) draft = Math.max(draft, drafts[key].length);
    const last = bot.lastMessage ? { id: bot.lastMessage.id, role: bot.lastMessage.role, status: bot.lastMessage.status, origin: bot.lastMessage.origin } : null;
    const before = director.moodOf(bot.id); if (director.observe(bot.id, { working, waiting, asleep, draft, last }) !== before) changed = true;
  }
  // a bot that answers in a room: its own chat does not change, the room's latest message does
  for (const room of data.rooms || []) {
    const last = room.lastMessage; if (!last?.id) continue;
    if (roomSeen.has(room.id) && roomSeen.get(room.id) !== last.id && last.role === 'assistant' && last.botId) { const before = director.moodOf(last.botId); if (director.spoke(last.botId, last) !== before) changed = true; }
    roomSeen.set(room.id, last.id);
  }
  if (changed) notify();
}
function start() { if (unsubscribe) return; feed(); unsubscribe = appStore.subscribe(feed); timer = setInterval(() => { if (director.tick().length) notify(); }, 250); }
function stop() { unsubscribe?.(); unsubscribe = null; clearInterval(timer); timer = null; }
function subscribe(listener) { listeners.add(listener); start(); return () => { listeners.delete(listener); if (!listeners.size) stop(); }; }

/** The expression a bot wears now ('normal', 'trabalhando', 'falando'…), or null for something that is not a bot of the app. */
export const useBotMood = id => useSyncExternalStore(subscribe, () => (id ? director.moodOf(id) : null), () => null);
export const moodDirector = director;
