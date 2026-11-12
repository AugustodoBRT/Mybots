import { fold, uuid } from './validation.mjs';

const kinds = { chefe: 'chefe', entregas: 'entrega', arquivo: 'arquivo' };
// The person's own note, at the center of the memory map: who they are and what they prefer. Every bot reads it (profile_read);
// a bot changes it only through profile_write, which the person approves. It is never archived or pruned.
export const PERSON_NOTE = 'chefe/voce.md';
export const PERSON_TITLE = 'Você';

/** Writes the person's note (creating it the first time), keeping the previous text in arquivo/historico/. Empty text empties it. */
export function writePersonNote(db, text, { botId = null } = {}) {
  checkBody(text);
  const at = new Date().toISOString(), previous = db.get('SELECT * FROM notes WHERE path=?', PERSON_NOTE);
  if (previous) {
    if (previous.body === text) return { path: PERSON_NOTE };
    const history = keepHistory(db, previous, at);
    db.run('UPDATE notes SET body=?,bot_id=?,updated_at=? WHERE path=?', text, botId, at, PERSON_NOTE);
    db.notify('notes.changed', { path: PERSON_NOTE });
    return { path: PERSON_NOTE, history };
  }
  saveNote(db, { path: PERSON_NOTE, bot_id: botId, kind: 'chefe', title: PERSON_TITLE, body: text, created_at: at, updated_at: at });
  return { path: PERSON_NOTE };
}
const secret = /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{12,})|(?:^|\n)[ \t]*(?:password|senha|token|api[_ -]?key)[ \t]*[:=][ \t]*\S|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i;

export function validPath(path) {
  return typeof path === 'string' && path.length <= 120 && path.endsWith('.md') && !path.includes('..') &&
    /^(chefe|entregas|arquivo)\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.md$/.test(path);
}

export function checkBody(body) {
  if (typeof body !== 'string' || body.length > 8000) throw new Error('Use até 8000 caracteres no corpo da nota.');
  if (secret.test(body)) throw new Error('Remova a possível senha, chave ou token antes de salvar a nota.');
  return body;
}

export function checkNote(row) {
  if (!validPath(row?.path) || kinds[row.path.split('/')[0]] !== row.kind || typeof row.title !== 'string' ||
      !(row.bot_id === null || typeof row.bot_id === 'string') ||
      ![row.created_at, row.updated_at].every(at => typeof at === 'string' && Number.isFinite(Date.parse(at)))) throw new Error('Nota inválida.');
  checkBody(row.body);
  checkBody(row.title);
}

const slug = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const FOLDER = /^(?:chefe|entregas|arquivo)\//;

// The targets of [[links]], written like in Obsidian: [[Nome da nota]], [[nome|apelido]], [[nome#seção]] or a path.
export function linkNames(body) {
  const names = new Set();
  for (const match of String(body).matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)) {
    const name = match[1].split('|')[0].split('#')[0].trim();
    if (name && !name.includes('..')) names.add(name);
  }
  return [...names];
}

// Where a link points without looking at the other notes: a path as written, or a note in chefe/ named after it
// ("Central de Vagas" becomes chefe/central-de-vagas.md), the file a [[link]] to a missing note would create.
export function linkPath(name) {
  const file = name.endsWith('.md') ? name : name + '.md';
  if (FOLDER.test(name)) return validPath(file) ? file : null;
  if (validPath('chefe/' + file)) return 'chefe/' + file;
  const stem = slug(name.replace(/\.md$/, ''));
  return stem ? 'chefe/' + stem.slice(0, 110) + '.md' : null;
}

export function links(body) {
  return [...new Set(linkNames(body).map(linkPath).filter(Boolean))];
}

