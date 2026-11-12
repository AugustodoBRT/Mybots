// A página do dono: lista os relatos, mostra a foto e muda o estado. Todo texto vindo de quem relatou entra só como texto.
const PLATFORMS = { android: 'Android', pc: 'Computador', iphone: 'iPhone', web: 'Navegador' };
const list = document.getElementById('list'), empty = document.getElementById('empty'), search = document.getElementById('search');
let reports = [], filter = 'novo';

const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(item => item != null)); return node; };
const when = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const size = bytes => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

async function api(path, body) {
  const response = await fetch('/relatos/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relatos': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não deu certo.');
  return data;
}

async function load() {
  try {
    const data = await api('lista'); reports = data.reports;
    document.getElementById('summary').textContent = `${reports.length} ${reports.length === 1 ? 'relato' : 'relatos'} · ${size(data.used)} de ${size(data.limit)}`;
    render();
  } catch (error) { document.getElementById('summary').textContent = error.message; }
}

async function change(report, body, path = 'estado') {
  try { await api(path, { id: report.id, ...body }); await load(); } catch (error) { alertLine(report.id, error.message); }
}
const alertLine = (id, text) => { const node = document.querySelector(`[data-id="${id}"] .meta`); if (node) node.append(el('span', { textContent: text, className: 'error' })); };

function card(report) {
  const remove = el('button', { textContent: 'Apagar', className: 'danger' });
  // Dois toques para apagar: o primeiro só arma o botão.
  remove.onclick = () => { if (remove.classList.contains('armed')) change(report, {}, 'apagar'); else { remove.classList.add('armed'); remove.textContent = 'Toque de novo para apagar'; setTimeout(() => { remove.classList.remove('armed'); remove.textContent = 'Apagar'; }, 4000); } };
  const next = { novo: [['visto', 'Marcar como visto'], ['resolvido', 'Resolvido']], visto: [['resolvido', 'Resolvido'], ['novo', 'Voltar para novo']], resolvido: [['novo', 'Reabrir']] }[report.state] || [];
  const copy = el('button', { textContent: 'Copiar texto', onclick: () => navigator.clipboard?.writeText(report.text).then(() => { copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar texto'; }, 1500); }) });
  const photo = report.image ? el('img', { className: 'photo', src: `/relatos/foto/${report.id}`, alt: 'Foto enviada com o relato', loading: 'lazy', onclick: () => open(`/relatos/foto/${report.id}`) }) : null;
  const node = el('article', { className: report.state },
    el('div', { className: 'meta' }, el('span', { className: `badge ${report.state}`, textContent: report.state }), el('span', { textContent: when(report.createdAt) }),
      el('span', { textContent: PLATFORMS[report.platform] || report.platform }), report.version ? el('span', { textContent: `versão ${report.version}` }) : null,
      report.device ? el('span', { textContent: report.device }) : null),
    el('div', { className: 'text', textContent: report.text }), photo,
    el('div', { className: 'actions' }, ...next.map(([state, label]) => el('button', { textContent: label, onclick: () => change(report, { state }) })), copy, remove));
  node.dataset.id = report.id; return node;
}

function render() {
  const counts = { novo: 0, visto: 0, resolvido: 0, todos: reports.length };
  for (const report of reports) counts[report.state]++;
  for (const node of document.querySelectorAll('[data-count]')) node.textContent = counts[node.dataset.count];
  const needle = search.value.trim().toLowerCase();
  const shown = reports.filter(report => (filter === 'todos' || report.state === filter) && (!needle || [report.text, report.version, report.device, report.platform].join(' ').toLowerCase().includes(needle)));
  list.replaceChildren(...shown.map(card)); empty.hidden = shown.length > 0;
}

const viewer = document.getElementById('viewer');
function open(src) { document.getElementById('viewerImage').src = src; viewer.hidden = false; }
viewer.onclick = () => { viewer.hidden = true; };
document.addEventListener('keydown', event => { if (event.key === 'Escape') viewer.hidden = true; });
for (const button of document.querySelectorAll('[data-filter]')) button.onclick = () => {
  filter = button.dataset.filter; for (const other of document.querySelectorAll('[data-filter]')) other.classList.toggle('on', other === button); render();
};
search.oninput = render;
load(); setInterval(() => { if (!document.hidden) load(); }, 30000);
