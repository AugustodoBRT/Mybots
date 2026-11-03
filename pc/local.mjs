import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { noticeCommand } from './platform.mjs';
import nodeBinaries from '../lib/node-binary.cjs';
const { nodeRun } = nodeBinaries;
import WebSocket from '../supervisor/node_modules/ws/wrapper.mjs';

export const DEFAULT_LOCAL_PORT = 3221;
const ENTRY = fileURLToPath(new URL('../supervisor/index.mjs', import.meta.url));
const RESTART_MS = [2000, 5000, 10000, 30000];
const read = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };

/**
 * The computer's own supervisor: the same code that runs on the phone, with its own database in
 * ~/.mybots-pc/supervisor, started as a child of the node. It pairs with this very node over loopback, so its turns
 * run through the same executor (sandbox, desktop, browser) the phone's bots use here. With it the computer keeps
 * bots, conversations, memory and routines by itself, with the phone off.
 */
export function createLocal({ directory, port = DEFAULT_LOCAL_PORT, entry = ENTRY, env = {}, nodePort, pairing, identity, log = () => {}, notify = showNotice }) {
  const home = join(directory, 'supervisor');
  const linkFile = join(directory, 'local-link.json');
  let child = null, closed = false, attempt = 0, restartTimer = null, endpoint = null, token = null, ready = null, polling = null;
  const sessions = new Set();

  const credentials = () => {
    token = null; endpoint = null;
    try {
      const saved = JSON.parse(readFileSync(join(home, 'endpoint.json'), 'utf8')); const secret = readFileSync(join(home, 'token'), 'utf8').trim();
      if (Number.isInteger(saved.port) && /^[0-9a-f]{64}$/.test(secret)) { endpoint = saved; token = secret; }
    } catch {}
    return Boolean(endpoint);
  };
  const waitReady = async () => {
    for (let i = 0; i < 300 && !closed; i++) {
      if (!child) throw new Error('O supervisor do computador parou ao iniciar.');
      if (credentials()) { try { const session = await open(() => {}); session.close(); return; } catch {} }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('O supervisor do computador não respondeu ao iniciar.');
  };

  /** One authenticated connection to the supervisor. It handles one request at a time, so calls are queued here. */
  function open(onEvent) {
    return new Promise((resolve, reject) => {
      if (!endpoint) { reject(new Error('O MyBots do computador ainda está iniciando.')); return; }
      const ws = new WebSocket(`ws://127.0.0.1:${endpoint.port}`); const waiting = new Map(); let serial = Promise.resolve(), opened = false;
      const session = {
        closed: false,
        call(method, params = {}) {
          const work = serial.then(() => new Promise((done, fail) => {
            if (ws.readyState !== 1) { fail(new Error('O MyBots do computador está desconectado.')); return; }
            const id = randomUUID(); const timer = setTimeout(() => { waiting.delete(id); fail(new Error('O MyBots do computador demorou para responder.')); }, 120000);
            waiting.set(id, { done: value => { clearTimeout(timer); done(value); }, fail: error => { clearTimeout(timer); fail(error); } });
            ws.send(JSON.stringify({ id, method, params }));
          }));
          serial = work.catch(() => {}); return work;
        },
        close() { session.closed = true; sessions.delete(session); ws.terminate(); }
      };
      const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
      ws.on('open', () => {
        const id = randomUUID(); waiting.set(id, { done: () => { opened = true; sessions.add(session); resolve(session); }, fail: reject }); send(id, 'auth', { token });
      });
      ws.on('message', raw => {
        let message; try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.event) { onEvent(message.event, message.data, raw.toString()); return; }
        const item = waiting.get(message.id); if (!item) return; waiting.delete(message.id);
        message.error ? item.fail(new Error(message.error)) : item.done(message.result);
      });
      ws.on('error', error => { if (!opened) reject(error); });
      ws.on('close', () => {
        session.closed = true; sessions.delete(session);
        for (const item of waiting.values()) item.fail(new Error('O MyBots do computador reiniciou. Tente de novo.'));
        waiting.clear(); if (!opened) reject(new Error('O MyBots do computador recusou a conexão.'));
        session.onClose?.();
      });
    });
  }

  /** Pairs the supervisor with this node when it never was, or when the node's port or certificate changed. */
  async function ensurePaired() {
    const me = identity(); const wanted = { id: me.id, port: nodePort(), fingerprint: me.fingerprint };
    const session = await open(() => {});
    try {
      const status = await session.call('computer.retry');
      const saved = read(linkFile, null);
      if (status.paired && saved && saved.id === wanted.id && saved.port === wanted.port && saved.fingerprint === wanted.fingerprint) return;
      await session.call('computer.pair', { link: pairing().link });
      writeFileSync(linkFile, JSON.stringify(wanted), { mode: 0o600 });
      log('Este computador agora tem o seu próprio MyBots (supervisor local pareado).');
    } finally { session.close(); }
  }

  /** Bot notices: the supervisor offers them on the same long-poll the Android app uses; here they become desktop notices. */
  async function pollNotices() {
    const controller = new AbortController(); polling = controller;
    const headers = () => ({ Authorization: 'Bearer ' + token });
    let failures = 0;
    while (!closed && !controller.signal.aborted) {
      try {
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/device/outbox`, { headers: headers(), signal: controller.signal });
        if (!response.ok) throw new Error('outbox');
        const { items = [] } = await response.json(); failures = 0;
        for (const item of items) if (!item.dismiss) notify(item, action => fetch(`http://127.0.0.1:${endpoint.port}/device/notification-action`, { method: 'POST', headers: headers(), body: JSON.stringify(action) }).catch(() => {}));
        if (items.length) await fetch(`http://127.0.0.1:${endpoint.port}/device/outbox/ack`, { method: 'POST', headers: headers(), body: JSON.stringify({ ids: items.map(item => item.id) }) }).catch(() => {});
      } catch { if (closed || controller.signal.aborted) return; await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)))); }
    }
  }

  function spawnChild() {
    mkdirSync(home, { recursive: true, mode: 0o700 }); chmodSync(home, 0o700);
    rmSync(join(home, 'endpoint.json'), { force: true });
    const runner = nodeRun();
    const process_ = spawn(runner.command, [entry], { env: { ...process.env, ...(runner.env || {}), MYBOTS_HOME: home, MYBOTS_PORT: String(port), MYBOTS_RELEASE: 'computador', MYBOTS_DEVICE_KIND: 'computer', ...env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child = process_;
    process_.stderr.on('data', data => { for (const line of String(data).split('\n')) if (line.trim()) log('[supervisor] ' + line.trim()); });
    process_.on('exit', code => {
      if (child === process_) child = null;
      polling?.abort(); for (const session of [...sessions]) session.close();
      if (closed) return;
      log(`O supervisor do computador parou (código ${code}); iniciando de novo.`);
      restartTimer = setTimeout(() => { restartTimer = null; start().catch(error => log(error.message)); }, RESTART_MS[Math.min(attempt++, RESTART_MS.length - 1)]);
    });
  }

  async function start() {
    if (closed || child) return ready;
    spawnChild();
    ready = (async () => { await waitReady(); await ensurePaired(); attempt = 0; pollNotices().catch(() => {}); })();
    ready.catch(error => log(error.message));
    return ready;
  }

  return {
    start, port: () => endpoint?.port || null,
    /** Whether the supervisor answers, for the window to use it. */
    online: () => Boolean(child && endpoint),
    ready: () => ready || Promise.resolve(),
    /** A connection for one window: events (as the supervisor sent them) go to onEvent. */
    // `notices`: a phone app wants the bots' notices too (the window ignores them; the node shows them as desktop notices).
    session: (onEvent, { notices = false } = {}) => open((event, data, text) => { if (notices || event !== 'bot.notify') onEvent(text); }),
    async close() {
      closed = true; clearTimeout(restartTimer); polling?.abort(); for (const session of [...sessions]) session.close();
      const running = child; child = null;
      if (running && running.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => { running.kill('SIGKILL'); resolve(); }, 6000); running.once('exit', () => { clearTimeout(timer); resolve(); }); running.kill('SIGTERM'); });
    }
  };
}

/** A notice on the desktop (libnotify, a Windows toast or macOS's own). On Linux an approval gets Aprovar/Recusar buttons when the server has actions. */
export function showNotice(item, act, platform = process.platform, run = spawn) {
  const title = String(item.title || 'MyBots').slice(0, 120), text = String(item.text || '').slice(0, 600);
  const approval = typeof item.approvalId === 'string' && typeof item.actionHash === 'string';
  const notice = noticeCommand(title, text, { actions: approval }, platform);
  let output = '';
  const child = run(notice.command, notice.args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, ...(notice.env ? { env: { ...process.env, ...notice.env } } : {}) });
  child.on('error', () => {});
  child.stdout?.on('data', data => { output += data; });
  if (approval && notice.actions) child.on('close', () => { const choice = output.trim(); if (choice === 'approve' || choice === 'reject') act({ type: choice, approvalId: item.approvalId, actionHash: item.actionHash }); });
  return child;
}
