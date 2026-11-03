import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { extraAddresses } from '../pc/platform.mjs';
const { isOurs, PARK_RULE, WINDOW_CLASSES } = createRequire(import.meta.url)('../desktop/electron/hypr-core.js');

test('Hyprland: our window is found by its pid under either class name (the installed app is "mybots", the development setup "mybots-desktop")', () => {
  assert.deepEqual(WINDOW_CLASSES, ['mybots', 'mybots-desktop']);
  for (const className of ['mybots', 'mybots-desktop']) assert.equal(isOurs({ pid: 42, class: className }, 42), true);
  assert.equal(isOurs({ pid: 42, class: 'firefox' }, 42), false);       // another program
  assert.equal(isOurs({ pid: 43, class: 'mybots' }, 42), false);        // another MyBots (another process)
  assert.equal(isOurs(null, 42), false); assert.equal(isOurs(undefined, 42), false);
});

test('Hyprland: the parking rule matches both class names and nothing else', () => {
  const rule = PARK_RULE(); assert.equal(rule, 'match:class ^(mybots|mybots-desktop)$, workspace special:mybots silent');
  const match = new RegExp(rule.match(/\^\(.*\)\$/)[0]);
  assert.equal(match.test('mybots'), true); assert.equal(match.test('mybots-desktop'), true);
  assert.equal(match.test('mybots-other'), false); assert.equal(match.test('xmybots'), false); assert.equal(match.test('MyBots'), false);
});

test('MYBOTS_PC_ADVERTISE: extra addresses for the phone (a Tailscale address without an interface), plain hosts and IPs only', () => {
  assert.deepEqual(extraAddresses({ MYBOTS_PC_ADVERTISE: '100.70.166.116' }), ['100.70.166.116']);
  assert.deepEqual(extraAddresses({ MYBOTS_PC_ADVERTISE: ' 100.70.166.116 , meu-pc.tailnet.ts.net,fd7a::1 ' }), ['100.70.166.116', 'meu-pc.tailnet.ts.net', 'fd7a::1']);
  assert.deepEqual(extraAddresses({}), []); assert.deepEqual(extraAddresses({ MYBOTS_PC_ADVERTISE: '' }), []);
  // nothing that is not a host: spaces inside, shell characters, paths and URLs are dropped; at most four
  assert.deepEqual(extraAddresses({ MYBOTS_PC_ADVERTISE: 'a b,$(x),http://x,/etc/passwd,1.1.1.1;2.2.2.2' }), []);
  assert.equal(extraAddresses({ MYBOTS_PC_ADVERTISE: '1.1.1.1,2.2.2.2,3.3.3.3,4.4.4.4,5.5.5.5' }).length, 4);
});
