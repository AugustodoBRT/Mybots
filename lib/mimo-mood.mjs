// Which expression a bot wears right now, from what is happening to it. Pure, with a clock you can hand in, so it is tested without waiting.
//   base:      sleeping (its computer is off) · waiting for a decision · working · calm
//   reactions: the user writes → curious · the answer is being written → talking · the answer arrives → talking, then happy
//              an error → error · a decision asked / waking up → surprised · now and then, calm or busy, a fit of "do mal"
// `observe(id, snapshot)` is called each time the app's state changes; `tick()` each ~250 ms; `moodOf(id)` is what to show.
const HOLD = { curioso: 1500, erro: 5000, surpreso: 1200, falando: 2300, concluido: 2400, domal: 1500 };
const PRIORITY = { erro: 9, surpreso: 7, falando: 6, concluido: 5, curioso: 4, domal: 2 };

export function createDirector({ now = () => Date.now(), random = Math.random, surtos = true } = {}) {
  const bots = new Map();
  const entry = id => { let b = bots.get(id); if (!b) { b = { snap: null, overlays: [], talkUntil: 0, surtoAt: now() + 7000 + random() * 11000, surtoUntil: 0, mood: 'normal' }; bots.set(id, b); } return b; };
  const add = (b, mood, from = now(), ms = HOLD[mood]) => { if (b.snap?.asleep && mood !== 'erro') return; b.overlays.push({ mood, from, until: from + ms, pr: PRIORITY[mood] }); if (b.overlays.length > 8) b.overlays.shift(); };
  const base = s => s?.asleep ? 'dormindo' : s?.waiting ? 'esperando' : s?.working ? 'trabalhando' : 'normal';
  function resolve(b) {
    const t = now(), s = b.snap, calm = base(s); b.overlays = b.overlays.filter(o => o.until > t);
    let best = null; for (const o of b.overlays) if (o.from <= t && (!best || o.pr > best.pr || (o.pr === best.pr && o.from > best.from))) best = o;
    if (b.talkUntil > t && (!best || best.pr < PRIORITY.falando)) best = { mood: 'falando', pr: PRIORITY.falando };
    if (calm === 'dormindo' && best && best.mood !== 'erro') best = null; // asleep: nothing is said
    let mood = best ? best.mood : calm;
    if (surtos && !best && (calm === 'normal' || calm === 'trabalhando')) {
      if (b.surtoUntil > t) mood = 'domal';
      else if (t >= b.surtoAt) { b.surtoUntil = t + HOLD.domal; b.surtoAt = t + HOLD.domal + 7000 + random() * 11000; mood = 'domal'; }
    }
    const changed = mood !== b.mood; b.mood = mood; return changed;
  }
  return {
    // snapshot: { working, waiting, asleep, draft (length of the reply being written), last: { id, role, status, origin } | null }
    observe(id, snap) {
      const b = entry(id), p = b.snap, t = now(); b.snap = { working: !!snap.working, waiting: !!snap.waiting, asleep: !!snap.asleep, draft: snap.draft || 0, last: snap.last || null };
      if (p) {
        const s = b.snap;
        if (s.last && (!p.last || s.last.id !== p.last.id)) {
          if (s.last.role === 'user' && s.last.origin !== 'routine') add(b, 'curioso', t);
          else if (s.last.role === 'assistant') {
            if (s.last.status === 'error') add(b, 'erro', t);
            else if (s.last.status !== 'streaming') { add(b, 'falando', t); if (!s.working) add(b, 'concluido', t + HOLD.falando); }
          }
        } else if (s.last && p.last && s.last.id === p.last.id && s.last.status === 'error' && p.last.status !== 'error') add(b, 'erro', t);
        if (s.draft > p.draft) b.talkUntil = t + 1400;
        if (s.waiting && !p.waiting) add(b, 'surpreso', t);
        if (p.asleep && !s.asleep) add(b, 'surpreso', t);
      }
      resolve(b); return b.mood;
    },
    // A bot spoke in a room (its own conversation is not the one the app watches): it talks, then is pleased.
    spoke(id, last) { const b = entry(id), t = now(); if (last?.status === 'error') add(b, 'erro', t); else { add(b, 'falando', t); if (!b.snap?.working) add(b, 'concluido', t + HOLD.falando); } resolve(b); return b.mood; },
    // Moves time: expires reactions and starts fits. Returns the ids whose expression changed.
    tick() { const changed = []; for (const [id, b] of bots) if (resolve(b)) changed.push(id); return changed; },
    moodOf: id => bots.get(id)?.mood || 'normal',
    forget: id => { bots.delete(id); }
  };
}
