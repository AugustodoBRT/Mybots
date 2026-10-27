import { addPage, applyMessage, applyToLists, applyBot, applyStep, inSequence } from '../chat-events.js';

// Preserve references for unchanged slices, including fresh state.get responses.
export function share(previous, next) {
  if (Object.is(previous, next) || !previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return next;
  const keys = Object.keys(next); let same = keys.length === Object.keys(previous).length;
  const result = Array.isArray(next) ? [] : {};
  for (const key of keys) { result[key] = share(previous[key], next[key]); if (!Object.hasOwn(previous, key) || result[key] !== previous[key]) same = false; }
  return same ? previous : result;
}

export function createStore() {
  let state = { data: null, chats: {} }; let seq = null;
  const listeners = new Set();
  const update = patch => { const next = share(state, { ...state, ...patch }); if (next === state) return; state = next; for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setData(value) {
      const data = typeof value === 'function' ? value(state.data) : value;
      const known = data?.supervisorConnected && new Set([...(data.bots || []), ...(data.rooms || [])].map(item => item.id));
      update({ data, ...(known ? { chats: Object.fromEntries(Object.entries(state.chats).filter(([id]) => known.has(id))) } : {}) });
    },
    setChats: value => update({ chats: typeof value === 'function' ? value(state.chats) : value }),
    sequence: value => { seq = value; },
    page: (key, page, older = false) => update({ chats: addPage(state.chats, key, page, older) }),
    event(event, payload, open) {
      if (typeof payload?.seq === 'number') {
        if (seq !== null && payload.seq <= seq) return { duplicate: true };
        if (!inSequence(seq, payload.seq)) return { gap: true };
        seq = payload.seq;
      }
      if (event === 'message.added' || event === 'message.updated') {
        const key = payload.botId || payload.roomId;
        const exists = state.chats[key]?.messages.some(message => message.id === payload.message?.id) || [...(state.data?.bots || []), ...(state.data?.rooms || [])].find(item => item.id === key)?.lastMessage?.id === payload.message?.id;
        update({ chats: applyMessage(state.chats, event, payload), data: applyToLists(state.data, exists ? 'message.updated' : event, payload, open) });
      }
      else if (event === 'bot.updated') {
        const chats = { ...state.chats };
        if (!payload.bot || payload.bot.deletedAt) delete chats[payload.botId];
        update({ data: applyBot(state.data, payload), chats });
      } else if (event === 'task.progress' && 'step' in payload) update({ data: applyStep(state.data, payload) });
      return {};
    }
  };
}

export const appStore = createStore();
const withoutSummary = ({ lastMessage, messageCount, unread, updatedAt, messages, ...item }) => item;
const withoutStep = ({ step, ...task }) => task;

// Navigation and settings do not subscribe to message lists or tool steps.
export const selectShell = ({ data }) => data && ({ ...data, seq: undefined,
  bots: data.bots?.map(withoutSummary).sort((a, b) => a.id.localeCompare(b.id)),
  rooms: data.rooms?.map(withoutSummary).sort((a, b) => a.id.localeCompare(b.id)), tasks: data.tasks?.map(withoutStep) });
export const selectHome = ({ data }) => data && ({ ...data, seq: undefined, tasks: data.tasks?.map(withoutStep) });

export const selectConversation = (key, isRoom = false) => ({ data, chats }) => {
  if (!data) return null;
  const room = isRoom ? data.rooms?.find(item => item.id === key) : null;
  const bots = data.bots?.filter(bot => room ? room.botIds.includes(bot.id) : bot.id === key) || [];
  const ids = new Set(bots.map(bot => bot.id));
  const pick = source => Object.fromEntries(Object.entries(source || {}).filter(([id]) => ids.has(id)));
  const chat = chats[key]; const item = room || bots[0];
  const context = { models: data.models, defaultSelection: data.defaultSelection, connections: data.connections, connection: data.connection, modelsError: data.modelsError,
    bots, nodes: data.nodes, presence: pick(data.presence), active: data.active?.filter(id => ids.has(id)),
    tasks: data.tasks?.filter(task => isRoom ? room?.activeTasks?.includes(task.id) : task.bot_id === key),
    approvals: data.approvals?.filter(approval => isRoom ? room?.activeTasks?.includes(approval.taskId) : approval.botId === key),
    activity: data.activity?.filter(activity => ids.has(activity.bot_id)),
    browser: Object.fromEntries(['pages', 'help', 'control'].map(name => [name, pick(data.browser?.[name])])) };
  return { [isRoom ? 'room' : 'bot']: item && { ...item, messages: item.messages || chat?.messages || [] }, data: context, more: Boolean(chat?.more) && !Array.isArray(item?.messages) };
};

export const selectBots = ({ data }) => data?.bots || [];
export const selectShareTargets = state => [...selectBots(state)].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  .map(({ id, name, color, avatar }) => ({ id, name, color: color || 'green', avatar: avatar || '' }));