// Other names of a note, in Obsidian's front matter: "aliases: [A, B]" or one "  - A" per line.
export function aliasesOf(body) {
  const front = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(String(body))?.[1];
  if (!front) return [];
  const lines = front.split('\n'), start = lines.findIndex(line => /^aliases\s*:/i.test(line));
  if (start < 0) return [];
  const inline = lines[start].replace(/^aliases\s*:\s*/i, '').trim();
  const names = inline ? inline.replace(/^\[|\]$/g, '').split(',') : lines.slice(start + 1).filter(line => /^\s+-\s/.test(line)).map(line => line.replace(/^\s+-\s*/, ''));
  return names.map(name => name.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

// Resolves link names against existing notes, like Obsidian: the exact path first, then a note whose title or file name
// matches ignoring case, accents and punctuation (chefe/ before entregas/ before arquivo/, newest first).
export function linkResolver(rows) {
  const byPath = new Set(rows.map(row => row.path)), byName = new Map(), rank = { chefe: 0, entrega: 1, arquivo: 2 };
  const add = (key, row) => {
    const old = key && byName.get(key);
    if (key && (!old || rank[row.kind] < rank[old.kind])) byName.set(key, row);
  };
  for (const row of rows) { add(slug(row.title), row); add(slug(row.path.split('/').at(-1).slice(0, -3)), row); for (const alias of aliasesOf(row.body)) add(slug(alias), row); }
  return name => {
    const path = linkPath(name);
    // A delivery linked by its path keeps working after it moves to arquivo/.
    const moved = path?.startsWith('entregas/') && 'arquivo/' + path.slice(9);
    if (moved && !byPath.has(path) && byPath.has(moved)) return moved;
    if (!path || byPath.has(path) || FOLDER.test(name)) return path;
    return byName.get(slug(name.replace(/\.md$/, '')))?.path || path;
  };
}

// Keep room for the timestamp and collision suffix even at the path length limit.
function available(db, stem, ending = '') {
  for (let n = 1; ; n++) {
    const suffix = ending + (n === 1 ? '' : '-' + n) + '.md';
    const path = stem.slice(0, 120 - suffix.length) + suffix;
    if (!db.get('SELECT 1 FROM notes WHERE path=?', path) &&
        !db.get("SELECT 1 FROM changes WHERE tbl='notes' AND key=?", path)) return path;
  }
}

export function saveNote(db, row) {
  checkNote(row);
  db.run('INSERT INTO notes(path,bot_id,kind,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    row.path, row.bot_id, row.kind, row.title, row.body, row.created_at, row.updated_at);
  db.notify('notes.changed', { path: row.path });
}

function keepHistory(db, previous, at) {
  const history = available(db, 'arquivo/historico/' + previous.path.slice(0, -3), '-' + at.replace(/[:.]/g, '-'));
  saveNote(db, { ...previous, path: history, kind: 'arquivo', updated_at: at });
  return history;
}

function archive(db, previous, summary, at) {
  const path = available(db, previous.path.replace(/^[^/]+\//, 'arquivo/').slice(0, -3));
  const body = summary ? previous.body + '\n\nResumo: ' + summary : previous.body;
  saveNote(db, { ...previous, path, kind: 'arquivo', updated_at: at, body });
  db.run('DELETE FROM notes WHERE path=?', previous.path);
  db.notify('notes.changed', { path: previous.path });
  return { path };
}

export function noteTool(db, bot, tool, args) {
  const read = path => db.get('SELECT * FROM notes WHERE path=?', path);
  if (tool === 'shared.index_read') {
    // What the Chefe wrote, plus a part the app keeps up to date by itself: projects, the latest deliveries of each bot and the notes.
    const note = read('chefe/index.md'), names = new Map(db.all("SELECT id, json_extract(body,'$.name') AS name FROM bots").map(row => [row.id, row.name]));
    const projects = db.all('SELECT path,title,updated_at FROM notes WHERE instr(path,?)=1 ORDER BY updated_at DESC LIMIT 30', PROJECTS);
    const deliveries = db.all("SELECT path,title,bot_id,created_at FROM notes WHERE kind='entrega' ORDER BY created_at DESC LIMIT 20");
    const others = db.all("SELECT path,title FROM notes WHERE kind='chefe' AND path<>'chefe/index.md' AND instr(path,?)<>1 ORDER BY updated_at DESC LIMIT 30", PROJECTS);
    const day = at => String(at || '').slice(0, 10);
    const auto = [projects.length ? '## Projetos\n' + projects.map(item => `- [[${item.path.slice(0, -3)}|${item.title}]] · atualizado ${day(item.updated_at)}`).join('\n') : '',
      deliveries.length ? '## Entregas recentes\n' + deliveries.map(item => `- ${day(item.created_at)} · ${names.get(item.bot_id) || 'bot'} · [[${item.path.slice(0, -3)}|${item.title}]]`).join('\n') : '',
      others.length ? '## Outras notas\n' + others.map(item => `- [[${item.path.slice(0, -3)}|${item.title}]]`).join('\n') : ''].filter(Boolean).join('\n\n');
    return { ...(note || { path: 'chefe/index.md', body: '' }), auto: auto || 'Ainda não há projetos, entregas nem notas.', untrusted: true,
      message: (note ? '' : 'Você ainda não escreveu o índice; ') + 'a parte "auto" é gerada sozinha pelo MyBots a cada leitura (projetos, entregas recentes, notas): não a copie para o índice.' };
  }
  if (tool === 'shared.note_read') {
    if (args.list) return { notes: db.all('SELECT path,title,bot_id,updated_at FROM notes WHERE instr(path,?)=1 ORDER BY updated_at DESC,path LIMIT 100', args.prefix) };
    const note = read(args.path), moved = !note && args.path.startsWith('entregas/') && read('arquivo/' + args.path.slice(9));
    if (moved) return { ...moved, movedFrom: args.path, message: 'Esta entrega já foi para o arquivo.' };
    if (!note) throw new Error('Nota não encontrada.');
    return note;
  }
  return db.transaction(() => {
    const at = new Date().toISOString();
    if (tool === 'delivery.write') {
      const minute = at.slice(0, 10) + '-' + at.slice(11, 16).replace(':', '');
      const path = available(db, 'entregas/' + minute + '-' + (slug(bot.name) || 'bot') + '-' + (slug(args.topic) || 'entrega'));
      const project = args.project ? attachProject(db, bot, args.project, at) : null;
      const body = `Bot: ${bot.name}\nData: ${at}\nAssunto: ${args.topic}\n${project ? `Projeto: [[${project.path.slice(0, -3)}|${label(project.title)}]]\n` : ''}\n${args.text}`;
      saveNote(db, { path, bot_id: bot.id, kind: 'entrega', title: args.topic, body, created_at: at, updated_at: at });
      // Every project the delivery links to (the one given or a [[link]] in the text) lists it.
      const resolve = linkResolver(db.all('SELECT path,title,kind,body FROM notes'));
      for (const target of new Set(linkNames(body).map(resolve))) if (target?.startsWith(PROJECTS)) refreshProject(db, target, at);
      const known = db.all('SELECT title FROM notes WHERE instr(path,?)=1 AND bot_id=? ORDER BY updated_at DESC LIMIT 20', PROJECTS, bot.id).map(row => row.title);
      return { path, ...(project ? { project: project.title, projectPath: project.path } : {}),
        ...(known.length ? { message: (project ? `Entrega ligada ao projeto "${project.title}". ` : 'Entrega sem projeto. ') + `Projetos deste bot: ${known.join('; ')}. Use sempre o mesmo nome em project.` } : {}) };
    }
    if (args.path === PERSON_NOTE) throw new Error(tool === 'shared.archive' ? 'A nota Você fica sempre na memória.' : 'A nota Você muda só com profile_write: a pessoa vê o antes e o depois e aprova.');
    const previous = read(args.path);
    if (tool === 'shared.archive') {
      if (!previous) throw new Error('Entrega não encontrada.');
      return archive(db, previous, args.summary, at);
    }
    if (args.path === 'chefe/index.md' && args.text.length > PRUNE.indexLimit)
      throw new Error(`Mantenha o índice com até ${PRUNE.indexLimit} caracteres: deixe links para projetos, pessoas e decisões e leve os detalhes para outras notas.`);
    if (previous) {
      if (!args.overwrite) throw new Error('A nota já existe. Use overwrite: true para guardar a versão anterior e substituir.');
      const history = keepHistory(db, previous, at);
      db.run('UPDATE notes SET body=?,bot_id=?,updated_at=? WHERE path=?', args.text, bot.id, at, args.path);
      db.notify('notes.changed', { path: args.path });
      return { path: args.path, history };
    }
    saveNote(db, { path: args.path, bot_id: bot.id, kind: 'chefe', title: args.path.split('/').at(-1).slice(0, -3), body: args.text, created_at: at, updated_at: at });
    return { path: args.path };
  });
}

const fields = {
  'notes.list': ['prefix', 'kind', 'botId', 'since', 'limit', 'cursor'],
  'notes.read': ['path'],
  'notes.search': ['query', 'kind', 'botId', 'since', 'limit'],
  'notes.graph': ['kind', 'botId', 'since', 'limit'],
  'notes.write': ['path', 'text', 'create'],
  'notes.archive': ['path', 'summary'],
  'notes.remove': ['path', 'confirm'],
  'notes.prune': []
};
export const noteMethods = Object.keys(fields);
export const GRAPH_LIMIT = 500;
const dateString = value => typeof value === 'string' && value.length <= 30 &&
  /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)?$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);

function validate(method, p) {
  const allowed = fields[method];
  if (!allowed || !p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !allowed.includes(k))) throw new Error('Parâmetros de notas inválidos.');
  if (allowed.includes('path') && !validPath(p.path)) throw new Error('Caminho de nota inválido. A regra: começa com chefe/ (suas notas, ex.: chefe/pessoas/ana.md ou chefe/projetos/vagas.md), entregas/ ou arquivo/ (essas duas vêm de delivery_write e shared_archive); termina em .md; só letras sem acento, números, - _ . e / (sem espaço); até 120 caracteres.');
  if ('prefix' in p && !(typeof p.prefix === 'string' && p.prefix.length <= 120 &&
    !p.prefix.includes('..') && /^(?:chefe|entregas|arquivo)\/(?:[\w-][\w.-]*\/)*[\w.-]*$/.test(p.prefix))) throw new Error('Prefixo de pasta inválido.');
  if ('kind' in p && !Object.values(kinds).includes(p.kind)) throw new Error('Tipo de nota inválido.');
  if ('botId' in p && !uuid(p.botId)) throw new Error('Identificador do bot inválido.');
  if ('since' in p && !dateString(p.since)) throw new Error('Data inválida.');
  const most = method === 'notes.graph' ? GRAPH_LIMIT : 100;
  if ('limit' in p && !(Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= most)) throw new Error('Use um limite entre 1 e ' + most + '.');
  if ('cursor' in p) {
    const [at, path, ...rest] = typeof p.cursor === 'string' && p.cursor.length <= 152 ? p.cursor.split('|') : [];
    if (!dateString(at) || !validPath(path) || rest.length) throw new Error('Cursor de notas inválido.');
  }
  if (method === 'notes.search' && !(typeof p.query === 'string' && p.query.length <= 200 && fold(p.query.trim()))) throw new Error('Busque por um texto de até 200 caracteres.');
  if ('create' in p && typeof p.create !== 'boolean') throw new Error('Opção de criação inválida.');
  if (method === 'notes.write') checkBody(p.text);
  if ('summary' in p) checkBody(p.summary);
  if (method === 'notes.remove' && p.confirm !== true) throw new Error('Confirme para apagar a nota para sempre.');
}

// Map folded offsets back to the original text, including combining accents.
function matchRange(text, query) {
  const offset = fold(text).indexOf(query);
  if (offset < 0) return null;
  const offsets = [];
  let pos = 0;
  for (const char of text) {
    const width = fold(char).length;
    for (let i = 0; i < width; i++) offsets.push(pos);
    pos += char.length;
  }
  return [offsets[offset], offsets[offset + query.length] ?? pos];
}

// Nodes and [[links]] only, for the memory map. Over the limit, half the slots go to the newest notes and the rest to the most
// linked ones, so neither a burst of fresh deliveries nor an old hub disappears. Rows arrive newest first.
function graph(rows, byPath, outgoing, incoming, missing, limit) {
  const degree = row => outgoing.get(row.path).length + (incoming.get(row.path)?.length || 0);
  let chosen = rows;
  if (rows.length > limit) {
    const newest = rows.slice(0, Math.ceil(limit / 2)), picked = new Set(newest.map(row => row.path));
    const linked = rows.filter(row => !picked.has(row.path)).sort((a, b) => degree(b) - degree(a)).slice(0, limit - newest.length);
    for (const row of linked) picked.add(row.path);
    chosen = rows.filter(row => picked.has(row.path));
  }
  const included = new Set(chosen.map(row => row.path)), edges = [];
  for (const row of chosen) for (const to of outgoing.get(row.path)) {
    if (included.has(to)) edges.push({ from: row.path, to, exists: true });
    else if (!byPath.has(to)) edges.push({ from: row.path, to, exists: false, title: missing.get(to) });
  }
  const nodes = chosen.map(row => ({ path: row.path, title: row.title, kind: row.kind, botId: row.bot_id, botName: row.botName,
    updatedAt: row.updated_at, outgoingCount: outgoing.get(row.path).length, incomingCount: incoming.get(row.path)?.length || 0 }));
  return { nodes, edges, truncated: chosen.length < rows.length };
}

// The text a person reads first: without YAML front matter or the "Bot: / Data: / Assunto:" lines deliveries start with.
const HEADER = /^(?:---\n[\s\S]*?\n---[ \t]*\n|(?:(?:bot|autor|data|assunto|projeto|status|tags|criada|atualizada|prazo|tipo|fonte)[ \t]*:[^\n]*\n){2,12})\s*/i;
const lead = body => body.replace(HEADER, '');
// Where a note mentions another, like Obsidian's backlinks: the line holding the [[link]].
function mention(body, names) {
  const line = body.split('\n').find(text => names.some(name => text.includes('[[' + name)));
  return (line || lead(body)).trim().slice(0, 200);
}

function readNotes(records, method, p) {
  // Backups can contain timestamps with offsets. Use UTC for filters, ordering and cursors.
  const rows = records.map(row => ({ ...row, updated_at: new Date(row.updated_at).toISOString() }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || (a.path > b.path) - (a.path < b.path));
  const byPath = new Map(rows.map(row => [row.path, row]));
  const outgoing = new Map(), incoming = new Map(), names = new Map(), missing = new Map(), resolve = linkResolver(rows);
  for (const row of rows) {
    const spelled = new Map();
    for (const name of linkNames(row.body)) {
      const path = resolve(name);
      if (!path) continue;
      if (!spelled.has(path)) spelled.set(path, []);
      spelled.get(path).push(name);
      if (!byPath.has(path) && !missing.has(path)) missing.set(path, name);
    }
    const paths = [...spelled.keys()];
    names.set(row.path, spelled);
    outgoing.set(row.path, paths);
    for (const path of paths) {
      if (!incoming.has(path)) incoming.set(path, []);
      incoming.get(path).push(row.path);
    }
  }
  const summary = row => {
    const outgoingPaths = outgoing.get(row.path), incomingPaths = incoming.get(row.path) || [];
    return { path: row.path, title: row.title, kind: row.kind, botId: row.bot_id, botName: row.botName,
      createdAt: row.created_at, updatedAt: row.updated_at, snippet: lead(row.body).slice(0, 140), outgoingPaths, incomingPaths,
      outgoingCount: outgoingPaths.length, incomingCount: incomingPaths.length };
  };
  if (method === 'notes.read') {
    const row = byPath.get(p.path);
    if (!row) throw new Error('Nota não encontrada.');
    const note = summary(row);
    return { ...note, body: row.body, links: note.outgoingPaths.map(path => ({ path, title: byPath.get(path)?.title || missing.get(path) || path, exists: byPath.has(path),
      kind: byPath.get(path)?.kind || null, botId: byPath.get(path)?.bot_id ?? null, names: names.get(row.path).get(path) })),
      backlinks: note.incomingPaths.map(path => ({ path, title: byPath.get(path).title, kind: byPath.get(path).kind, botId: byPath.get(path).bot_id,
        snippet: mention(byPath.get(path).body, names.get(path).get(row.path)) })) };
  }
  const since = p.since && new Date(p.since).toISOString();
  const kept = row => !((p.prefix && !row.path.startsWith(p.prefix)) || (p.kind && row.kind !== p.kind) ||
    (p.botId && row.bot_id !== p.botId) || (since && row.updated_at < since));
  if (method === 'notes.graph') return graph(rows.filter(kept), byPath, outgoing, incoming, missing, p.limit || GRAPH_LIMIT);
  const query = p.query && fold(p.query.trim()), limit = p.limit || 50, notes = [];
  const [at, after] = p.cursor?.split('|') || [];
  for (const row of rows) {
    if (!kept(row) || (at && (row.updated_at > at || (row.updated_at === at && row.path <= after)))) continue;
    const result = summary(row);
    if (query) {
      result.titleMatch = matchRange(row.title, query);
      const match = matchRange(row.body, query);
      if (!result.titleMatch && !match) continue;
      if (match) {
        const start = Math.max(0, match[0] - 40);
        result.snippet = row.body.slice(start, start + 140);
        result.snippetMatch = [match[0] - start, Math.min(match[1] - start, 140)];
      }
    }
    notes.push(result);
    if (notes.length > limit) break;
  }
  const more = notes.length > limit;
  if (more) notes.pop();
  const last = notes.at(-1);
  return { notes, more, nextCursor: !query && more ? last.updatedAt + '|' + last.path : null };
}

export function notesRpc(db, method, params = {}) {
  validate(method, params);
  if (['notes.list', 'notes.read', 'notes.search', 'notes.graph'].includes(method)) {
    const records = db.all("SELECT n.*,json_extract(b.body,'$.name') AS botName FROM notes n LEFT JOIN bots b ON b.id=n.bot_id");
    return readNotes(records, method, params);
  }
  if (method === 'notes.prune') return pruneNotes(db);
  const { path, text, create, summary } = params;
  return db.transaction(() => {
    const previous = db.get('SELECT * FROM notes WHERE path=?', path);
    const kind = kinds[path.split('/')[0]], at = new Date().toISOString();
    let result = { path }, action, detail;
    if (method === 'notes.write') {
      if (kind === 'arquivo') throw new Error('Escolha uma nota em chefe/ ou entregas/ para editar.');
      if (previous && create) throw new Error('Já existe uma nota com esse caminho.');
      if (!previous && !create) throw new Error('Nota não encontrada. Escolha criar uma nova nota.');
      if (previous) {
        result.history = keepHistory(db, previous, at);
        db.run('UPDATE notes SET body=?,updated_at=? WHERE path=?', text, at, path);
        db.notify('notes.changed', { path });
      } else {
        saveNote(db, { path, kind, title: path === PERSON_NOTE ? PERSON_TITLE : path.split('/').at(-1).slice(0, -3), body: text, bot_id: null, created_at: at, updated_at: at });
      }
      action = 'note_written'; detail = previous ? 'Você editou a nota' : 'Você criou a nota';
    } else {
      if (!previous) throw new Error('Nota não encontrada.');
      if (method === 'notes.archive') {
        if (kind === 'arquivo') throw new Error('Esta nota já está no arquivo.');
        if (path === PERSON_NOTE) throw new Error('A nota Você fica sempre na memória: para mudar, edite o texto.');
        result = archive(db, previous, summary, at);
        action = 'note_archived'; detail = 'Você arquivou a nota';
      } else {
        if (kind !== 'arquivo') throw new Error('Arquive a nota antes de apagar para sempre.');
        db.run('DELETE FROM notes WHERE path=?', path);
        db.notify('notes.changed', { path });
        action = 'note_removed'; detail = 'Você apagou permanentemente a nota';
      }
    }
    db.record(action, detail + ': ' + path, previous?.bot_id || null);
    db.notify('activity.new', {});
    return result;
  });
}

// Automatic pruning: old deliveries move to arquivo/ (body intact), each month gets a generated summary in arquivo/resumos/,
// and chefe/index.md drops the list lines that only pointed at what moved, so neither the index nor what the Chief reads grows forever.
export const PRUNE = { days: 30, keep: 30, months: 6, indexLimit: 4000 };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = month => `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
const DELIVERY = /^arquivo\/(\d{4}-\d\d)-(\d\d)-\d{4}-[^/]+\.md$/;
const label = text => String(text).replace(/[\[\]|#\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const firstLine = body => {
  const line = lead(body).split('\n').map(text => text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/^[\s#>*+-]+|\[[ x]\]\s*/gi, '').trim()).find(Boolean) || '';
  return line.length > 90 ? line.slice(0, 89).trimEnd() + '…' : line;
};

// Rebuilds the summaries of one month from the archived deliveries themselves, so running it twice (or on both devices) gives the same text.
function writeSummaries(db, month, at) {
  const rows = db.all("SELECT n.path,n.title,n.body,json_extract(b.body,'$.name') AS botName FROM notes n LEFT JOIN bots b ON b.id=n.bot_id WHERE n.kind='arquivo' AND instr(n.path,?)=1 ORDER BY n.path", `arquivo/${month}-`)
    .filter(row => DELIVERY.test(row.path));
  const heading = part => `Entregas de ${monthName(month)}${part > 1 ? ` (parte ${part})` : ''}`;
  const pathOf = part => `arquivo/resumos/${month}${part > 1 ? '-parte-' + part : ''}.md`;
  const intro = 'Resumo automático das entregas que foram para o arquivo. Cada link abre a entrega completa.\n\n';
  const parts = [[]];
  let size = 0;
  for (const row of rows) {
    const day = row.path.match(DELIVERY)[2], who = label(row.botName || 'Sem bot'), text = firstLine(row.body);
    let line = `- ${day}/${month.slice(5, 7)} · ${who} · [[${row.path.slice(0, -3)}|${label(row.title) || 'Entrega'}]]${text ? ' — ' + text : ''}`;
    try { checkBody(line); } catch { line = line.split(' — ')[0]; }
    if (size + line.length > 7200) { parts.push([]); size = 0; }
    parts.at(-1).push(line); size += line.length + 1;
  }
  parts.forEach((lines, i) => {
    const part = i + 1, path = pathOf(part), next = part < parts.length ? `\n\nContinua em [[${pathOf(part + 1).slice(0, -3)}|${heading(part + 1)}]].` : '';
    const body = `# ${heading(part)}\n\n${intro}${lines.join('\n')}${next}`, title = heading(part);
    const old = db.get('SELECT body,title FROM notes WHERE path=?', path);
    if (!old) saveNote(db, { path, bot_id: null, kind: 'arquivo', title, body, created_at: at, updated_at: at });
    else if (old.body !== body || old.title !== title) { checkBody(body); db.run('UPDATE notes SET body=?,title=?,updated_at=? WHERE path=?', body, title, at, path); db.notify('notes.changed', { path }); }
  });
  for (let part = parts.length + 1; db.get('SELECT 1 FROM notes WHERE path=?', pathOf(part)); part++) {
    db.run('DELETE FROM notes WHERE path=?', pathOf(part)); db.notify('notes.changed', { path: pathOf(part) });
  }
  return pathOf(1);
}

