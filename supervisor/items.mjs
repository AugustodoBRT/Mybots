import { randomUUID } from 'node:crypto';
import { now, uuid } from './database.mjs';
import { instant } from '../mobile/routine-text.js';

// The same activity is the same course, title and deadline, ignoring case, accents and punctuation.
const normal = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const itemKey = ({ course, title, due }) => `${normal(course)}|${normal(title)}|${due || ''}`;
const clip = (value, max) => value.length > max ? value.slice(0, max - 1) + '…' : value;
const localDate = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

/**
 * A deadline is a date ("2026-10-25") or a date and time ("2026-10-25T23:59") on the phone's wall clock.
 * A date alone stays a date: it is never turned into 23:59. Returns the instants that matter for it.
 */
export function deadline(due, timeZone) {
  const [date, time] = due.split('T');
  const [year, month, day] = date.split('-').map(Number);
  if (time) {
    const [hour, minute] = time.split(':').map(Number);
    const at = instant(year, month - 1, day, hour, minute, timeZone);
    return { dateOnly: false, at, end: at, remind: at - 86400000 };
  }
  const start = instant(year, month - 1, day, 0, 0, timeZone);
  // The day before at 09:00, local time.
  return { dateOnly: true, at: start, end: instant(year, month - 1, day + 1, 0, 0, timeZone), remind: instant(year, month - 1, day - 1, 9, 0, timeZone) };
}

/** "amanhã (sex., 23/10) às 23:59", in the phone's time zone, relative to `from`. */
export function describeDue(due, timeZone, from) {
  const { dateOnly, at } = deadline(due, timeZone);
  const day = localDate(at, timeZone);
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(at);
  const relative = day === localDate(from, timeZone) ? `hoje (${label})` : day === localDate(from + 86400000, timeZone) ? `amanhã (${label})` : label;
  return dateOnly ? relative : `${relative} às ${new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at)}`;
}

/**
 * The bot's pending items (activities, tasks). Creating one that already exists (same key) returns the existing
 * one; a changed deadline is an update, not a new item. Items with a deadline get one MyBots notice the day before.
 */
