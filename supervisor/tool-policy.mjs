import { validGoogleAccount } from '../mobile/local.js';
import { routineArguments } from '../mobile/routine-text.js';
import { safeUrl } from './browser.mjs';
import { EYE_STYLES, MOUTHS, TOPS, LIMITS } from '../lib/mimo.mjs';
import { validPath, checkBody } from './notes.mjs';
export const TOOL_DEFINITIONS = [
  { name: 'team.status', label: 'Consultar estado da equipe', description: 'Mostra ao Chefe as pendências, rotinas e última atividade dos bots.', readOnly: true },
  { name: 'team.update_bot', label: 'Alterar outro bot', description: 'O Chefe propõe mudar o nome, a função ou as instruções de um bot; a pessoa aprova antes.' },
  { name: 'team.routines', label: 'Ver rotinas da equipe', description: 'O Chefe vê as rotinas de cada bot com o resultado das últimas execuções.', readOnly: true },
  { name: 'team.routine_update', label: 'Alterar rotinas da equipe', description: 'O Chefe propõe criar, pausar, retomar, apagar ou mudar o horário da rotina de outro bot; a pessoa aprova antes.' },
  { name: 'team.usage', label: 'Ver o gasto da equipe', description: 'O Chefe vê (só leitura) o uso e o custo estimado de cada bot e de cada rotina.', readOnly: true },
  { name: 'profile.read', label: 'Ler a nota Você', description: 'Lê a nota Você, no centro da memória: dados e preferências da pessoa (sem senhas), a mesma para todos os bots.', readOnly: true, defaultAllowed: true },
  { name: 'profile.write', label: 'Alterar a nota Você', description: 'O Chefe propõe mudar a nota Você; a pessoa aprova antes.' },
  { name: 'team.overlap', label: 'Ver papéis parecidos', description: 'Mostra ao Chefe os bots com funções parecidas, para unir ou aposentar.', readOnly: true },
  { name: 'table.list', label: 'Ver tabelas compartilhadas', description: 'Lista as tabelas que todos os bots leem e escrevem.', readOnly: true, defaultAllowed: true },
  { name: 'table.read', label: 'Ler tabela compartilhada', description: 'Lê linhas de uma tabela compartilhada, com filtro.', readOnly: true, defaultAllowed: true },
  { name: 'table.add', label: 'Gravar em tabela compartilhada', description: 'Acrescenta uma linha, conferindo duplicata antes.', defaultAllowed: true },
  { name: 'table.update', label: 'Alterar linha de tabela', description: 'Muda colunas de uma linha de uma tabela compartilhada.', defaultAllowed: true },
  { name: 'table.delete', label: 'Apagar linha de tabela', description: 'Apaga uma linha de uma tabela compartilhada.', defaultAllowed: true },
  { name: 'canvas.read', label: 'Ver o canvas', description: 'Vê os cartões, as ligações e as áreas do canvas da equipe.', readOnly: true, defaultAllowed: true },
  { name: 'canvas.add', label: 'Pôr cartão no canvas', description: 'Põe no canvas uma nota, tabela, gráfico, página HTML (sem internet), imagem ou vídeo.', defaultAllowed: true },
  { name: 'canvas.update', label: 'Mudar cartão do canvas', description: 'Muda o conteúdo, a posição, o tamanho ou a área de um cartão do canvas.', defaultAllowed: true },
  { name: 'canvas.link', label: 'Ligar cartões', description: 'Liga dois cartões do canvas com um rótulo.', defaultAllowed: true },
  { name: 'canvas.remove', label: 'Tirar do canvas', description: 'Tira um cartão ou uma ligação do canvas.', defaultAllowed: true },
  { name: 'user.decide', label: 'Pedir uma decisão', description: 'Pergunta algo à pessoa com opções para tocar (e sempre "Escrever minha resposta"); a resposta volta como mensagem.', defaultAllowed: true },
  { name: 'user.decisions', label: 'Ver decisões', description: 'Consulta o que a pessoa já decidiu e o que está esperando resposta.', readOnly: true, defaultAllowed: true },
  { name: 'delivery.write', label: 'Registrar entrega', description: 'Cria uma entrega datada deste bot.', defaultAllowed: true },
  { name: 'shared.index_read', label: 'Ler índice compartilhado', description: 'Consulta o índice das notas do Chefe.', readOnly: true },
  { name: 'shared.note_read', label: 'Consultar notas', description: 'Lê uma nota ou lista os títulos das notas compartilhadas.', readOnly: true },
  { name: 'shared.note_write', label: 'Escrever nota', description: 'Cria uma nota do Chefe ou guarda a versão anterior ao substituir.' },
  { name: 'shared.archive', label: 'Arquivar entrega', description: 'Move uma entrega para o arquivo, preservando o conteúdo.' },
  { name: 'memory.read', label: 'Ler memória', description: 'Lê somente as lembranças deste bot.', readOnly: true },
  { name: 'memory.write', label: 'Salvar memória', description: 'Guarda ou atualiza uma lembrança deste bot.' },
  { name: 'memory.delete', label: 'Apagar memória', description: 'Apaga uma lembrança deste bot que ficou inútil ou que a pessoa pediu para esquecer.', defaultAllowed: true },
  { name: 'task.create_item', label: 'Criar pendências', description: 'Adiciona um item à sua lista local, com disciplina e prazo; o MyBots avisa um dia antes do prazo.' },
  { name: 'task.list_items', label: 'Ver pendências', description: 'Consulta as pendências deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'task.update_item', label: 'Atualizar pendências', description: 'Corrige dados, muda o prazo ou marca como concluída uma pendência deste bot.', defaultAllowed: true },
  { name: 'notify.user', label: 'Enviar notificação', description: 'Mostra uma notificação no celular.', alwaysAsk: true },
  { name: 'email.search', label: 'Buscar e-mails', description: 'Procura e-mails na caixa de entrada conectada (remetente, assunto, data).', readOnly: true },
  { name: 'email.read', label: 'Ler e-mails', description: 'Lê o texto de um e-mail encontrado. Somente leitura; nunca envia nem apaga.', readOnly: true },
  { name: 'notifications.recent', label: 'Ver notificações', description: 'Lê as notificações que chegaram no celular (Gmail, bancos, apps, mensagens).', readOnly: true },
  { name: 'sms.search', label: 'Ler SMS', description: 'Procura nas mensagens SMS do celular.', readOnly: true },
  { name: 'sms.send', label: 'Enviar SMS', description: 'Envia um SMS pelo seu chip.', alwaysAsk: true },
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
  { name: 'routine.create', label: 'Criar rotinas', description: 'Propõe uma rotina por horário ou por notificação.', alwaysAsk: true, defaultAllowed: true },
  { name: 'routine.update', label: 'Pausar ou apagar rotinas', description: 'Pausa, retoma ou apaga uma rotina deste bot.', defaultAllowed: true },
  // Bots answering from the paired computer: files in their own folder there are free; the rest goes by the level.
  { name: 'computer', label: 'Mexer no computador', description: 'Quando responde pelo computador: cria e edita arquivos na pasta dele (~/MyBots/Nome) e roda comandos. Acesso total aos arquivos e ao terminal disponíveis no aparelho.' },
  // GitHub: the person's own login (gh and the git token), shown to this bot's turns on the computer only when turned on.
  { name: 'github', label: 'Usar o seu GitHub', description: 'No computador, o bot usa o gh e o git com a sua conta: vê seus repositórios, cria projetos, faz commit e push, seguindo as mesmas regras de aprovação do terminal. Desligado, sua conta fica escondida dele.' },
  { name: 'desktop', label: 'Controlar a tela do computador', description: 'Vê a tela e as janelas, abre apps, clica e digita no PC.' },
  // Skills: small programs a bot made, run on the phone without the IA. Installing one always asks the person.
  { name: 'negotiation.status', label: 'Ver negociações', description: 'Consulta os mandatos de negociação deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'negotiation.offer', label: 'Declarar ofertas', description: 'Declara uma oferta dentro do mandato; o MyBots recusa o que o mandato não cobre.', defaultAllowed: true },
  { name: 'negotiation.close', label: 'Fechar negócios', description: 'Fecha dentro do mandato ou leva a proposta à pessoa com Aceitar e Recusar.', defaultAllowed: true },
  { name: 'skill.list', label: 'Ver habilidades', description: 'Consulta as habilidades deste bot.', readOnly: true, defaultAllowed: true },
  { name: 'skill.run', label: 'Usar habilidades', description: 'Roda no celular uma habilidade deste bot (um programa que você aprovou) e lê o resultado.', readOnly: true, defaultAllowed: true },
  { name: 'skill.propose', label: 'Criar habilidades', description: 'Propõe instalar no celular um programa que o bot escreveu (ex.: buscar vagas todo dia), com os sites que ele acessa.', alwaysAsk: true, defaultAllowed: true },
  // One switch for the whole browser; sending a form is a separate decision (browser/write) on the Médio level.
  // The team: bots making bots, opening rooms, adding and removing members. No approval cards; one switch turns it all off.
  { name: 'team', label: 'Equipe de bots', description: 'Criar outros bots, abrir salas, pôr e tirar bots delas, sair sozinho e chamar os outros para trabalhar (@Nome), tudo sem perguntar. Um bot nunca cria outro com mais acesso do que o próprio. Desligado em Pouco acesso, a menos que você ligue.', defaultAllowed: true },
  { name: 'browser', label: 'Navegador', description: 'Abre sites no navegador do bot (dentro do MyBots), lê, clica e preenche. Por padrão é o navegador compartilhado: o bot age logado nas contas em que você entrou nele. Senhas só você digita, pelo botão Assumir.', readOnly: true },
  // Only on the Livre level: the other apps of the phone (MyBotsAccess) and Termux's whole shell.
  { name: 'phone', label: 'Controlar o celular', description: 'Vê a tela, toca, digita, rola e abre apps no celular pelo serviço de acessibilidade do MyBots, com um botão Parar sempre visível. Senhas aparecem mascaradas; códigos de verificação vão direto para o campo, sem o bot ver.' },
  { name: 'termux', label: 'Terminal do Termux', description: 'Quando o bot responde pelo celular: o shell completo do Termux para instalar pacotes, rodar scripts e usar o Termux:API.' }
];
// What still asks on the Livre level: the person edits this list in the app; the model never sees a way to change it.
export const FREE_ASK_OPTIONS = [
  ['risky', 'Comandos perigosos', 'sudo, apagar pastas inteiras e git push, no computador ou no Termux.', true],
  ['skill.propose', 'Instalar habilidades', 'Programas que o bot escreve para rodar sozinhos no celular.', true],
  ['browser/upload', 'Anexar arquivos em sites', 'Mandar um arquivo seu para um site.', true],
  ['sms.send', 'Enviar SMS', 'Pelo seu chip.', true],
  ['wallet/pay', 'Pagar com a carteira', 'Cada pagamento com o cartão guardado.', true],
  ['browser/submit', 'Enviar formulários no navegador', 'Botões de enviar, confirmar e arrastar.', false],
  ['browser/login', 'Entrar com senha salva', 'O bot nunca vê a senha, mas entra na sua conta.', false],
  ['phone.fill_code', 'Preencher códigos de verificação', 'Mesmo com o remetente e o site certos.', false],
  ['termux', 'Comandos no Termux', 'Qualquer comando no terminal do celular.', false],
  ['computer/shell', 'Comandos no computador', 'Qualquer comando no terminal do PC.', false],
  ['account.connectors/write', 'Agir nos apps da conta', 'Gmail, Agenda, Drive e outros: enviar, criar, apagar.', false],
  ['desktop', 'Controlar a tela do computador', 'Cliques e teclas no PC (a permissão própria continua valendo).', false],
  ['notify.user', 'Mandar notificações', '', false],
  ['routine.create', 'Criar rotinas', '', false]
];
// Retired from the list: on Livre the bot opens apps, taps, types and scrolls on its own, as the person asked. An old saved list may still carry them.
export const FREE_ASK_RETIRED = ['phone/act', 'phone.open_app'];
export const FREE_ASK_DEFAULT = FREE_ASK_OPTIONS.filter(item => item[3]).map(item => item[0]);
export function validFreeAsk(list) {
  return Array.isArray(list) && list.length <= FREE_ASK_OPTIONS.length && list.every(key => FREE_ASK_OPTIONS.some(item => item[0] === key));
}
export const BROWSER_TOOLS = ['browser.act', 'browser.tabs', 'browser.find', 'browser.open', 'browser.read', 'browser.click', 'browser.type', 'browser.upload', 'browser.login', 'browser.pay', 'browser.wait', 'browser.screenshot', 'browser.ask_user', 'browser.viewport'];
export const TEAM_TOOLS = ['team.bots', 'team.rooms', 'team.create_bot', 'team.create_room', 'team.add_to_room', 'team.remove_from_room', 'team.leave_room', 'team.close_room', 'team.post', 'team.read_room', 'team.ask', 'team.answer'];
export const DESKTOP_TOOLS = ['desktop.screenshot', 'desktop.windows', 'desktop.focus', 'desktop.launch', 'desktop.click', 'desktop.type', 'desktop.key'];
export const PHONE_TOOLS = ['phone.screen', 'phone.tap', 'phone.type', 'phone.scroll', 'phone.open_app', 'phone.back', 'phone.fill_code', 'phone.ask_user'];
/** The permission a tool is decided by: every browser tool shares the "browser" switch. */
export const grantOf = tool => BROWSER_TOOLS.includes(tool) ? 'browser' : DESKTOP_TOOLS.includes(tool) ? 'desktop' : TEAM_TOOLS.includes(tool) ? 'team' : PHONE_TOOLS.includes(tool) ? 'phone' : tool;
export const AVATARS = ['orbit', 'pixel', 'cat', 'spark'];
// Pouco acesso, médio (pergunta na primeira vez), acesso total e livre (nada pergunta, salvo a lista "sempre perguntar"
// e os limites duros). Bots without a level keep their switches.
export const ACCESS_LEVELS = ['basic', 'ask', 'full', 'free'];
// Where a bot lives: on the phone, on the computer (offline while it is off) or wherever is on (the computer when connected).
export const HOMES = ['phone', 'pc', 'any'];
// Keys, passwords and the MyBots pairing on the computer: out of reach whatever the level.
export const SENSITIVE = /(^|[\s/~'"=])\.(ssh|gnupg|password-store|mybots-pc|aws|kube|docker)(\/|\s|$|['"])|\.claude\/\.credentials|\.codex\/auth\.json|\.config\/(gh|rclone)\b|\/etc\/(shadow|sudoers)|keyrings?\b/i;
/** Folders on the computer a bot may edit besides its own (~/vscodeProjects, /home/ana/Projetos). */
export function validFolders(list) {
  if (!Array.isArray(list) || list.length > 10) return false;
  return list.every(path => typeof path === 'string' && /^(~|\/)[^\u0000-\u001f]{0,300}$/.test(path) && !/(^|\/)\.\.(\/|$)/.test(path) && !SENSITIVE.test(path) && !['/', '~', '~/'].includes(path.trim()));
}
export { browserMode, browserSlot } from '../mobile/local.js';
import { BROWSER_MODES } from '../mobile/local.js';
import agentSkills from '../lib/agent-skills.cjs';
// A bot's face: a seed, an optional color (#rrggbb) and the choices the person made for the body (`mimo`; what is not there comes from the
// seed). `pieces` is what the earlier character faces saved: accepted so older bots still validate, no longer used.
export function validFace(face) {
  if (!face || typeof face !== 'object' || Array.isArray(face)) return false;
  if (typeof face.seed !== 'string' || !face.seed.trim() || face.seed.length > 40 || /[\u0000-\u001f]/.test(face.seed)) return false;
  if (face.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(face.color)) return false;
  if (face.pieces !== undefined && (!face.pieces || typeof face.pieces !== 'object' || Array.isArray(face.pieces) || Object.values(face.pieces).some(value => typeof value !== 'string' || value.length > 20))) return false;
  if (face.mimo !== undefined) {
    const o = face.mimo; if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    for (const [key, value] of Object.entries(o)) {
      if (key in LIMITS) { if (!Number.isFinite(value) || value < LIMITS[key][0] || value > LIMITS[key][1]) return false; }
      else if (key === 'eyes') { if (![1, 2, 3].includes(value)) return false; }
      else if (key === 'eyeStyle') { if (!EYE_STYLES[value]) return false; }
      else if (key === 'mouth') { if (!MOUTHS[value]) return false; }
      else if (key === 'top') { if (!TOPS[value]) return false; }
      else if (key === 'blush') { if (typeof value !== 'boolean') return false; }
      else return false;
    }
  }
  return Object.keys(face).every(key => ['seed', 'color', 'pieces', 'mimo'].includes(key));
}
export function validateProfile(data) {
  if (data.isChief !== undefined && typeof data.isChief !== 'boolean') throw new Error('Papel de Chefe inválido.');
  if (data.googleAccount !== undefined && data.googleAccount !== '' && !validGoogleAccount(data.googleAccount)) throw new Error('Informe um e-mail Google válido.');
  if (data.face !== undefined && !validFace(data.face)) throw new Error('Escolha um rosto válido.');
  if (data.aiAccount !== undefined && data.aiAccount !== '' && !/^[a-z0-9-]{1,24}$/.test(data.aiAccount)) throw new Error('Escolha uma conta de IA válida.');
  if (data.gpu !== undefined && typeof data.gpu !== 'boolean') throw new Error('Escolha se o bot usa a placa de vídeo.');
  if (data.skills !== undefined && (!agentSkills.validSkills(data.skills) || data.skills.some(item => SENSITIVE.test(item.path) || item.path.split('/').filter(Boolean).length < 3))) throw new Error('Use até 20 skills, cada uma uma pasta do computador (nunca a pasta pessoal inteira nem pastas de senhas e chaves).');
  if (data.browserMode !== undefined && ![...BROWSER_MODES, 'own'].includes(data.browserMode)) throw new Error('Escolha um navegador válido.');
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
  const fields = { 'delivery.write': ['topic','text','project'], 'shared.index_read': [], 'shared.note_read': ['path','list','prefix'],
    'shared.note_write': ['path','text','overwrite'], 'shared.archive': ['path','summary'], 'memory.read': ['key','query','list'], 'memory.write': ['key','text'], 'memory.delete': ['key'], 'task.create_item': ['title','details','course','due','source'], 'task.list_items': ['state','limit'],
    'task.update_item': ['id','title','details','course','due','source','done'], 'notify.user': ['title','body'],
    'email.search': ['query','from','subject','since','limit'], 'email.read': ['uid'],
    'notifications.recent': ['app','query','sinceMinutes','limit'], 'sms.search': ['query','number','limit'], 'sms.send': ['number','text'],
    'contacts.search': ['query','limit'], 'calls.search': ['query','limit'], 'location.get': ['provider'], 'device.status': [],
    'attachment.read': ['id','offset','page','as_image'], 'file.list': ['limit'], 'file.create': ['name','format','content','send'], 'file.send': ['id', 'path'], 'connector.permission': ['tool_name', 'input', 'tool_use_id'], 'routine.list': [], 'routine.create': ['title','instructions','trigger','room'], 'routine.update': ['id','enabled','delete'],
    'browser.act': ['action','x','y','dx','dy','key','toX','toY'], 'browser.tabs': ['action','tab','url'], 'browser.find': ['query','limit'], 'browser.open': ['url'], 'browser.read': ['main','max_chars','maxChars'], 'browser.click': ['id'], 'browser.type': ['id','text','submit'], 'browser.upload': ['id','file'], 'browser.login': [], 'browser.pay': ['store','items','category','total','card'], 'browser.wait': ['text','selector','url','timeoutSeconds'], 'browser.screenshot': ['marks'], 'browser.ask_user': ['reason'],
    'desktop.screenshot': [], 'desktop.windows': [], 'desktop.focus': ['address'], 'desktop.launch': ['app'], 'desktop.click': ['x','y','button'], 'desktop.type': ['text'], 'desktop.key': ['keys'],
    'team.update_bot': ['bot','name','instructions','reason'], 'team.routines': ['bot'], 'team.routine_update': ['bot','id','action','title','instructions','trigger','room','reason'], 'team.usage': [],
    'profile.read': [], 'profile.write': ['text','reason'], 'team.overlap': [],
    'canvas.read': ['area'], 'canvas.add': ['kind','title','area','text','html','chart','table','columns','rows','by','sum','file','x','y','w','h','near','label'],
    'canvas.update': ['id','title','area','text','html','chart','table','columns','rows','by','sum','file','x','y','w','h'], 'canvas.link': ['from','to','label'], 'canvas.remove': ['id'], 'browser.viewport': ['size','width','height'],
    'table.list': [], 'table.read': ['table','where','query','limit'], 'table.add': ['table','row','unique'], 'table.update': ['table','id','row'], 'table.delete': ['table','id'],
    'user.decide': ['question','options','deadline_hours','on_timeout'], 'user.decisions': ['state','limit','bot'],
    'team.status': [], 'team.bots': ['bot'], 'team.rooms': [], 'team.create_bot': ['name','instructions','color','avatar','access','home'], 'team.create_room': ['name','bots','message'], 'team.add_to_room': ['room','bot'],
    'team.remove_from_room': ['room','bot'], 'team.leave_room': ['room'], 'team.close_room': ['room'], 'team.post': ['room','text'], 'team.read_room': ['room','limit'], 'team.ask': ['bot','text'], 'team.answer': ['task'],
    'phone.screen': ['image'], 'phone.tap': ['id','x','y','long'], 'phone.type': ['id','text','submit'], 'phone.scroll': ['direction','id'], 'phone.open_app': ['app'], 'phone.back': ['home'], 'phone.fill_code': ['from','id','where'], 'phone.ask_user': ['reason'],
    'negotiation.status': [], 'negotiation.offer': ['channel','to','amount','text','negotiation'], 'negotiation.close': ['channel','to','amount','summary','negotiation'], 'skill.list': [], 'skill.run': ['name','input'], 'skill.propose': ['name','title','description','code','sites','example_input','timeout_seconds','new_bot','daily_at'] }[tool];
  // Say which argument was not accepted and which ones are: "não permitido" alone left the model (and the person) guessing, and the bot
  // stopped at the first failure believing it lacked permission.
  const extra = fields ? Object.keys(args).filter(key => !fields.includes(key)) : [];
  if (!fields) throw new Error('Ferramenta ou argumento não permitido.');
  if (extra.length) throw new Error(`Ferramenta ou argumento não permitido: ${tool.replace('.', '_')} não aceita ${extra.slice(0, 5).map(key => `"${String(key).slice(0, 30)}"`).join(', ')}. Os argumentos aceitos são: ${fields.length ? fields.join(', ') : 'nenhum'}. Não é falta de permissão: tente de novo só com esses.`);
  const text = (name, max, optional = false) => {
    // Models often send "" for a filter they do not want; for optional fields that means no filter.
    if (optional && (args[name] === undefined || args[name] === null || (typeof args[name] === 'string' && !args[name].trim()))) return '';
    if (typeof args[name] !== 'string' || !args[name].trim() || args[name].length > max || /\u0000/.test(args[name])) throw new Error('Preencha os argumentos da ferramenta dentro dos limites.');
    return args[name].trim();
  };
  // Checked in full by the code that runs them (shared-data.mjs, routines, the team): here only the size.
  // The canvas: html up to 120.000 characters; the rest is checked by canvas.mjs.
  if (/^canvas\./.test(tool)) { if (JSON.stringify(args).length > 160000) throw new Error('Argumentos grandes demais para o canvas.'); return args; }
  if (/^(table|user|profile)\./.test(tool) || ['team.update_bot', 'team.routines', 'team.routine_update', 'team.usage', 'team.overlap'].includes(tool)) {
    if (JSON.stringify(args).length > 12000) throw new Error('Argumentos grandes demais.');
    return args;
  }
  if (tool === 'delivery.write') { const project = text('project', 80, true); return { topic: checkBody(text('topic', 80)), text: checkBody(text('text', 4000)), ...(project ? { project: checkBody(project) } : {}) }; }
  if (tool === 'shared.index_read') return {};
  if (tool.startsWith('shared.')) {
    for (const key of ['list', 'overwrite']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error('Use true ou false em ' + key + '.');
    if (args.list) {
      if (args.path !== undefined) throw new Error('Escolha path ou list.');
      const prefix = args.prefix === undefined ? '' : args.prefix;
      if (typeof prefix !== 'string' || prefix.length > 120 || /[^a-zA-Z0-9_./-]/.test(prefix) || prefix.startsWith('/') || prefix.includes('..')) throw new Error('Prefixo de notas inválido.');
      return { list: true, prefix };
    }
    const { path } = args;
    if (args.prefix !== undefined || !validPath(path)) throw new Error('Caminho de nota inválido. A regra: começa com chefe/ (suas notas, ex.: chefe/pessoas/ana.md ou chefe/projetos/vagas.md), entregas/ ou arquivo/ (essas duas vêm de delivery_write e shared_archive); termina em .md; só letras sem acento, números, - _ . e / (sem espaço); até 120 caracteres.');
    if (tool === 'shared.note_read') return { path };
    if (tool === 'shared.archive' && path.startsWith('entregas/')) return { path, summary: checkBody(text('summary', 4000, true)) };
    if (tool === 'shared.note_write' && path.startsWith('chefe/')) {
      text('text', 8000);
      return { path, text: checkBody(args.text), overwrite: args.overwrite === true };
    }
    throw new Error('Caminho não permitido para esta ferramenta.');
  }
  if (tool === 'memory.read') {
    if (args.list !== undefined && typeof args.list !== 'boolean') throw new Error('Use list true para ver só as chaves.');
    return { key: text('key', 80, true), query: text('query', 200, true), list: args.list === true };
  }
  if (tool === 'memory.write') return { key: text('key', 80), text: text('text', 4000) };
  if (tool === 'memory.delete') return { key: text('key', 80) };
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
  if (tool === 'team.bots') return {};
  if (tool === 'team.status' || tool === 'team.rooms') return {};
  if (tool === 'team.create_bot') {
    const color = text('color', 10, true); const avatar = text('avatar', 10, true); const access = text('access', 10, true); const home = text('home', 10, true);
    if (color && !['green','blue','purple','orange'].includes(color)) throw new Error('Use color green, blue, purple ou orange.');
    if (avatar && !AVATARS.includes(avatar)) throw new Error('Use avatar orbit, pixel, cat ou spark.');
    if (access === 'free') throw new Error('Só a pessoa põe um bot no nível Livre, pelo app. Use access basic, ask ou full.');
    if (access && !ACCESS_LEVELS.includes(access)) throw new Error('Use access basic, ask ou full.');
    if (home && !HOMES.includes(home)) throw new Error('Use home phone, pc ou any.');
    return { name: text('name', 40), instructions: text('instructions', 2000, true), ...(color ? { color } : {}), ...(avatar ? { avatar } : {}), ...(access ? { access } : {}), ...(home ? { home } : {}) };
  }
  if (tool === 'team.create_room') {
    if (!Array.isArray(args.bots) || args.bots.length < 1 || args.bots.length > 7 || args.bots.some(item => typeof item !== 'string' || !item.trim() || item.length > 60)) throw new Error('Em bots, liste de 1 a 7 nomes (ou ids) de bots; você entra na sala sozinho.');
    return { name: text('name', 40), bots: args.bots.map(item => item.trim()), message: text('message', 4000, true) };
  }
  if (tool === 'team.add_to_room' || tool === 'team.remove_from_room') return { room: text('room', 60), bot: tool === 'team.add_to_room' ? text('bot', 60) : text('bot', 60, true) };
  if (tool === 'team.leave_room' || tool === 'team.close_room') return { room: text('room', 60) };
  if (tool === 'team.post') return { room: text('room', 60), text: text('text', 4000) };
  if (tool === 'team.ask') return { bot: text('bot', 60), text: text('text', 4000) };
  if (tool === 'team.answer') return { task: text('task', 40) };
  if (tool === 'team.read_room') return { room: text('room', 60), limit: integer('limit', 1, 60, 30) };
  if (tool === 'negotiation.status') return {};
  if (tool === 'negotiation.offer' || tool === 'negotiation.close') {
    if (!['whatsapp', 'olx', 'marketplace', 'email'].includes(args.channel)) throw new Error('Em channel, use whatsapp, olx, marketplace ou email.');
    if (typeof args.amount !== 'number') throw new Error('Em amount, mande o valor em reais, como 850.');
    const note = tool === 'negotiation.offer' ? text('text', 2000) : text('summary', 2000);
    return { channel: args.channel, to: text('to', 200), amount: args.amount, [tool === 'negotiation.offer' ? 'text' : 'summary']: note, ...(args.negotiation === undefined ? {} : { negotiation: text('negotiation', 40) }) };
  }
  if (tool === 'skill.list') return {};
  if (tool === 'skill.run') {
    const input = args.input === undefined ? {} : args.input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 10000) throw new Error('Em input, mande um objeto JSON pequeno.');
    return { name: text('name', 40), input };
  }
  // The proposal itself is checked by skillProposal (supervisor/skills.mjs) when it runs.
  if (tool === 'skill.propose') { if (JSON.stringify(args).length > 260000) throw new Error('Proposta grande demais.'); return args; }
  if (tool === 'browser.read') {
    // main: only the page's main content (no menus, header, footer); max_chars: a shorter text (500 to 20.000).
    if (args.main !== undefined && typeof args.main !== 'boolean') throw new Error('Use main true para ler só o conteúdo principal.');
    // maxChars is this function's own output: the computer's browser checks the arguments again after the supervisor did.
    const maxChars = args.max_chars ?? args.maxChars;
    if (maxChars !== undefined && (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 20000)) throw new Error('max_chars vai de 500 a 20000.');
    return { ...(args.main ? { main: true } : {}), ...(maxChars ? { maxChars } : {}) };
  }
  if (tool === 'device.status' || tool === 'routine.list' || tool === 'browser.login') return {};
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
  if (tool === 'browser.viewport') {
    if (args.size !== undefined) { if (!['celular', 'tablet', 'computador'].includes(args.size)) throw new Error('size é celular, tablet ou computador.'); return { size: args.size }; }
    return { width: integer('width', 280, 2560), height: integer('height', 300, 2560) };
  }
  if (tool === 'browser.tabs') {
    if (!['list','switch','new','close'].includes(args.action)) throw new Error('Ação de abas inválida.');
    return { action: args.action, ...(['switch','close'].includes(args.action) || args.tab !== undefined ? { tab: integer('tab', 1, 5) } : {}), ...(args.url !== undefined ? { url: safeUrl(text('url', 2000), { local: true }) } : {}) };
  }
  if (tool === 'browser.find') return { query: text('query', 200), limit: integer('limit', 1, 20, 5) };
  if (tool === 'browser.screenshot') {
    if (args.marks !== undefined && typeof args.marks !== 'boolean') throw new Error('Use marks true ou false.');
    return { marks: args.marks === true };
  }
  // A local development site passes here; whether this bot may open it is decided where it runs (tools.mjs).
  if (tool === 'browser.open') return { url: safeUrl(text('url', 2000), { local: true }) };
  if (tool === 'browser.click') return { id: integer('id', 1, 100000) };
  if (tool === 'browser.type') {
    if (args.submit !== undefined && typeof args.submit !== 'boolean') throw new Error('Use submit true ou false.');
    if (typeof args.text !== 'string' || args.text.length > 2000 || /\u0000/.test(args.text)) throw new Error('Texto até 2.000 caracteres.');
    return { id: integer('id', 1, 100000), text: args.text, submit: args.submit === true };
  }
  // The wallet's rules and the checkout's own total are checked in the app; here, only the shape of what the bot declares.
  if (tool === 'browser.pay') {
    if (!Array.isArray(args.items) || !args.items.length || args.items.length > 20 || args.items.some(item => typeof item !== 'string' || !item.trim() || item.length > 200)) throw new Error('Em items, liste de 1 a 20 itens da compra.');
    if (typeof args.total !== 'number' || !Number.isFinite(args.total) || args.total <= 0 || args.total > 1e7 || Math.abs(Math.round(args.total * 100) - args.total * 100) > 1e-6) throw new Error('Em total, mande o valor em reais com até duas casas, como 129.9.');
    if (args.card !== undefined && !/^[0-9]{4}$/.test(String(args.card))) throw new Error('Em card, informe só os 4 últimos dígitos do cartão (ex.: 1234), como a carteira mostra.');
    return { store: text('store', 200), items: args.items.map(item => item.trim()), category: text('category', 100), total: Math.round(args.total * 100), ...(args.card === undefined ? {} : { card: String(args.card) }) };
  }
  if (tool === 'browser.upload') {
    if (typeof args.file !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.file)) throw new Error('Em file, informe o id de um arquivo deste bot (veja em files_list).');
    return { id: integer('id', 1, 100000), file: args.file.toLowerCase() };
  }
  if (tool === 'browser.wait') return { url: text('url', 200, true), text: text('text', 200, true), selector: text('selector', 200, true), timeoutSeconds: integer('timeoutSeconds', 1, 30, 10) };
  if (tool === 'browser.ask_user' || tool === 'phone.ask_user') return { reason: text('reason', 300) };
  if (tool === 'phone.screen') {
    if (args.image !== undefined && typeof args.image !== 'boolean') throw new Error('Use image true ou false.');
    return { image: args.image === true };
  }
  if (tool === 'phone.tap') {
    if (args.long !== undefined && typeof args.long !== 'boolean') throw new Error('Use long true ou false.');
    if (args.id !== undefined) { if (args.x !== undefined || args.y !== undefined) throw new Error('Use id ou x/y, não os dois.'); return { id: integer('id', 1, 5000), long: args.long === true }; }
    return { x: integer('x', 0, 10000), y: integer('y', 0, 10000), long: args.long === true };
  }
  if (tool === 'phone.type') {
    if (args.submit !== undefined && typeof args.submit !== 'boolean') throw new Error('Use submit true ou false.');
    if (typeof args.text !== 'string' || args.text.length > 2000 || /\u0000/.test(args.text)) throw new Error('Texto até 2.000 caracteres.');
    return { id: integer('id', 1, 5000), text: args.text, submit: args.submit === true };
  }
  if (tool === 'phone.scroll') {
    if (!['up', 'down', 'left', 'right'].includes(args.direction)) throw new Error('Use direction up, down, left ou right.');
    return { direction: args.direction, ...(args.id !== undefined ? { id: integer('id', 1, 5000) } : {}) };
  }
  if (tool === 'phone.open_app') {
    const app = text('app', 100);
    if (/[\n\r/\\]/.test(app)) throw new Error('Informe o nome do app (como aparece no celular) ou o pacote, como com.android.settings.');
    return { app };
  }
  if (tool === 'phone.back') {
    if (args.home !== undefined && typeof args.home !== 'boolean') throw new Error('Use home true ou false.');
    return { home: args.home === true };
  }
  if (tool === 'phone.fill_code') {
    const where = args.where === undefined ? 'phone' : args.where;
    if (!['phone', 'browser'].includes(where)) throw new Error('Use where phone (outro app) ou browser (o navegador do bot no celular).');
    return { from: text('from', 100), id: integer('id', 1, where === 'browser' ? 100000 : 5000), where };
  }
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
    if (typeof args.path === 'string' && args.path.trim() && args.id === undefined) { if (args.path.length > 1000 || args.path.includes('\0')) throw new Error('Caminho inválido.'); return { path: args.path.trim() }; }
    if (typeof args.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.id)) throw new Error('Informe o id de um arquivo deste bot (veja em files_list) ou o caminho (path) de um arquivo na sua pasta de trabalho.');
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