// The index keeps what the Chief wrote, minus list lines whose every [[link]] went to the archive, plus an "Arquivo" section
// with the latest months' summaries. The previous version stays in arquivo/historico/, like any other edit.
function tidyIndex(body, gone, resolve, months) {
  const lines = body.split('\n'), kept = [];
  for (const line of lines) {
    const targets = /^\s*(?:[-*+]|\d+[.)])\s/.test(line) ? linkNames(line).map(resolve) : [];
    if (targets.length && targets.every(path => gone.has(path))) continue;
    kept.push(line);
  }
  const start = kept.findIndex(line => /^##\s+Arquivo\s*$/i.test(line.trim()));
  let section = [];
  if (start >= 0) {
    let end = kept.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line));
    if (end < 0) end = kept.length;
    section = kept.splice(start, end - start).slice(1);
  }
  const known = new Set([...section.join('\n').matchAll(/arquivo\/resumos\/(\d{4}-\d\d)\b/g)].map(match => match[1]));
  for (const month of months) known.add(month);
  const other = section.filter(line => line.trim() && !/arquivo\/resumos\/\d{4}-\d\d/.test(line));
  const recent = [...known].sort().reverse().slice(0, PRUNE.months).map(month => `- [[arquivo/resumos/${month}|Entregas de ${monthName(month)}]]`);
  while (kept.length && !kept.at(-1).trim()) kept.pop();
  return [...kept, '', '## Arquivo', '', ...other, ...recent].join('\n') + '\n';
}

