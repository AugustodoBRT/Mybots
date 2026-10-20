const $ = selector => document.querySelector(selector);
const state = { bots: [], active: [], connection: {}, models: [], modelsError: '', defaultSelection: null,
  selected: localStorage.getItem('mybots-selected'), sending: false, savingModel: false };
let lastView = '', lastList = '', disconnected = false;
const effortNames = { none: 'Sem raciocínio', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo', ultra: 'Ultra' };

function modelName(model) { return state.models.find(item => item.model === model)?.displayName || model; }
function configurationLabel(value) {
  return value.model ? [modelName(value.model), effortNames[value.reasoningEffort] || value.reasoningEffort].filter(Boolean).join(' · ') : 'Modelo não registrado';
}
function configurePicker(modelSelect, effortSelect, selection, disabled = false) {
  const model = state.models.find(item => item.model === selection?.model);
  const signature = JSON.stringify([state.models, selection, disabled]);
  if (modelSelect.dataset.signature === signature) return;
  modelSelect.dataset.signature = signature;
  modelSelect.replaceChildren();
  if (!model) modelSelect.append(new Option(state.models.length ? 'Escolha o modelo' : 'Modelos indisponíveis', ''));
  for (const item of state.models) modelSelect.append(new Option(item.displayName, item.model));
  modelSelect.value = model?.model || '';
  modelSelect.disabled = disabled || !state.models.length;
  effortSelect.replaceChildren();
  if (!model || !model.efforts.length) effortSelect.append(new Option('Padrão do modelo', ''));
  else for (const effort of model.efforts) effortSelect.append(new Option(effortNames[effort] || effort, effort));
  effortSelect.value = selection?.reasoningEffort || model?.defaultEffort || '';
  effortSelect.disabled = disabled || !model?.efforts.length;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function avatar(bot) { return element('div', `avatar ${bot.color}`, bot.name.slice(0, 1).toLocaleUpperCase('pt-BR')); }
async function api(path, data) {
  let response;
  try {
    response = await fetch(path, data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MyBots': '1' }, body: JSON.stringify(data)
    });
  } catch { throw new Error('O app perdeu a conexão. Confira se ele continua aberto no terminal.'); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Não foi possível concluir o pedido.');
  return value;
}
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { $('#toast').hidden = true; }, 7000);
}
function toggleMenu(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#backdrop').hidden = !open;
  $('#menu-button').setAttribute('aria-expanded', String(open));
}
function selectBot(id) {
  state.selected = id;
  localStorage.setItem('mybots-selected', id);
  lastView = '';
  $('#message-input').value = '';
  $('#message-input').style.height = '';
  toggleMenu(false);
  render();
  if (matchMedia('(min-width: 761px)').matches) $('#message-input').focus();
}
function renderList() {
  const signature = JSON.stringify([state.selected, state.active, state.bots.map(bot => [bot.id, bot.name, bot.color, bot.updatedAt, bot.messages.at(-1)?.text])]);
  if (signature === lastList) return;
  lastList = signature;
  const list = $('#bot-list');
  list.replaceChildren();
  for (const bot of [...state.bots].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const button = element('button', 'bot-item' + (bot.id === state.selected ? ' selected' : ''));
    if (bot.id === state.selected) button.setAttribute('aria-current', 'true');
    const text = element('span', 'bot-item-text');
    text.append(element('span', 'bot-item-name', bot.name), element('span', 'bot-item-preview',
      state.active.includes(bot.id) ? 'Escrevendo uma resposta…' : bot.messages.at(-1)?.text || 'Uma nova conversa espera por você'));
    button.append(avatar(bot), text, element('span', 'bot-item-arrow', '›'));
    button.addEventListener('click', () => selectBot(bot.id));
    list.append(button);
  }
  $('#bot-count').textContent = state.bots.length;
  $('#list-empty').hidden = state.bots.length > 0;
}
function renderMessages(bot, busy) {
  const container = $('#messages');
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 110;
  const view = JSON.stringify([bot.id, bot.messages, busy, state.models]);
  if (view === lastView) return;
  const changedBot = !lastView || JSON.parse(lastView)[0] !== bot.id;
  lastView = view;
  container.replaceChildren();
  if (!bot.messages.length) {
    const empty = element('div', 'chat-empty');
    empty.append(avatar(bot), element('h2', '', `Diga oi para ${bot.name}.`),
      element('p', '', 'Pode ser uma pergunta, uma ideia solta ou só um oi. A conversa é sua.'));
    const start = element('button', 'greeting-prompt', 'Oi! Vamos nos conhecer? ↗');
    start.addEventListener('click', () => { $('#message-input').value = 'Oi! Vamos nos conhecer?'; void sendMessage(); });
    start.disabled = busy;
    empty.append(start);
    container.append(empty);
  }
  for (const message of bot.messages) {
    const row = element('article', `message ${message.role}`);
    row.append(avatar(bot));
    const content = element('div', 'message-content');
    const meta = element('div', 'message-meta');
    const time = new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    meta.append(element('strong', '', message.role === 'user' ? 'Você' : bot.name), element('span', '', time));
    if (message.role === 'assistant') meta.append(element('span', 'message-model', configurationLabel(message)));
    content.append(meta, element('p', 'message-text', message.text));
    if (message.status === 'error') {
      content.append(element('p', 'message-error', message.error || 'A resposta não foi concluída.'));
      const retry = element('button', 'retry', 'Tentar novamente');
      retry.disabled = busy;
      retry.addEventListener('click', () => { $('#message-input').value = message.text; void sendMessage(); });
      content.append(retry);
    }
    row.append(content);
    container.append(row);
  }
  if (busy) {
    const row = element('div', 'message assistant');
    const typing = element('div', 'typing');
    for (let i = 0; i < 3; i++) typing.append(element('span'));
    row.append(avatar(bot), typing, element('span', 'typing-label', `${bot.name} está pensando…`));
    container.append(row);
  }
  if (changedBot || wasNearBottom) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}
