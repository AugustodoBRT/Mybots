import test from 'node:test';
import assert from 'node:assert/strict';
import { create, toHtml, toDocx } from '../supervisor/creator.mjs';
import { unzip } from '../supervisor/documents.mjs';
import { splitMath, texText, texHtml } from '../supervisor/math.mjs';

const docxText = bytes => unzip(bytes).text('word/document.xml');

test('formulas written in LaTeX show as formulas in HTML, PDF text and plain text, and money is not taken for one', () => {
  const html = toHtml('Energia: $E = \\frac{1}{2}mv^2$ e $$\\int_0^1 x\\,dx$$.\n\nCusta $5 ou $10.', 't');
  assert.match(html, /class="mf"/); assert.match(html, /<sup>2<\/sup>/); assert.match(html, /math-display/); assert.doesNotMatch(html, /\\frac/);
  assert.match(html, /Custa \$5 ou \$10/);
  assert.equal(texText('\\frac{a+b}{2} + x^2 + \\sqrt{x_1}'), '(a+b)/2+x²+√(x₁)');
  assert.deepEqual(splitMath('$5 e $10').map(piece => !!piece.math), [false]);
  assert.match(texHtml('\\alpha + \\beta'), /α/);
});

test('Word gets native equations and a whole HTML page given as content is kept for PDF and HTML, not shown as text', async () => {
  const made = await create({ name: 'prova', format: 'docx', content: 'A razão é $\\frac{x}{y}$ e $z^2$.' }, { pdf: async () => Buffer.alloc(0) });
  const xml = docxText(made.bytes);
  assert.match(xml, /<m:f>/); assert.match(xml, /<m:sSup>/); assert.match(xml, /xmlns:m=/);
  const page = '<!doctype html><html><body><h1>Oi</h1><script>alert(1)</script><p onclick="x()">texto</p></body></html>';
  let sent = ''; const pdf = await create({ name: 'a', format: 'pdf', content: page }, { pdf: async html => { sent = html; return Buffer.from('%PDF'); } });
  assert.equal(pdf.mime, 'application/pdf'); assert.match(sent, /<h1>Oi<\/h1>/); assert.doesNotMatch(sent, /<script|onclick/);
  const html = await create({ name: 'a', format: 'html', content: page }, { pdf: async () => Buffer.alloc(0) });
  assert.match(html.bytes.toString(), /<h1>Oi<\/h1>/); assert.doesNotMatch(html.bytes.toString(), /&lt;h1/);
  const word = await create({ name: 'a', format: 'docx', content: page }, { pdf: async () => Buffer.alloc(0) });
  assert.doesNotMatch(docxText(word.bytes), /&lt;h1|alert/);
});

test('a formula whose backslashes a model lost to JSON escapes (form feed, backspace, tab) is put back, and a chart may name its numbers values', async () => {
  const lost = 'Raiz $\x0crac{1}{2}$ e $\x08eta + 2\times 3$.';
  const html = toHtml(lost, 't');
  assert.match(html, /class="mf"/); assert.match(html, /β/); assert.match(html, /×/);
  assert.match(toHtml('```chart\n{"type":"bar","labels":["A","B"],"series":[{"name":"s","values":[3,5]}]}\n```', 't'), /<rect[^>]*height="[1-9]/);
});
