import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { now, uuid } from './database.mjs';
import { TOOL_DEFINITIONS, BROWSER_TOOLS, grantOf, toolArguments } from './tool-policy.mjs';
import { BROWSER_NOTICE } from './browser.mjs';
import { Items } from './items.mjs';
import { IMAGE_HINT } from './attachments.mjs';
import { create as createFile } from './creator.mjs';
import { MCP_TOOLS, MCP_NAMES } from './mcp/catalog.mjs';
import { describeTrigger } from '../mobile/routine-text.js';

// The bot's own data: available on every level, without asking (creating a routine still asks).
const OWN_TOOLS = new Set(['memory.read', 'memory.write', 'task.create_item', 'task.list_items', 'task.update_item', 'attachment.read', 'file.list', 'file.create', 'file.send', 'routine.list', 'routine.create', 'routine.update']);

// Connector actions whose names only read. Anything that also mentions a change goes to the person.
const READ = /(^|[_.\-])(search|list|get|read|fetch|find|query|lookup|count|view|download)([_.\-]|$)/i;
const CHANGE = /(send|delete|create|update|modify|archive|trash|move|remove|write|draft|label|reply|forward|share|upload|insert|patch|add|set|mark|invite|cancel|accept|decline|post|edit|copy|rename)/i;
export const connectorRead = action => READ.test(action) && !CHANGE.test(action);

const APPROVAL_TITLES = { 'memory.write': 'Guardar uma lembrança', 'task.create_item': 'Criar uma pendência', 'notify.user': 'Enviar uma notificação', 'sms.send': 'Enviar um SMS',
  'routine.create': 'Criar uma rotina', 'routine.update': 'Alterar uma rotina', 'browser/submit': 'Enviar um formulário no navegador', 'browser/upload': 'Enviar um arquivo para um site' };
const BROWSER_LABELS = { 'browser.open': 'Navegador: abrir site', 'browser.read': 'Navegador: ler página', 'browser.click': 'Navegador: clicar', 'browser.type': 'Navegador: preencher', 'browser.upload': 'Navegador: anexar arquivo',
  'browser.wait': 'Navegador: esperar', 'browser.screenshot': 'Navegador: ver tela', 'browser.ask_user': 'Navegador: pedir ajuda' };
// What the approval card shows: the concrete effect, in words, without raw JSON for known tools.
function approvalText(tool, args, app) {
  if (app) return { title: `Usar ${app.server.name}: ${app.tool.name}`, summary: JSON.stringify(args, null, 1).slice(0, 1500) };
  if (tool === 'routine.create') return { title: APPROVAL_TITLES[tool], summary: `${args.title}\n${describeTrigger(args.trigger)}\n${args.instructions}` };
  if (tool === 'routine.update') return { title: args.delete ? 'Apagar uma rotina' : args.enabled ? 'Retomar uma rotina' : 'Pausar uma rotina', summary: '' };
  if (tool === 'browser/submit') return { title: APPROVAL_TITLES[tool], summary: [args.label && `Botão: ${args.label}`, args.text !== undefined && args.text && `Texto: ${args.text}`, args.page && `Página: ${args.page}`].filter(Boolean).join('\n') };
  if (tool === 'browser/upload') return { title: APPROVAL_TITLES[tool], summary: [`Arquivo: ${args.name} (${Math.max(1, Math.round(args.size / 1024))} KB)`, args.label && `Campo: ${args.label}`, args.page && `Site: ${args.page}`].filter(Boolean).join('\n') };
  if (BROWSER_TOOLS.includes(tool)) return { title: 'Usar o navegador', summary: args.url || args.reason || BROWSER_LABELS[tool] };
  // First use of a tool on the Médio level: the card names the tool ("Buscar e-mails"), not a generic action.
  return { title: APPROVAL_TITLES[tool] || TOOL_DEFINITIONS.find(item => item.name === tool)?.label || 'Executar uma ação', summary: Object.values(args).filter(value => typeof value === 'string' && value).join('\n') };
}

