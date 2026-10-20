// Routine triggers, shared by the supervisor (validation, scheduling) and the app (labels).
const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const MIN_INTERVAL = 15;

export function validTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

export function routineTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) throw new Error('Informe o gatilho da rotina.');
  const keys = { interval: ['type', 'everyMinutes'], daily: ['type', 'time', 'days'], notification: ['type', 'app', 'query'] }[trigger.type];
  if (!keys || Object.keys(trigger).some(key => !keys.includes(key))) throw new Error('Use um gatilho interval, daily ou notification.');
  if (trigger.type === 'interval') {
    if (!Number.isInteger(trigger.everyMinutes) || trigger.everyMinutes < MIN_INTERVAL || trigger.everyMinutes > 10080) throw new Error(`O intervalo precisa ficar entre ${MIN_INTERVAL} minutos e 7 dias.`);
    return { type: 'interval', everyMinutes: trigger.everyMinutes };
  }
  if (trigger.type === 'daily') {
    if (typeof trigger.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)) throw new Error('Use o horário no formato HH:MM.');
    const days = trigger.days === undefined ? ALL_DAYS : trigger.days;
    if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) throw new Error('Use dias da semana de 0 (domingo) a 6 (sábado).');
    return { type: 'daily', time: trigger.time, days: [...days].sort() };
  }
  const text = (value, max) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > max || /\u0000/.test(value)) throw new Error('Filtro de notificação inválido.');
    return value.trim();
  };
  const app = text(trigger.app, 100), query = text(trigger.query, 200);
  if (!app && !query) throw new Error('Diga de qual app ou com qual texto a notificação deve disparar a rotina.');
  return { type: 'notification', app, query };
}

export function describeTrigger(trigger) {
  if (trigger.type === 'interval') return trigger.everyMinutes % 60 ? `A cada ${trigger.everyMinutes} min` : `A cada ${trigger.everyMinutes / 60} h`;
  if (trigger.type === 'daily') return `${trigger.days.length === 7 ? 'Todo dia' : trigger.days.map(day => DAY_NAMES[day]).join(', ')} às ${trigger.time}`;
  return `Quando chegar notificação${trigger.app ? ` do ${trigger.app}` : ''}${trigger.query ? ` com “${trigger.query}”` : ''}`;
}

export function matchesNotification(trigger, item) {
  if (trigger.type !== 'notification') return false;
  const app = trigger.app.toLowerCase(), query = trigger.query.toLowerCase();
  return (!app || item.app.toLowerCase().includes(app) || item.package.toLowerCase().includes(app))
    && (!query || `${item.title}\n${item.text}\n${item.subText}`.toLowerCase().includes(query));
}

function wallClock(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(ms).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

// The UTC instant when the wall clock in timeZone shows the given date and time.
export function instant(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month, day, hour, minute);
  const first = guess - (wallClock(guess, timeZone) - guess);
  return guess - (wallClock(first, timeZone) - first);
}

/** Next run strictly after `from` (ms), or null for event triggers. */
export function nextRun(trigger, from, timeZone) {
  if (trigger.type === 'interval') return from + trigger.everyMinutes * 60000;
  if (trigger.type !== 'daily') return null;
  const today = new Date(wallClock(from, timeZone));
  const [hour, minute] = trigger.time.split(':').map(Number);
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
    if (!trigger.days.includes(date.getUTCDay())) continue;
    const at = instant(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, timeZone);
    if (at > from) return at;
  }
  return null;
}

export function routineArguments(args) {
  const text = (name, max) => {
    if (typeof args[name] !== 'string' || !args[name].trim() || args[name].length > max || /\u0000/.test(args[name])) throw new Error('Preencha título (até 80) e instruções (até 2.000 caracteres).');
    return args[name].trim();
  };
  return { title: text('title', 80), instructions: text('instructions', 2000), trigger: routineTrigger(args.trigger) };
}
