// The canvas's geometry, kept apart from the screen so it can be tested: areas around their cards, where each link starts and ends,
// where each bot stands, the view that fits everything, and what a touch lands on. Canvas units are points at 100% zoom.

export const ZOOM = { min: 0.15, max: 2.5 };
export const HEADER = 34, CORNER = 26, AREA_PAD = 36, AREA_LABEL = 30, BOT = 44;
// A bot on the canvas is a small plate: its face, its name and what it is doing.
export const NODE_W = 156, NODE_H = 52, HUB_GAP = 150;
export const clampZoom = k => Math.max(ZOOM.min, Math.min(ZOOM.max, k));

/** One box per named area, around its cards, with room for the area's name on top. */
export function areaBoxes(cards) {
  const groups = new Map();
  for (const card of cards) if (card.area) { const list = groups.get(card.area) || []; list.push(card); groups.set(card.area, list); }
  return [...groups].map(([name, list]) => {
    const x0 = Math.min(...list.map(c => c.x)), y0 = Math.min(...list.map(c => c.y)), x1 = Math.max(...list.map(c => c.x + c.w)), y1 = Math.max(...list.map(c => c.y + c.h));
    return { name, x: x0 - AREA_PAD, y: y0 - AREA_PAD - AREA_LABEL - BOT, w: x1 - x0 + AREA_PAD * 2, h: y1 - y0 + AREA_PAD * 2 + AREA_LABEL + BOT };
  });
}

/** Where a line between two cards leaves each one: on the border, toward the other card's center. */
function edge(card, tx, ty) {
  const cx = card.x + card.w / 2, cy = card.y + card.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs(card.w / 2 / (dx || 1e-9)), Math.abs(card.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}
export function linkLine(a, b) {
  const start = edge(a, b.x + b.w / 2, b.y + b.h / 2), end = edge(b, a.x + a.w / 2, a.y + a.h / 2);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, mx: (start.x + end.x) / 2, my: (start.y + end.y) / 2 };
}

/** Each bot stands on top of the card it touched last; the ones that touched nothing wait in a column left of everything. */
export function botSpots(bots, cards, at = {}) {
  const byId = new Map(cards.map(card => [card.id, card])); const crowd = new Map(); const spots = {};
  const left = cards.length ? Math.min(...cards.map(c => c.x)) - 150 : 0, top = cards.length ? Math.min(...cards.map(c => c.y)) : 0;
  let idle = 0;
  for (const bot of bots) {
    const card = byId.get(at[bot.id]?.card);
    if (card) { const n = crowd.get(card.id) || 0; crowd.set(card.id, n + 1); spots[bot.id] = { x: card.x + 10 + n * (BOT + 6), y: card.y - BOT - 6, card: card.id }; }
    else spots[bot.id] = { x: left, y: top + idle++ * (BOT + 30), card: null };
  }
  return spots;
}

/**
 * Where every bot's plate goes. The Chefe is the centre of the team (the hub, left of the cards); a bot that made or touched a card
 * stands just above the one it touched last; the others wait in a ring around the Chefe. With nothing on the canvas the hub is at (0, 0).
 */
export function teamSpots(bots, cards, at = {}, chiefId = null) {
  const byId = new Map(cards.map(card => [card.id, card])); const crowd = new Map(); const spots = {};
  const owned = new Map(); for (const card of cards) if (card.botId) { const list = owned.get(card.botId) || []; list.push(card); owned.set(card.botId, list); }
  const idle = [];
  for (const bot of bots) {
    if (bot.id === chiefId) continue;
    const mine = owned.get(bot.id) || [];
    const card = byId.get(at[bot.id]?.card) || [...mine].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (!card) { idle.push(bot); continue; }
    const n = crowd.get(card.id) || 0; crowd.set(card.id, n + 1);
    spots[bot.id] = { x: card.x + 6 + n * (NODE_W + 8), y: card.y - NODE_H - 12, w: NODE_W, h: NODE_H, card: card.id };
  }
  const radius = Math.max(190, Math.ceil(idle.length * (NODE_H + 22) / (2 * Math.PI)) + 60);
  const hub = cards.length ? { x: Math.min(...cards.map(c => c.x)) - HUB_GAP - radius, y: (Math.min(...cards.map(c => c.y)) + Math.max(...cards.map(c => c.y + c.h))) / 2 } : { x: 0, y: 0 };
  const chief = bots.find(bot => bot.id === chiefId);
  if (chief) spots[chief.id] = { x: Math.round(hub.x - NODE_W / 2), y: Math.round(hub.y - NODE_H / 2), w: NODE_W, h: NODE_H, card: null, hub: true };
  idle.forEach((bot, index) => {
    // Without a Chefe the waiting bots are a plain column; with one, a ring around it, starting on top.
    if (!chief) { spots[bot.id] = { x: Math.round(hub.x - NODE_W / 2), y: Math.round(hub.y + (index - (idle.length - 1) / 2) * (NODE_H + 18) - NODE_H / 2), w: NODE_W, h: NODE_H, card: null }; return; }
    const angle = -Math.PI / 2 + index * 2 * Math.PI / idle.length;
    spots[bot.id] = { x: Math.round(hub.x + Math.cos(angle) * radius * 1.35 - NODE_W / 2), y: Math.round(hub.y + Math.sin(angle) * radius - NODE_H / 2), w: NODE_W, h: NODE_H, card: null };
  });
  return spots;
}

