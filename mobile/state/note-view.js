// The parts of a [[link]] as written: the target and what to show ([[nome|apelido]] shows "apelido", [[nome#seção]] the name).
export function linkParts(raw) {
  const [target, alias] = String(raw).split('|');
  const name = target.split('#')[0].trim();
  return { name, label: (alias ?? target).trim() || name };
}

// Resolve the display spelling against the destinations returned by notes.read (which lists the spellings of each one).
export function noteDestination(raw, links) {
  const { name } = linkParts(raw);
  const named = links.find(item => item.names?.includes(name));
  if (named) return named;
  let path = name;
  if (!path.includes('/')) path = 'chefe/' + path;
  if (!path.endsWith('.md')) path += '.md';
  return links.find(item => item.path === path);
}

export function noteChanged(original, latest) {
  return Boolean(original && (!latest || latest.path !== original.path || original.updatedAt !== latest.updatedAt || original.body !== latest.body));
}

// Obsidian shows a note's metadata as "properties" above the text. Notes here carry it as YAML front matter or, in the
// deliveries the bots write, as leading "Bot: …", "Data: …" lines. Returns { properties: [[key, value]], body }.
const KNOWN = new Set(['bot', 'autor', 'data', 'assunto', 'projeto', 'status', 'tags', 'criada', 'atualizada', 'prazo', 'responsavel', 'tipo', 'pessoa', 'cliente', 'fonte', 'link', 'origem']);
export function noteProperties(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n');
  const pair = /^([\p{L}][\p{L}\p{N} _-]{0,24}):[ \t]+(\S.*)$/u;
  const front = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  if (front) {
    const lines = front[1].split('\n').filter(line => line.trim());
    if (lines.every(line => pair.test(line))) return { properties: lines.map(line => pair.exec(line).slice(1, 3).map(part => part.trim().replace(/^["']|["']$/g, ''))), body: source.slice(front[0].length).replace(/^\n+/, '') };
  }
  const head = source.split(/\n[ \t]*\n/)[0], lines = head.split('\n');
  // Without front matter only well-known keys count, so an ordinary first paragraph with colons stays text.
  const known = line => KNOWN.has(pair.exec(line)?.[1].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
  if (lines.length >= 2 && lines.length <= 12 && lines.every(line => pair.test(line) && known(line))) {
    return { properties: lines.map(line => pair.exec(line).slice(1, 3).map(part => part.trim())), body: source.slice(head.length).replace(/^\n+/, '') };
  }
  return { properties: [], body: source };
}

// "2026-11-07T15:53:01.180Z" as people read it; anything else stays as written.
export function readableDate(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) || !Number.isFinite(Date.parse(value))) return value;
  const date = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
