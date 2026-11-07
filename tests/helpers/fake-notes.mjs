// Test notes for the memory map: random [[links]], some orphans and some links to notes that do not exist.
import { links } from '../../supervisor/notes.mjs';

function random(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const topics = ['projeto', 'cliente', 'decisao', 'reuniao', 'ideia', 'pesquisa', 'tarefa', 'contato', 'site', 'orcamento', 'viagem', 'estudo'];

/** Rows for the notes table. `bots` is a list of bot ids to sign entregas with (others are the person's). */
export function fakeNotes({ notes = 300, links: count = 600, seed = 1, bots = [], now = Date.UTC(2026, 10, 7, 12) } = {}) {
  const rnd = random(seed), rows = [];
  for (let i = 0; i < notes; i++) {
    const roll = rnd(), folder = roll < 0.55 ? 'chefe' : roll < 0.9 ? 'entregas' : 'arquivo';
    const topic = topics[Math.floor(rnd() * topics.length)];
    const at = new Date(now - Math.floor(rnd() * 60 * 86400000)).toISOString();
    rows.push({ path: `${folder}/${topic}-${i}.md`, kind: { chefe: 'chefe', entregas: 'entrega', arquivo: 'arquivo' }[folder],
      title: `${topic[0].toUpperCase() + topic.slice(1)} ${i}`, bot_id: folder === 'entregas' && bots.length ? bots[i % bots.length] : null,
      created_at: at, updated_at: at, targets: [] });
  }
  // About one note in ten never links nor is linked (orphans); a few links point at notes that do not exist.
  const linkable = rows.filter((_, i) => i % 10 !== 7);
  for (let k = 0; k < count; k++) {
    // Favour a few hubs, like a real memory with an index and some projects.
    const from = linkable[Math.floor(rnd() * linkable.length)];
    if (rnd() < 0.04) { from.targets.push(`chefe/falta-${k % 23}`); continue; }
    const pick = rnd() < 0.3 ? Math.floor(rnd() * Math.min(12, linkable.length)) : Math.floor(rnd() * linkable.length);
    const to = linkable[pick];
    if (to !== from) from.targets.push(to.path.startsWith('chefe/') ? to.path.slice(6, -3) : to.path.slice(0, -3));
  }
  return rows.map(({ targets, ...row }) => ({ ...row, body: `Nota de teste ${row.title}.\n\n` + targets.map(t => `- [[${t}]]`).join('\n') }));
}

/** The same notes in the shape notes.graph returns, without a database. */
export function fakeGraph(options) {
  const rows = fakeNotes(options), paths = new Set(rows.map(r => r.path)), incoming = new Map(), outgoing = new Map();
  for (const row of rows) {
    const out = links(row.body);
    outgoing.set(row.path, out);
    for (const to of out) incoming.set(to, (incoming.get(to) || 0) + 1);
  }
  const nodes = rows.map(r => ({ path: r.path, title: r.title, kind: r.kind, botId: r.bot_id, botName: null, updatedAt: r.updated_at,
    outgoingCount: outgoing.get(r.path).length, incomingCount: incoming.get(r.path) || 0 }));
  const edges = rows.flatMap(r => outgoing.get(r.path).map(to => ({ from: r.path, to, exists: paths.has(to) })));
  return { nodes, edges, truncated: false };
}
