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
  let state = { data: null, chats: {}, drafts: {}, draftKeys: {}, roomEvents: [] }; let seq = null; let draftNumber = 0;
  const listeners = new Set();
  const update = patch => { const next = share(state, { ...state, ...patch }); if (next === state) return; state = next; for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setData(value) {
      const data = typeof value === 'function' ? value(state.data) : value;
      const known = data?.supervisorConnected && new Set([...(data.bots || []), ...(data.rooms || [])].map(item => item.id));
      update({ data, ...(!data ? { roomEvents: [] } : {}), ...(known ? { chats: Object.fromEntries(Object.entries(state.chats).filter(([id]) => known.has(id))) } : {}) });
    },
    setChats: value => update({ chats: typeof value === 'function' ? value(state.chats) : value }),
    sequence: value => { seq = value; },
    // The number in a state.get: behind what the events already brought it says nothing, and going back would make the next event look like a lost one.
    catchUp: value => { if (seq === null || value === null || value > seq) seq = value; },
    snapshot(data) {
      if (seq !== null && typeof data.seq === 'number' && data.seq < seq) return false;
      this.catchUp(data.seq); this.setData(data); return true;
    },
    // The reply being written, by conversation (a room keeps one per bot); the finished message or an empty text clears it.
    draft: ({ botId, roomId, text }) => {
      const key = roomId ? roomId + ':' + botId : botId; if (!key) return;
      const drafts = { ...state.drafts }; if (text) drafts[key] = text; else delete drafts[key];
      const draftKeys = { ...state.draftKeys };
      if (text && !draftKeys[key]) draftKeys[key] = `stream:${++draftNumber}`;
      if (!text) delete draftKeys[key];
      update({ drafts, draftKeys });
    },
    page(key, page, older = false, baseline) {
      const current = state.chats[key]?.messages || [];
      const previous = new Map(current.map(message => [message.id, message]));
      let messages = page.messages.map(message => previous.get(message.id)?.renderKey ? { ...message, renderKey: previous.get(message.id).renderKey } : message);
      if (baseline && !older) {
        const before = new Map(baseline.map(message => [message.id, message]));
        const changed = current.filter(message => before.get(message.id) !== message);
        const fresh = new Map(changed.map(message => [message.id, message]));
        const received = new Set(messages.map(message => message.id));
        messages = [...messages.map(message => fresh.get(message.id) || message), ...changed.filter(message => !received.has(message.id))];
      }
      update({ chats: addPage(state.chats, key, { ...page, messages }, older) });
    },
    event(event, payload, open) {
      if (typeof payload?.seq === 'number') {
        if (seq !== null && payload.seq <= seq) return { duplicate: true };
        if (!inSequence(seq, payload.seq)) return { gap: true };
        seq = payload.seq;
      }
      if (event === 'message.added' || event === 'message.updated') {
        const key = payload.botId || payload.roomId;
        // The finished message takes the draft's place.
        const drafts = { ...state.drafts }, draftKeys = { ...state.draftKeys };
        const draftKey = payload.roomId ? payload.roomId + ":" + payload.message?.botId : payload.botId;
        if (event === "message.added" && payload.message?.role === "assistant" && draftKeys[draftKey]) {
          payload = { ...payload, message: { ...payload.message, renderKey: draftKeys[draftKey] } };
          delete draftKeys[draftKey];
        }
        if (event === 'message.added' && payload.message?.role === 'assistant') delete drafts[payload.roomId ? payload.roomId + ':' + payload.message.botId : payload.botId];
        const exists = state.chats[key]?.messages.some(message => message.id === payload.message?.id) || [...(state.data?.bots || []), ...(state.data?.rooms || [])].find(item => item.id === key)?.lastMessage?.id === payload.message?.id;
        // Unopened rooms only keep a short trail of delegation evidence; receiving an event never marks a room read.
        const { message, roomId } = payload;
        const chief = roomId && state.data?.bots?.find(bot => bot.isChief);
        let roomEvents = state.roomEvents;
        if (chief && message?.role === 'assistant' && message.status === 'complete' && !message.progress &&
            (message.botId === chief.id || message.replyTo)) {
          const { id, botId, role, status, replyTo, createdAt } = message;
          const last = state.data.rooms?.find(room => room.id === roomId)?.lastMessage;
          if (last?.botId === chief.id && last.text?.includes('@') && last.text.length < 280 && !roomEvents.some(item => item.id === last.id))
            roomEvents = [...roomEvents, { ...last, roomId }];
          roomEvents = [...roomEvents.filter(item => item.id !== id), { roomId, id, botId, role, status, replyTo, createdAt,
            ...(botId === chief.id ? { text: message.text } : {}) }].slice(-100);
        }
        update({ drafts, draftKeys, roomEvents, chats: applyMessage(state.chats, event, payload), data: applyToLists(state.data, exists ? 'message.updated' : event, payload, open) });
      }
      else if (event === 'task.settled' && state.data) {
        const tasks = (state.data.tasks || []).map(task => task.id === payload.taskId ? { ...task, state: payload.state, step: undefined } : task);
        const active = tasks.filter(task => ['queued', 'running', 'waiting_approval'].includes(task.state));
        update({ data: { ...state.data, tasks, active: state.data.active?.filter(id => id !== payload.botId || active.some(task => task.bot_id === id)),
          rooms: state.data.rooms?.map(room => room.id !== payload.roomId ? room : { ...room, activeTasks: room.activeTasks?.filter(id => id !== payload.taskId), active: room.active?.filter(id => id !== payload.botId || active.some(task => task.bot_id === id && room.activeTasks?.includes(task.id))) }) } });
      }
      else if (event === 'bot.updated') {
        const chats = { ...state.chats };
        if (payload.bot === null || payload.bot?.deletedAt) delete chats[payload.botId];
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

export const selectConversation = (key, isRoom = false) => ({ data, chats, drafts, draftKeys = {} }) => {
  if (!data) return null;
  const room = isRoom ? data.rooms?.find(item => item.id === key) : null;
  const bots = data.bots?.filter(bot => room ? room.botIds.includes(bot.id) : bot.id === key) || [];
  const ids = new Set(bots.map(bot => bot.id));
  const pick = source => Object.fromEntries(Object.entries(source || {}).filter(([id]) => ids.has(id)));
  const chat = chats[key]; const item = room || bots[0];
  const draftOf = Object.fromEntries(Object.entries(drafts || {}).filter(([id]) => id === key || id.startsWith(key + ':')));
  const context = { models: data.models, defaultSelection: data.defaultSelection, connections: data.connections, aiAccounts: data.aiAccounts, connection: data.connection, modelsError: data.modelsError,
    bots, nodes: data.nodes, presence: pick(data.presence), active: data.active?.filter(id => ids.has(id)),
    tasks: data.tasks?.filter(task => isRoom ? room?.activeTasks?.includes(task.id) : task.bot_id === key),
    approvals: data.approvals?.filter(approval => isRoom ? room?.activeTasks?.includes(approval.taskId) : approval.botId === key),
    activity: data.activity?.filter(activity => ids.has(activity.bot_id)),
    browser: Object.fromEntries(['pages', 'help', 'control'].map(name => [name, pick(data.browser?.[name])])) };
  return { draftKeys: Object.fromEntries(Object.entries(draftKeys).filter(([id]) => id === key || id.startsWith(key + ':'))), drafts: draftOf, [isRoom ? 'room' : 'bot']: item && { ...item, messages: item.messages || chat?.messages || [] }, data: context, more: Boolean(chat?.more) && !Array.isArray(item?.messages) };
};

export const selectBots = ({ data }) => data?.bots || [];
export const selectShareTargets = state => [...selectBots(state)].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  .map(({ id, name, color, avatar, face }) => ({ id, name, color: color || 'green', avatar: avatar || '', ...(face ? { face } : {}) }));