export function pruneNotes(db, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString(), cutoff = new Date(now - PRUNE.days * 86400000).toISOString();
  return db.transaction(() => {
    const rows = db.all('SELECT * FROM notes');
    const deliveries = rows.filter(row => row.kind === 'entrega').map(row => ({ ...row, when: new Date(row.updated_at).toISOString() }))
      .sort((a, b) => b.when.localeCompare(a.when) || (a.path > b.path) - (a.path < b.path));
    const old = deliveries.slice(PRUNE.keep).filter(row => row.when < cutoff);
    if (!old.length) return { archived: 0, months: [] };
    const resolve = linkResolver(rows), gone = new Set(), months = new Set();
    for (const row of old) {
      const { path } = archive(db, row, '', at);
      gone.add(row.path);
      const month = path.match(DELIVERY)?.[1];
      if (month) months.add(month);
    }
    const summaries = [...months].sort().map(month => writeSummaries(db, month, at));
    const index = db.get("SELECT * FROM notes WHERE path='chefe/index.md'");
    if (index) {
      const body = tidyIndex(index.body, gone, resolve, months);
      if (body !== index.body && body.length <= 8000) {
        keepHistory(db, index, at);
        db.run('UPDATE notes SET body=?,updated_at=? WHERE path=?', body, at, index.path);
        db.notify('notes.changed', { path: index.path });
      }
    }
    db.record('notes_pruned', `Memória arrumada: ${old.length === 1 ? '1 entrega antiga foi' : old.length + ' entregas antigas foram'} para o arquivo, com um resumo por mês.`, null);
    db.notify('activity.new', {});
    return { archived: old.length, months: [...months].sort(), summaries };
  });
}