function render() {
  renderList();
  $('#connection-label').textContent = state.connection.loggedIn ? 'Codex conectado' : 'Conectar ao Codex';
  $('#connection-dot').className = 'status-dot' + (state.connection.loggedIn ? '' : ' error');
  $('#connection').title = state.connection.message || 'Verificar conexão';
  const bot = state.bots.find(bot => bot.id === state.selected);
  $('#welcome').hidden = Boolean(bot);
  $('#chat').hidden = !bot;
  $('#welcome [data-create]').firstChild.textContent = state.bots.length ? 'Criar mais um bot ' : 'Criar meu primeiro bot ';
  $('#breadcrumb').replaceChildren(document.createTextNode('Seu espaço '), element('span', '', '/'), element('strong', '', bot?.name || 'Início'));
  if (!bot) return;
  $('#chat-name').textContent = bot.name;
  const headerAvatar = $('#chat-avatar');
  headerAvatar.className = `avatar ${bot.color}`;
  headerAvatar.textContent = bot.name.slice(0, 1).toLocaleUpperCase('pt-BR');
  const busy = state.active.includes(bot.id) || state.sending;
  const selection = bot.model ? bot : state.defaultSelection;
  configurePicker($('#chat-model'), $('#chat-effort'), selection, busy || state.savingModel);
  $('#model-status').textContent = state.savingModel ? 'Salvando…' : busy ? 'Em uso nesta resposta' : selection?.model ? 'Para a próxima resposta' : 'Selecione antes de conversar';
  $('#send-button').disabled = busy || state.savingModel || !$('#chat-model').value || !$('#message-input').value.trim();
  $('#message-input').disabled = busy;
  $('#message-input').placeholder = busy ? 'Aguarde a resposta…' : `Converse com ${bot.name}…`;
  $('#chat-alert').hidden = Boolean(state.connection.loggedIn && !state.modelsError);
  $('#chat-alert').textContent = state.modelsError || state.connection.message || 'Verificando conexão…';
  renderMessages(bot, busy);
}
async function refresh() {
  const data = await api('/api/state');
  Object.assign(state, { bots: data.bots, active: data.active, connection: data.connection,
    models: data.models || [], modelsError: data.modelsError || '', defaultSelection: data.defaultSelection });
  $('#device').textContent = data.device;
  render();
}
async function sendMessage(event) {
  event?.preventDefault();
  const text = $('#message-input').value.trim();
  const bot = state.bots.find(bot => bot.id === state.selected);
  if (!text || !bot || state.sending || state.savingModel || state.active.includes(bot.id)) return;
  state.sending = true;
  render();
  try {
    await api(`/api/bots/${bot.id}/messages`, { text });
    $('#message-input').value = '';
    $('#message-input').style.height = '';
    await refresh();
    $('#messages').scrollTop = $('#messages').scrollHeight;
  } catch (error) { notify(error.message); }
  finally { state.sending = false; render(); }
}

