import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Database, now, uuid } from './database.mjs';
import { Queue } from './queue.mjs';
import { Tools, notifyUser } from './tools.mjs';
import { processIdentity } from './process.mjs';
import { Codex } from '../lib/codex.mjs';
import { Claude } from '../lib/claude.mjs';
import { PROMPT_VERSION } from '../mobile/local.js';
import { Rooms } from './rooms.mjs';
import { selectionFor, PROVIDER_NAMES } from '../lib/models.mjs';
import { handleMcp } from './mcp/http.mjs';
import { Vault } from './vault.mjs';
import { ConnectorBundle } from './connector-bundle.mjs';
import { EmailConnector } from './email.mjs';
import { Device, ingestNotifications, notificationStats } from './device.mjs';
import { Routines } from './routines.mjs';
import { Attachments } from './attachments.mjs';
import { Apps } from './apps.mjs';
import { Browser } from './browser.mjs';
import { Items } from './items.mjs';
import { Nodes } from './nodes.mjs';
import { Link } from './link.mjs';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createSupervisor({ directory = join(homedir(), '.mybots'), port = 3219, release = 'development', importFile,
  codex = new Codex(), claude = process.env.CLAUDE_BIN ? new Claude(process.env.CLAUDE_BIN) : null, execute, heartbeatMs = 60000, notify, approvalMs, bundle: bundleOption, imapOptions, emailPollMs, device: deviceOption, routineTickMs, clock, appFetch } = {}) {
  process.umask(0o077);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, 'supervisor.lock');
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, start: processIdentity(process.pid) }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(readFileSync(lock, 'utf8'));
    let alive = true; try { process.kill(previous.pid, 0); } catch { alive = false; }
    if (alive && (!previous.start || previous.start === processIdentity(previous.pid))) throw new Error('O supervisor já está em execução.');
    unlinkSync(lock);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, start: processIdentity(process.pid) }), { flag: 'wx', mode: 0o600 });
  }
  let db, server, sockets, timer, pingTimer, queue, email, routines, browser, items, itemTimer, rooms, nodes, link;
  try {
    const tokenFile = join(directory, 'token');
    try { writeFileSync(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    chmodSync(tokenFile, 0o600);
    const token = readFileSync(tokenFile, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('O token local está inválido. Seus dados foram preservados.');
    db = new Database(directory);
    if (importFile && !db.get("SELECT value FROM metadata WHERE key='legacy_imported'")) db.importLegacy(JSON.parse(readFileSync(importFile, 'utf8')));
    let tools;
    // When the base instructions every bot gets change (PROMPT_VERSION), open conversations start a new IA session once:
    // a resumed session keeps the old instructions. The history goes with the next turn, as for any new session.
    if (db.get("SELECT value FROM metadata WHERE key='prompt.version'")?.value !== String(PROMPT_VERSION)) db.transaction(() => {
      db.run('DELETE FROM codex_sessions');
      db.run("INSERT INTO metadata VALUES('prompt.version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(PROMPT_VERSION));
    });
    queue = new Queue(db, execute);
    const roomSelection = bot => ({ ...(bot.provider ? { provider: bot.provider } : {}), model: bot.model, reasoningEffort: bot.reasoningEffort });
    queue.recover();
    const instanceId = randomUUID();
    let models = [], modelsError = '', checking, lastCheck = 0, closed = false, accountConnectors = null;
    const connections = { codex: { available: false, loggedIn: false, message: 'Verificando o Codex…' }, ...(claude ? { claude: { available: false, loggedIn: false, message: 'Verificando o Claude…' } } : {}) };
    // The app keeps one summary line; per-provider details are in `connections`.
    const summary = () => {
      const ready = Object.entries(connections).filter(([, item]) => item.loggedIn).map(([key]) => PROVIDER_NAMES[key]);
      return ready.length ? { available: true, loggedIn: true, message: ready.join(' e ') + (ready.length > 1 ? ' conectados' : ' conectado') } : connections.codex;
    };
    const publicTasks = () => db.tasks().slice(0, 200).map(({ payload, worker_pid, worker_start, ...task }) => queue.steps.has(task.id) ? { ...task, step: queue.steps.get(task.id) } : task);
    // Home-screen widget pollers: woken on any change, they answer only when the widget's summary changed.
    const widgetPollers = new Set();
    const broadcast = (event, data = {}) => {
      for (const socket of sockets?.clients || []) if (socket.authenticated && socket.readyState === 1 && socket.bufferedAmount < 2_000_000) socket.send(JSON.stringify({ event, data }));
      for (const poller of widgetPollers) poller();
      link?.event(event, data);
    };
    const vault = new Vault(directory);
    const bundle = bundleOption || new ConnectorBundle(directory);
    email = new EmailConnector(db, vault, bundle, { changed: broadcast, pollMs: emailPollMs, imapOptions });
    const device = deviceOption || new Device(db);
    // Bot notifications go to the MyBots app (its notification listener long-polls /device/outbox) so they
    // show as MyBots; when the app has not polled recently or does not confirm in time, Termux:API shows them.
    const outbox = new Map(); const pollers = new Set(); let lastPoll = 0;
    const flushOutbox = () => {
      if (!outbox.size) return;
      const items = [...outbox.values()].map(entry => entry.item);
      for (const poller of pollers) poller(items);
      pollers.clear();
    };
    const appOpen = () => [...(sockets?.clients || [])].some(socket => socket.authenticated && socket.readyState === 1);
    const toApp = (item, wait = 12000) => new Promise(resolve => {
      if (Date.now() - lastPoll > 60000 && !appOpen()) { resolve(false); return; }
      const timer = setTimeout(() => { outbox.delete(item.id); resolve(false); }, wait);
      outbox.set(item.id, { item, done: () => { clearTimeout(timer); outbox.delete(item.id); resolve(true); } });
      flushOutbox();
      // An open app shows it right away; the listener's long-poll covers the app being closed.
      broadcast('bot.notify', item);
    });
    const fallback = notify || notifyUser;
    // Notifications show plain text: the bots' replies use Markdown (**bold**, `code`, # titles).
    const plain = value => String(value || '').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '');
    const deliver = async (raw, options = {}) => {
      const args = { ...raw, title: plain(raw.title), body: plain(raw.body) };
      const botName = options.botName || '';
      const item = { id: randomUUID(), tag: options.id || '', botId: options.botId || '', title: botName || args.title || 'MyBots', text: botName && args.title && args.title.trim().toLowerCase() !== botName.trim().toLowerCase() ? `${args.title}: ${args.body}` : args.body };
      if (await toApp(item)) return { notified: true, via: 'MyBots' };
      return fallback(args, options);
    };
    tools = new Tools(db, { changed: broadcast, notify: deliver, approvalMs, email, device }); queue.tools = tools;
    rooms = new Rooms(db, { changed: broadcast, schedule: () => queue.schedule() }); queue.rooms = rooms;
    // The computer: turns of its bots wait while it is off and start as soon as it connects.
    nodes = new Nodes(db, { changed: (event, data) => { if (data?.node && !nodes.computer()) queue.lost('pc'); else queue.schedule(); broadcast(event, data); broadcast('activity.new'); } }); queue.nodes = nodes;
    // The models to pick from: the phone's, plus those of an IA that is logged in only on the computer.
    const catalog = () => [...models, ...(nodes.computer()?.models || []).filter(item => !models.some(own => (own.provider || 'codex') === (item?.provider || 'codex')))];
    link = new Link(db, nodes, { port: () => server.address().port, changed: broadcast });
    // Whether a bot's IA is logged in where its next turn runs: the computer reports its own; while it is off,
    // a turn of a computer bot just waits (and is checked by the computer when it runs there).
    const statusFor = bot => {
      const provider = bot.provider || 'codex'; const lane = nodes.lane(bot);
      if (lane === 'pc') return nodes.computer().connections?.[provider] || { loggedIn: false, message: `Entre no ${PROVIDER_NAMES[provider]} no computador para usar este bot lá.` };
      return lane ? connections[provider] : { loggedIn: true };
    };
    // A routine runs only when its bot's IA is connected; otherwise it is skipped with the reason.
    const ready = bot => {
      // Before the first IA check, wait instead of skipping a routine that is due at startup.
      if (!lastCheck) { refresh().then(() => routines.tick(), () => {}); return { wait: true }; }
      const status = statusFor(bot);
      if (!status?.loggedIn) return { error: status?.message || 'a IA deste bot não está conectada.' };
      try { return { selection: selectionFor(catalog(), bot) }; } catch (error) { return { error: error.message }; }
    };
    const attachments = new Attachments(db); tools.attachments = attachments;
    const apps = new Apps(db, vault, { changed: broadcast, fetch: appFetch }); tools.apps = apps;
    browser = new Browser({ changed: broadcast }); tools.browser = browser;
    attachments.pdf = args => browser.device('pdfRead', args);
    routines = new Routines(db, { queue, ready, notify: tools.notify, changed: broadcast, tickMs: routineTickMs, clock }); tools.routines = routines;
    // Pending items and their notice the day before the deadline (as MyBots, without calling the model).
    items = new Items(db, { notify: tools.notify, changed: broadcast, timeZone: () => routines.timeZone(), clock }); tools.items = items;
    const nextWake = () => [routines.nextDue(), items.next()].filter(Boolean).sort()[0] || null;
    // A gap in the heartbeats is an interruption: a new instance means the supervisor stopped and started again;
    // the same instance means the phone suspended Termux (screen off, Doze) and the timers stopped meanwhile.
    let beats = 0;
    const format = value => new Intl.DateTimeFormat('pt-BR', { timeZone: routines.timeZone(), dateStyle: 'short', timeStyle: 'short' }).format(value);
    const heartbeat = () => {
      const previous = db.get('SELECT instance_id,created_at FROM heartbeats ORDER BY id DESC LIMIT 1');
      const gap = previous ? Date.now() - Date.parse(previous.created_at) : 0;
      if (gap > 90000) {
        const span = `de ${format(Date.parse(previous.created_at))} até ${format(Date.now())} (${Math.round(gap / 60000)} min)`;
        db.record('heartbeat_late', previous.instance_id === instanceId ? `Supervisor pausado pelo sistema ${span}; retomou sozinho.` : `Supervisor parado ${span}; iniciado de novo.`);
        broadcast('activity.new');
      }
      db.run('INSERT INTO heartbeats(instance_id,created_at) VALUES(?,?)', instanceId, now()); nodes.touch();
      if (beats++ % 60 === 0) db.run('DELETE FROM heartbeats WHERE created_at < ?', new Date(Date.now() - 7 * 86400000).toISOString());
    };
    // The app's keep-alive service wakes the supervisor (alarm, screen off) and restarts it when it does not answer.
    let lastWake = null;
    const wake = (body = {}) => {
      lastWake = { at: now(), reason: ['alarm', 'periodic', 'boot', 'app'].includes(body.reason) ? body.reason : 'periodic' };
      const restarted = body.restarted;
      if (restarted && typeof restarted.downSince === 'number' && Number.isFinite(restarted.downSince)) {
        db.record('supervisor_restarted', `O MyBots reiniciou o supervisor, que não respondia desde ${format(restarted.downSince)}.`);
        broadcast('activity.new');
      }
      heartbeat(); routines.tick(); items.tick().catch(() => {}); queue.schedule(); link.kick();
      // A turn waiting for the computer is not work for the phone: it must not hold the phone awake.
      const busy = db.tasks().some(task => task.state === 'running' || (task.state === 'queued' && queue.laneOf(task.bot_id)));
      const next = nextWake();
      return { release, instanceId, busy, nextRoutineAt: next, nextRoutineMs: next ? Date.parse(next) : null };
    };
    heartbeat(); timer = setInterval(heartbeat, heartbeatMs);
    const refresh = async (force = false) => {
      if (checking) return checking;
      // A disconnected IA is checked again sooner, so installing or logging in shows up without restarting.
      const ttl = Object.values(connections).every(item => item.loggedIn) ? 300000 : 30000;
      if (!force && lastCheck && Date.now() - lastCheck < ttl) return;
      checking = (async () => {
        const [codexStatus, claudeStatus] = await Promise.all([codex.status(), claude?.status()]);
        connections.codex = codexStatus; if (claude) connections.claude = claudeStatus;
        const catalog = [];
        if (codexStatus.loggedIn) {
          try { catalog.push(...(await codex.models()).map(item => ({ ...item, provider: 'codex' }))); modelsError = ''; }
          catch (error) { modelsError = error.message; }
          refreshLimits();
        }
        // Claude stays listed even when missing or logged out, so the app can show why it cannot answer yet.
        if (claude) catalog.push(...await claude.models());
        models = catalog;
        lastCheck = Date.now();
      })().finally(() => { checking = null; broadcast('connection.changed'); });
      return checking;
    };
    // The ChatGPT plan's usage windows: read with the catalog and after each Codex reply, at most once a minute.
    let limitsAt = 0;
    const refreshLimits = () => {
      if (!codex.limits || Date.now() - limitsAt < 60000) return;
      limitsAt = Date.now();
      codex.limits().then(limits => { db.setLimits('codex', limits); broadcast('connection.changed'); }).catch(() => {});
    };
    const widgetSummary = () => {
      const active = db.tasks().filter(task => ['queued', 'running', 'waiting_approval'].includes(task.state));
      const pending = db.all("SELECT body FROM approvals WHERE state='pending'").map(row => JSON.parse(row.body).botId);
      const plain = text => String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*`#>_]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      const bots = db.bots().filter(bot => !bot.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4).map(bot => {
        const latest = bot.messages.at(-1);
        const busy = active.some(task => task.bot_id === bot.id);
        // A bot of the computer sleeps while it is off; a message sent to it waits.
        const state = pending.includes(bot.id) ? 'waiting' : !nodes.presence(bot).online ? 'sleeping' : busy ? 'working' : 'idle';
        return { id: bot.id, name: bot.name, color: bot.color || 'green', avatar: bot.avatar || '', state,
          preview: state === 'waiting' ? 'Esperando sua decisão' : state === 'sleeping' ? (busy ? 'Mensagem esperando o computador' : 'Dormindo até o computador ligar') : state === 'working' ? 'Trabalhando…' : latest?.origin === 'routine' ? `Rotina · ${latest.routineTitle || ''}` : plain(latest?.text) || 'Pronto para começar' };
      });
      const open = db.all("SELECT * FROM pending_items WHERE state='open'").map(row => items.row(row)).filter(item => !db.bot(item.botId)?.deletedAt);
      const next = open.filter(item => item.due).sort((a, b) => a.due.localeCompare(b.due))[0];
      const body = { bots, approvals: pending.length, openItems: open.length, next: next ? { title: next.title.slice(0, 80), due: next.dueLabel || next.due, course: (next.course || '').slice(0, 60) } : null };
      return { version: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16), ...body };
    };
    // The account's connector names, learned from `claude mcp list` and from each Claude reply, kept across restarts.
    const knownServers = () => JSON.parse(db.get("SELECT value FROM metadata WHERE key='claude.servers'")?.value || 'null');
    const rememberServers = names => { if (Array.isArray(names) && names.length) db.run("INSERT INTO metadata VALUES('claude.servers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify([...new Set(names)].slice(0, 60))); };
    queue.accountServers = async () => {
      const known = knownServers(); if (known) return known;
      try { const list = await claude?.connectors?.(); if (list) { rememberServers(list.map(item => item.name)); return knownServers() || []; } } catch {}
      return [];
    };
    queue.rememberServers = rememberServers;
    const state = () => ({ ...db.snapshot(), usage: db.usage(), person: db.person(),
      rooms: rooms.list().map(room => ({ ...room, active: [...new Set(rooms.active(room.id).map(task => task.bot_id))], activeTasks: rooms.active(room.id).map(task => task.id) })),
      presence: Object.fromEntries(db.bots().filter(bot => !bot.deletedAt).map(bot => [bot.id, nodes.presence(bot)])), nodes: nodes.status(),
      accountApps: Object.fromEntries(db.bots().filter(bot => !bot.deletedAt).map(bot => [bot.id, tools.accountApps(bot.id)])), accountServers: knownServers() || [], bots: db.bots().filter(bot => !bot.deletedAt), deletedBots: db.bots().filter(bot => bot.deletedAt),
      active: [...new Set(db.tasks().filter(task => ['queued','running','waiting_approval'].includes(task.state)).map(task => task.bot_id))],
      connection: summary(), connections, models: catalog().map(item => {
        // A Claude alias shows the version the last reply confirmed: "Claude Opus 5.5".
        const resolved = item.provider === 'claude' ? db.get('SELECT value FROM metadata WHERE key=?', 'claude.model.' + item.model)?.value || item.modelId : null; const version = Claude.version(resolved);
        return version ? { ...item, displayName: `${item.displayName} ${version}`, modelId: resolved } : item;
      }), modelsError, defaultSelection: models.length ? selectionFor(models) : null,
      grants: Object.fromEntries(db.bots().filter(bot => !bot.deletedAt).map(bot => [bot.id, tools.grants(bot.id)])),
      botNotices: { lastPoll: lastPoll ? new Date(lastPoll).toISOString() : null }, browser: browser.status(), apps: apps.status(), routines: routines.all().filter(item => !db.bot(item.botId)?.deletedAt), timeZone: routines.timeZone(),
      memories: db.all('SELECT * FROM memory').map(row => ({ id: row.id, botId: row.bot_id, ...JSON.parse(row.body), updatedAt: row.updated_at })).filter(row => !db.bot(row.botId)?.deletedAt),
      pendingItems: db.all('SELECT * FROM pending_items ORDER BY created_at DESC').map(row => items.row(row)).filter(row => !db.bot(row.botId)?.deletedAt),
      approvals: db.all("SELECT * FROM approvals WHERE state='pending'").map(row => ({ id: row.id, taskId: row.task_id, actionHash: row.action_hash, ...JSON.parse(row.body) })),
      tasks: publicTasks(), activity: db.all('SELECT * FROM activity ORDER BY id DESC LIMIT 100'),
      heartbeat: db.get('SELECT created_at FROM heartbeats ORDER BY id DESC LIMIT 1')?.created_at, lastWake, nextRoutineAt: nextWake(),
      interruptions: db.all("SELECT id,kind,detail,created_at FROM activity WHERE kind IN ('heartbeat_late','supervisor_restarted') ORDER BY id DESC LIMIT 20"),
      email: email.status(), connectors: bundle.status(), secretsLocked: vault.locked, notifications: notificationStats(db),
      computer: link.status(), instanceId, release, supervisorConnected: true, device: 'Supervisor no Termux' });
    link.rpc = (method, params) => rpc(method, params);
    const rpc = async (method, params = {}) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Pedido inválido.');
      switch (method) {
        case 'state.get': await refresh(); return state();
        case 'connection.refresh': await refresh(true); return state();
        case 'bots.list': return state().bots;
        case 'bot.create': await refresh(); { const bot = db.create(params, selectionFor(catalog(), params)); tools.setAccountApps(bot.id, []); broadcast('activity.new'); return bot; }
        case 'bot.apps': return { apps: tools.setAccountApps(params.botId, params.apps) };
        case 'bot.update': { const bot = db.requireBot(params.botId); await refresh(); const updated = db.configure(bot.id, selectionFor(catalog(), { ...bot, ...params }), params); broadcast('activity.new'); return updated; }
        case 'bot.delete': db.delete(params.botId); broadcast('activity.new'); return { deleted: true };
        case 'bots.merge': db.merge(params.bots); broadcast('activity.new'); return { merged: true };
        case 'chat.history': return db.requireBot(params.botId).messages;
        case 'chat.send': {
          if (!uuid(params.requestId)) throw new Error('Pedido sem identificador válido.');
          const bot = db.requireBot(params.botId); await refresh();
          const selection = selectionFor(catalog(), bot);
          const status = statusFor({ ...bot, ...selection });
          if (!status?.loggedIn) throw new Error(status?.message || 'Esta IA não está conectada neste aparelho.');
          // A retried request reuses the files saved the first time instead of storing them again.
          const previous = db.task(params.requestId);
          const files = previous ? db.bot(previous.bot_id)?.messages.find(item => item.id === previous.message_id)?.attachments : attachments.save(bot.id, params.attachments);
          const text = typeof params.text === 'string' && params.text.trim() ? params.text : files?.length ? 'Veja o anexo.' : params.text;
          let task;
          try { task = db.enqueue(bot.id, params.requestId, text, selection, files?.length ? { attachments: files } : {}); }
          catch (error) { if (!previous && files?.length) attachments.discard(files); throw error; }
          broadcast('task.progress', { taskId: task.id }); queue.schedule();
          return { taskId: task.id, messageId: task.message_id, state: task.state };
        }
        case 'tasks.list': return publicTasks();
        case 'task.cancel': if (!uuid(params.taskId)) throw new Error('Tarefa inválida.'); await queue.cancel(params.taskId); return { cancelled: true };
        case 'activity.list': return state().activity;
        case 'grants.set': return tools.grant(params.botId, params.tool, params.allowed);
        case 'approval.respond': return tools.respond(params.approvalId, params.approved, params.actionHash, params.always ?? false);
        // "Consultar agora" in Atividade → Uso: Codex reads its windows directly; Claude needs one tiny reply.
        case 'room.create': return rooms.create(params);
        case 'room.update': return rooms.update(params.roomId, params);
        case 'room.delete': rooms.remove(params.roomId); return { deleted: true };
        case 'room.send': { await refresh(); return rooms.send(params.roomId, params.requestId, params.text, roomSelection); }
        case 'computer.pair': { if (typeof params.link !== 'string' || params.link.length > 2000) throw new Error('Leia o QR do computador.'); const result = await link.pair(params.link); broadcast('activity.new'); return result; }
        case 'computer.forget': { const result = link.forget(); broadcast('activity.new'); return result; }
        case 'computer.retry': link.kick(); return link.status();
        case 'person.update': { const person = db.setPerson(params); broadcast('activity.new'); return person; }
        case 'limits.refresh': {
          if (!['codex', 'claude'].includes(params.provider)) throw new Error('IA inválida.');
          const source = params.provider === 'codex' ? codex : claude;
          if (!source?.limits || !connections[params.provider]?.loggedIn) throw new Error(`O ${params.provider === 'codex' ? 'Codex' : 'Claude'} não está conectado neste celular.`);
          db.setLimits(params.provider, await source.limits()); broadcast('connection.changed');
          return db.limits();
        }
        case 'account.connectors': {
          // `claude mcp list` checks each server's health, so it is slow: cache it unless asked to refresh.
          if (params.refresh || !accountConnectors || Date.now() - accountConnectors.at > 300000) {
            let claudeList = null, claudeError = '';
            if (claude && connections.claude?.loggedIn) { try { claudeList = await claude.connectors?.() || null; } catch (error) { claudeError = error.message; } }
            accountConnectors = { at: Date.now(), claude: claudeList, claudeError, codex: Boolean(connections.codex?.loggedIn) };
            if (claudeList) rememberServers(claudeList.map(item => item.name));
          }
          return accountConnectors;
        }
        case 'apps.list': return apps.status();
        case 'app.add': { const result = await apps.add(params); broadcast('activity.new'); return result; }
        case 'app.refresh': return apps.refresh(params.id);
        case 'app.configure': return apps.configure(params.id, params);
        case 'app.remove': { const result = apps.remove(params.id); broadcast('activity.new'); return result; }
        case 'browser.control': {
          const bot = db.requireBot(params.botId);
          const help = browser.setControl(bot.id, params.who);
          db.record('browser_control', params.who === 'person' ? 'Você assumiu o navegador do bot.' : 'Navegador devolvido ao bot.', bot.id);
          // Handing back after the bot asked for help continues its work as a new turn.
          if (help) {
            await refresh();
            const selection = selectionFor(catalog(), bot);
            if (connections[selection.provider || 'codex']?.loggedIn) {
              const task = db.enqueue(bot.id, randomUUID(), `[Navegador devolvido] Terminei o que você pediu (“${help.reason}”) e devolvi o navegador. Continue de onde parou; confira a página com browser_read.`, selection);
              broadcast('task.progress', { taskId: task.id }); queue.schedule();
            }
          }
          broadcast('activity.new'); return { control: params.who, continued: Boolean(help) };
        }
        // The app fetches a bot's file in parts (3 MB, whole base64 groups) to open, share or save it.
        case 'file.read': {
          if (!uuid(params.id)) throw new Error('Arquivo inválido.');
          const row = db.get('SELECT * FROM attachments WHERE id=?', params.id);
          if (!row) throw new Error('Arquivo não encontrado.');
          db.requireBot(row.bot_id);
          const offset = Number.isInteger(params.offset) && params.offset >= 0 ? params.offset : 0; const part = 3 * 1024 * 1024;
          const bytes = readFileSync(attachments.path(row.id));
          return { id: row.id, name: row.name, mime: row.mime, size: bytes.length, chunk: bytes.subarray(offset, offset + part).toString('base64'), next: offset + part < bytes.length ? offset + part : null };
        }
        case 'outbox.ack': for (const id of Array.isArray(params.ids) ? params.ids.slice(0, 50) : []) outbox.get(id)?.done(); return { acknowledged: true };
        case 'device.timezone': return routines.setTimeZone(params.timeZone);
        case 'routines.list': return routines.all();
        case 'routine.update': return routines.update(params.id, { enabled: params.enabled });
        case 'routine.delete': return routines.remove(params.id);
        case 'routine.run': return routines.runNow(params.id);
        case 'item.complete': {
          if (!uuid(params.id)) throw new Error('Pendência inválida.');
          const item = db.get('SELECT * FROM pending_items WHERE id=?', params.id);
          if (!item) throw new Error('Pendência não encontrada.');
          db.requireBot(item.bot_id); db.run("UPDATE pending_items SET state='done' WHERE id=?", params.id);
          db.record('item_done', 'Pendência concluída por você.', item.bot_id); broadcast('activity.new'); return { completed: true };
        }
        case 'backup.list': return readdirSync(join(directory, 'backup'), { withFileTypes: true }).filter(entry => entry.isFile() && /^mybots-[0-9]{8}T[0-9]{6}Z-[0-9a-f-]{36}\.json$/i.test(entry.name)).map(entry => entry.name).sort().reverse();
        case 'backup.read': {
          if (typeof params.name !== 'string' || !/^mybots-[0-9]{8}T[0-9]{6}Z-[0-9a-f-]{36}\.json$/i.test(params.name)) throw new Error('Backup inválido.');
          const path = join(directory, 'backup', params.name);
          if (statSync(path).size > 20_000_000) throw new Error('Backup grande demais.');
          return JSON.parse(readFileSync(path, 'utf8'));
        }
        case 'environment.get': {
          let report = ''; try { report = readFileSync(join(directory, 'ambiente-supervisor.txt'), 'utf8').slice(0, 16000); } catch {}
          return { report: `Node ${process.version} · SQLite nativo\nSupervisor ativo · ${release.slice(0, 12)}\nCatálogo app-server: ${models.some(item => item.provider === 'codex') ? 'respondeu' : 'não confirmado'}\nClaude Code: ${connections.claude ? connections.claude.message : 'não encontrado'}\n\n${report}` };
        }
        case 'secrets.unlock': {
          const matched = vault.unlock(params.key);
          if (!matched && email.config()) email.update({ status: 'auth_error', message: 'O MyBots foi reinstalado: reconecte a conta de e-mail.' });
          email.start(); broadcast('connection.changed'); return { unlocked: true, matched };
        }
        case 'connectors.status': return bundle.status();
        case 'connectors.install': { const result = bundle.install(params.data); email.start(); broadcast('connection.changed'); return result; }
        case 'email.status': return email.status();
        case 'email.configure': { const result = await email.configure(params); broadcast('activity.new'); return result; }
        case 'email.disconnect': return email.disconnect();
        case 'email.sync': return email.sync();
        case 'backup.export': return db.snapshot();
        case 'backup.create': return db.backup();
        case 'backup.restore': db.restore(params.snapshot); broadcast('activity.new'); return { restored: true };
        default: throw new Error('Operação não permitida.');
      }
    };
    queue.on('changed', change => {
      broadcast(change?.event || 'task.progress', change || {}); broadcast('activity.new');
      // A bot that named another member (@) in a room hands it the next turn.
      if (change?.event === 'task.done') rooms.answered(change.taskId, roomSelection);
      if (change?.event === 'task.done' && (db.bot(db.task(change.taskId)?.bot_id)?.provider || 'codex') === 'codex' && connections.codex?.loggedIn) refreshLimits();
    });
    let api;
    server = createServer(async (request, response) => {
      if (request.url === '/mcp') { await handleMcp(request, response, tools); return; }
      if (request.method === 'POST' && ['/tools/claim','/tools/call','/tools/list'].includes(request.url)) {
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
        if (request.headers.origin || !request.headers.authorization?.startsWith('Bearer ')) { response.writeHead(403).end(JSON.stringify({ error: 'Conexão não autorizada.' })); return; }
        const runToken = request.headers.authorization.slice(7);
        if (!tools.runs.has(runToken)) { response.writeHead(403).end(JSON.stringify({ error: 'Autorização de execução inválida ou encerrada.' })); return; }
        try {
          let size = 0; const chunks = [];
          for await (const chunk of request) { size += chunk.length; if (size > 16000) throw new Error('Pedido grande demais.'); chunks.push(chunk); }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const result = request.url === '/tools/claim' ? (tools.context(runToken, body.bridgeId, true), { connected: true })
            : request.url === '/tools/list' ? { tools: tools.toolList(runToken, body.bridgeId) }
            : body.name !== undefined ? await tools.callMcp(runToken, body) : await tools.call(runToken, body);
          response.end(JSON.stringify(result));
        } catch (error) { response.writeHead(400).end(JSON.stringify({ error: error.code || error instanceof SyntaxError ? 'Pedido de ferramenta inválido.' : error.message })); }
        return;
      }
      if (!equal(request.headers.authorization, 'Bearer ' + token)) { response.writeHead(401).end(); return; }
      if (request.method === 'POST' && request.url === '/device/events') {
        // The app's notification listener posts here with the pairing token; content is stored as untrusted events.
        try {
          let size = 0; const chunks = [];
          for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) throw new Error('size'); chunks.push(chunk); }
          const added = ingestNotifications(db, JSON.parse(Buffer.concat(chunks).toString('utf8')).events);
          if (added.length) { broadcast('activity.new'); routines.notifications(added); }
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: added.length }));
        } catch { response.writeHead(400).end(); }
        return;
      }
      if (request.method === 'GET' && request.url === '/device/outbox') {
        lastPoll = Date.now();
        const answer = items => { if (!response.writableEnded) response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ items })); };
        if (outbox.size) { answer([...outbox.values()].map(entry => entry.item)); return; }
        const poller = items => { clearTimeout(timer); answer(items); };
        const timer = setTimeout(() => { pollers.delete(poller); answer([]); lastPoll = Date.now(); }, 25000);
        pollers.add(poller); request.on('close', () => { clearTimeout(timer); pollers.delete(poller); });
        return;
      }
      if (request.method === 'POST' && request.url === '/device/outbox/ack') {
        try {
          let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 20000) throw new Error('size'); }
          for (const id of JSON.parse(raw).ids || []) outbox.get(id)?.done();
          response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"acknowledged":true}');
        } catch { response.writeHead(400).end(); }
        return;
      }
      // The app's browser host: long-polls commands for the bots' browsers and posts each result back.
      if (request.method === 'GET' && request.url === '/device/browser') {
        const cancel = browser.poll(commands => { if (!response.writableEnded) response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ commands })); });
        request.on('close', cancel);
        return;
      }
      if (request.method === 'POST' && request.url === '/device/browser/result') {
        try {
          let size = 0; const chunks = [];
          for await (const chunk of request) { size += chunk.length; if (size > 6_000_000) throw new Error('size'); chunks.push(chunk); }
          const accepted = browser.result(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted }));
        } catch { if (!response.headersSent) response.writeHead(400).end(); }
        return;
      }
      // A file the app downloaded in a bot's browser: kept as that bot's file.
      if (request.method === 'POST' && request.url === '/device/files') {
        const fail = (status, error) => { if (!response.headersSent) response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error })); };
        try {
          let size = 0; const chunks = [];
          for await (const chunk of request) { size += chunk.length; if (size > 30_000_000) throw new Error('size'); chunks.push(chunk); }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const bot = db.requireBot(body.botId);
          const name = typeof body.name === 'string' ? body.name.replace(/[\u0000/\\]/g, '_').trim().slice(0, 120) : '';
          const mime = typeof body.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(body.mime) ? body.mime.toLowerCase() : 'application/octet-stream';
          const bytes = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
          if (!name || !bytes.length || bytes.length > 20 * 1024 * 1024) { fail(400, 'Arquivo vazio, sem nome ou maior que 20 MB.'); return; }
          const file = attachments.store(bot.id, { name, mime, bytes });
          db.record('file_downloaded', `Arquivo baixado pelo navegador: ${name}${typeof body.source === 'string' ? ` (${body.source.slice(0, 100)})` : ''}.`, bot.id);
          broadcast('activity.new');
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(file));
        } catch (error) { fail(400, error.message === 'size' ? 'Arquivo grande demais.' : error.message || 'Arquivo inválido.'); }
        return;
      }
      // The home-screen widget: who is working or waiting, the latest messages and the next deadline. Long-polls
      // with the version it shows (?v=), so a bot that starts working shows up right away.
      if (request.method === 'GET' && request.url.startsWith('/device/widget')) {
        const known = new URL(request.url, 'http://local').searchParams.get('v') || '';
        const answer = summary => { if (!response.writableEnded) response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(summary)); };
        const first = widgetSummary();
        if (first.version !== known) { answer(first); return; }
        let timer;
        const poller = closing => { if (closing === true) { finish(); answer(first); return; } clearTimeout(pending); pending = setTimeout(() => { const next = widgetSummary(); if (next.version !== known) { finish(); answer(next); } }, 300); };
        let pending;
        const finish = () => { clearTimeout(timer); clearTimeout(pending); widgetPollers.delete(poller); };
        timer = setTimeout(() => { finish(); answer(widgetSummary()); }, 25000);
        widgetPollers.add(poller); request.on('close', finish);
        return;
      }
      if (request.method === 'POST' && request.url === '/device/wake') {
        try {
          let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 4000) throw new Error('size'); }
          const body = raw ? JSON.parse(raw) : {};
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(wake(body && typeof body === 'object' ? body : {})));
        } catch { if (!response.headersSent) response.writeHead(400).end(); }
        return;
      }
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ release, instanceId, port: server.address().port }));
      } else if (request.method === 'POST' && request.url === '/shutdown') {
        response.writeHead(200).end();
        setImmediate(() => {
          // Only as the main process: embedded in tests or another program, the caller owns process exit.
          const main = resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
          if (main) setTimeout(() => { try { unlinkSync(lock); } catch {} process.exit(1); }, 8000).unref();
          api.close().then(() => { if (main) process.exit(0); });
        });
      } else response.writeHead(404).end();
    });
    sockets = new WebSocketServer({ noServer: true, maxPayload: 20_000_000, perMessageDeflate: false });
    server.on('upgrade', (request, socket, head) => {
      const origin = request.headers.origin;
      if (request.url !== '/' || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) { socket.destroy(); return; }
      sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
    });
    sockets.on('connection', socket => {
      const timeout = setTimeout(() => socket.close(1008), 5000); socket.alive = true;
      socket.on('error', () => {}); socket.on('pong', () => { socket.alive = true; });
      socket.on('close', () => clearTimeout(timeout));
      let processing = false;
      socket.on('message', async (raw, binary) => {
        if (binary || processing) { socket.close(1008); return; }
        processing = true;
        let request;
        try {
          request = JSON.parse(raw.toString());
          if (typeof request.id !== 'string' || request.id.length > 100 || typeof request.method !== 'string') throw new Error('Pedido inválido.');
          if (!socket.authenticated) {
            if (request.method !== 'auth' || !equal(request.params?.token, token)) { socket.close(1008); return; }
            socket.authenticated = true; clearTimeout(timeout);
            socket.send(JSON.stringify({ id: request.id, result: { authenticated: true } }));
          } else {
            const result = await rpc(request.method, request.params);
            if (socket.readyState === 1) socket.send(JSON.stringify({ id: request.id, result }));
          }
        } catch (error) {
          // Never echo payloads, tokens, SQL statements or account diagnostics.
          const message = error.code ? 'Não foi possível gravar ou ler os dados do supervisor.' : error.message;
          if (socket.readyState === 1) socket.send(JSON.stringify({ id: request?.id || null, error: message }));
        } finally { processing = false; }
      });
    });
    pingTimer = setInterval(() => { for (const ws of sockets.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 30000);
    await new Promise((resolveStart, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveStart); });
    const actualPort = server.address().port; queue.toolEndpoint = `http://127.0.0.1:${actualPort}`;
    writeFileSync(join(directory, 'endpoint.json'), JSON.stringify({ port: actualPort, release, instanceId }), { mode: 0o600 });
    api = { db, queue, tools, routines, items, nodes, link, token, port: actualPort, rpc, state, async close() {
      if (closed) return; closed = true;
      clearInterval(timer); clearInterval(pingTimer); clearInterval(itemTimer); email.stop(); routines.stop(); link.close();
      for (const ws of sockets.clients) ws.terminate();
      // Open long-polls and keep-alive sockets would hold server.close() forever, and with it the lock.
      for (const poller of pollers) poller([]); pollers.clear(); browser.close();
      for (const poller of [...widgetPollers]) poller(true);
      await queue.close();
      const closing = new Promise(resolveClose => server.close(resolveClose));
      server.closeAllConnections?.();
      await closing;
      db.close(); unlinkSync(lock);
    } };
    queue.schedule(); routines.start(); link.start();
    items.tick().catch(() => {}); itemTimer = setInterval(() => items.tick().catch(() => {}), routineTickMs || 30000);
    return api;
  } catch (error) {
    clearInterval(timer); clearInterval(pingTimer); email?.stop(); routines?.stop(); link?.close();
    for (const socket of sockets?.clients || []) socket.terminate();
    server?.close(); db?.close();
    try { unlinkSync(lock); } catch {}
    throw error;
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const directory = process.env.MYBOTS_HOME || join(homedir(), '.mybots');
  createSupervisor({ directory, port: Number(process.env.MYBOTS_PORT || 3219), release: process.env.MYBOTS_RELEASE || 'development', importFile: process.env.MYBOTS_IMPORT || undefined })
    .then(app => {
      // A shutdown that hangs must not keep the lock: the next version could never start.
      const stop = () => { setTimeout(() => { try { unlinkSync(join(directory, 'supervisor.lock')); } catch {} process.exit(1); }, 8000).unref(); app.close().then(() => process.exit(0)); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
    })
    .catch(() => { console.error('Não foi possível iniciar o supervisor. Dados preservados; confira o ambiente e o diagnóstico.'); process.exitCode = 1; });
}