export function notifyUser({ title, body }, { id, botId }) {
  return new Promise((resolve, reject) => {
    // Arguments are passed directly to the executable; user text never becomes a shell command. The tap action
    // only carries a validated bot id, and high priority makes the notice drop down on screen.
    const open = ['am', 'start', '-n', 'com.mybots.app/.MainActivity', ...(uuid(botId) ? ['--es', 'mybotsBotId', botId] : [])].join(' ');
    const child = spawn('termux-notification', ['--id', id, '--title', title, '--content', body, '--priority', 'high', '--action', open], { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('O Termux:API não respondeu. No MyBots, abra Ajustes → Notificações do celular → Termux:API e siga o que aparecer (app instalado da mesma fonte do Termux, início automático, notificações).')); }, 10000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Instale o Termux:API e o pacote termux-api para receber notificações.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ notified: true }) : reject(new Error('O Termux não conseguiu mostrar a notificação. Confira o Termux:API e a permissão de notificações.')); });
  });
}

const DEVICE_CALLS = { 'notifications.recent': 'notifications', 'sms.search': 'smsSearch', 'sms.send': 'smsSend', 'contacts.search': 'contactsSearch',
  'calls.search': 'callLog', 'location.get': 'location', 'device.status': 'status' };

export class Tools {
  constructor(db, { changed = () => {}, notify = notifyUser, approvalMs = 120000, email = null, device = null } = {}) {
    this.db = db; this.email = email; this.device = device; this.changed = changed; this.notify = notify; this.approvalMs = approvalMs; this.runs = new Map(); this.waiting = new Map();
    this.items = new Items(db, { changed });
    // Files a run sends to the person, attached to the bot's reply when the turn ends.
    this.outgoing = new Map();
    for (const approval of db.all("SELECT id FROM approvals WHERE state IN ('pending','approved')")) db.run("UPDATE approvals SET state='expired' WHERE id=?", approval.id);
  }
  open(task, signal) {
    const token = randomBytes(32).toString('hex');
    const workspace = join(this.db.directory, 'workspaces', task.bot_id); mkdirSync(workspace, { recursive: true, mode: 0o700 });
    mkdirSync(join(this.db.directory, 'secrets'), { recursive: true, mode: 0o700 });
    const run = { taskId: task.id, botId: task.bot_id, signal, calls: new Map() };
    this.runs.set(token, run);
    const close = () => {
      this.runs.delete(token);
      for (const [id, pending] of this.waiting) if (pending.run === run) { this.db.run("UPDATE approvals SET state='cancelled' WHERE id=? AND state='pending'", id); pending.resolve(false); }
    };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    return { token, workspace, close: () => { close(); signal?.removeEventListener('abort', close); } };
  }
  context(token, bridgeId, claim = false) {
    const run = this.runs.get(token);
    if (!run || run.signal?.aborted || !uuid(bridgeId) || !['running','waiting_approval'].includes(this.db.task(run.taskId)?.state)) throw new Error('Autorização de execução inválida ou encerrada.');
    if (claim) { if (run.bridgeId) throw new Error('Esta autorização já foi usada para iniciar uma conexão.'); run.bridgeId = bridgeId; }
    if (run.bridgeId !== bridgeId) throw new Error('Conexão não autorizada.');
    this.db.requireBot(run.botId); return run;
  }
  // Connected apps are granted as a whole ("mcp:<id>"), like a built-in tool, and start blocked.
  definitions() {
    return [...TOOL_DEFINITIONS, ...(this.apps?.list() || []).map(server => ({ name: 'mcp:' + server.id, label: `App · ${server.name}`, app: true,
      description: `${server.tools.length} ferramentas de ${new URL(server.url).host}. ${server.askAlways ? 'Ações que alteram algo sempre pedem aprovação.' : 'Ações seguem a autonomia do bot.'}` }))];
  }
  allowed(botId, tool) {
    const saved = this.db.get('SELECT body FROM grants WHERE bot_id=? AND tool=?', botId, tool)?.body;
    return saved === undefined ? Boolean(TOOL_DEFINITIONS.find(item => item.name === tool)?.defaultAllowed) : saved === 'true';
  }
  grants(botId) { this.db.requireBot(botId); return this.definitions().filter(tool => !tool.internal).map(tool => ({ ...tool, allowed: this.allowed(botId, tool.name), state: this.policy(botId, tool.name) })); }
  grant(botId, tool, allowed) {
    this.db.requireBot(botId);
    const definition = this.definitions().find(item => item.name === tool);
    if (!definition || typeof allowed !== 'boolean') throw new Error('Permissão inválida.');
    const changed = this.allowed(botId, tool) !== allowed;
    this.db.run('INSERT INTO grants(id,bot_id,tool,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', botId + ':' + tool, botId, tool, JSON.stringify(allowed));
    // A resumed session keeps concluding "I have no access"; a new one rebuilds the context with the history.
    if (changed) this.db.run('DELETE FROM codex_sessions WHERE bot_id=?', botId);
    this.db.record('grant_changed', `${definition.label}: ${allowed ? 'permitido' : 'bloqueado'}.`, botId);
    if (!allowed) for (const [id, item] of this.waiting) if (item.run.botId === botId && (grantOf(item.tool) === tool || item.tool.startsWith(tool + '/'))) { this.db.run("UPDATE approvals SET state='denied' WHERE id=?", id); item.resolve(false); }
    this.changed('activity.new'); return this.grants(botId);
  }
  saved(botId, key) { return this.db.get('SELECT body FROM grants WHERE bot_id=? AND tool=?', botId, key)?.body; }
  /**
   * What a bot may do with a tool or permission group: 'allow', 'ask' (the person decides, and may say
   * "always") or 'deny'. The level comes from the bot's profile; bots made before the levels keep their switches.
   */
  policy(botId, tool) {
    const bot = this.db.requireBot(botId); const saved = this.saved(botId, tool);
    if (TOOL_DEFINITIONS.find(item => item.name === tool)?.internal) return 'allow';
    if (bot.access === 'full') return 'allow';
    if (bot.access === 'basic') return OWN_TOOLS.has(tool) && saved !== 'false' ? 'allow' : 'deny';
    if (bot.access === 'ask') return saved === 'true' ? 'allow' : saved === 'false' ? 'deny' : OWN_TOOLS.has(tool) || tool === 'account.connectors' ? 'allow' : 'ask';
    return this.allowed(botId, tool) ? 'allow' : 'deny';
  }
  /** Whether this call needs the person now, and whether the card may offer "Sempre permitir". */
  gate(bot, tool, { readOnly = false, alwaysAsk = false, writeKey = null, legacyAsk = false } = {}) {
    const policy = this.policy(bot.id, tool);
    if (policy === 'deny') throw new Error(bot.access === 'basic' ? 'Este bot está com Pouco acesso. A pessoa pode mudar o nível em Permissões, no perfil dele.' : 'Permissão negada para este bot. Peça à pessoa para liberar em Permissões, no perfil dele.');
    if (policy === 'ask') return { ask: true, always: tool };
    if (bot.access === 'full' || readOnly) return { ask: false };
    if (writeKey && this.saved(bot.id, writeKey) === 'true') return { ask: false };
    if (bot.access === 'ask') return this.saved(bot.id, tool) === 'true' && !writeKey ? { ask: false } : (alwaysAsk || writeKey) ? { ask: true, always: writeKey || tool } : { ask: false };
    if (bot.access === 'basic') return { ask: alwaysAsk };
    return { ask: legacyAsk };
  }
  /** "Sempre permitir": switches a tool on, or remembers that a group's actions no longer need asking. */
  remember(botId, key) {
    this.db.run('INSERT INTO grants(id,bot_id,tool,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', botId + ':' + key, botId, key, 'true');
    this.db.record('grant_changed', `${this.definitions().find(item => item.name === key.split('/')[0])?.label || key}: ${key.endsWith('/write') ? 'ações liberadas sem perguntar' : 'sempre permitido'}.`, botId);
    this.changed('activity.new');
  }
  requireGrant(run, tool) {
    const bot = this.db.requireBot(run.botId);
    if (!this.runsHas(run) || this.policy(run.botId, tool) === 'deny') throw new Error(bot.access === 'basic' && this.runsHas(run) ? 'Este bot está com Pouco acesso. A pessoa pode mudar o nível em Permissões, no perfil dele.' : 'Permissão negada para este bot. Peça à pessoa para liberar em Permissões, no perfil dele.');
  }
  runsHas(run) { return !run.signal?.aborted && [...this.runs.values()].includes(run) && ['running','waiting_approval'].includes(this.db.task(run.taskId)?.state); }
  /** The tools one run may see: MyBots tools plus the connected apps granted to its bot. */
  toolList(token, bridgeId) {
    const run = this.context(token, bridgeId);
    // "Pouco acesso" hides what it blocks; elsewhere a blocked tool stays listed, so the bot can say where to allow it.
    const basic = this.db.requireBot(run.botId).access === 'basic';
    return [...MCP_TOOLS.filter(tool => !basic || this.policy(run.botId, grantOf(MCP_NAMES[tool.name])) !== 'deny'), ...(this.apps?.toolsFor(tool => this.policy(run.botId, tool) !== 'deny') || [])];
  }
  /** Calls by MCP name, from either bridge: built-in names map to tools, x<id>_ names to connected apps. */
  async callMcp(token, { bridgeId, callId, name, args }) {
    if (MCP_NAMES[name]) return this.call(token, { bridgeId, callId, tool: MCP_NAMES[name], args });
    const app = this.apps?.resolve(name);
    if (!app) throw new Error('Ferramenta não permitida.');
    return this.call(token, { bridgeId, callId, tool: `mcp:${app.server.id}/${app.tool.name}`, args }, app);
  }
  async call(token, { bridgeId, callId, tool, args }, app = null) {
    const run = this.context(token, bridgeId);
    if (!uuid(callId)) throw new Error('Chamada inválida.');
    let normalized;
    try {
      if (app) {
        if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 12000) throw new Error('Argumentos inválidos para o app.');
        normalized = args;
      } else normalized = toolArguments(tool, args);
    }
    catch (error) { this.db.record('tool_denied', `${TOOL_DEFINITIONS.find(item => item.name === tool)?.label || 'Ferramenta'}: ${error.message}`.slice(0, 300), run.botId, run.taskId); this.changed('activity.new'); throw error; }
    const hash = createHash('sha256').update(JSON.stringify({ botId: run.botId, taskId: run.taskId, tool, args: normalized })).digest('hex');
    const previous = run.calls.get(callId);
    if (previous) { if (previous.hash !== hash) throw new Error('Esta chamada já foi usada com outros argumentos.'); return previous.promise; }
    if (run.calls.size >= 100 || run.busy) throw new Error('Aguarde a ferramenta atual ou inicie outra mensagem.');
    run.busy = true;
    const promise = (app ? this.performApp(run, tool, app, normalized, hash) : BROWSER_TOOLS.includes(tool) ? this.performBrowser(run, tool, normalized, hash) : this.perform(run, tool, normalized, hash)).finally(() => { run.busy = false; });
    run.calls.set(callId, { hash, promise }); return promise;
  }
  async perform(run, tool, args, hash) {
    const label = TOOL_DEFINITIONS.find(item => item.name === tool).label;
    try {
      this.requireGrant(run, tool);
      const bot = this.db.requireBot(run.botId);
      const definition = TOOL_DEFINITIONS.find(item => item.name === tool);
      // Older bots: read-only tools run on the switch alone; changes follow the bot's autonomy.
      const gate = this.gate(bot, tool, { readOnly: definition.readOnly, alwaysAsk: definition.alwaysAsk, legacyAsk: !definition.readOnly && (definition.alwaysAsk || bot.autonomy !== 'local') });
      if (gate.ask) {
        const approved = await this.ask(run, tool, args, hash, null, gate.always);
        if (!approved) throw new Error('Ação recusada, expirada ou cancelada. Nada foi executado.');
      }
      // Permission revocation and cancellation take effect even while the approval was open.
      this.requireGrant(run, tool);
      let result;
      if (tool === 'memory.read') result = { memories: this.db.all('SELECT body,updated_at FROM memory WHERE bot_id=? ORDER BY updated_at DESC', run.botId).map(row => ({ ...JSON.parse(row.body), updatedAt: row.updated_at })).filter(item => !args.key || item.key === args.key).slice(0, 100) };
      else if (tool === 'memory.write') {
        const id = run.botId + ':' + args.key;
        this.db.run('INSERT INTO memory VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at', id, run.botId, JSON.stringify(args), now()); result = { saved: true, key: args.key };
      } else if (tool === 'task.create_item' || tool === 'task.list_items' || tool === 'task.update_item') {
        // The bot comes from the authenticated run, never from the model's arguments.
        result = tool === 'task.create_item' ? this.items.create(run.botId, args) : tool === 'task.list_items' ? this.items.list(run.botId, args) : this.items.update(run.botId, args);
      } else if (tool === 'email.search' || tool === 'email.read') {
        if (!this.email) throw new Error('O conector de e-mail não está disponível.');
        result = await this.email[tool === 'email.search' ? 'search' : 'read'](args);
      } else if (tool === 'connector.permission') {
        result = await this.connectorPermission(run, args);
      } else if (tool === 'attachment.read') {
        if (!this.attachments) throw new Error('Os anexos não estão disponíveis.');
        result = await this.attachments.read(run.botId, args.id, args);
      } else if (tool === 'file.create' || tool === 'file.send') {
        if (!this.attachments) throw new Error('Os arquivos não estão disponíveis.');
        let file;
        if (tool === 'file.create') {
          const made = await createFile(args, { pdf: async html => Buffer.from((await this.browser.device('pdfCreate', { html })).data, 'base64') });
          if (made.bytes.length > 20 * 1024 * 1024) throw new Error('O arquivo passaria de 20 MB; divida o conteúdo.');
          file = this.attachments.store(run.botId, made);
          this.db.record('file_created', `Arquivo criado: ${file.name}.`, run.botId, run.taskId);
        } else { const row = this.attachments.meta(run.botId, args.id); file = { id: row.id, name: row.name, mime: row.mime, size: row.size }; }
        if (tool === 'file.send' || args.send) {
          const list = this.outgoing.get(run.taskId) || [];
          if (!list.some(item => item.id === file.id)) list.push(file);
          if (list.length > 10) throw new Error('Mande até 10 arquivos por resposta.');
          this.outgoing.set(run.taskId, list);
        }
        result = { ...file, sent: tool === 'file.send' || args.send, message: tool === 'file.send' || args.send ? 'O arquivo aparece para a pessoa junto da sua resposta, com Abrir, Compartilhar e Salvar.' : 'Arquivo criado (não mandado). Use file_send com o id para mandar.' };
      } else if (tool === 'file.list') {
        if (!this.attachments) throw new Error('Os arquivos não estão disponíveis.');
        result = this.attachments.list(run.botId, args.limit);
      } else if (tool.startsWith('routine.')) {
        if (!this.routines) throw new Error('As rotinas não estão disponíveis.');
        // The bot comes from the authenticated run, never from the model's arguments.
        if (tool === 'routine.list') result = { routines: this.routines.list(run.botId).map(({ botId, ...item }) => item) };
        else if (tool === 'routine.create') result = this.routines.create(run.botId, args);
        else result = args.delete ? this.routines.remove(args.id, run.botId) : this.routines.update(args.id, { enabled: args.enabled }, run.botId);
      } else if (DEVICE_CALLS[tool]) {
        if (!this.device) throw new Error('As capacidades do celular não estão disponíveis.');
        result = await this.device[DEVICE_CALLS[tool]](args);
      } else result = await this.notify(args, { id: 'mybots-' + run.taskId, botId: run.botId, botName: bot.name });
      this.db.record('tool_done', label + ': concluído.', run.botId, run.taskId); this.changed('activity.new'); return result;
    } catch (error) {
      this.db.record('tool_denied', label + ': não executado.', run.botId, run.taskId); this.changed('activity.new'); throw error;
    }
  }
  /**
   * Claude Code's permission prompt for tools it was not pre-allowed (account connectors). The answer is the
   * JSON Claude Code expects. Built-in tools are never allowed; reads pass; anything else needs the person.
   */
  async connectorPermission(run, { tool_name: name, input }) {
    const deny = message => ({ behavior: 'deny', message });
    const bot = this.db.requireBot(run.botId);
    if (this.policy(run.botId, 'account.connectors') === 'deny') return deny('Este bot não tem permissão para usar os apps da conta. A pessoa pode liberar em Permissões, no perfil dele.');
    const match = /^mcp__(.+?)__(.+)$/.exec(name);
    if (!match || match[1] === 'mybots-tools') return deny('Somente ferramentas de apps conectados podem ser autorizadas aqui.');
    const [, server, action] = match; const label = `${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')}: ${action}`;
    if (connectorRead(action)) { this.db.record('tool_done', `${label}: leitura liberada.`, run.botId, run.taskId); this.changed('activity.new'); return { behavior: 'allow', updatedInput: input }; }
    if (bot.access === 'full' || this.saved(run.botId, 'account.connectors/write') === 'true') { this.db.record('tool_done', `${label}: autorizado pelo nível de acesso.`, run.botId, run.taskId); this.changed('activity.new'); return { behavior: 'allow', updatedInput: input }; }
    const hash = createHash('sha256').update(JSON.stringify({ botId: run.botId, taskId: run.taskId, name, input })).digest('hex');
    const approved = await this.ask(run, 'account.connectors/' + name, input, hash, { server: { name: server.replace(/^claude_ai_/, '').replace(/_/g, ' ') }, tool: { name: action } }, bot.access === 'ask' ? 'account.connectors/write' : null);
    this.db.record(approved ? 'tool_done' : 'tool_denied', `${label}: ${approved ? 'autorizado' : 'não autorizado'}.`, run.botId, run.taskId); this.changed('activity.new');
    return approved ? { behavior: 'allow', updatedInput: input } : deny('A pessoa recusou ou não respondeu. Nada foi executado; não tente de novo sem ela pedir.');
  }
  /**
   * The bot's browser runs in the app. Using it follows the "browser" switch and level (Médio asks the first time);
   * sending a form (a submit button, or typing with submit) is a write: on Médio it asks, with "Sempre permitir".
   */
  async performBrowser(run, tool, args, hash) {
    const label = BROWSER_LABELS[tool];
    try {
      this.requireGrant(run, 'browser');
      const bot = this.db.requireBot(run.botId);
      if (!this.browser) throw new Error('O navegador não está disponível neste supervisor.');
      const refused = 'Ação recusada, expirada ou cancelada. Nada foi executado.';
      const gate = this.gate(bot, 'browser', { readOnly: true });
      if (gate.ask && !(await this.ask(run, tool, args, hash, null, gate.always))) throw new Error(refused);
      let result;
      if (tool === 'browser.ask_user') {
        this.browser.requestHelp(run.botId, args.reason);
        result = { requested: true, message: 'A pessoa vai ver o cartão com o seu pedido e o botão para abrir o navegador. Termine agora a resposta explicando o que ela precisa fazer. Quando ela tocar em “Devolver ao bot”, você recebe uma nova mensagem para continuar.' };
      } else if (tool === 'browser.click' || tool === 'browser.type') {
        const target = await this.browser.command(run.botId, 'inspect', { id: args.id });
        if (tool === 'browser.type' && target.kind === 'password') throw new Error('Campos de senha só a pessoa preenche. Use browser_ask_user para pedir que ela entre.');
        if (tool === 'browser.click' ? target.kind === 'submit' : args.submit) {
          const write = this.gate(bot, 'browser', { writeKey: 'browser/write', legacyAsk: bot.autonomy !== 'local' });
          if (write.ask && !(await this.ask(run, 'browser/submit', { ...args, label: target.label || '', page: target.url || '' }, hash, null, write.always))) throw new Error(refused);
        }
        this.requireGrant(run, 'browser');
        result = { untrusted: true, notice: BROWSER_NOTICE, ...await this.browser.command(run.botId, tool.slice(8), args), next: 'Use browser_read para ver como a página ficou.' };
      } else if (tool === 'browser.upload') {
        // Handing a file to a site always asks, on every level: the card names the file and the site.
        if (!this.attachments) throw new Error('Os arquivos não estão disponíveis.');
        const file = this.attachments.meta(run.botId, args.file);
        if (file.size > 10 * 1024 * 1024) throw new Error('Envie arquivos de até 10 MB.');
        const target = await this.browser.command(run.botId, 'inspect', { id: args.id });
        if (target.kind !== 'file') throw new Error('Este elemento não é um campo de arquivo. Em browser_read, procure um elemento do tipo file.');
        if (!(await this.ask(run, 'browser/upload', { ...args, name: file.name, size: file.size, label: target.label || '', page: target.url || '' }, hash, null, null))) throw new Error(refused);
        this.requireGrant(run, 'browser');
        const data = this.attachments.bytes(run.botId, args.file).toString('base64');
        result = { untrusted: true, notice: BROWSER_NOTICE, ...await this.browser.command(run.botId, 'upload', { id: args.id, name: file.name, mime: file.mime, data }), attached: file.name,
          next: 'O arquivo está no campo, mas ainda não foi enviado. Use browser_read e clique no botão de enviar do formulário.' };
      } else if (tool === 'browser.screenshot') {
        const shot = await this.browser.command(run.botId, 'screenshot');
        if (typeof shot.image !== 'string' || shot.image.length > 4_000_000) throw new Error('Não consegui capturar a tela do navegador.');
        result = { mcpContent: [{ type: 'text', text: `${IMAGE_HINT}\n${BROWSER_NOTICE}\n${shot.title || ''} · ${shot.url || ''}` }, { type: 'image', data: shot.image, mimeType: 'image/jpeg' }] };
      } else result = { untrusted: true, notice: BROWSER_NOTICE, ...await this.browser.command(run.botId, tool.slice(8), args) };
      this.db.record('tool_done', label + ': concluído.', run.botId, run.taskId); this.changed('activity.new'); return result;
    } catch (error) {
      this.db.record('tool_denied', `${label}: ${error.message}`.slice(0, 300), run.botId, run.taskId); this.changed('activity.new'); throw error;
    }
  }
  async performApp(run, tool, app, args, hash) {
    const grant = 'mcp:' + app.server.id; const label = `${app.server.name}: ${app.tool.name}`;
    try {
      this.requireGrant(run, grant);
      const bot = this.db.requireBot(run.botId);
      const gate = this.gate(bot, grant, { readOnly: app.tool.readOnly, writeKey: app.tool.readOnly ? null : grant + '/write', legacyAsk: !app.tool.readOnly && (app.server.askAlways || bot.autonomy !== 'local') });
      if (gate.ask) {
        const approved = await this.ask(run, tool, args, hash, app, gate.always);
        if (!approved) throw new Error('Ação recusada, expirada ou cancelada. Nada foi executado.');
      }
      this.requireGrant(run, grant);
      const result = await this.apps.call(this.apps.get(app.server.id), app.tool, args);
      this.db.record('tool_done', label + ': concluído.', run.botId, run.taskId); this.changed('activity.new'); return result;
    } catch (error) {
      this.db.record('tool_denied', label + ': não executado.', run.botId, run.taskId); this.changed('activity.new'); throw error;
    }
  }
  ask(run, tool, args, hash, app = null, always = null) {
    const id = randomUUID(); const body = JSON.stringify({ botId: run.botId, tool, args, ...approvalText(tool, args, app), canAlways: Boolean(always), createdAt: now(), expiresAt: new Date(Date.now() + this.approvalMs).toISOString() });
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.db.run("UPDATE approvals SET state='expired' WHERE id=? AND state='pending'", id); finish(false); }, this.approvalMs);
      const finish = decision => {
        clearTimeout(timer); this.waiting.delete(id);
        if (this.db.task(run.taskId)?.state === 'waiting_approval') { this.db.run("UPDATE tasks SET state='running',updated_at=? WHERE id=?", now(), run.taskId); this.db.event(run.taskId, 'running'); }
        this.changed('activity.new'); resolve(decision);
      };
      this.waiting.set(id, { run, tool, hash, always, resolve: finish });
      this.db.transaction(() => {
        this.db.run("INSERT INTO approvals VALUES(?,?,?,'pending',?)", id, run.taskId, hash, body);
        this.db.run("UPDATE tasks SET state='waiting_approval',updated_at=? WHERE id=?", now(), run.taskId); this.db.event(run.taskId, 'waiting_approval');
        this.db.record('approval_requested', 'Uma ferramenta precisa da sua aprovação.', run.botId, run.taskId);
      });
      this.changed('approval.request', { approvalId: id });
    });
  }
  /** The files a turn sent, handed to its reply once (and forgotten). */
  takeOutgoing(taskId) { const list = this.outgoing.get(taskId) || []; this.outgoing.delete(taskId); return list; }
  respond(id, approved, actionHash, always = false) {
    if (!uuid(id) || typeof approved !== 'boolean' || typeof always !== 'boolean') throw new Error('Decisão inválida. Nenhuma ação foi executada.');
    const row = this.db.get('SELECT * FROM approvals WHERE id=?', id); const pending = this.waiting.get(id);
    if (!pending || row?.state !== 'pending' || row.action_hash !== actionHash || pending.hash !== actionHash) throw new Error('Esta aprovação expirou, já foi usada ou mudou. Atualize a tela.');
    if (approved) this.requireGrant(pending.run, grantOf(pending.tool.includes('/') ? pending.tool.split('/')[0] : pending.tool));
    if (approved && always && pending.always) this.remember(pending.run.botId, pending.always);
    this.db.run('UPDATE approvals SET state=? WHERE id=?', approved ? 'consumed' : 'denied', id);
    this.db.record(approved ? 'approval_accepted' : 'approval_denied', approved ? (always && pending.always ? 'Ação autorizada; não vai perguntar de novo.' : 'Ação autorizada uma vez.') : 'Ação recusada. Nada foi executado.', pending.run.botId, pending.run.taskId);
    pending.resolve(approved); return { responded: true };
  }
}
