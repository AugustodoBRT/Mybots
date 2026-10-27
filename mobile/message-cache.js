import { parseBlocks, parseInline } from './markdown.js';

const markdown = new Map();
export function messageMarkdown(id, text) {
  const key = id || text; let entry = markdown.get(key);
  if (!entry || entry.text !== text) {
    const inline = new Map();
    entry = { text, blocks: parseBlocks(text), runs(value) { if (!inline.has(value)) inline.set(value, parseInline(value)); return inline.get(value); } };
    markdown.delete(key); markdown.set(key, entry);
    if (markdown.size > 240) markdown.delete(markdown.keys().next().value);
  }
  return entry;
}

export function sameMessage(a, b) {
  const x = a.message, y = b.message;
  // Length is the fast path; compare text too so corrections of equal length still appear.
  if (x.id !== y.id || x.status !== y.status || x.text?.length !== y.text?.length || x.text !== y.text) return false;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[key] !== y[key]) return false;
  return ['id', 'name', 'avatar', 'color'].every(key => a.bot?.[key] === b.bot?.[key]) && a.models === b.models &&
    (x.status !== 'error' || a.busy === b.busy) && a.onRetry === b.onRetry && a.onFile === b.onFile &&
    (x.attachments || []).every(file => (a.fileBusy === file.id) === (b.fileBusy === file.id));
}
