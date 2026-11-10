import { randomUUID } from 'node:crypto';
import { now } from './database.mjs';
import { fold } from './rooms.mjs';

// The team's canvas: one infinite board where the bots leave what they are working on (notes, tables, charts, small HTML pages,
// pictures and videos, each bot's browser) and link one thing to another. It replaces the 3D office: the person sees the work, not
// only the bots. Cards live in the database (canvas_items) and sync between the phone and the computer like notes and tables.

export const CANVAS_LIMITS = { cards: 400, links: 800, text: 20000, html: 120000, rows: 200, columns: 20, cell: 500, title: 80, label: 60, area: 40 };
export const CARD_KINDS = ['note', 'table', 'chart', 'html', 'image', 'video', 'browser'];
// Default sizes (canvas units, about one point each at 100%) by kind.
const SIZES = { note: [320, 220], table: [420, 260], chart: [420, 280], html: [420, 320], image: [320, 240], video: [360, 240], browser: [400, 300] };
// A phone, a tablet and a computer, for a page the bot is testing.
export const VIEWPORTS = { celular: { width: 390, height: 844, mobile: true }, tablet: { width: 820, height: 1180, mobile: true }, computador: { width: 1280, height: 800, mobile: false } };
const GAP = 40, AREA_GAP = 160;
// An area is rows of about three cards; the areas stand side by side, a few per row of the board.
const AREA_WIDE = 1150, BOARD_WIDE = 2700;

const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const number = (value, min, max) => Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : undefined;
function text(value, max, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.includes('\u0000')) throw new Error(`${name} precisa ser texto.`);
  if (value.length > max) throw new Error(`${name} tem até ${max.toLocaleString('pt-BR')} caracteres.`);
  return value;
}
function chartSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('chart é {"type":"bar"|"line"|"pie","title":"…","labels":[…],"series":[{"name":"…","data":[…]}]}.');
  if (!['bar', 'line', 'pie'].includes(value.type)) throw new Error('O tipo do gráfico é bar, line ou pie.');
  const labels = Array.isArray(value.labels) ? value.labels.slice(0, 60).map(item => clip(String(item), 40)) : [];
  const series = Array.isArray(value.series) ? value.series.slice(0, 8).map(item => ({ name: clip(String(item?.name ?? ''), 40), data: Array.isArray(item?.data) ? item.data.slice(0, 60).map(n => Number.isFinite(n) ? n : 0) : [] })) : [];
  if (!labels.length || !series.length || series.some(item => item.data.length !== labels.length)) throw new Error('O gráfico precisa de labels e de séries com um número para cada label.');
  return { type: value.type, title: clip(String(value.title ?? ''), 80), labels, series };
}
function staticTable(columns, rows) {
  if (!Array.isArray(columns) || !columns.length || columns.length > CANVAS_LIMITS.columns) throw new Error(`columns é uma lista de 1 a ${CANVAS_LIMITS.columns} nomes de coluna.`);
  if (!Array.isArray(rows) || rows.length > CANVAS_LIMITS.rows) throw new Error(`rows é uma lista de até ${CANVAS_LIMITS.rows} linhas (cada linha, uma lista de valores).`);
  const cell = item => item === null || item === undefined ? '' : clip(typeof item === 'string' ? item : JSON.stringify(item), CANVAS_LIMITS.cell);
  return { columns: columns.map(item => clip(String(item), 40)), rows: rows.map(row => Array.isArray(row) ? row.slice(0, columns.length).map(cell) : columns.map(column => cell(row?.[column]))) };
}

