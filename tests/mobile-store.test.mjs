import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, share, selectConversation, selectHome, selectShell } from '../mobile/state/store.js';
import { conversationCache, cachedConversations } from '../mobile/local.js';
import { messageMarkdown, sameMessage } from '../mobile/message-cache.js';
const message = (id, text = id) => ({ id, text, role: 'assistant', status: 'complete', createdAt: '2026-10-27T12:00:00Z' });
const initial = () => ({ supervisorConnected: true, seq: 10, bots: [{ id: 'a', name: 'A', messageCount: 1 }, { id: 'b', name: 'B', messageCount: 1 }], rooms: [{ id: 'r', botIds: ['a', 'b'] }], tasks: [{ id: 't', bot_id: 'a', state: 'running' }] });

test('store applies ordered events once, detects gaps, and preserves a loaded page and other slices', () => {
  const store = createStore(); store.setData(initial()); store.sequence(10);
  store.page('a', { messages: [message('1')], more: true, before: 11 });
  store.page('b', { messages: [message('x')], more: false });
  const other = store.getSnapshot().chats.b;
  store.event('message.added', { seq: 11, botId: 'a', message: message('2') });
  assert.deepEqual(store.event('message.added', { seq: 11, botId: 'a', message: message('2') }), { duplicate: true });
  store.event('message.added', { seq: 12, botId: 'a', message: message('2') });
  assert.equal(store.getSnapshot().data.bots[0].messageCount, 2);
  store.event('message.updated', { seq: 13, botId: 'a', message: message('2', 'editada') });
  assert.deepEqual(store.getSnapshot().chats.a.messages.map(m => m.text), ['1', 'editada']);
  const beforeGap = store.getSnapshot(); assert.deepEqual(store.event('task.progress', { seq: 15, taskId: 't', step: 'não aplicar' }), { gap: true }); assert.equal(store.getSnapshot(), beforeGap);
  store.page('a', { messages: [message('0'), message('1')], before: 1, more: false }, true);
  assert.deepEqual(store.getSnapshot().chats.a.messages.map(m => m.id), ['0', '1', '2']); assert.equal(store.getSnapshot().chats.b, other);
  store.sequence(0); store.event('task.progress', { seq: 1, taskId: 't', step: 'reiniciou' }); assert.equal(store.getSnapshot().data.tasks[0].step, 'reiniciou');
});

test('a step of bot A changes neither chat B nor Home nor navigation; a message changes only its conversation and summaries', () => {
  const store = createStore(); store.setData(initial());
  const selectors = [selectConversation('b'), selectHome, selectShell];
  const snapshots = selectors.map(selector => selector(store.getSnapshot())); const renders = [0, 0, 0];
  store.subscribe(() => selectors.forEach((selector, i) => { const next = share(snapshots[i], selector(store.getSnapshot())); if (next !== snapshots[i]) renders[i]++; snapshots[i] = next; }));
  store.event('task.progress', { taskId: 't', botId: 'a', step: 'Lendo a página' }); assert.deepEqual(renders, [0, 0, 0]);
  store.event('message.added', { botId: 'a', message: message('new') }); assert.deepEqual(renders, [0, 1, 0]);
  store.setData(structuredClone(store.getSnapshot().data)); assert.deepEqual(renders, [0, 1, 0]);
});

test('local cache caps bot and room previews at 40, survives an empty load, and removes deleted bots and rooms', () => {
  const store = createStore(); store.setData(initial());
  const messages = Array.from({ length: 90 }, (_, i) => message(String(i)));
  store.page('a', { messages }); store.page('r', { messages });
  let cache = conversationCache(null, store.getSnapshot().data, store.getSnapshot().chats);
  assert.equal(cache.bots[0].messages.length, 40); assert.equal(cache.rooms[0].messages.length, 40); assert.equal(cache.bots[0].messages[0].id, '50');
  cache = conversationCache(cache, store.getSnapshot().data, {}); assert.equal(cache.bots[0].messages.length, 40);
  assert.deepEqual(cachedConversations(cache).r.messages, messages.slice(-40));
  store.event('bot.updated', { botId: 'a', bot: { id: 'a', deletedAt: 'now' } }); assert.equal(store.getSnapshot().chats.a, undefined);
  store.setData({ ...store.getSnapshot().data, rooms: [], deletedBots: [{ id: 'a', deletedAt: 'now' }] });
  cache = conversationCache(cache, store.getSnapshot().data, store.getSnapshot().chats);
  assert.deepEqual(cache.bots.find(bot => bot.id === 'a').messages, []); assert.equal(cache.rooms.length, 0);
  assert.equal(cachedConversations(cache).a, undefined); assert.equal(cachedConversations(cache).r, undefined); assert.equal(store.getSnapshot().chats.r, undefined);
});