/** A cord between two rectangles: it leaves each border toward the other and sags in a soft curve, like a cable. */
export function cord(a, b) {
  const l = linkLine(a, b), dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  // Mostly sideways: the curve bends on x; mostly up and down: on y.
  const bend = Math.abs(dx) >= Math.abs(dy) ? [l.x1 + dx / 2, l.y1, l.x2 - dx / 2, l.y2] : [l.x1, l.y1 + dy / 2, l.x2, l.y2 - dy / 2];
  return { ...l, d: `M${l.x1},${l.y1} C${bend[0]},${bend[1]} ${bend[2]},${bend[3]} ${l.x2},${l.y2}` };
}

/** Every cord of the team: the Chefe to each bot, and each bot to every card it made (the one it is on now is `live`). */
export function teamCords(bots, cards, spots, at = {}, chiefId = null) {
  const cords = []; const chief = spots[chiefId];
  for (const bot of bots) {
    const spot = spots[bot.id]; if (!spot) continue;
    if (chief && bot.id !== chiefId) cords.push({ key: 'c' + bot.id, kind: 'team', botId: bot.id, ...cord(chief, spot) });
    for (const card of cards) if (card.botId === bot.id) cords.push({ key: 'o' + bot.id + card.id, kind: 'owns', botId: bot.id, live: at[bot.id]?.card === card.id, ...cord(spot, card) });
  }
  return cords;
}

/** Everything that is drawn, as one rectangle (cards and the bots waiting on the side). */
export function bounds(cards, spots = {}) {
  const boxes = [...cards, ...Object.values(spots).map(s => ({ x: s.x, y: s.y, w: s.w || BOT, h: s.h || BOT + 18 }))];
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y)), x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The view (zoom k, shift x and y) that shows a rectangle in a screen area, with a margin, never zooming past 100%. */
export function fitView(box, width, height, margin = 28) {
  if (!box || !width || !height) return { k: 1, x: width / 2 || 0, y: height / 2 || 0 };
  const k = clampZoom(Math.min(1, (width - margin * 2) / Math.max(1, box.w), (height - margin * 2) / Math.max(1, box.h)));
  return { k, x: (width - box.w * k) / 2 - box.x * k, y: (height - box.h * k) / 2 - box.y * k };
}

/** Zoom by `factor` keeping the canvas point under (px, py) still. */
export function zoomAround(view, px, py, factor) {
  const k = clampZoom(view.k * factor), wx = (px - view.x) / view.k, wy = (py - view.y) / view.k;
  return { k, x: px - wx * k, y: py - wy * k };
}

/** What a screen point lands on: a bot, a card's resize corner, its title bar (to drag it) or its body (to open it). Topmost first. */
export function hit(view, px, py, cards, spots = {}) {
  const x = (px - view.x) / view.k, y = (py - view.y) / view.k, slop = 6 / view.k;
  for (const [botId, s] of Object.entries(spots)) if (x >= s.x - slop && x <= s.x + (s.w || BOT) + slop && y >= s.y - slop && y <= s.y + (s.h || BOT + 16) + slop) return { kind: 'bot', id: botId };
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (x < c.x - slop || x > c.x + c.w + slop || y < c.y - slop || y > c.y + c.h + slop) continue;
    const corner = Math.max(CORNER, 30 / view.k);
    if (x >= c.x + c.w - corner && y >= c.y + c.h - corner) return { kind: 'resize', id: c.id, card: c };
    if (y <= c.y + Math.max(HEADER, 26 / view.k)) return { kind: 'header', id: c.id, card: c };
    return { kind: 'body', id: c.id, card: c };
  }
  return null;
}

/** The cards drawn last are on top: the one being dragged, then the most recently changed. */
export function stacked(cards, front) {
  return [...cards].sort((a, b) => (a.id === front) - (b.id === front) || String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
}

// A page a bot made runs isolated: no network, no access to the app; only what the bot wrote.
export const HTML_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
export const sandboxed = html => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_POLICY}"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${String(html || '')}</body></html>`;
