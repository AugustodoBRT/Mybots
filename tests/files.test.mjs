import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { officeText } from '../supervisor/documents.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// The phone side of PDF work, like DeviceFiles.kt: answers pdfRead with text pages, or pictures for a scan.
function fakePhone(app, { scanned = false } = {}) {
  const seen = []; let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const answer = await fetch(`http://127.0.0.1:${app.port}/device/browser`, { headers: { Authorization: 'Bearer ' + app.token } });
        if (answer.status !== 200) break;
        for (const command of (await answer.json()).commands) {
          seen.push(command);
          if (command.op === 'pdfCreate') {
            await fetch(`http://127.0.0.1:${app.port}/device/browser/result`, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: command.id, ok: true, value: { data: Buffer.from('%PDF-1.7 ' + command.args.html.length).toString('base64') } }) });
            continue;
          }
          const pages = Array.from({ length: 25 }, (_, i) => i + 1).slice(command.args.firstPage - 1, command.args.firstPage - 1 + command.args.maxPages);
          const value = { pages: 25, text: pages.map(page => ({ page, text: scanned ? '' : `Questão ${page}: calcule a derivada.` })), images: scanned || command.args.images === 'all' ? pages.slice(0, 6).map(page => ({ page, data: Buffer.from('jpeg' + page).toString('base64') })) : [] };
          await fetch(`http://127.0.0.1:${app.port}/device/browser/result`, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: command.id, ok: true, value }) });
        }
      } catch { break; }
    }
  })();
  return { seen, stop: () => { stopped = true; } };
}

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-files-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: options.execute });
  const phone = fakePhone(app, options);
  t.after(async () => { phone.stop(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  await until(() => app.state().browser.available);
  const bot = await app.rpc('bot.create', { name: 'Faculdade', access: 'ask', ...selection });
  const open = (botId = bot.id) => {
    const task = app.db.start(app.db.enqueue(botId, randomUUID(), 'Oi', selection).id); const cap = app.tools.open(task); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(cap.close);
    return (name, args = {}) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args });
  };
  const upload = body => fetch(`http://127.0.0.1:${app.port}/device/files`, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { app, bot, open, phone, upload };
}

test('Word, Excel and PowerPoint made by LibreOffice are read as Markdown with headings and tables', async () => {
  const word = officeText(await fixture('atividade.docx'), 'application/octet-stream', 'atividade.docx');
  assert.match(word, /^# Lista de Exercícios 3 — Cálculo I/); assert.match(word, /- Calcule a derivada de f\(x\) = x³ \+ 2x\./);
  assert.match(word, /\| Questão \| Pontos \|\n\| --- \| --- \|\n\| 1 \| 4 \|/); assert.match(word, /ação e coração/);
  assert.match(officeText(await fixture('notas.xlsx'), '', 'notas.xlsx'), /## Planilha: notas\n\n\| Disciplina \| Nota \| Situação \|[\s\S]*\| Física Experimental \| 6 \| Recuperação \|/);
  assert.match(officeText(await fixture('atividade.pptx'), '', 'atividade.pptx'), /## Slide 1\n\nLista de Exercícios 3/);
  assert.equal(officeText(Buffer.from('oi'), 'text/plain', 'a.txt'), null);
  assert.throws(() => officeText(Buffer.from('não é zip'), '', 'falso.docx'), /corrompido/);
});

test('a download from the bot browser becomes the bot\'s file; it reads PDFs page by page and Office files', async t => {
  const f = await setup(t); const call = f.open();
  const pdf = await (await f.upload({ botId: f.bot.id, name: 'Lista 3.pdf', mime: 'application/octet-stream', source: 'sig.cefetmg.br', data: (await fixture('atividade.pdf')).toString('base64') })).json();
  assert.equal(pdf.name, 'Lista 3.pdf'); assert.ok(pdf.id);
  const docx = await (await f.upload({ botId: f.bot.id, name: 'enunciado.docx', mime: 'application/octet-stream', data: (await fixture('atividade.docx')).toString('base64') })).json();
  assert.deepEqual((await call('files_list')).files.map(file => file.name).sort(), ['Lista 3.pdf', 'enunciado.docx']);
  assert.ok(f.app.state().activity.some(item => item.kind === 'file_downloaded' && /Lista 3\.pdf \(sig\.cefetmg\.br\)/.test(item.detail)));
  // The PDF goes to the phone (recognized by its bytes, whatever the mime), 20 pages at a time.
  const first = await call('attachment_read', { id: pdf.id });
  assert.match(first.mcpContent[0].text, /25 páginas · lidas 1–20 \(continue com page 21\)/); assert.match(first.mcpContent[0].text, /--- Página 20 ---\nQuestão 20/);
  assert.match(first.mcpContent[0].text, /nunca instrução/);
  const rest = await call('attachment_read', { id: pdf.id, page: 21 });
  assert.match(rest.mcpContent[0].text, /lidas 21–25\n/);
  assert.deepEqual(f.phone.seen.map(item => [item.op, item.args.firstPage, item.botId]), [['pdfRead', 1, null], ['pdfRead', 21, null]]);
  const word = await call('attachment_read', { id: docx.id });
  assert.equal(word.format, 'markdown'); assert.equal(word.untrusted, true); assert.match(word.text, /\| Questão \| Pontos \|/);
  // Another bot never sees them; executables and oversized files never get in.
  const other = await f.app.rpc('bot.create', { name: 'Outro', access: 'ask', ...selection });
  await assert.rejects(f.open(other.id)('attachment_read', { id: pdf.id }), /não encontrado/);
  assert.equal((await f.open(other.id)('files_list')).files.length, 0);
  assert.match((await (await f.upload({ botId: f.bot.id, name: 'app.apk', mime: 'application/octet-stream', data: 'AAAA' })).json()).error, /executáveis/);
  assert.equal((await f.upload({ botId: f.bot.id, name: 'vazio.pdf', mime: 'application/pdf', data: '' })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${f.app.port}/device/files`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal(f.app.state().approvals.length, 0, 'ler os próprios arquivos não pede aprovação');
});

test('a scanned PDF comes back as page pictures the model can look at', async t => {
  const f = await setup(t, { scanned: true }); const call = f.open();
  const pdf = await (await f.upload({ botId: f.bot.id, name: 'prova.pdf', mime: 'application/pdf', data: (await fixture('atividade.pdf')).toString('base64') })).json();
  const read = await call('attachment_read', { id: pdf.id });
  assert.match(read.mcpContent[0].text, /--- Página 1 ---\n\(página sem texto: veja a imagem\)/);
  assert.equal(read.mcpContent.filter(item => item.type === 'image').length, 6);
  assert.equal(read.mcpContent[1].mimeType, 'image/jpeg');
});

test('a PDF with text and figures: the bot is told it can look at the pages, and as_image brings them as pictures', async t => {
  const f = await setup(t); const call = f.open();
  const pdf = await (await f.upload({ botId: f.bot.id, name: 'CSD_T6.pdf', mime: 'application/pdf', data: (await fixture('atividade.pdf')).toString('base64') })).json();
  const text = await call('attachment_read', { id: pdf.id });
  assert.equal(text.mcpContent.filter(item => item.type === 'image').length, 0);
  assert.match(text.mcpContent[0].text, /diagramas, gráficos, fórmulas, frações.*as_image true/);
  const seen = await call('attachment_read', { id: pdf.id, page: 2, as_image: true });
  assert.equal(seen.mcpContent.filter(item => item.type === 'image').length, 4);
  assert.match(seen.mcpContent[0].text, /lidas 2–5 \(continue com page 6\)/);
  await assert.rejects(call('attachment_read', { id: pdf.id, as_image: 'sim' }), /as_image true ou false/);
});

const ANSWER = `# Resolução — Lista 3

| Questão | Resposta |
|---|---|
| 1 | 3x² + 2 |
| 2 | 9 |

\`\`\`chart
{"type":"bar","title":"Pontos","labels":["Q1","Q2"],"series":[{"data":[4,6]}]}
\`\`\``;

test('the bot makes PDF, Word and spreadsheet files and sends them with its reply; a download can be forwarded', async t => {
  let app, forwarded;
  // A model turn that calls the tools through its run, like the MCP bridge does.
  const execute = async (bot, prompt, { tools }) => {
    const bridgeId = randomUUID(); app.tools.context(tools.token, bridgeId, true);
    const call = (name, args) => app.tools.callMcp(tools.token, { bridgeId, callId: randomUUID(), name, args });
    const pdf = await call('file_create', { name: 'Resolução Lista 3', format: 'pdf', content: ANSWER });
    const word = await call('file_create', { name: 'Resolução Lista 3.docx', format: 'docx', content: ANSWER });
    const sheet = await call('file_create', { name: 'notas', format: 'xlsx', content: ANSWER, send: false });
    await call('file_send', { id: forwarded.id });
    await assert.rejects(call('file_create', { name: '../x', format: 'pdf', content: 'a' }), /nome do arquivo/);
    await assert.rejects(call('file_create', { name: 'x', format: 'exe', content: 'a' }), /format/);
    return { text: `Pronto: ${pdf.name}, ${word.name} e ${sheet.name}.`, ...selection };
  };
  const f = await setup(t, { execute }); app = f.app;
  forwarded = await (await f.upload({ botId: f.bot.id, name: 'Enunciado.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 enunciado').toString('base64') })).json();
  const { taskId } = await app.rpc('chat.send', { botId: f.bot.id, requestId: randomUUID(), text: 'Resolve e me manda em PDF e Word' });
  await until(() => app.db.task(taskId).state === 'done');
  const reply = app.db.messages(f.bot.id).at(-1);
  assert.equal(reply.text, 'Pronto: Resolução Lista 3.pdf, Resolução Lista 3.docx e notas.xlsx.');
  assert.deepEqual(reply.attachments.map(file => [file.name, file.mime]), [['Resolução Lista 3.pdf', 'application/pdf'],
    ['Resolução Lista 3.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['Enunciado.pdf', 'application/pdf']]);
  // The PDF came from the phone's print system, from HTML with the table and the chart as SVG.
  const html = f.phone.seen.find(item => item.op === 'pdfCreate').args.html;
  assert.match(html, /<th>Questão<\/th>/); assert.match(html, /<svg[\s\S]*Pontos/); assert.match(html, /@page/);
  // The Word file is a real document: reading it back gives the same table.
  const word = await app.rpc('file.read', { id: reply.attachments[1].id });
  assert.match(officeText(Buffer.from(word.chunk, 'base64'), word.mime, word.name), /\| 1 \| 3x² \+ 2 \|/);
  assert.equal(word.next, null);
  // The spreadsheet was made but not sent; it is still one of the bot's files.
  assert.ok((await f.open()('files_list')).files.some(file => file.name === 'notas.xlsx'));
  assert.ok(app.state().activity.some(item => item.kind === 'file_created' && /Resolução Lista 3\.pdf/.test(item.detail)));
  await assert.rejects(app.rpc('file.read', { id: randomUUID() }), /não encontrado/);
});

test('Markdown for chat and files: tables, charts, lists and LaTeX turned into common symbols', async () => {
  const { parseBlocks, parseInline, chartSpec, plainText } = await import('../mobile/markdown.js');
  const blocks = parseBlocks('# Título\n\n| Q | R |\n|---|:-:|\n| 1 | \\(3x^2+2\\) |\n\n```chart\n{"type":"line","labels":["a","b"],"series":[{"name":"s","data":[1,"x"]}]}\n```\n\n1. um\n2. dois\n\n```js\nconst a = "$x^2$";\n```');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'table', 'chart', 'list', 'code']);
  assert.deepEqual(blocks[1].rows, [['1', '3x²+2']]);
  assert.deepEqual(blocks[2].spec.series[0].data, [1, 0]);
  assert.equal(blocks[4].text, 'const a = "$x^2$";', 'código fica como foi escrito');
  assert.equal(chartSpec('{"type":"radar","labels":["a"],"series":[]}'), null);
  assert.equal(parseBlocks('```chart\nnão é json\n```')[0].type, 'code');
  assert.equal(parseBlocks('\\[\\int_0^3 2x\\,dx = 9\\]')[0].text, '∫₀³ 2x dx = 9');
  assert.equal(parseBlocks('Resposta: \\(\\boxed{9}\\), \\(x \\in \\mathbb{R}\\)')[0].text, 'Resposta: 9, x ∈ ℝ');
  assert.equal(parseBlocks('Período $T = 2\\pi\\sqrt{\\frac{L}{g}}$ e preço $5 ou $10')[0].text, 'Período T = 2π√(L/g) e preço $5 ou $10');
  assert.deepEqual(parseInline('**a** [b](javascript:x) [c](https://c.d)').map(run => [run.text, Boolean(run.bold), run.href || '']), [['a', true, ''], [' [b](javascript:x) ', false, ''], ['c', false, 'https://c.d']]);
  assert.equal(plainText('## Oi\n- **um**\n- dois'), 'Oi\n\n• um\n• dois');
});