// Projects: the note each delivery hangs from (chefe/projetos/<nome>.md). The MyBots creates it when a delivery names it and keeps
// its "## Entregas" list; what the Chief or the person write above the list stays. Other spellings of the name become aliases.
export const PROJECTS = 'chefe/projetos/';
const ENTRIES = '## Entregas', LISTED = 60;
// The name without case, accents, spacing or a leading "Projeto".
const projectKey = name => slug(String(name)).replace(/^(?:projeto|project)-/, '').replace(/-/g, '');
// Two names of one bot are the same project when one starts the other ("Engajamento Commit" / "Engajamento CommitJR") or they
// share most of their start ("Engajamento CommitJR" / "Engajamento Commit Júnior").
function sameProject(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  let common = 0;
  while (common < shorter && a[common] === b[common]) common++;
  return shorter >= 12 && common >= Math.max(12, Math.ceil(shorter * 0.7));
}
const projectNames = row => [row.title, ...aliasesOf(row.body)];

function findProject(db, botId, name) {
  const key = projectKey(name), rows = db.all('SELECT * FROM notes WHERE instr(path,?)=1 ORDER BY created_at, path', PROJECTS);
  return rows.find(row => projectNames(row).some(other => projectKey(other) === key)) ||
    rows.find(row => row.bot_id === botId && projectNames(row).some(other => sameProject(projectKey(other), key))) || null;
}

