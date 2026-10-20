// The bots write Markdown. This reader is shared by the app (chat bubbles) and the supervisor (PDF, Word and
// spreadsheet files), so a table or chart looks the same in the conversation and in a file the bot sends.
//
// Blocks: heading, paragraph, list, table, code, chart (```chart with JSON), quote, rule.
// Inline: **bold**, *italic* / _italic_, `code`, [text](https://link).

const CHART_TYPES = ['bar', 'line', 'pie'];

/** A chart block's JSON, checked: {type, title?, labels[], series:[{name?, data[]}]}; null when invalid. */
export function chartSpec(source) {
  let value;
  try { value = JSON.parse(source); } catch { return null; }
  if (!value || typeof value !== 'object' || !CHART_TYPES.includes(value.type)) return null;
  const labels = Array.isArray(value.labels) ? value.labels.slice(0, 50).map(label => String(label).slice(0, 40)) : null;
  const series = Array.isArray(value.series) ? value.series.slice(0, 6) : Array.isArray(value.data) ? [{ name: '', data: value.data }] : null;
  if (!labels?.length || !series?.length) return null;
  const clean = series.map(item => ({ name: String(item?.name || '').slice(0, 40), data: labels.map((_, index) => Number(item?.data?.[index])).map(number => Number.isFinite(number) ? number : 0) }));
  return { type: value.type, title: typeof value.title === 'string' ? value.title.slice(0, 100) : '', labels, series: value.type === 'pie' ? clean.slice(0, 1) : clean };
}

const cells = line => {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = []; let current = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') { current += '|'; i++; }
    else if (body[i] === '|') { out.push(current.trim()); current = ''; }
    else current += body[i];
  }
  out.push(current.trim());
  return out;
};
const isDivider = line => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");

// Models often write formulas in LaTeX, which neither the chat nor the files can typeset. Common notation is turned
// into Unicode (x², ∫₀³, √, ≤, α); what is left loses only its backslashes and braces.
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', '′': '′' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', n: 'ₙ', x: 'ₓ' };
const SYMBOLS = { int: '∫', iint: '∬', oint: '∮', sum: 'Σ', prod: '∏', infty: '∞', pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', varphi: 'φ', omega: 'ω', Omega: 'Ω', cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', iff: '⇔', partial: '∂', nabla: '∇', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', cdots: '⋯', ldots: '…', dots: '…', circ: '°', degree: '°', angle: '∠', perp: '⊥', parallel: '∥', lim: 'lim', sin: 'sen', cos: 'cos', tan: 'tg', ln: 'ln', log: 'log', exp: 'exp' };
const group = (text, start) => {
  if (text[start] === '\\') { const name = /^\\[a-zA-Z]+/.exec(text.slice(start))?.[0]; if (name) return [name, start + name.length]; }
  if (text[start] !== '{') return [text[start] ?? '', start + 1];
  let depth = 0;
  for (let i = start; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) return [text.slice(start + 1, i), i + 1]; }
  return [text.slice(start + 1), text.length];
};
const script = (value, table, mark) => [...value].every(ch => table[ch]) ? [...value].map(ch => table[ch]).join('') : `${mark}(${value})`;
export function texToText(source) {
  let out = '', i = 0; const tex = String(source);
  while (i < tex.length) {
    const ch = tex[i];
    if (ch === '\\') {
      const name = /^[a-zA-Z]+/.exec(tex.slice(i + 1))?.[0];
      if (!name) { const next = tex[i + 1] ?? ''; out += next === ',' || next === ';' || next === ':' || next === ' ' ? ' ' : next === '!' ? '' : next; i += 2; continue; }
      i += 1 + name.length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [top, a] = group(tex, i); const [bottom, b] = group(tex, a); i = b;
        const wrap = value => /^[\w.²³]+$/.test(value) ? value : `(${value})`;
        out += `${wrap(texToText(top))}/${wrap(texToText(bottom))}`;
      } else if (name === 'sqrt') { const [inner, a] = group(tex, i); i = a; const value = texToText(inner); out += /^\w+$/.test(value) ? `√${value}` : `√(${value})`; }
      else if (['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathcal', 'operatorname', 'textbf', 'textit', 'mbox', 'boxed', 'underline', 'overline', 'bar', 'hat', 'vec', 'tilde', 'widehat', 'overrightarrow'].includes(name)) {
        const [inner, a] = group(tex, i); i = a; const value = texToText(inner);
        out += name === 'vec' || name === 'overrightarrow' ? value + '⃗' : name === 'hat' || name === 'widehat' ? value + '̂' : name === 'bar' || name === 'overline' ? value + '̄' : value;
      } else if (name === 'mathbb') { const [inner, a] = group(tex, i); i = a; out += { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' }[inner] ?? inner; }
      else if (['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'limits'].includes(name)) continue;
      else if (name === 'quad' || name === 'qquad') out += '  ';
      else out += SYMBOLS[name] ?? name;
      continue;
    }
    if (ch === '^' || ch === '_') {
      const [inner, a] = group(tex, i + 1); i = a;
      const value = texToText(inner);
      out += ch === '^' && (value === '∘' || value === '°' || inner === '\\circ') ? '°' : script(value, ch === '^' ? SUPER : SUB, ch);
      continue;
    }
    if (ch === '{' || ch === '}') { i++; continue; }
    out += ch === '-' ? '−' : ch; i++;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
const mathish = value => /[\\^_{}]/.test(value);
function withoutTex(text) {
  // Code fences keep their text as written.
  return text.split(/(^\s*```[\s\S]*?^\s*```\s*$)/m).map((part, index) => index % 2 ? part : part
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body) => '\n' + texToText(body) + '\n')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => '\n' + texToText(body) + '\n')
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body) => texToText(body))
    .replace(/\$([^$\n]+?)\$/g, (match, body) => mathish(body) ? texToText(body) : match)).join('');
}

