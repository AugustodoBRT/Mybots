import { routineArguments } from '../mobile/routine-text.js';
import { safeUrl } from './browser.mjs';
export const TOOL_DEFINITIONS = [
  { name: 'memory.read', label: 'Ler memória', description: 'Lê somente as lembranças deste bot.', readOnly: true },
  { name: 'memory.write', label: 'Salvar memória', description: 'Guarda ou atualiza uma lembrança deste bot.' },
  { name: 'task.create_item', label: 'Criar pendências', description: 'Adiciona um item à sua lista local, com disciplina e prazo; o MyBots avisa um dia antes do prazo.' },
  { name: 'task.list_items', label: 'Ver pendências', description: 'Consulta as pendências deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'task.update_item', label: 'Atualizar pendências', description: 'Corrige dados, muda o prazo ou marca como concluída uma pendência deste bot.', defaultAllowed: true },
  { name: 'notify.user', label: 'Enviar notificação', description: 'Mostra uma notificação no celular. Sempre pede aprovação.', alwaysAsk: true },
  { name: 'email.search', label: 'Buscar e-mails', description: 'Procura e-mails na caixa de entrada conectada (remetente, assunto, data).', readOnly: true },
  { name: 'email.read', label: 'Ler e-mails', description: 'Lê o texto de um e-mail encontrado. Somente leitura; nunca envia nem apaga.', readOnly: true },
  { name: 'notifications.recent', label: 'Ver notificações', description: 'Lê as notificações que chegaram no celular (Gmail, bancos, apps, mensagens).', readOnly: true },
  { name: 'sms.search', label: 'Ler SMS', description: 'Procura nas mensagens SMS do celular.', readOnly: true },
  { name: 'sms.send', label: 'Enviar SMS', description: 'Envia um SMS pelo seu chip. Sempre pede aprovação.', alwaysAsk: true },
  { name: 'contacts.search', label: 'Ver contatos', description: 'Procura nome e número nos contatos.', readOnly: true },
  { name: 'calls.search', label: 'Ver chamadas', description: 'Lê o histórico de ligações.', readOnly: true },
  { name: 'location.get', label: 'Ver localização', description: 'Consulta onde o celular está agora.', readOnly: true },
  { name: 'device.status', label: 'Ver bateria', description: 'Consulta bateria e carregamento.', readOnly: true },
  { name: 'account.connectors', label: 'Apps da sua conta', description: 'Gmail, Agenda, Drive e outros que você conectou na sua conta do Claude (claude.ai) ou do ChatGPT. Leituras liberadas; no Claude, ações que alteram pedem aprovação; no Codex, ficam bloqueadas.' },
  { name: 'connector.permission', label: 'Aprovar ações dos apps da conta', description: 'Uso interno: decide cada ação dos apps da conta.', readOnly: true, internal: true, defaultAllowed: true },
  { name: 'attachment.read', label: 'Ler arquivos', description: 'Lê os arquivos deste bot: o que você enviou e o que ele baixou ou criou (texto, imagem, PDF, Word, Excel, PowerPoint).', readOnly: true, defaultAllowed: true },
  { name: 'file.list', label: 'Ver arquivos', description: 'Lista os arquivos deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'file.create', label: 'Criar arquivos', description: 'Cria PDF, Word, planilha ou texto para você, a partir do que o bot escrever.', defaultAllowed: true },
  { name: 'file.send', label: 'Mandar arquivos', description: 'Manda para você, na conversa, um arquivo deste bot (criado, baixado ou anexado).', defaultAllowed: true },
  // Routine tools start allowed: creating one always asks you, and a bot only sees and changes its own routines.
  { name: 'routine.list', label: 'Ver rotinas', description: 'Consulta as rotinas deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'routine.create', label: 'Criar rotinas', description: 'Propõe uma rotina por horário ou por notificação. Sempre pede aprovação.', alwaysAsk: true, defaultAllowed: true },
  { name: 'routine.update', label: 'Pausar ou apagar rotinas', description: 'Pausa, retoma ou apaga uma rotina deste bot.', defaultAllowed: true },
  // Bots answering from the paired computer: files in their own folder there are free; the rest goes by the level.
  { name: 'computer', label: 'Mexer no computador', description: 'Quando responde pelo computador: cria e edita arquivos na pasta dele (~/MyBots/Nome) e roda comandos. Fora da pasta e comandos pedem aprovação no Médio; sudo, apagar pastas inteiras e git push sempre pedem.' },
  { name: 'desktop', label: 'Controlar a tela do computador', description: 'Permissão separada, desligada por padrão, inclusive no Acesso total. Vê a tela e as janelas, abre apps, clica e digita no PC. No Médio, ações pedem aprovação, com Sempre permitir. Pouco acesso nunca pode usar.' },
  // Skills: small programs a bot made, run on the phone without the IA. Installing one always asks the person.
  { name: 'skill.list', label: 'Ver habilidades', description: 'Consulta as habilidades deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'skill.run', label: 'Usar habilidades', description: 'Roda no celular uma habilidade deste bot (um programa que você aprovou) e lê o resultado.', readOnly: true, defaultAllowed: true },
  { name: 'skill.propose', label: 'Criar habilidades', description: 'Propõe instalar no celular um programa que o bot escreveu (ex.: buscar vagas todo dia), com os sites que ele acessa. Sempre pede aprovação.', alwaysAsk: true, defaultAllowed: true },
  // One switch for the whole browser; sending a form is a separate decision (browser/write) on the Médio level.
  { name: 'browser', label: 'Navegador', description: 'Abre sites no navegador próprio do bot (dentro do MyBots), lê, clica e preenche. Enviar formulários pede aprovação no nível Médio; anexar um arquivo num site sempre pede. Senhas só você digita, pelo botão Assumir.', readOnly: true }
];
export const BROWSER_TOOLS = ['browser.act', 'browser.tabs', 'browser.find', 'browser.open', 'browser.read', 'browser.click', 'browser.type', 'browser.upload', 'browser.login', 'browser.wait', 'browser.screenshot', 'browser.ask_user'];
export const DESKTOP_TOOLS = ['desktop.screenshot', 'desktop.windows', 'desktop.focus', 'desktop.launch', 'desktop.click', 'desktop.type', 'desktop.key'];
/** The permission a tool is decided by: every browser tool shares the "browser" switch. */
export const grantOf = tool => BROWSER_TOOLS.includes(tool) ? 'browser' : DESKTOP_TOOLS.includes(tool) ? 'desktop' : tool;
export const AVATARS = ['orbit', 'pixel', 'cat', 'spark'];
// Pouco acesso, médio (pergunta na primeira vez) e acesso total. Bots without a level keep their switches.
export const ACCESS_LEVELS = ['basic', 'ask', 'full'];
// Where a bot lives: on the phone, on the computer (offline while it is off) or wherever is on (the computer when connected).
export const HOMES = ['phone', 'pc', 'any'];
// Keys, passwords and the MyBots pairing on the computer: out of reach whatever the level.
export const SENSITIVE = /(^|[\s/~'"=])\.(ssh|gnupg|password-store|mybots-pc|aws|kube|docker)(\/|\s|$|['"])|\.claude\/\.credentials|\.codex\/auth\.json|\.config\/(gh|rclone)\b|\/etc\/(shadow|sudoers)|keyrings?\b/i;
/** Folders on the computer a bot may edit besides its own (~/vscodeProjects, /home/ana/Projetos). */
export function validFolders(list) {
  if (!Array.isArray(list) || list.length > 10) return false;
  return list.every(path => typeof path === 'string' && /^(~|\/)[^\u0000-\u001f]{0,300}$/.test(path) && !/(^|\/)\.\.(\/|$)/.test(path) && !SENSITIVE.test(path) && !['/', '~', '~/'].includes(path.trim()));
}
export { browserMode } from '../mobile/local.js';
export function validateProfile(data) {
  if (data.browserMode !== undefined && !['own','mine','claude'].includes(data.browserMode)) throw new Error('Escolha um navegador válido.');
  if (data.browserMode === 'claude' && data.provider !== 'claude') throw new Error('Claude in Chrome só está disponível para bots Claude.');
  if (data.browserMode === 'mine' && data.access === 'basic') throw new Error('Meu Chrome exige Navegador e não está disponível em Pouco acesso.');
  if (data.mainChrome !== undefined && typeof data.mainChrome !== 'boolean') throw new Error('Escolha se o bot usa o seu Chrome principal.');
  if (data.avatar !== undefined && !AVATARS.includes(data.avatar)) throw new Error('Escolha uma aparência válida.');
  if (data.autonomy !== undefined && !['ask', 'local'].includes(data.autonomy)) throw new Error('Escolha uma autonomia válida.');
  if (data.access !== undefined && !ACCESS_LEVELS.includes(data.access)) throw new Error('Escolha um nível de acesso válido.');
  if (data.home !== undefined && !HOMES.includes(data.home)) throw new Error('Escolha onde o bot vive: celular, computador ou onde estiver.');
  if (data.folders !== undefined && !validFolders(data.folders)) throw new Error('Use até 10 pastas do computador, como ~/vscodeProjects (nunca a pasta pessoal inteira nem pastas de senhas e chaves).');
}
export function toolArguments(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos.');
  const fields = { 'memory.read': ['key'], 'memory.write': ['key','text'], 'task.create_item': ['title','details','course','due','source'], 'task.list_items': ['state','limit'],
    'task.update_item': ['id','title','details','course','due','source','done'], 'notify.user': ['title','body'],
    'email.search': ['query','from','subject','since','limit'], 'email.read': ['uid'],
    'notifications.recent': ['app','query','sinceMinutes','limit'], 'sms.search': ['query','number','limit'], 'sms.send': ['number','text'],
    'contacts.search': ['query','limit'], 'calls.search': ['query','limit'], 'location.get': ['provider'], 'device.status': [],
    'attachment.read': ['id','offset','page','as_image'], 'file.list': ['limit'], 'file.create': ['name','format','content','send'], 'file.send': ['id'], 'connector.permission': ['tool_name', 'input', 'tool_use_id'], 'routine.list': [], 'routine.create': ['title','instructions','trigger'], 'routine.update': ['id','enabled','delete'],
    'browser.act': ['action','x','y','dx','dy','key','toX','toY'], 'browser.tabs': ['action','tab','url'], 'browser.find': ['query','limit'], 'browser.open': ['url'], 'browser.read': [], 'browser.click': ['id'], 'browser.type': ['id','text','submit'], 'browser.upload': ['id','file'], 'browser.login': [], 'browser.wait': ['text','selector','url','timeoutSeconds'], 'browser.screenshot': ['marks'], 'browser.ask_user': ['reason'],
    'desktop.screenshot': [], 'desktop.windows': [], 'desktop.focus': ['address'], 'desktop.launch': ['app'], 'desktop.click': ['x','y','button'], 'desktop.type': ['text'], 'desktop.key': ['keys'],
    'skill.list': [], 'skill.run': ['name','input'], 'skill.propose': ['name','title','description','code','sites','example_input','timeout_seconds','new_bot','daily_at'] }[tool];
  if (!fields || Object.keys(args).some(key => !fields.includes(key))) throw new Error('Ferramenta ou argumento não permitido.');
  const text = (name, max, optional = false) => {
    // Models often send "" for a filter they do not want; for optional fields that means no filter.
    if (optional && (args[name] === undefined || args[name] === null || (typeof args[name] === 'string' && !args[name].trim()))) return '';
    if (typeof args[name] !== 'string' || !args[name].trim() || args[name].length > max || /\u0000/.test(args[name])) throw new Error('Preencha os argumentos da ferramenta dentro dos limites.');
    return args[name].trim();
  };
  if (tool === 'memory.read') return { key: text('key', 80, true) };
  if (tool === 'memory.write') return { key: text('key', 80), text: text('text', 4000) };
  // A deadline is a date, or a date and time on the phone's clock; a date alone is never turned into 23:59.
  const due = optional => {
    const value = text('due', 16, optional);
    if (value && (!/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/.test(value) || Number.isNaN(Date.parse(value.slice(0, 10) + 'T00:00:00Z')) || new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10)))
      throw new Error('Use o prazo como AAAA-MM-DD ou AAAA-MM-DDTHH:MM (hora só se o aviso disser).');
    return value;
  };
  if (tool === 'task.create_item') return { title: text('title', 160), details: text('details', 2000, true), course: text('course', 120, true), due: due(true), source: text('source', 300, true) };
  if (tool === 'task.update_item') {
    if (typeof args.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.id)) throw new Error('Informe o id de uma pendência (veja em task_list_items).');
    if (args.done !== undefined && typeof args.done !== 'boolean') throw new Error('Use done true ou false.');
    const changes = { id: args.id };
    if (args.title !== undefined) changes.title = text('title', 160);
    // An empty string clears an optional field (e.g. a deadline that was cancelled).
    for (const [name, max] of [['details', 2000], ['course', 120], ['source', 300]]) if (args[name] !== undefined) changes[name] = text(name, max, true);
    if (args.due !== undefined) changes.due = due(true);
    if (args.done !== undefined) changes.done = args.done;
    if (Object.keys(changes).length === 1) throw new Error('Diga o que mudar na pendência.');
    return changes;
  }
  const integer = (name, min, max, fallback) => {
    const value = args[name] === undefined ? fallback : args[name];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Use ${name} entre ${min} e ${max}.`);
    return value;
  };
  if (tool === 'desktop.screenshot' || tool === 'desktop.windows') return {};
  if (tool === 'desktop.focus') {
    const address = text('address', 30);
    if (!/^0x[0-9a-f]+$/i.test(address)) throw new Error('Use o endereço de uma janela retornado por desktop_windows.');
    return { address };
  }
  if (tool === 'desktop.launch') {
    const app = text('app', 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(app)) throw new Error('Informe só o nome do executável, sem argumentos nem comandos de shell.');
    return { app };
  }
  if (tool === 'desktop.click') {
    const button = args.button ?? 'left';
    if (!['left', 'middle', 'right'].includes(button)) throw new Error('Use button left, middle ou right.');
    return { x: integer('x', 0, 32767), y: integer('y', 0, 32767), button };
  }
  if (tool === 'desktop.type') {
    if (typeof args.text !== 'string' || !args.text.length || args.text.length > 2000 || /\u0000/.test(args.text)) throw new Error('Texto entre 1 e 2.000 caracteres.');
    return { text: args.text };
  }
  if (tool === 'desktop.key') {
    if (!Array.isArray(args.keys) || args.keys.length < 1 || args.keys.length > 5 || args.keys.some(key => !['CTRL','ALT','SHIFT','SUPER','ENTER','TAB','ESC','BACKSPACE','DELETE','SPACE','UP','DOWN','LEFT','RIGHT','HOME','END','A','C','V','X','Z','L','F','S'].includes(key))) throw new Error('Use de 1 a 5 teclas da lista de desktop_key.');
    return { keys: [...new Set(args.keys)] };
  }
  if (tool === 'notifications.recent') return { app: text('app', 100, true), query: text('query', 200, true), sinceMinutes: integer('sinceMinutes', 1, 10080, 1440), limit: integer('limit', 1, 100, 30) };
  if (tool === 'sms.search') return { query: text('query', 200, true), number: text('number', 30, true), limit: integer('limit', 1, 100, 30) };
  if (tool === 'sms.send') {
    const number = text('number', 20);
    if (!/^\+?[0-9 ()-]{3,20}$/.test(number)) throw new Error('Número de telefone inválido.');
    return { number: number.replace(/[ ()-]/g, ''), text: text('text', 1000) };
  }
  if (tool === 'contacts.search') return { query: text('query', 100), limit: integer('limit', 1, 50, 20) };
  if (tool === 'calls.search') return { query: text('query', 100, true), limit: integer('limit', 1, 100, 30) };
  if (tool === 'location.get') {
    const provider = args.provider === undefined ? 'network' : args.provider;
    if (!['gps', 'network', 'passive'].includes(provider)) throw new Error('Use provider gps, network ou passive.');
    return { provider };
  }
  if (tool === 'task.list_items') {
    const state = args.state === undefined ? 'open' : args.state;
    if (!['open', 'done', 'all'].includes(state)) throw new Error('Use state open, done ou all.');
    return { state, limit: integer('limit', 1, 200, 50) };
  }
  if (tool === 'skill.list') return {};
  if (tool === 'skill.run') {
    const input = args.input === undefined ? {} : args.input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 10000) throw new Error('Em input, mande um objeto JSON pequeno.');
    return { name: text('name', 40), input };
  }
  // The proposal itself is checked by skillProposal (supervisor/skills.mjs) when it runs.
  if (tool === 'skill.propose') { if (JSON.stringify(args).length > 260000) throw new Error('Proposta grande demais.'); return args; }
  if (tool === 'device.status' || tool === 'routine.list' || tool === 'browser.read' || tool === 'browser.login') return {};
  if (tool === 'browser.act') {
    if (!['click','double_click','right_click','hover','scroll','key','drag'].includes(args.action)) throw new Error('Ação inválida no navegador.');
    const result = { action: args.action };
    for (const [name, max] of [['x',1280],['y',800],['toX',1280],['toY',800]]) {
      if (args[name] !== undefined || (args.action !== 'key' && ['x','y'].includes(name)) || (args.action === 'drag' && ['toX','toY'].includes(name))) {
        if (!Number.isFinite(args[name]) || args[name] < 0 || args[name] > max) throw new Error('Coordenadas fora da captura.');
        result[name] = args[name];
      }
    }
    if (args.action === 'key' || args.key !== undefined) {
      if (!['Enter','Tab','Shift+Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Space'].includes(args.key)) throw new Error('Tecla inválida.');
      result.key = args.key;
    }
    for (const name of ['dx','dy']) if (args.action === 'scroll' || args[name] !== undefined) {
      const value = args[name] ?? 0;
      if (!Number.isFinite(value) || Math.abs(value) > 5000) throw new Error('Rolagem fora dos limites.');
      result[name] = value;
    }
    return result;
  }
  if (tool === 'browser.tabs') {
    if (!['list','switch','new','close'].includes(args.action)) throw new Error('Ação de abas inválida.');
    return { action: args.action, ...(['switch','close'].includes(args.action) || args.tab !== undefined ? { tab: integer('tab', 1, 5) } : {}), ...(args.url !== undefined ? { url: safeUrl(text('url', 2000)) } : {}) };
  }
  if (tool === 'browser.find') return { query: text('query', 200), limit: integer('limit', 1, 20, 5) };
  if (tool === 'browser.screenshot') {
    if (args.marks !== undefined && typeof args.marks !== 'boolean') throw new Error('Use marks true ou false.');
    return { marks: args.marks === true };
  }
  if (tool === 'browser.open') return { url: safeUrl(text('url', 2000)) };
  if (tool === 'browser.click') return { id: integer('id', 1, 100000) };
  if (tool === 'browser.type') {
    if (args.submit !== undefined && typeof args.submit !== 'boolean') throw new Error('Use submit true ou false.');
    if (typeof args.text !== 'string' || args.text.length > 2000 || /\u0000/.test(args.text)) throw new Error('Texto até 2.000 caracteres.');
    return { id: integer('id', 1, 100000), text: args.text, submit: args.submit === true };
  }
  if (tool === 'browser.upload') {
    if (typeof args.file !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.file)) throw new Error('Em file, informe o id de um arquivo deste bot (veja em files_list).');
    return { id: integer('id', 1, 100000), file: args.file.toLowerCase() };
  }
  if (tool === 'browser.wait') return { url: text('url', 200, true), text: text('text', 200, true), selector: text('selector', 200, true), timeoutSeconds: integer('timeoutSeconds', 1, 30, 10) };
  if (tool === 'browser.ask_user') return { reason: text('reason', 300) };
  if (tool === 'routine.create') return routineArguments(args);
  if (tool === 'connector.permission') {
    if (typeof args.tool_name !== 'string' || !args.tool_name || args.tool_name.length > 200) throw new Error('Pedido de permissão inválido.');
    const input = args.input === undefined ? {} : args.input;
    // A file written on the computer comes whole in the request; the card only shows its path.
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 300000) throw new Error('Pedido de permissão inválido.');
    return { tool_name: args.tool_name, input };
  }
  if (tool === 'attachment.read') {
    if (typeof args.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.id)) throw new Error('Informe o id de um arquivo deste bot (veja em files_list).');
    if (args.as_image !== undefined && typeof args.as_image !== 'boolean') throw new Error('Use as_image true ou false.');
    return { id: args.id, offset: integer('offset', 0, 50_000_000, 0), page: integer('page', 1, 10000, 1), ...(args.as_image ? { asImage: true } : {}) };
  }
  if (tool === 'file.list') return { limit: integer('limit', 1, 200, 50) };
  if (tool === 'file.create') {
    const name = text('name', 100);
    if (/[\u0000/\\:*?"<>|]/.test(name)) throw new Error('O nome do arquivo não pode ter / \\ : * ? " < > |.');
    if (!['pdf', 'docx', 'xlsx', 'csv', 'md', 'txt', 'html'].includes(args.format)) throw new Error('Use format pdf, docx, xlsx, csv, md, txt ou html.');
    if (typeof args.content !== 'string' || !args.content.trim() || args.content.length > 200_000) throw new Error('Escreva o conteúdo do arquivo em Markdown (até 200 mil caracteres).');
    if (args.send !== undefined && typeof args.send !== 'boolean') throw new Error('Use send true ou false.');
    return { name, format: args.format, content: args.content, send: args.send !== false };
  }
  if (tool === 'file.send') {
    if (typeof args.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.id)) throw new Error('Informe o id de um arquivo deste bot (veja em files_list).');
    return { id: args.id };
  }
  if (tool === 'routine.update') {
    if (typeof args.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.id)) throw new Error('Informe o id de uma rotina deste bot (veja em routine_list).');
    if (args.delete === true) return { id: args.id, delete: true };
    if (typeof args.enabled !== 'boolean' || args.delete !== undefined) throw new Error('Use enabled true/false ou delete true.');
    return { id: args.id, enabled: args.enabled };
  }
  if (tool === 'email.search') {
    const since = text('since', 10, true);
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('Use a data no formato AAAA-MM-DD.');
    const limit = args.limit === undefined ? 20 : args.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Peça entre 1 e 50 e-mails.');
    return { query: text('query', 300, true), from: text('from', 200, true), subject: text('subject', 200, true), since, limit };
  }
  if (tool === 'email.read') {
    if (!Number.isInteger(args.uid) || args.uid < 1) throw new Error('Informe o uid de um e-mail encontrado na busca.');
    return { uid: args.uid };
  }
  return { title: text('title', 80), body: text('body', 500) };
}
