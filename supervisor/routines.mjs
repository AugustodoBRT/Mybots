import { randomUUID } from 'node:crypto';
import { now, uuid } from './database.mjs';
import { routineArguments, describeTrigger, matchesNotification, nextRun, validTimeZone } from '../mobile/routine-text.js';
import { DEVICE_NOTICE } from './device.mjs';

export const LIMITS = { perBot: 20, runsPerDay: 48, eventCooldownMs: 5 * 60000, eventsPerRun: 20, skipNoticeMs: 3600000 };

const clip = (value, max) => value.length > max ? value.slice(0, max - 1) + '…' : value;

/**
 * Routines turn a schedule or a matching phone notification into a queued task for their bot.
 * They never bypass grants or approvals: the run is an ordinary task, marked as coming from the routine.
 */
export class Routines {
  constructor(db, { queue, ready = () => null, notify = async () => {}, changed = () => {}, tickMs = 30000, clock = () => Date.now() } = {}) {
    Object.assign(this, { db, queue, ready, notify, changed, tickMs, clock });
    queue.on('changed', change => { if (change?.event === 'task.done') this.finished(change.taskId).catch(() => {}); });
  }
  timeZone() {
    const saved = this.db.get("SELECT value FROM metadata WHERE key='time_zone'")?.value;
    return validTimeZone(saved) ? saved : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
  setTimeZone(value) {
    if (!validTimeZone(value)) throw new Error('Fuso horário inválido.');
    if (value === this.timeZone()) return { timeZone: value };
    this.db.transaction(() => {
      this.db.run("INSERT INTO metadata VALUES('time_zone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", value);
      // Daily routines keep their wall-clock time in the new zone.
      for (const routine of this.all().filter(item => item.trigger.type === 'daily')) this.db.run('UPDATE routines SET next_run_at=? WHERE id=?', this.next(routine.trigger), routine.id);
    });
    return { timeZone: value };
  }
  next(trigger) { const at = nextRun(trigger, this.clock(), this.timeZone()); return at === null ? null : new Date(at).toISOString(); }
  row(row) {
    const body = JSON.parse(row.body);
    return { id: row.id, botId: row.bot_id, ...body, label: describeTrigger(body.trigger) + (body.skill ? ' · habilidade, sem IA' : ''), enabled: Boolean(row.enabled), nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
      pending: Boolean(row.pending), lastResult: row.last_result, createdAt: row.created_at, runsToday: this.runsToday(row.id) };
  }
  all() { return this.db.all('SELECT * FROM routines ORDER BY created_at').map(row => this.row(row)); }
  list(botId) { this.db.requireBot(botId); return this.all().filter(item => item.botId === botId); }
  get(id, botId) {
    if (!uuid(id)) throw new Error('Rotina inválida.');
    const row = this.db.get('SELECT * FROM routines WHERE id=?', id);
    // A bot only sees and changes its own routines; the id never crosses bots.
    if (!row || (botId && row.bot_id !== botId)) throw new Error('Rotina não encontrada.');
    return this.row(row);
  }
  runsToday(id) { return this.db.get('SELECT COUNT(*) AS count FROM routine_runs WHERE routine_id=? AND created_at >= ?', id, new Date(this.clock() - 86400000).toISOString()).count; }
  create(botId, args, origin = 'bot') {
    const bot = this.db.requireBot(botId); const routine = routineArguments(args);
    if (this.list(botId).length >= LIMITS.perBot) throw new Error(`Cada bot pode ter até ${LIMITS.perBot} rotinas.`);
    const id = randomUUID(); const stamp = now();
    this.db.transaction(() => {
      this.db.run('INSERT INTO routines(id,bot_id,body,enabled,next_run_at,last_event_at,pending,created_at,updated_at) VALUES(?,?,?,1,?,?,0,?,?)',
        id, bot.id, JSON.stringify({ ...routine, notify: true, origin }), this.next(routine.trigger), stamp, stamp, stamp);
      this.db.record('routine_created', `Rotina “${routine.title}” criada: ${describeTrigger(routine.trigger)}.`, bot.id);
    });
    this.changed('activity.new'); return this.get(id);
  }
  /** A daily routine that runs one of the bot's skills directly (no IA): the result goes to its chat and a notice. */
  createSkill(botId, { title, time, skill, input = {} }) {
    const bot = this.db.requireBot(botId);
    if (this.list(botId).length >= LIMITS.perBot) throw new Error(`Cada bot pode ter até ${LIMITS.perBot} rotinas.`);
    const trigger = routineArguments({ title, instructions: 'Habilidade', trigger: { type: 'daily', time, days: [0, 1, 2, 3, 4, 5, 6] } }).trigger;
    const id = randomUUID(); const stamp = now();
    this.db.transaction(() => {
      this.db.run('INSERT INTO routines(id,bot_id,body,enabled,next_run_at,last_event_at,pending,created_at,updated_at) VALUES(?,?,?,1,?,?,0,?,?)',
        id, bot.id, JSON.stringify({ title: title.slice(0, 80), instructions: `Roda a habilidade ${title} e manda o resultado.`, trigger, skill, input, notify: true, origin: 'skill' }), this.next(trigger), stamp, stamp, stamp);
      this.db.record('routine_created', `Rotina “${title}” criada: ${describeTrigger(trigger)}, com a habilidade (sem IA).`, bot.id);
    });
    this.changed('activity.new'); return this.get(id);
  }
  update(id, { enabled }, botId) {
    const routine = this.get(id, botId);
    if (typeof enabled !== 'boolean') throw new Error('Diga se a rotina fica ativa ou pausada.');
    this.db.transaction(() => {
      // Resuming starts counting from now; events that arrived while paused are not replayed.
      if (enabled) this.db.run('UPDATE routines SET enabled=1,next_run_at=?,pending=0,last_event_at=?,skipped_at=NULL,updated_at=? WHERE id=?', this.next(routine.trigger), now(), now(), id);
      else this.db.run('UPDATE routines SET enabled=0,pending=0,updated_at=? WHERE id=?', now(), id);
      this.db.record('routine_updated', `Rotina “${routine.title}” ${enabled ? 'retomada' : 'pausada'}.`, routine.botId);
    });
    this.changed('activity.new'); return this.get(id);
  }
  remove(id, botId) {
    const routine = this.get(id, botId);
    this.db.transaction(() => {
      this.db.run('DELETE FROM routines WHERE id=?', id);
      this.db.record('routine_deleted', `Rotina “${routine.title}” apagada.`, routine.botId);
    });
    this.changed('activity.new'); return { deleted: true };
  }
  /** Marks notification routines that match newly stored notifications; the run happens on the next tick. */
  notifications(items) {
    if (!items.length) return;
    let touched = false;
    for (const routine of this.all().filter(item => item.enabled && item.trigger.type === 'notification' && !item.pending)) {
      if (!items.some(item => matchesNotification(routine.trigger, item))) continue;
      this.db.run('UPDATE routines SET pending=1 WHERE id=?', routine.id); touched = true;
    }
    if (touched) this.tick();
  }
  start() { this.tick(); this.timer = setInterval(() => this.tick(), this.tickMs); }
  stop() { clearInterval(this.timer); }
  runNow(id) {
    const routine = this.get(id);
    if (this.busy(routine.botId)) throw new Error('Este bot já está trabalhando. Tente quando ele terminar.');
    const started = this.launch(routine, true);
    if (!started) throw new Error(this.db.get('SELECT last_result FROM routines WHERE id=?', id).last_result || 'Não consegui executar a rotina agora.');
    return { started: true };
  }
  busy(botId) { return this.db.activeTasks(botId).length > 0; }
  /** When the next routine is due (ISO), so the phone can wake the supervisor for it with the screen off. */
  nextDue() {
    const times = this.all().filter(item => item.enabled).map(item => item.trigger.type !== 'notification' ? item.nextRunAt
      : item.pending ? new Date(Math.max(this.clock(), (item.lastRunAt ? Date.parse(item.lastRunAt) : 0) + LIMITS.eventCooldownMs)).toISOString() : null);
    return times.filter(Boolean).sort()[0] || null;
  }
  tick() {
    const stamp = new Date(this.clock()).toISOString();
    for (const routine of this.all().filter(item => item.enabled)) {
      const due = routine.trigger.type === 'notification'
        ? routine.pending && (!routine.lastRunAt || this.clock() - Date.parse(routine.lastRunAt) >= LIMITS.eventCooldownMs)
        : routine.nextRunAt && routine.nextRunAt <= stamp;
      // Conversation comes first: a busy bot keeps the routine due for the next tick.
      if (due && !this.busy(routine.botId)) this.launch(routine);
    }
  }
  skip(routine, reason, advance) {
    const row = this.db.get('SELECT skipped_at FROM routines WHERE id=?', routine.id);
    this.db.run('UPDATE routines SET last_result=?,next_run_at=?,skipped_at=? WHERE id=?', reason, advance ? this.next(routine.trigger) : routine.nextRunAt,
      !row.skipped_at || this.clock() - Date.parse(row.skipped_at) > LIMITS.skipNoticeMs ? now() : row.skipped_at, routine.id);
    if (!row.skipped_at || this.clock() - Date.parse(row.skipped_at) > LIMITS.skipNoticeMs) { this.db.record('routine_skipped', `Rotina “${routine.title}” não rodou: ${reason}`, routine.botId); this.changed('activity.new'); }
    return false;
  }
  launch(routine, manual = false) {
    const bot = this.db.bot(routine.botId);
    if (!bot || bot.deletedAt) { this.db.run('UPDATE routines SET enabled=0 WHERE id=?', routine.id); return false; }
    const schedule = routine.trigger.type !== 'notification';
    // A skill routine runs the program itself, without the IA and without the queue.
    if (routine.skill && this.runSkill) {
      this.db.run('UPDATE routines SET last_run_at=?,next_run_at=?,pending=0,last_result=? WHERE id=?', now(), schedule && !manual ? this.next(routine.trigger) : routine.nextRunAt, 'Executando…', routine.id);
      this.runSkill(routine, bot, manual).then(summary => this.db.run('UPDATE routines SET last_result=? WHERE id=?', clip(summary, 200), routine.id))
        .catch(error => this.db.run('UPDATE routines SET last_result=? WHERE id=?', clip(error.message, 200), routine.id)).finally(() => this.changed('activity.new'));
      return true;
    }
    if (this.runsToday(routine.id) >= LIMITS.runsPerDay) return this.skip(routine, `limite de ${LIMITS.runsPerDay} execuções em 24 h atingido.`, schedule);
    const { selection, error, wait } = this.ready(bot);
    if (wait) return false;
    if (error) return this.skip(routine, error, schedule);
    let events = [], cursor = null;
    if (routine.trigger.type === 'notification') {
      const since = this.db.get('SELECT last_event_at FROM routines WHERE id=?', routine.id).last_event_at;
      events = this.db.all("SELECT body,created_at FROM events WHERE kind='notification' AND created_at > ? ORDER BY created_at", since)
        .map(row => ({ ...JSON.parse(row.body), at: row.created_at })).filter(item => matchesNotification(routine.trigger, item));
      if (events.length) cursor = events.at(-1).at;
      events = events.slice(-LIMITS.eventsPerRun);
      // Nothing new is resolved without calling the model.
      if (!events.length && !manual) { this.db.run('UPDATE routines SET pending=0 WHERE id=?', routine.id); return false; }
    }
    const text = this.prompt(routine, events, manual);
    const requestId = randomUUID();
    try {
      this.db.transaction(() => {
        this.db.enqueue(bot.id, requestId, text, selection, { origin: 'routine', routineId: routine.id, routineTitle: routine.title });
        this.db.run('INSERT INTO routine_runs(id,routine_id,task_id,created_at) VALUES(?,?,?,?)', randomUUID(), routine.id, requestId, now());
        this.db.run('UPDATE routines SET last_run_at=?,next_run_at=?,pending=0,last_event_at=?,last_result=?,skipped_at=NULL WHERE id=?', now(),
          schedule && !manual ? this.next(routine.trigger) : routine.nextRunAt, cursor ?? now(), 'Executando…', routine.id);
      });
    } catch (error) { return this.skip(routine, error.message, false); }
    this.changed('task.progress', { taskId: requestId }); this.queue.schedule();
    return true;
  }
  prompt(routine, events, manual) {
    const time = new Intl.DateTimeFormat('pt-BR', { timeZone: this.timeZone(), dateStyle: 'full', timeStyle: 'short' }).format(this.clock());
    const lines = events.map(item => `- ${new Intl.DateTimeFormat('pt-BR', { timeZone: this.timeZone(), hour: '2-digit', minute: '2-digit' }).format(Date.parse(item.at))} · ${item.app} · ${clip(item.title, 160)}: ${clip(item.text.replace(/\s+/g, ' '), 300)}`);
    const parts = [`[Rotina “${routine.title}” · ${manual ? 'execução manual' : describeTrigger(routine.trigger)} · ${time}]`,
      'Execução automática: a pessoa pode não estar olhando. Faça a tarefa abaixo e termine com um resumo curto (ele vira uma notificação). Se nada for relevante, diga isso em uma frase. Ações que exigem aprovação podem expirar sem resposta.',
      `Tarefa: ${routine.instructions}`];
    if (events.length) parts.push(`Notificações novas que dispararam a rotina. ${DEVICE_NOTICE}`, ...lines);
    let text = parts.join('\n');
    if (text.length > 7900) text = text.slice(0, 7899) + '…';
    return text;
  }
  async finished(taskId) {
    const run = this.db.get('SELECT routine_id FROM routine_runs WHERE task_id=?', taskId);
    const task = run && this.db.task(taskId);
    if (!task) return;
    const row = this.db.get('SELECT * FROM routines WHERE id=?', run.routine_id);
    if (!row) return;
    const routine = this.row(row); const bot = this.db.bot(task.bot_id);
    const reply = task.state === 'done' ? this.db.latest(bot.id, 'assistant')?.text || '' : '';
    const result = task.state === 'done' ? clip(reply.replace(/\s+/g, ' '), 200) : task.error || 'A execução não terminou.';
    this.db.run('UPDATE routines SET last_result=? WHERE id=?', result, routine.id);
    this.changed('activity.new');
    // The owner's own phone is the only destination, so this notice does not go through tool approval.
    if (routine.notify && task.state === 'done') {
      try { await this.notify({ title: clip(`${bot.name} · ${routine.title}`, 80), body: clip(reply.replace(/\s+/g, ' ') || 'Rotina concluída.', 500) }, { id: 'mybots-routine-' + routine.id, botId: bot.id }); }
      catch (error) { this.db.record('routine_notify_failed', error.message, bot.id, taskId); }
    }
  }
}