export class Items {
  constructor(db, { notify = async () => {}, changed = () => {}, timeZone = () => 'UTC', clock = () => Date.now() } = {}) {
    Object.assign(this, { db, notify, changed, timeZone, clock });
  }
  row(row) {
    const { key, ...body } = JSON.parse(row.body);
    return { id: row.id, botId: row.bot_id, ...body, state: row.state, createdAt: row.created_at, ...(body.due ? { dueLabel: describeDue(body.due, this.timeZone(), this.clock()) } : {}) };
  }
  rows(botId) { return this.db.all('SELECT * FROM pending_items WHERE bot_id=? ORDER BY created_at', botId); }
  list(botId, { state = 'open', limit = 50 } = {}) {
    this.db.requireBot(botId);
    const items = this.rows(botId).filter(row => state === 'all' || row.state === state).map(row => this.row(row));
    // Deadlines first, the nearest on top; items without a deadline after them.
    items.sort((a, b) => (a.due ? deadline(a.due, this.timeZone()).at : Infinity) - (b.due ? deadline(b.due, this.timeZone()).at : Infinity));
    return { items: items.slice(0, limit), total: items.length };
  }
  find(botId, key, except) { return this.rows(botId).find(row => row.id !== except && JSON.parse(row.body).key === key); }
  create(botId, args) {
    const bot = this.db.requireBot(botId);
    const fields = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== ''));
    const key = itemKey(fields);
    const existing = this.find(bot.id, key);
    if (existing) return { duplicate: true, item: this.row(existing), message: 'Esta pendência já está registrada (mesma disciplina, título e prazo); nada foi criado. Se algo mudou, use task_update_item com o id.' };
    const id = randomUUID();
    this.db.transaction(() => {
      this.db.run('INSERT INTO pending_items VALUES(?,?,?,?,?)', id, bot.id, JSON.stringify({ ...fields, key }), 'open', now());
      this.db.record('item_created', `Pendência criada: ${fields.course ? fields.course + ' · ' : ''}${fields.title}${fields.due ? ` (prazo ${describeDue(fields.due, this.timeZone(), this.clock())})` : ''}.`, bot.id);
    });
    this.changed('activity.new');
    return this.row(this.db.get('SELECT * FROM pending_items WHERE id=?', id));
  }
  update(botId, { id, done, ...changes }) {
    if (!uuid(id)) throw new Error('Pendência inválida.');
    const row = this.db.get('SELECT * FROM pending_items WHERE id=?', id);
    // A bot only sees and changes its own items.
    if (!row || row.bot_id !== botId) throw new Error('Pendência não encontrada. Veja os ids em task_list_items.');
    const { key: _key, ...body } = JSON.parse(row.body);
    const next = { ...body };
    for (const [field, value] of Object.entries(changes)) if (value === '') delete next[field]; else next[field] = value;
    // A new deadline gets its own notice.
    if (next.due !== body.due) delete next.remindedAt;
    const key = itemKey(next);
    if (this.find(botId, key, id)) throw new Error('Já existe outra pendência igual (mesma disciplina, título e prazo).');
    const state = done === true ? 'done' : done === false ? 'open' : row.state;
    const changesText = [next.due !== body.due && `prazo ${body.due ? describeDue(body.due, this.timeZone(), this.clock()) : 'sem data'} → ${next.due ? describeDue(next.due, this.timeZone(), this.clock()) : 'sem data'}`,
      state !== row.state && (state === 'done' ? 'concluída' : 'reaberta')].filter(Boolean).join(', ') || 'dados atualizados';
    this.db.transaction(() => {
      this.db.run('UPDATE pending_items SET body=?,state=? WHERE id=?', JSON.stringify({ ...next, key }), state, id);
      this.db.record('item_updated', `Pendência “${next.title}”: ${changesText}.`, botId);
    });
    this.changed('activity.new');
    return this.row(this.db.get('SELECT * FROM pending_items WHERE id=?', id));
  }
  // Notices the day before: open items with a deadline, not yet reminded, inside [remind, end).
  waiting() {
    return this.db.all("SELECT * FROM pending_items WHERE state='open'").map(row => ({ row, body: JSON.parse(row.body) }))
      .filter(({ row, body }) => body.due && !body.remindedAt && !this.db.bot(row.bot_id)?.deletedAt)
      .map(item => ({ ...item, when: deadline(item.body.due, this.timeZone()) }));
  }
  /** When the next notice is due (ISO), so the phone wakes for it with the screen off. */
  next() {
    const now = this.clock();
    const times = this.waiting().filter(item => item.when.end > now).map(item => Math.max(item.when.remind, now));
    return times.length ? new Date(Math.min(...times)).toISOString() : null;
  }
  async tick() {
    const at = this.clock();
    for (const { row, body, when } of this.waiting()) {
      if (at < when.remind || at >= when.end) continue;
      // Marked first: a crash or a slow notice never sends the same reminder twice.
      this.db.run('UPDATE pending_items SET body=? WHERE id=?', JSON.stringify({ ...body, remindedAt: now() }), row.id);
      const bot = this.db.bot(row.bot_id); const due = describeDue(body.due, this.timeZone(), at);
      const title = clip(`${bot.name} · ${body.course ? body.course + ': ' : ''}${body.title}`, 80);
      try {
        await this.notify({ title, body: clip(`Prazo ${due}.${body.details ? ' ' + body.details.replace(/\s+/g, ' ') : ''}`, 500) }, { id: 'mybots-item-' + row.id, botId: bot.id });
        this.db.record('item_reminder', `Aviso de prazo enviado: ${body.title} (${due}).`, bot.id);
      } catch (error) { this.db.record('item_reminder_failed', `Aviso de prazo não enviado: ${error.message}`.slice(0, 300), bot.id); }
      this.changed('activity.new');
    }
  }
}
