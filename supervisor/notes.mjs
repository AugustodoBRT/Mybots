import { fold, uuid } from './validation.mjs';

const kinds = { chefe: 'chefe', entregas: 'entrega', arquivo: 'arquivo' };
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

// Resolves link names against existing notes, like Obsidian: the exact path first, then a note whose title or file name
// matches ignoring case, accents and punctuation (chefe/ before entregas/ before arquivo/, newest first).
export function linkResolver(rows) {
  const byPath = new Set(rows.map(row => row.path)), byName = new Map(), rank = { chefe: 0, entrega: 1, arquivo: 2 };
  const add = (key, row) => {
    const old = key && byName.get(key);
    if (key && (!old || rank[row.kind] < rank[old.kind])) byName.set(key, row);
  };
  for (const row of rows) { add(slug(row.title), row); add(slug(row.path.split('/').at(-1).slice(0, -3)), row); }
  return name => {
    const path = linkPath(name);
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
    const note = read('chefe/index.md');
    return note || { path: 'chefe/index.md', body: '', message: 'O índice ainda não foi criado.' };
  }
  if (tool === 'shared.note_read') {
    if (args.list) return { notes: db.all('SELECT path,title,bot_id,updated_at FROM notes WHERE instr(path,?)=1 ORDER BY updated_at DESC,path LIMIT 100', args.prefix) };
    const note = read(args.path);
    if (!note) throw new Error('Nota não encontrada.');
    return note;
  }
  return db.transaction(() => {
    const at = new Date().toISOString();
    if (tool === 'delivery.write') {
      const minute = at.slice(0, 10) + '-' + at.slice(11, 16).replace(':', '');
      const path = available(db, 'entregas/' + minute + '-' + (slug(bot.name) || 'bot') + '-' + (slug(args.topic) || 'entrega'));
      const body = `Bot: ${bot.name}\nData: ${at}\nAssunto: ${args.topic}\n\n${args.text}`;
      saveNote(db, { path, bot_id: bot.id, kind: 'entrega', title: args.topic, body, created_at: at, updated_at: at });
      return { path };
    }
    const previous = read(args.path);
    if (tool === 'shared.archive') {
      if (!previous) throw new Error('Entrega não encontrada.');
      return archive(db, previous, args.summary, at);
    }
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
  'notes.remove': ['path', 'confirm']
};
export const noteMethods = Object.keys(fields);
export const GRAPH_LIMIT = 500;
const dateString = value => typeof value === 'string' && value.length <= 30 &&
  /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)?$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);

function validate(method, p) {
  const allowed = fields[method];
  if (!allowed || !p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !allowed.includes(k))) throw new Error('Parâmetros de notas inválidos.');
  if (allowed.includes('path') && !validPath(p.path)) throw new Error('Caminho de nota inválido.');
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
        saveNote(db, { path, kind, title: path.split('/').at(-1).slice(0, -3), body: text, bot_id: null, created_at: at, updated_at: at });
      }
      action = 'note_written'; detail = previous ? 'Você editou a nota' : 'Você criou a nota';
    } else {
      if (!previous) throw new Error('Nota não encontrada.');
      if (method === 'notes.archive') {
        if (kind === 'arquivo') throw new Error('Esta nota já está no arquivo.');
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