function withAliases(body, aliases) {
  const rest = String(body).replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
  return aliases.length ? `---\naliases:\n${aliases.map(alias => `  - ${label(alias)}`).join('\n')}\n---\n${rest}` : rest;
}

function attachProject(db, bot, name, at, extra = []) {
  const title = label(name).slice(0, 80);
  if (!projectKey(title)) return null;
  const found = findProject(db, bot.id, title);
  if (found) {
    const names = projectNames(found), missing = [title, ...extra].filter(other => label(other) && !names.some(known => slug(known) === slug(other)));
    if (missing.length) {
      const body = withAliases(found.body, [...aliasesOf(found.body), ...missing.map(label)]);
      checkBody(body); db.run('UPDATE notes SET body=? WHERE path=?', body, found.path); db.notify('notes.changed', { path: found.path });
    }
    return found;
  }
  const path = available(db, PROJECTS + (slug(title) || 'projeto').slice(0, 80));
  const body = withAliases(`# ${title}\n\nProjeto ${bot.name ? `de ${label(bot.name)}` : 'da equipe'}. O MyBots mantém a lista de entregas abaixo; escreva acima dela o que vale para o projeto todo.\n\n${ENTRIES}\n`, extra.filter(other => slug(other) !== slug(title)).map(label));
  saveNote(db, { path, bot_id: bot.id || null, kind: 'chefe', title, body, created_at: at, updated_at: at });
  return db.get('SELECT * FROM notes WHERE path=?', path);
}

