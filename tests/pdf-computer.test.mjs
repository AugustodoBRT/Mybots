import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisor } from '../supervisor/index.mjs';
import { pdfRead, pdfCreate } from '../pc/pdf.mjs';

const fixture = readFileSync(new URL('./fixtures/atividade.pdf', import.meta.url));
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'T', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };

/** A small valid PDF, one page per text (an empty text is a page with no text at all, like a scan). */
function makePdf(texts) {
  const objects = []; const kids = texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${texts.length} >>`; objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  texts.forEach((text, i) => {
    const stream = text ? `BT /F1 18 Tf 72 700 Td (${text}) Tj ET` : '';
    objects[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n'; const offsets = [];
  for (let i = 1; i < objects.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const base64 = bytes => bytes.toString('base64');

test('the computer reads a real PDF by itself: the text of its pages, accents included', async () => {
  const result = await pdfRead({ data: base64(fixture) });
  assert.equal(result.pages, 1); assert.deepEqual(result.images, []); assert.equal(result.text[0].page, 1);
  assert.match(result.text[0].text, /Lista de Exercícios 3 — Cálculo I/); assert.match(result.text[0].text, /derivada/); assert.match(result.text[0].text, /integral/);
});

test('pages are read in ranges, and the range is kept inside the document', async () => {
  const pdf = base64(makePdf(['Primeira pagina', 'Segunda pagina', 'Terceira pagina', 'Quarta pagina']));
  const all = await pdfRead({ data: pdf }); assert.equal(all.pages, 4); assert.deepEqual(all.text.map(item => item.page), [1, 2, 3, 4]); assert.match(all.text[2].text, /Terceira/);
  const middle = await pdfRead({ data: pdf, firstPage: 2, maxPages: 2 }); assert.deepEqual(middle.text.map(item => item.page), [2, 3]); assert.match(middle.text[0].text, /Segunda/);
  const past = await pdfRead({ data: pdf, firstPage: 99, maxPages: 5 }); assert.deepEqual(past.text.map(item => item.page), [4]);   // never beyond the last page
  const odd = await pdfRead({ data: pdf, firstPage: 'x', maxPages: -3 }); assert.equal(odd.text[0].page, 1);
});

test('a PDF that is only pictures says so, a damaged or fake file says so, and nothing is returned as blank text', async () => {
  await assert.rejects(pdfRead({ data: base64(makePdf(['', ''])) }), /não tem texto selecionável.*escaneado/);
  // one page with text among blank ones is fine: the blank ones stay empty
  const mixed = await pdfRead({ data: base64(makePdf(['', 'So esta tem texto'])) }); assert.equal(mixed.text[0].text, ''); assert.match(mixed.text[1].text, /So esta/);
  await assert.rejects(pdfRead({ data: base64(Buffer.from('isto não é um pdf')) }), /não parece ser um PDF/);
  await assert.rejects(pdfRead({ data: '' }), /não parece ser um PDF/); await assert.rejects(pdfRead({}), /não parece ser um PDF/);
  const broken = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog'), Buffer.alloc(50, 7)]);
  await assert.rejects(pdfRead({ data: base64(broken) }), /Não consegui abrir este PDF/);
});

test('creating a PDF is not available on the computer yet, and the message says what to do', async () => {
  await assert.rejects(pdfCreate(), /Criar PDF ainda não está disponível no computador.*Word, planilha ou HTML/);
});

test('the bot reads a PDF attachment on the computer\'s own MyBots (no phone app), while the phone\'s supervisor still needs its app', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-pdf-')); const phoneDirectory = await mkdtemp(join(tmpdir(), 'mybots-pdf-phone-'));
  const computer = await createSupervisor({ directory, port: 0, codex, kind: 'computer' }); const phone = await createSupervisor({ directory: phoneDirectory, port: 0, codex });
  t.after(async () => { await computer.close(); await phone.close(); await rm(directory, { recursive: true, force: true }); await rm(phoneDirectory, { recursive: true, force: true }); });
  for (const app of [computer, phone]) { const bot = app.db.create({ name: 'Leitor' }, selection); app.bot = bot; app.file = app.tools.attachments.store(bot.id, { name: 'atividade.pdf', mime: 'application/pdf', bytes: fixture }); }
  const read = await computer.tools.attachments.read(computer.bot.id, computer.file.id);
  const text = read.mcpContent.find(item => item.type === 'text').text;
  assert.match(text, /1 páginas|1 página/); assert.match(text, /Cálculo I/); assert.match(text, /Página 1/);
  await assert.rejects(phone.tools.attachments.read(phone.bot.id, phone.file.id), /usa o app MyBots, que não está ativo/);
  await assert.rejects(computer.tools.pdfCreate('<p>oi</p>'), /Criar PDF ainda não está disponível/); assert.equal(phone.tools.pdfCreate, undefined);
});