test('message cache parses once per id/text and memoization still shows edits, files, metadata and retry state', () => {
  const parsed = messageMarkdown('m', '**Olá**\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(messageMarkdown('m', parsed.text), parsed); assert.equal(parsed.runs('**Olá**'), parsed.runs('**Olá**'));
  assert.notEqual(messageMarkdown('m', 'Adeus'), parsed);
  const props = { message: message('m', 'abc'), bot: { id: 'a', name: 'A', color: 'green' }, models: [] };
  assert.ok(sameMessage(props, { ...props, message: { ...props.message }, bot: { ...props.bot }, busy: true }));
  for (const patch of [{ text: 'xyz' }, { status: 'error' }, { attachments: [{ id: 'file' }] }, { usage: { input: 1, output: 2 } }]) assert.equal(sameMessage(props, { ...props, message: { ...props.message, ...patch } }), false);
  assert.equal(sameMessage(props, { ...props, bot: { ...props.bot, name: 'Novo nome' } }), false);
});

test('Direct Share reads recent bots from its own slice, while navigation does not need timestamps', async () => {
  const { selectShareTargets } = await import('../mobile/state/store.js');
  const state = { data: { ...initial(), bots: [{ id: 'a', name: 'A', updatedAt: '2026-10-26' }, { id: 'b', name: 'B', updatedAt: '2026-10-27' }] } };
  assert.deepEqual(selectShareTargets(state).map(bot => bot.id), ['b', 'a']);
  assert.equal(selectShell(state).bots[0].updatedAt, undefined);
  assert.deepEqual(selectShareTargets({ data: null }), []);
});

test('legacy computer mode reads its own history even if the same bot has a phone page in memory', () => {
  const state = { data: { ...initial(), bots: [{ id: 'a', name: 'A', messages: [message('pc')] }] }, chats: { a: { messages: [message('phone')], more: true } } };
  const slice = selectConversation('a')(state);
  assert.deepEqual(slice.bot.messages.map(m => m.id), ['pc']); assert.equal(slice.more, false);
});

test('saving the conversation cache keeps where the phone\'s MyBots lives (the computer\'s or its own)', () => {
  const store = createStore(); store.setData(initial());
  for (const backend of ['pc', 'embedded']) {
    const saved = conversationCache({ backend, mode: 'phone', bots: [], rooms: [] }, store.getSnapshot().data, store.getSnapshot().chats);
    assert.equal(saved.backend, backend);
    assert.equal(conversationCache(saved, store.getSnapshot().data, {}).backend, backend);
  }
  assert.equal('backend' in conversationCache(null, store.getSnapshot().data, {}), false);
});

test('Home follows the chief, Team stays open, and an explicit chat or room wins', async () => {
  const { destination } = await import('../mobile/state/chief-home.js');
  const data = { bots: [{ id: 'a' }, { id: 'b', isChief: true }], rooms: [{ id: 'r' }] };
  for (const bots of [[], [{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]]) assert.equal(destination({ bots }).selected, null);
  assert.equal(destination(data).selected, 'b');
  assert.deepEqual(destination(data, { kind: 'team' }), { selected: null, roomId: null, team: true });
  assert.equal(destination(data, { kind: 'bot', id: 'a' }).selected, 'a');
  assert.equal(destination(data, { kind: 'room', id: 'r' }).roomId, 'r');
  assert.equal(destination(data, { kind: 'home' }).selected, 'b');
  assert.equal(destination(data, { kind: 'bot', id: 'deleted' }).selected, 'b');
  assert.equal(destination({ bots: [{ id: 'a', isChief: true }, { id: 'b' }] }).selected, 'a');
  // The phone's Home is the list, with the Chefe pinned; his conversation opens on a tap.
  assert.deepEqual(destination(data, { kind: 'home' }, { chiefHome: false }), { selected: null, roomId: null, team: true });
  assert.equal(destination(data, { kind: 'bot', id: 'b' }, { chiefHome: false }).selected, 'b');
});

test('chief status counts bots once, prioritizes approvals, and respects local date-only deadlines', async () => {
  const { teamStatus } = await import('../mobile/state/chief-home.js');
  const now = Date.parse('2026-11-07T15:00Z');
  const data = { timeZone: 'America/Sao_Paulo', bots: ['a','b','c','d'].map(id => ({ id })),
    active: ['a','a','b','c'], presence: { c: { online: false } }, approvals: [{ botId: 'b' }, { botId: 'b' }, { botId: 'd' }],
    pendingItems: ['2026-11-06','2026-11-07','2026-11-08T12:00','2026-11-08T12:01','2026-11-07T11:59',null].map(due => ({ state: 'open', due })).concat({ state: 'done', due: '2026-11-07' }) };
  assert.deepEqual(teamStatus(data, now), { working: 1, waiting: 2, soon: 2 });
  assert.deepEqual(teamStatus({ bots: [] }, now), { working: 0, waiting: 0, soon: 0 });
});

test('chief delegation cards match room message IDs without loading or marking the room read', async () => {
  const { delegationCards } = await import('../mobile/state/chief-home.js');
  const store = createStore(); const data = initial();
  data.bots[0].isChief = true; data.bots[1].name = 'Sol'; data.rooms[0].name = 'Projeto';
  store.setData(data);
  const add = (id, text, botId, replyTo) => store.event('message.added', { roomId: 'r', message: { ...message(id, text), botId, replyTo } });
  add('1', '@Sol prepare a entrega.', 'a'); add('2', 'Sobre outro assunto', 'b', 'unrelated');
  add('3', 'Pronto.', 'b', '1');
  assert.deepEqual(delegationCards(store.getSnapshot()).map(({ label, roomId }) => [label, roomId]), [['O Chefe chamou Sol','r'], ['Sol respondeu','r']]);
  assert.equal(store.getSnapshot().chats.r, undefined);
  assert.equal(store.getSnapshot().data.rooms[0].unread, 3);
  store.setData({ ...data, rooms: [] }); assert.deepEqual(delegationCards(store.getSnapshot()), []);
});

test('note links keep Markdown formatting, missing destinations and code; a remote edit is detected even in the same millisecond', async () => {
  const { noteDestination, noteChanged } = await import('../mobile/state/note-view.js');
  const { parseInline } = await import('../mobile/markdown.js');
  const links = [{ path: 'chefe/uma_nota.md', exists: true }, { path: 'entregas/ausente.md', exists: false }];
  const runs = parseInline('**[[uma_nota]]** e [[entregas/ausente]] ou `[[uma_nota]]`', name => noteDestination(name, links));
  assert.deepEqual(runs.filter(run => run.note).map(run => [run.note.exists, Boolean(run.bold)]), [[true, true], [false, false]]);
  assert.ok(runs.at(-1).code && !runs.at(-1).note);
  const base = { path: 'chefe/a.md', updatedAt: 'mesma hora', body: 'antes' };
  assert.equal(noteChanged(base, { ...base }), false);
  assert.equal(noteChanged(base, { ...base, body: 'depois' }), true);
  assert.equal(noteChanged(base, null), true);
});

test('a state.get behind the events already applied does not make the next event look lost; a reconnection starts over', () => {
  const store = createStore(); store.setData(initial()); store.catchUp(10);
  store.page('a', { messages: [message('1')], more: false });
  store.event('message.added', { seq: 11, botId: 'a', message: message('2') });
  store.catchUp(10);
  assert.deepEqual(store.event('message.added', { seq: 12, botId: 'a', message: message('3') }), {});
  assert.deepEqual(store.getSnapshot().chats.a.messages.map(m => m.id), ['1', '2', '3']);
  store.sequence(null); store.catchUp(2);
  assert.deepEqual(store.event('task.progress', { seq: 3, taskId: 't', step: 'depois de reiniciar' }), {});
});
