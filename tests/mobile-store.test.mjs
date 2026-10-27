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
