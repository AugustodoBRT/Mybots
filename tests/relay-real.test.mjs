import test from 'node:test';
import assert from 'node:assert/strict';
import { hostRelay, dialRelay, roomFor, DEFAULT_RELAY } from '../supervisor/relay.mjs';

// Against the real relay (VM da Oracle, wss:// through Caddy). Only with MYBOTS_REAL_RELAY=1: it needs the internet.
test('real relay over wss:// (opt-in: MYBOTS_REAL_RELAY=1): the computer waits, the phone arrives, bytes round-trip fast', { skip: process.env.MYBOTS_REAL_RELAY !== '1' }, async () => {
  const room = roomFor(`teste-real-${Date.now()}`); const streams = [];
  const host = hostRelay({ relay: DEFAULT_RELAY, rooms: () => [room], onStream: stream => streams.push(stream) });
  try {
    for (let i = 0; i < 300 && host.online() !== 1; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(host.online(), 1);
    const phone = await dialRelay(DEFAULT_RELAY, room);
    for (let i = 0; i < 300 && !streams.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(streams.length, 1); streams[0].on('data', data => streams[0].write(data));
    const times = [];
    for (let i = 0; i < 5; i++) { const start = Date.now(); const back = new Promise(resolve => phone.once('data', resolve)); phone.write('ping'); assert.equal((await back).toString(), 'ping'); times.push(Date.now() - start); }
    console.log(`ida e volta pelo relé (wss): ${times.join(' ')} ms`);
    assert.ok(Math.min(...times) < 1000);
    phone.destroy();
  } finally { host.close(); }
});