export function parseBlocks(text) {
  const lines = withoutTex(String(text || '').replace(/\r\n?/g, '\n')).split('\n');
  const blocks = []; let paragraph = [];
  const flush = () => { if (paragraph.length) { blocks.push({ type: 'paragraph', text: paragraph.join('\n') }); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      const source = body.join('\n');
      const spec = fence[1].toLowerCase() === 'chart' ? chartSpec(source) : null;
      blocks.push(spec ? { type: 'chart', spec } : { type: 'code', lang: fence[1], text: source });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); continue; }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { flush(); blocks.push({ type: 'rule' }); continue; }
    if (line.includes('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flush();
      const header = cells(line); const rows = []; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      blocks.push({ type: 'table', header, rows: rows.map(row => header.map((_, index) => row[index] ?? '')) });
      continue;
    }
    const item = /^\s*([-*+•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]); const items = [item[2]];
      while (i + 1 < lines.length) {
        const next = /^\s*([-*+•]|\d+[.)])\s+(.*)$/.exec(lines[i + 1]);
        if (next && /\d/.test(next[1]) === ordered) { items.push(next[2]); i++; }
        else if (lines[i + 1].trim() && /^\s{2,}\S/.test(lines[i + 1])) { items[items.length - 1] += ' ' + lines[i + 1].trim(); i++; }
        else break;
      }
      const start = ordered ? Number(/\d+/.exec(item[1])[0]) : 1;
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Inline runs: [{ text, bold?, italic?, code?, href? }]. Links only http(s). */
export function parseInline(text) {
  const runs = []; const source = String(text || '');
  const pattern = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)|(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g;
  let last = 0, match;
  while ((match = pattern.exec(source))) {
    const lead = match[6] ?? match[8] ?? '';
    const start = match.index + lead.length;
    if (start > last) runs.push({ text: source.slice(last, start) });
    if (match[2] !== undefined) runs.push(...parseInline(match[2]).map(run => ({ ...run, bold: true })));
    else if (match[3] !== undefined) runs.push({ text: match[3], code: true });
    else if (match[4] !== undefined) runs.push({ text: match[4], href: match[5] });
    else runs.push({ text: match[7] ?? match[9], italic: true });
    last = pattern.lastIndex;
  }
  if (last < source.length) runs.push({ text: source.slice(last) });
  return runs.filter(run => run.text);
}

/** Text without Markdown marks (notifications, plain-text files). */
export const plainText = text => parseBlocks(text).map(block => {
  const inline = value => parseInline(value).map(run => run.text).join('');
  if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') return inline(block.text);
  if (block.type === 'list') return block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : '•'} ${inline(item)}`).join('\n');
  if (block.type === 'table') return [block.header, ...block.rows].map(row => row.map(inline).join('\t')).join('\n');
  if (block.type === 'chart') return `[Gráfico${block.spec.title ? ': ' + block.spec.title : ''}]`;
  if (block.type === 'code') return block.text;
  return '';
}).filter(Boolean).join('\n\n');