// Rewrites only the "## Entregas" section, from the deliveries that link to the project (newest first). No history copy:
// the list is generated, like the monthly summaries.
function refreshProject(db, path, at, rows = db.all("SELECT n.path,n.title,n.kind,n.body,n.created_at,json_extract(b.body,'$.name') AS botName FROM notes n LEFT JOIN bots b ON b.id=n.bot_id")) {
  const project = rows.find(row => row.path === path) || db.get('SELECT * FROM notes WHERE path=?', path);
  if (!project) return;
  const resolve = linkResolver(rows);
  const items = rows.filter(row => (row.kind === 'entrega' || DELIVERY.test(row.path)) && linkNames(row.body).some(name => resolve(name) === path))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.path > b.path) - (a.path < b.path));
  const line = row => { const day = new Date(row.created_at).toISOString(); return `- ${day.slice(8, 10)}/${day.slice(5, 7)} · ${label(row.botName || 'Sem bot')} · [[${row.path.slice(0, -3)}|${label(row.title) || 'Entrega'}]]`; };
  const list = items.slice(0, LISTED).map(line);
  if (items.length > LISTED) list.push(`- … e mais ${items.length - LISTED} entregas mais antigas (veja as ligações desta nota).`);
  const lines = project.body.split('\n'), start = lines.findIndex(text => text.trim() === ENTRIES);
  const before = start < 0 ? lines : lines.slice(0, start);
  let end = start < 0 ? -1 : lines.findIndex((text, i) => i > start && /^#{1,2}\s/.test(text));
  const after = end < 0 ? [] : ['', ...lines.slice(end)];
  while (before.length && !before.at(-1).trim()) before.pop();
  let body = [...before, '', ENTRIES, '', ...(list.length ? list : ['Nenhuma entrega ainda.']), ...after].join('\n') + '\n';
  while (body.length > 8000 && list.length > 1) { list.splice(-2, 1); body = [...before, '', ENTRIES, '', ...list, ...after].join('\n') + '\n'; }
  if (body === project.body) return;
  checkBody(body); db.run('UPDATE notes SET body=?,updated_at=? WHERE path=?', body, at, path); db.notify('notes.changed', { path });
}