/** The canvas of the team: cards (note, table, chart, html, image, video, browser) and links between them, grouped in named areas. */
export class Canvas {
  constructor(db, { changed = () => {}, tables = null, attachments = null } = {}) { Object.assign(this, { db, changed, tables, attachments }); }
  rows() { return this.db.all('SELECT * FROM canvas_items ORDER BY created_at,id').map(row => ({ id: row.id, kind: row.kind, botId: row.bot_id, createdAt: row.created_at, updatedAt: row.updated_at, ...JSON.parse(row.body) })); }
  cards() { return this.rows().filter(item => item.kind !== 'link'); }
  links() { return this.rows().filter(item => item.kind === 'link'); }
  card(id) {
    if (typeof id !== 'string' || !id) throw new Error('Informe o id de um cartão do canvas (veja em canvas_read).');
    const found = this.cards().find(item => item.id === id || item.id.startsWith(id) && id.length >= 8);
    if (!found) throw new Error('Cartão não encontrado no canvas. Use canvas_read para ver os ids.');
    return found;
  }
  /** The whole canvas for the app, with each bot's last card (where its little figure walks to). */
  state() {
    const cards = this.cards(), links = this.links(); const at = {};
    for (const card of [...cards].sort((a, b) => String(a.touchedAt || '').localeCompare(String(b.touchedAt || '')))) if (card.touchedBy) at[card.touchedBy] = { card: card.id, at: card.touchedAt };
    return { cards: cards.map(card => this.view(card)), links: links.map(({ id, from, to, label }) => ({ id, from, to, label })), at };
  }
  /** A card as the app draws it: a table that reads a shared table comes with its rows now; a chart can count them. */
  view(card) {
    if (card.kind === 'table' && card.source && this.tables) {
      try { const rows = this.tables.read({ table: card.source, limit: CANVAS_LIMITS.rows }).rows || []; const columns = card.columns?.length ? card.columns : [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('_') && key !== 'id')))].slice(0, CANVAS_LIMITS.columns);
        return { ...card, columns, rows: rows.map(row => columns.map(column => row[column] === undefined || row[column] === null ? '' : String(row[column]).slice(0, CANVAS_LIMITS.cell))) };
      } catch (error) { return { ...card, columns: [], rows: [], error: error.message }; }
    }
    if (card.kind === 'chart' && card.source && this.tables) {
      try {
        const rows = this.tables.read({ table: card.source, limit: CANVAS_LIMITS.rows }).rows || []; const sums = new Map();
        for (const row of rows) { const key = String(row[card.by] ?? '—').slice(0, 40); sums.set(key, (sums.get(key) || 0) + (card.sum ? Number(row[card.sum]) || 0 : 1)); }
        return { ...card, chart: { type: card.chart?.type || 'bar', title: card.chart?.title || card.title, labels: [...sums.keys()], series: [{ name: card.sum || 'quantidade', data: [...sums.values()] }] } };
      } catch (error) { return { ...card, error: error.message }; }
    }
    return card;
  }
  /** What a bot sees: every card in short (no long contents), the links and the areas. */
  read({ area } = {}, botId = null) {
    const names = new Map(this.db.bots().map(bot => [bot.id, bot.name]));
    const cards = this.cards().filter(card => !area || fold(card.area || '') === fold(area));
    const short = card => ({ id: card.id, kind: card.kind, title: card.title, area: card.area || null, x: card.x, y: card.y, w: card.w, h: card.h, by: card.sticky ? 'a pessoa (dona do app)' : names.get(card.botId) || null,
      ...(card.kind === 'note' ? { text: clip(card.text, 300) } : {}), ...(card.kind === 'table' ? (card.source ? { table: card.source } : { columns: card.columns, rows: card.rows?.length || 0 }) : {}),
      ...(card.kind === 'chart' ? (card.source ? { table: card.source, by: card.by } : { chart: card.chart?.type }) : {}), ...(card.kind === 'html' ? { html: `${card.html?.length || 0} caracteres` } : {}),
      ...(['image', 'video'].includes(card.kind) ? { file: card.file?.name || null } : {}), ...(card.kind === 'browser' ? { url: card.url || '', viewport: card.viewport || 'computador' } : {}), updatedAt: card.updatedAt });
    const ids = new Set(cards.map(card => card.id));
    return { cards: cards.map(short), links: this.links().filter(link => ids.has(link.from) || ids.has(link.to)).map(({ id, from, to, label }) => ({ id, from, to, label })),
      areas: [...new Set(this.cards().map(card => card.area).filter(Boolean))], mine: botId ? cards.filter(card => card.botId === botId).length : undefined,
      note: 'Reaproveite um cartão (canvas_update) antes de criar outro igual. Cartões sem posição são arrumados sozinhos na área. Notas com by "a pessoa" foram escritas por ela no canvas: leia e leve em conta.' };
  }
  /** Where a new card goes: to the right of its area's last row; a new area goes beside the last one, and under them when the row of areas is full. */
  place(area, w, h) {
    const cards = this.cards(); const same = cards.filter(card => fold(card.area || '') === fold(area || ''));
    if (same.length) {
      const top = Math.min(...same.map(card => card.y)), right = Math.max(...same.map(card => card.x + card.w)), left = Math.min(...same.map(card => card.x));
      // Rows of up to about three cards: then a new row under the area.
      if (right - left + w < AREA_WIDE) return { x: right + GAP, y: top };
      return { x: left, y: Math.max(...same.map(card => card.y + card.h)) + GAP };
    }
    if (!cards.length) return { x: 0, y: 0 };
    // The lowest band of areas: the new area continues it while it fits.
    const tops = new Map(); for (const card of cards) { const key = fold(card.area || ''); tops.set(key, Math.min(tops.get(key) ?? Infinity, card.y)); }
    const bandTop = Math.max(...tops.values()); const band = cards.filter(card => tops.get(fold(card.area || '')) >= bandTop - 200);
    const right = Math.max(...band.map(card => card.x + card.w));
    if (right + AREA_GAP + w <= BOARD_WIDE) return { x: right + AREA_GAP, y: bandTop };
    return { x: Math.min(...cards.map(card => card.x)), y: Math.max(...cards.map(card => card.y + card.h)) + AREA_GAP };
  }
  content(kind, args, old = {}) {
    const out = {};
    if (kind === 'note' && args.text !== undefined) out.text = text(args.text, CANVAS_LIMITS.text, 'text');
    if (kind === 'html' && args.html !== undefined) out.html = text(args.html, CANVAS_LIMITS.html, 'html');
    if (kind === 'chart' && args.chart !== undefined) { out.chart = chartSpec(args.chart); out.source = null; }
    if ((kind === 'table' || kind === 'chart') && args.table !== undefined) {
      if (!this.tables) throw new Error('As tabelas compartilhadas não estão disponíveis.');
      const listed = this.tables.list(null).tables.map(item => item.name);
      if (!listed.includes(String(args.table).toLowerCase())) throw new Error(`A tabela "${String(args.table).slice(0, 40)}" não existe ainda (table_list mostra as que existem).`);
      out.source = String(args.table).toLowerCase(); if (this.botId) this.tables.need(this.botId, out.source, 'read');
      if (kind === 'chart') { out.by = text(args.by, 40, 'by'); out.sum = args.sum === undefined ? old.sum || null : text(args.sum, 40, 'sum'); out.chart = { type: args.chart?.type || old.chart?.type || 'bar', title: '' }; if (!out.by && !old.by) throw new Error('Num gráfico de tabela, by diz a coluna que agrupa (ex.: "status"); sum, opcional, a coluna que soma.'); }
    }
    if (kind === 'table' && (args.columns !== undefined || args.rows !== undefined)) Object.assign(out, staticTable(args.columns ?? old.columns, args.rows ?? old.rows ?? []), { source: null });
    if (kind === 'table' && args.table !== undefined && args.columns !== undefined) out.columns = staticTable(args.columns, []).columns;
    if (['image', 'video'].includes(kind) && args.file !== undefined) {
      if (!this.attachments) throw new Error('Os arquivos não estão disponíveis.');
      const file = this.attachments.meta(this.botId, args.file);
      if (kind === 'image' ? !/^image\//.test(file.mime) : !/^video\//.test(file.mime)) throw new Error(kind === 'image' ? 'Esse arquivo não é uma imagem.' : 'Esse arquivo não é um vídeo.');
      out.file = { id: file.id, name: file.name, mime: file.mime, size: file.size };
    }
    return out;
  }
  check(card) {
    if (card.kind === 'note' && !card.text) throw new Error('Uma nota precisa de text.');
    if (card.kind === 'html' && !card.html) throw new Error('Um cartão html precisa de html (uma página completa, sem internet).');
    if (card.kind === 'chart' && !card.chart && !card.source) throw new Error('Um gráfico precisa de chart, ou de table com by.');
    if (card.kind === 'table' && !card.source && !card.columns) throw new Error('Uma tabela precisa de table (uma tabela compartilhada) ou de columns e rows.');
    if (['image', 'video'].includes(card.kind) && !card.file) throw new Error('Informe file: o id de um arquivo seu (files_list).');
  }
  add(botId, args) {
    if (!CARD_KINDS.includes(args.kind) || args.kind === 'browser') throw new Error('kind é note, table, chart, html, image ou video. O cartão do navegador aparece sozinho quando você navega.');
    if (this.cards().length >= CANVAS_LIMITS.cards) throw new Error(`O canvas já tem ${CANVAS_LIMITS.cards} cartões: reaproveite ou remova um (canvas_remove).`);
    this.botId = botId;
    const [dw, dh] = SIZES[args.kind]; const w = number(args.w, 160, 2400) ?? dw, h = number(args.h, 100, 2400) ?? dh;
    const area = clip(args.area?.trim?.() ?? '', CANVAS_LIMITS.area) || (args.near ? this.card(args.near).area || '' : '');
    const near = args.near ? this.card(args.near) : null;
    const spot = Number.isFinite(args.x) && Number.isFinite(args.y) ? { x: number(args.x, -100000, 100000), y: number(args.y, -100000, 100000) } : near ? this.free(near.x + near.w + GAP, near.y, w, h) : this.place(area, w, h);
    const stamp = now(), id = randomUUID();
    const card = { kind: args.kind, title: clip(args.title?.trim?.() || '', CANVAS_LIMITS.title) || { note: 'Nota', table: 'Tabela', chart: 'Gráfico', html: 'Página', image: 'Imagem', video: 'Vídeo' }[args.kind], area, ...spot, w, h, ...this.content(args.kind, args), touchedBy: botId, touchedAt: stamp };
    this.check(card);
    this.db.run('INSERT INTO canvas_items(id,kind,body,bot_id,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, card.kind, JSON.stringify(strip(card)), botId, stamp, stamp);
    if (near) this.link(botId, { from: near.id, to: id, label: args.label || '' });
    this.changed(); return { id, kind: card.kind, title: card.title, area: card.area || null, x: card.x, y: card.y, w, h, message: 'O cartão está no canvas.' };
  }
  /** A free spot near (x, y): moves down until it overlaps no card. */
  free(x, y, w, h) {
    const cards = this.cards(); let spot = { x, y };
    for (let n = 0; n < 50; n++) { const hit = cards.find(card => spot.x < card.x + card.w && spot.x + w > card.x && spot.y < card.y + card.h && spot.y + h > card.y); if (!hit) break; spot = { x, y: hit.y + hit.h + GAP }; }
    return spot;
  }
  update(botId, args) {
    const card = this.card(args.id); this.botId = botId;
    if (card.sticky) throw new Error('Essa nota é da pessoa e só ela muda. Para responder, crie um cartão seu ao lado dela (canvas_add com near).');
    const next = { ...card, ...this.content(card.kind, args, card) };
    if (args.title !== undefined) next.title = clip(String(args.title).trim(), CANVAS_LIMITS.title) || card.title;
    if (args.area !== undefined) next.area = clip(String(args.area).trim(), CANVAS_LIMITS.area);
    for (const key of ['x', 'y']) if (args[key] !== undefined) next[key] = number(args[key], -100000, 100000) ?? card[key];
    for (const key of ['w', 'h']) if (args[key] !== undefined) next[key] = number(args[key], key === 'w' ? 160 : 100, 2400) ?? card[key];
    if (args.area !== undefined && args.x === undefined && fold(next.area) !== fold(card.area || '')) Object.assign(next, this.place(next.area, next.w, next.h));
    this.check(next); this.save(next, botId);
    return { id: card.id, title: next.title, area: next.area || null, x: next.x, y: next.y, w: next.w, h: next.h, message: 'Cartão atualizado.' };
  }
  save(card, botId) {
    const stamp = now(); const body = strip({ ...card, ...(botId ? { touchedBy: botId, touchedAt: stamp } : {}) });
    this.db.run('UPDATE canvas_items SET body=?,updated_at=? WHERE id=?', JSON.stringify(body), stamp, card.id); this.changed();
  }
  link(botId, { from, to, label = '' }) {
    const a = this.card(from), b = this.card(to);
    if (a.id === b.id) throw new Error('Ligue dois cartões diferentes.');
    const existing = this.links().find(link => link.from === a.id && link.to === b.id || link.from === b.id && link.to === a.id);
    const stamp = now();
    if (existing) { this.db.run('UPDATE canvas_items SET body=?,updated_at=? WHERE id=?', JSON.stringify({ from: existing.from, to: existing.to, label: clip(label, CANVAS_LIMITS.label) }), stamp, existing.id); this.changed(); return { id: existing.id, from: a.id, to: b.id, message: 'A ligação já existia; o rótulo foi atualizado.' }; }
    if (this.links().length >= CANVAS_LIMITS.links) throw new Error('O canvas já tem ligações demais: remova as que não servem mais.');
    const id = randomUUID();
    this.db.run('INSERT INTO canvas_items(id,kind,body,bot_id,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, 'link', JSON.stringify({ from: a.id, to: b.id, label: clip(label, CANVAS_LIMITS.label) }), botId, stamp, stamp);
    this.changed(); return { id, from: a.id, to: b.id, message: 'Cartões ligados.' };
  }
  remove(id) {
    const all = this.rows(); const found = all.find(item => item.id === id || id?.length >= 8 && item.id.startsWith(id));
    if (!found) throw new Error('Cartão ou ligação não encontrado. Use canvas_read para ver os ids.');
    this.db.run('DELETE FROM canvas_items WHERE id=?', found.id);
    if (found.kind !== 'link') for (const link of all.filter(item => item.kind === 'link' && (item.from === found.id || item.to === found.id))) this.db.run('DELETE FROM canvas_items WHERE id=?', link.id);
    this.changed(); return { deleted: true, id: found.id };
  }
  /** Each bot's browser is a card of its own, made and kept current as the bot browses. */
  browser(botId, { url = '', title = '', viewport } = {}) {
    const bot = this.db.bot(botId); if (!bot) return null;
    const found = this.cards().find(card => card.kind === 'browser' && card.botId === botId);
    if (found) {
      const next = { ...found, url: clip(url, 2000) || found.url, title: clip(title, CANVAS_LIMITS.title) || found.title, ...(viewport ? { viewport } : {}) };
      if (viewport && VIEWPORTS[viewport]) { const size = VIEWPORTS[viewport]; const scale = 300 / size.height; next.w = Math.round(Math.max(220, Math.min(560, size.width * scale * (size.mobile ? 1.15 : 1)))); next.h = viewport === 'computador' ? 300 : 420; }
      this.save(next, botId); return found.id;
    }
    if (this.cards().length >= CANVAS_LIMITS.cards) return null;
    const area = this.cards().filter(card => card.botId === botId && card.area).at(-1)?.area || '';
    const [w, h] = SIZES.browser; const spot = this.place(area, w, h); const stamp = now(), id = randomUUID();
    this.db.run('INSERT INTO canvas_items(id,kind,body,bot_id,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, 'browser', JSON.stringify({ kind: 'browser', title: clip(title, CANVAS_LIMITS.title) || `Navegador de ${bot.name}`, area, ...spot, w, h, url: clip(url, 2000), viewport: viewport || 'computador', touchedBy: botId, touchedAt: stamp }), botId, stamp, stamp);
    this.changed(); return id;
  }
  /**
   * The person's own note (a sticky note): written in the app, on the spot they chose. The bots read it in canvas_read as written by the
   * owner. With `id` the text of an existing one changes.
   */
  personNote({ id, text: body, x, y } = {}) {
    const value = text(body, 4000, 'A nota');
    if (!value?.trim()) throw new Error('Escreva a nota.');
    if (id) {
      const card = this.card(id); if (!card.sticky) throw new Error('Só as suas notas podem ser editadas aqui.');
      this.save({ ...card, text: value.trim() }, null); return { id: card.id };
    }
    if (this.cards().length >= CANVAS_LIMITS.cards) throw new Error(`O canvas já tem ${CANVAS_LIMITS.cards} cartões: tire um antes.`);
    const w = 240, h = 180; const spot = Number.isFinite(x) && Number.isFinite(y) ? this.free(number(x, -100000, 100000), number(y, -100000, 100000), w, h) : this.place('', w, h);
    const stamp = now(), key = randomUUID();
    this.db.run('INSERT INTO canvas_items(id,kind,body,bot_id,created_at,updated_at) VALUES(?,?,?,?,?,?)', key, 'note', JSON.stringify({ kind: 'note', title: 'Sua nota', area: '', ...spot, w, h, text: value.trim(), sticky: true }), null, stamp, stamp);
    this.changed(); return { id: key };
  }
  /** The person moves, resizes or renames a card, or tidies an area, in the app. */
  personMove({ id, x, y, w, h }) {
    const card = this.card(id);
    this.save({ ...card, x: number(x, -100000, 100000) ?? card.x, y: number(y, -100000, 100000) ?? card.y, w: number(w, 160, 2400) ?? card.w, h: number(h, 100, 2400) ?? card.h }, null);
    return { moved: true };
  }
  /** Tidies the canvas: each area becomes rows of cards, the areas side by side in rows of the board, nothing overlapping. */
  tidy() {
    const cards = this.cards(); const areas = [...new Set(cards.map(card => card.area || ''))]; let left = 0, top = 0, band = 0;
    for (const area of areas) {
      // The area's own shape first (from 0,0), then where it goes on the board.
      let x = 0, y = 0, row = 0, wide = 0; const spots = [];
      for (const card of cards.filter(item => (item.area || '') === area).sort((a, b) => a.y - b.y || a.x - b.x)) {
        if (x && x + card.w > AREA_WIDE) { x = 0; y += row + GAP; row = 0; }
        spots.push([card, x, y]); x += card.w + GAP; row = Math.max(row, card.h); wide = Math.max(wide, x - GAP);
      }
      const tall = y + row;
      if (left && left + wide > BOARD_WIDE) { left = 0; top += band + AREA_GAP; band = 0; }
      for (const [card, cx, cy] of spots) if (card.x !== left + cx || card.y !== top + cy) this.db.run('UPDATE canvas_items SET body=?,updated_at=? WHERE id=?', JSON.stringify(strip({ ...card, x: left + cx, y: top + cy })), now(), card.id);
      left += wide + AREA_GAP; band = Math.max(band, tall);
    }
    this.changed(); return { tidied: cards.length };
  }
}
// Only the card's own fields go to the database; the row has id, kind, bot and times.
function strip(card) { const { id, botId, createdAt, updatedAt, error, rows: _rows, ...rest } = card; return card.kind === 'table' && !card.source ? { ...rest, rows: card.rows } : rest; }