for (const button of document.querySelectorAll('[data-create], [data-idea]')) button.addEventListener('click', () => {
  $('#create-form').reset();
  $('#create-error').hidden = true;
  configurePicker($('#bot-model'), $('#bot-effort'), state.defaultSelection);
  $('#catalog-note').textContent = state.modelsError || (state.models.length ? 'As opções são informadas pelo Codex conectado. O acesso depende da sua conta.' : 'Verificando modelos. Você pode escolher o modelo na conversa depois.');
  const ideas = {
    ideas: ['Nico', 'Me ajude a explorar ideias. Faça perguntas, traga possibilidades e mantenha um tom descontraído.'],
    study: ['Lua', 'Estude comigo. Explique com exemplos simples e faça perguntas para conferir se entendi.'],
    chat: ['Bento', 'Converse comigo de forma leve e natural. Seja curioso e tenha senso de humor.']
  };
  if (button.dataset.idea) {
    const [name, instructions] = ideas[button.dataset.idea];
    $('#bot-name').value = name;
    $('#bot-instructions').value = instructions;
  }
  $('#create-dialog').showModal();
});
$('#close-dialog').addEventListener('click', () => $('#create-dialog').close());
$('#create-dialog').addEventListener('click', event => { if (event.target === $('#create-dialog') && event.offsetX < 0) $('#create-dialog').close(); });
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#create-submit').disabled = true;
  $('#create-error').hidden = true;
  try {
    const bot = await api('/api/bots', Object.fromEntries(new FormData(event.target)));
    $('#create-dialog').close();
    await refresh();
    selectBot(bot.id);
  } catch (error) { $('#create-error').textContent = error.message; $('#create-error').hidden = false; }
  finally { $('#create-submit').disabled = false; }
});
$('#message-form').addEventListener('submit', sendMessage);
$('#bot-model').addEventListener('change', event => {
  const model = state.models.find(item => item.model === event.target.value);
  configurePicker($('#bot-model'), $('#bot-effort'), model ? { model: model.model, reasoningEffort: model.defaultEffort } : null);
});
async function saveSelection(model, reasoningEffort) {
  const bot = state.bots.find(item => item.id === state.selected);
  if (!bot || state.savingModel || state.active.includes(bot.id)) return;
  state.savingModel = true;
  render();
  try {
    await api(`/api/bots/${bot.id}/settings`, { model, reasoningEffort });
    await refresh();
  } catch (error) { notify(error.message); }
  finally { state.savingModel = false; render(); }
}
$('#chat-model').addEventListener('change', event => {
  const model = state.models.find(item => item.model === event.target.value);
  if (model) void saveSelection(model.model, model.defaultEffort);
});
$('#chat-effort').addEventListener('change', event => {
  void saveSelection($('#chat-model').value, event.target.value || null);
});
$('#message-input').addEventListener('input', event => {
  event.target.style.height = 'auto';
  event.target.style.height = Math.min(event.target.scrollHeight, 160) + 'px';
  $('#send-button').disabled = !event.target.value.trim() || state.sending || state.savingModel || !$('#chat-model').value || state.active.includes(state.selected);
});
$('#message-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(); }
});
$('#menu-button').addEventListener('click', () => toggleMenu(!$('#sidebar').classList.contains('open')));
$('#backdrop').addEventListener('click', () => toggleMenu(false));
$('.brand').addEventListener('click', event => { event.preventDefault(); state.selected = null; localStorage.removeItem('mybots-selected'); toggleMenu(false); render(); });
$('#connection').addEventListener('click', async () => {
  $('#connection-label').textContent = 'Verificando…';
  try { state.connection = await api('/api/connection', {}); notify(state.connection.message); render(); }
  catch (error) { notify(error.message); }
});
await refresh().catch(error => notify(error.message));
void api('/api/connection', {}).then(() => refresh()).catch(error => notify(error.message));
setInterval(async () => {
  if (document.hidden || (!state.active.length && !disconnected)) return;
  try { await refresh(); disconnected = false; }
  catch (error) { if (!disconnected) notify(error.message); disconnected = true; }
}, 1800);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh().catch(error => notify(error.message)); });
