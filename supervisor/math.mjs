// A small LaTeX reader for the documents the bots write: a formula becomes HTML (web page and PDF), a Word equation (OMML) or plain text.
// It covers what school and engineering text uses: fractions, roots, powers and indices, Greek letters, operators, sums and integrals,
// text and accents. Anything it does not know is shown as its own name instead of breaking the document.
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
const SYMBOLS = { cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', oint: '∮', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', forall: '∀', exists: '∃', ldots: '…', cdots: '⋯', dots: '…', circ: '∘', degree: '°', angle: '∠', perp: '⊥', parallel: '∥', equiv: '≡', sim: '∼', propto: '∝', hbar: 'ℏ', ell: 'ℓ', prime: '′', neg: '¬', land: '∧', lor: '∨', emptyset: '∅', star: '⋆', bullet: '•', mid: '∣', ll: '≪', gg: '≫', cong: '≅', therefore: '∴', because: '∵', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', vert: '|', Vert: '‖', '|': '‖', ',': ' ', ';': ' ', ':': ' ', '!': '', quad: '  ', qquad: '    ', ' ': ' ', '{': '{', '}': '}', '%': '%', '&': '&', '#': '#', _: '_', $: '$', '\\': ' ' };
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'gcd', 'arg', 'mod']);
const TEXTS = new Set(['text', 'mathrm', 'textbf', 'mathbf', 'mathit', 'operatorname', 'mbox', 'textit', 'mathsf', 'mathtt']);
const ACCENTS = { hat: '̂', widehat: '̂', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', widetilde: '̃', bar: '̄', overline: '̄', check: '̌', acute: '́', grave: '̀' };
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', i: 'ᵢ', j: 'ⱼ', n: 'ₙ', k: 'ₖ', m: 'ₘ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ' };

const tokenize = src => {
  const tokens = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') { const m = /^\\([a-zA-Z]+|.)/s.exec(src.slice(i)); tokens.push('\\' + m[1]); i += m[0].length; continue; }
    tokens.push(c); i++;
  }
  return tokens;
};

/** LaTeX → tree. Never throws: what it cannot read stays as text. */
export function parseTex(src) {
  const tokens = tokenize(String(src)); let i = 0;
  const seq = until => { const out = []; while (i < tokens.length && tokens[i] !== until) out.push(scripts(atom())); if (until && tokens[i] === until) i++; return out; };
  const arg = () => { if (i >= tokens.length) return { t: 'group', items: [] }; return atom(); };
  const raw = node => node.t === 'group' ? node.items.map(raw).join('') : node.v ?? (node.base ? raw(node.base) : '');
  function atom() {
    const token = tokens[i++];
    if (token === undefined) return { t: 'group', items: [] };
    if (token === '{') return { t: 'group', items: seq('}') };
    if (token === '}') return { t: 'group', items: [] };
    if (token[0] !== '\\') return { t: 'ch', v: token };
    const name = token.slice(1);
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') { const n = arg(), d = arg(); return { t: 'frac', n, d }; }
    if (name === 'sqrt') { let n = null; if (tokens[i] === '[') { i++; const items = []; while (i < tokens.length && tokens[i] !== ']') items.push(scripts(atom())); i++; n = { t: 'group', items }; } return { t: 'sqrt', n, x: arg() }; }
    if (name === 'left' || name === 'right') { const d = tokens[i++]; if (d === undefined || d === '.') return { t: 'group', items: [] }; const sym = d[0] === '\\' ? SYMBOLS[d.slice(1)] ?? d.slice(1) : d; return { t: 'ch', v: sym }; }
    if (name === 'begin' || name === 'end') { arg(); return { t: 'group', items: [] }; }
    if (TEXTS.has(name)) return { t: 'text', v: raw(arg()) };
    if (ACCENTS[name]) return { t: 'acc', c: ACCENTS[name], x: arg() };
    if (GREEK[name]) return { t: 'sym', v: GREEK[name] };
    if (SYMBOLS[name] !== undefined) return { t: 'sym', v: SYMBOLS[name] };
    if (FUNCTIONS.has(name)) return { t: 'fn', v: name };
    return { t: 'text', v: name };
  }
  function scripts(base) {
    let sub = null, sup = null;
    while (tokens[i] === '^' || tokens[i] === '_') { const kind = tokens[i++]; const value = arg(); if (kind === '^') sup = value; else sub = value; }
    if (!sub && !sup) return base;
    return { t: 'scr', base, sub, sup };
  }
  return { t: 'group', items: seq(null) };
}

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isLetter = value => /^[A-Za-z]$/.test(value);