// The deliveries already written: names linked without a note become projects when one bot used them (or close spellings) in
// PROJECT_MIN deliveries or more, and close spellings of an existing project of that bot become its aliases. Runs again harmlessly.
export const PROJECT_MIN = 3;
// The project a delivery names: the link after "Projeto:", else its first link (the instructions asked for the project, then
// the decision), never one written as a decision.
function projectLink(body) {
  const text = lead(String(body));
  const named = /projeto\s*:\s*\[\[([^\[\]\r\n]+)\]\]/i.exec(text)?.[1];
  const first = /\[\[([^\[\]\r\n]+)\]\]/.exec(text);
  const decision = first && /decis[aã]o\s*:\s*$/i.test(text.slice(Math.max(0, first.index - 12), first.index));
  const name = (named || (!decision && first?.[1]) || '').split('|')[0].split('#')[0].trim();
  return name && !/^decis[aã]o\b/i.test(name) ? [name] : [];
}
export function linkProjects(db, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  return db.transaction(() => {
    const rows = db.all('SELECT * FROM notes'), byPath = new Set(rows.map(row => row.path)), resolve = linkResolver(rows);
    const groups = new Map(); // bot -> [{ key, names: Map(name -> count), deliveries: Set }]
    let aliased = 0, created = 0;
    for (const row of rows) {
      if (!row.bot_id || !(row.kind === 'entrega' || DELIVERY.test(row.path))) continue;
      for (const name of projectLink(row.body)) {
        const target = resolve(name);
        if (!target || byPath.has(target) || FOLDER.test(name) || !projectKey(name)) continue;
        const key = projectKey(name), list = groups.get(row.bot_id) || [];
        groups.set(row.bot_id, list);
        let group = list.find(item => sameProject(item.key, key));
        if (!group) { group = { key, names: new Map(), deliveries: new Set() }; list.push(group); }
        group.names.set(name, (group.names.get(name) || 0) + 1); group.deliveries.add(row.path);
      }
    }
    for (const [botId, list] of groups) {
      const bot = { id: botId, name: db.bot?.(botId)?.name || '' };
      for (const group of list) {
        const names = [...group.names].sort((a, b) => b[1] - a[1]).map(([name]) => name);
        const existing = names.map(name => findProject(db, botId, name)).find(Boolean);
        if (!existing && group.deliveries.size < PROJECT_MIN) continue;
        if (existing) aliased++; else created++;
        attachProject(db, bot, existing ? existing.title : names[0], at, names);
      }
    }
    const all = db.all("SELECT n.path,n.title,n.kind,n.body,n.created_at,json_extract(b.body,'$.name') AS botName FROM notes n LEFT JOIN bots b ON b.id=n.bot_id");
    for (const row of all) if (row.path.startsWith(PROJECTS)) refreshProject(db, row.path, at, all);
    if (created) { db.record('projects_linked', `Memória arrumada: ${created === 1 ? '1 projeto ganhou' : created + ' projetos ganharam'} nota própria, ligando as entregas que já falavam dele.`, null); db.notify('activity.new', {}); }
    return { created, aliased };
  });
}
