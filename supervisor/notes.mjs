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

export function links(body) {
  const paths = new Set();
  for (const match of body.matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)) {
    let path = match[1].trim();
    if (!path.includes('/')) path = 'chefe/' + path;
    if (!path.endsWith('.md')) path += '.md';
    if (validPath(path)) paths.add(path);
  }
  return [...paths];
}

const slug = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
      const path = available(db, args.path.replace(/^entregas\//, 'arquivo/').slice(0, -3));
      const body = args.summary ? previous.body + '\n\nResumo: ' + args.summary : previous.body;
      saveNote(db, { ...previous, path, kind: 'arquivo', updated_at: at, body });
      db.run('DELETE FROM notes WHERE path=?', args.path);
      return { path };
    }
    if (previous) {
      if (!args.overwrite) throw new Error('A nota já existe. Use overwrite: true para guardar a versão anterior e substituir.');
      const history = available(db, 'arquivo/historico/' + args.path.slice(0, -3), '-' + at.replace(/[:.]/g, '-'));
      saveNote(db, { ...previous, path: history, kind: 'arquivo', updated_at: at });
      db.run('UPDATE notes SET body=?,bot_id=?,updated_at=? WHERE path=?', args.text, bot.id, at, args.path);
      return { path: args.path, history };
    }
    saveNote(db, { path: args.path, bot_id: bot.id, kind: 'chefe', title: args.path.split('/').at(-1).slice(0, -3), body: args.text, created_at: at, updated_at: at });
    return { path: args.path };
  });
}
