import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorClient } from '../mobile/supervisor-client.js';
import { localSupervisorRecovery } from '../mobile/local-supervisor.js';

class Socket {
  static all = [];
  constructor() { this.readyState = 0; Socket.all.push(this); }
  send(raw) { this.request = JSON.parse(raw); }
  open() { this.readyState = 1; this.onopen?.(); }
  auth() { this.onmessage?.({ data: JSON.stringify({ id: this.request.id, result: { authenticated: true } }) }); }
  close() { this.readyState = 3; } // Android's close callback may arrive after the next socket opened.
}
const tick = () => new Promise(r => setImmediate(r));

test('closing a pending connection allows immediate recovery; stale socket callbacks cannot authenticate or close the new one', async t => {
  const events = []; const client = new SupervisorClient({ WebSocketClass: Socket, onConnection: on => events.push(on), connectTimeout: 1000 });
  t.after(() => client.close());
  const old = client.connect({ port: 1, token: 'old' }); const rejected = assert.rejects(old, /encerrada/);
  const a = Socket.all.at(-1); a.open(); a.auth(); // auth callback is still waiting in the microtask queue
  client.close();
  const next = client.connect({ port: 2, token: 'new' }); const b = Socket.all.at(-1);
  await rejected; a.onclose?.(); a.onerror?.(); a.onopen?.();
  assert.equal(client.authenticated, false); assert.equal(client.socket, b);
  b.open(); b.auth(); await next; await tick();
  assert.equal(client.authenticated, true); assert.deepEqual(events, [true]);
});

test('a socket error releases the failed connection instead of leaking it into the next attempt', async t => {
  const client = new SupervisorClient({ WebSocketClass: Socket, connectTimeout: 1000 }); t.after(() => client.close());
  const failed = client.connect({ port: 1, token: 'x' }); const rejected = assert.rejects(failed, /Não consegui/);
  const a = Socket.all.at(-1); a.onerror(); await rejected;
  assert.equal(a.readyState, 3);
  const next = client.connect({ port: 1, token: 'x' }); const b = Socket.all.at(-1); b.open(); b.auth(); await next;
  a.onclose?.(); assert.equal(client.authenticated, true);
});

test('an RPC failure after authentication does not restart Linux; simultaneous recovery shares one attempt', async () => {
  let starts = 0, connects = 0;
  const client = { authenticated: false, async connect() { connects++; this.authenticated = true; }, close() { this.authenticated = false; } };
  const recover = localSupervisorRecovery({ client, readPairing: async () => ({ port: 1, token: 'x' }), start: async () => { starts++; }, savePairing: async x => x });
  await Promise.all([recover(), recover()]);
  await assert.rejects(async () => { await recover(); throw Error('state.get failed'); }, /state.get/);
  await recover(); assert.equal(starts, 0); assert.equal(connects, 1); assert.equal(client.authenticated, true);
});

test('a process that dies immediately is not started in an endless tight loop; recovery resumes after backoff', async () => {
  let time = 100, starts = 0;
  const client = { authenticated: false, async connect() { throw Error('down'); }, close() {} };
  const recover = localSupervisorRecovery({ client, readPairing: async () => null, start: async () => { starts++; return {}; }, savePairing: async x => x, now: () => time });
  await assert.rejects(recover(), /down/);
  for (let i = 0; i < 10; i++) await assert.rejects(recover(), /próxima tentativa/);
  assert.equal(starts, 1); time += 10000; await assert.rejects(recover(), /down/); assert.equal(starts, 2);
});

test('the local supervisor remains usable while an AI status check is stuck or fails', async t => {
  const { createSupervisor } = await import('../supervisor/index.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const directory = await mkdtemp(join(tmpdir(), 'mybots-slow-status-'));
  const app = await createSupervisor({ directory, port: 0, stateWaitMs: 10, codex: { status: () => pending, models: async () => [] } });
  t.after(async () => { release({ available: false, loggedIn: false }); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const before = app.state().instanceId;
  const state = await Promise.race([app.rpc('state.get'), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('state.get blocked on AI')), 1000); timer.unref(); })]);
  assert.equal(state.supervisorConnected, true); assert.equal(state.instanceId, before);
  release({ available: false, loggedIn: false });
  await tick(); assert.equal((await app.rpc('state.get')).instanceId, before);
});

test('a healthy local process is not restarted when its WebSocket fails to authenticate in time', async () => {
  let starts = 0;
  const client = { authenticated: false, async connect() { throw Error('socket timeout'); }, close() {} };
  const recover = localSupervisorRecovery({ client, readPairing: async () => ({ port: 1, token: 'x' }), isAlive: async () => true, start: async () => { starts++; }, savePairing: async x => x });
  for (let i = 0; i < 3; i++) await assert.rejects(recover(), /está ativo/);
  assert.equal(starts, 0);
});
