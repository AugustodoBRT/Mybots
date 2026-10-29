import { plain } from './settings-search.js';

// The saved passwords (site, username and which bots; never the secret) grouped by site for the passwords screen.
// `query` filters by site or username; groups come sorted by site, each with its entries sorted by username.
export function groupPasswords(list, query = '') {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const kept = words.length ? list.filter(item => { const hay = plain(`${item.host} ${item.username || ''}`); return words.every(word => hay.includes(word)); }) : list;
  const groups = new Map();
  for (const item of kept) { const host = String(item.host || '').replace(/^www\./, ''); if (!groups.has(host)) groups.set(host, []); groups.get(host).push(item); }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([host, data]) => ({ host, data: data.sort((a, b) => (a.username || '').localeCompare(b.username || '')) }));
}

// "312 senhas · 4 bots com acesso": a password for "todos os bots" (bots: null) counts every bot.
export function passwordSummary(list, bots) {
  if (!list.length) return 'Nenhuma senha guardada';
  const live = bots.filter(bot => !bot.deletedAt).map(bot => bot.id);
  const withAccess = new Set();
  for (const item of list) for (const id of item.bots || live) if (live.includes(id)) withAccess.add(id);
  const n = list.length, b = withAccess.size;
  return `${n} ${n === 1 ? 'senha' : 'senhas'} · ${b} ${b === 1 ? 'bot com acesso' : 'bots com acesso'}`;
}