/** HTML (the style sheet is in `MATH_CSS`). */
export function treeHtml(node) {
  switch (node.t) {
    case 'group': return node.items.map(treeHtml).join('');
    case 'ch': return isLetter(node.v) ? `<i>${node.v}</i>` : esc(node.v);
    case 'sym': return esc(node.v);
    case 'fn': return `${node.v}<span class="mt"></span>`;
    case 'text': return `<span class="mx">${esc(node.v)}</span>`;
    case 'acc': return `${treeHtml(node.x)}${node.c}`;
    case 'frac': return `<span class="mf"><span class="mn">${treeHtml(node.n)}</span><span class="md">${treeHtml(node.d)}</span></span>`;
    case 'sqrt': return `<span class="mq">${node.n ? `<sup class="mi">${treeHtml(node.n)}</sup>` : ''}√<span class="mr">${treeHtml(node.x)}</span></span>`;
    case 'scr': return `${treeHtml(node.base)}${node.sub ? `<sub>${treeHtml(node.sub)}</sub>` : ''}${node.sup ? `<sup>${treeHtml(node.sup)}</sup>` : ''}`;
    default: return '';
  }
}
export const MATH_CSS = `.math { font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif; font-size: 1.05em; white-space: nowrap; } .math-display { display: block; text-align: center; margin: 8pt 0; }
.math i { font-style: italic; } .mx { font-style: normal; } .mt { display: inline-block; width: 0.17em; }
.mf { display: inline-block; vertical-align: middle; text-align: center; margin: 0 1pt; } .mn { display: block; padding: 0 2pt; border-bottom: 1px solid currentColor; } .md { display: block; padding: 0 2pt; }
.mq { white-space: nowrap; } .mr { border-top: 1px solid currentColor; padding: 0 1pt; } .mi { font-size: 0.65em; margin-right: -0.2em; }`;

/** Word equation (OMML), the inside of an <m:oMath>. */
export function treeOmml(node) {
  const run = (text, upright) => text === '' ? '' : `<m:r>${upright ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
  const e = child => treeOmml(child);
  switch (node.t) {
    case 'group': return node.items.map(e).join('');
    case 'ch': return run(node.v, !isLetter(node.v));
    case 'sym': return run(node.v, true);
    case 'fn': return run(node.v, true);
    case 'text': return run(node.v, true);
    case 'acc': return `<m:acc><m:accPr><m:chr m:val="${node.c}"/></m:accPr><m:e>${e(node.x)}</m:e></m:acc>`;
    case 'frac': return `<m:f><m:num>${e(node.n)}</m:num><m:den>${e(node.d)}</m:den></m:f>`;
    case 'sqrt': return node.n ? `<m:rad><m:deg>${e(node.n)}</m:deg><m:e>${e(node.x)}</m:e></m:rad>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e(node.x)}</m:e></m:rad>`;
    case 'scr': {
      const base = e(node.base) || run(' ', true);
      if (node.sub && node.sup) return `<m:sSubSup><m:e>${base}</m:e><m:sub>${e(node.sub)}</m:sub><m:sup>${e(node.sup)}</m:sup></m:sSubSup>`;
      if (node.sup) return `<m:sSup><m:e>${base}</m:e><m:sup>${e(node.sup)}</m:sup></m:sSup>`;
      return `<m:sSub><m:e>${base}</m:e><m:sub>${e(node.sub)}</m:sub></m:sSub>`;
    }
    default: return '';
  }
}

/** Plain text with Unicode (for .txt and anywhere that cannot show a formula). */
export function treeText(node) {
  const wrap = (value, simple) => simple ? value : `(${value})`;
  const small = (node, table, mark) => { const text = treeText(node); return [...text].every(ch => table[ch]) ? [...text].map(ch => table[ch]).join('') : `${mark}${wrap(text, text.length < 2)}`; };
  switch (node.t) {
    case 'group': return node.items.map(treeText).join('');
    case 'ch': case 'sym': case 'fn': case 'text': return node.v;
    case 'acc': return `${treeText(node.x)}${node.c}`;
    case 'frac': { const n = treeText(node.n), d = treeText(node.d); return `${wrap(n, /^[\w.]+$/.test(n))}/${wrap(d, /^[\w.]+$/.test(d))}`; }
    case 'sqrt': { const x = treeText(node.x); return `${node.n ? small(node.n, SUPER, '^') : ''}√${wrap(x, /^[\w.]+$/.test(x))}`; }
    case 'scr': return `${treeText(node.base)}${node.sub ? small(node.sub, SUB, '_') : ''}${node.sup ? small(node.sup, SUPER, '^') : ''}`;
    default: return '';
  }
}

export const texHtml = (src, display = false) => `<span class="${display ? 'math math-display' : 'math'}">${treeHtml(parseTex(src))}</span>`;
export const texOmml = (src, display = false) => display ? `<m:oMathPara><m:oMath>${treeOmml(parseTex(src))}</m:oMath></m:oMathPara>` : `<m:oMath>${treeOmml(parseTex(src))}</m:oMath>`;
export const texText = src => treeText(parseTex(src));

// $$ … $$ and \[ … \] are display formulas; $ … $ and \( … \) are inline. "$5 and $10" is money, not a formula.
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?!\d)/g;
/** Text → pieces: { text } or { math, display }. */
export function splitMath(text) {
  const out = []; let last = 0;
  for (const match of String(text).matchAll(MATH)) {
    const tex = match[1] ?? match[2] ?? match[3] ?? match[4]; const display = match[1] !== undefined || match[2] !== undefined;
    if (!display && /^[\d.,\s]+$/.test(tex)) continue;
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push({ math: tex.trim(), display }); last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
export const hasMath = text => splitMath(text).some(piece => piece.math);
