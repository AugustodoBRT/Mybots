import test from 'node:test';
import assert from 'node:assert/strict';
import { Link } from '../supervisor/link.mjs';

const bot = id => ({ id, browserMode: 'shared' });
function online(bots) {
  const sent = [];
  const link = new Link({ bot: id => bots[id] }, {}, {});
  link.state = 'online'; link.socket = { readyState: 1, send: text => sent.push(JSON.parse(text)) };
  return { link, sent };
}

test('a bot answering on the phone browses in the computer\'s Chromium when it is connected', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const { link, sent } = online({ [id]: bot(id) });
  assert.equal(link.browserFor(bot(id)), true);
  assert.equal(link.browserFor({ id, browserMode: 'mine' }), false);
  assert.equal(link.browserFor({ id, browserMode: 'claude' }), false);
  const run = { taskId: 't', botId: id, lane: 'phone' };
  const pending = link.command(run, 'browser.read', {});
  assert.equal(sent[0].type, 'pc_command'); assert.equal(sent[0].id, null); assert.equal(sent[0].botId, id); assert.equal(sent[0].mode, 'shared');
  link.commands.get(sent[0].rid)({ result: { url: 'https://x.test' } });
  assert.deepEqual(await pending, { url: 'https://x.test' });
  await assert.rejects(link.command(run, 'desktop.click', {}), /interrompida/);
  link.state = 'offline'; assert.equal(link.browserFor(bot(id)), false);
});
