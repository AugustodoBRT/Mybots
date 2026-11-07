// Opens the memory map with test notes: a throwaway supervisor, N fake notes and the exported web app.
//   node scripts/memory-graph-demo.mjs [--notes 300] [--links 600] [--ui <expo web export>] [--measure]
// Without --ui it exports the web app first (npx expo export, a few minutes). With --measure it drives headless Chrome,
// prints the timings and exits; otherwise it prints the address and waits for Ctrl+C. Everything lives in a temp folder.
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';
import { saveNote } from '../supervisor/notes.mjs';
import { fakeNotes } from '../tests/helpers/fake-notes.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const notes = Number(arg('notes', 300)), count = Number(arg('links', notes * 2)), measure = process.argv.includes('--measure');
const directory = await mkdtemp(join(tmpdir(), 'mybots-graph-'));
let ui = arg('ui', null);
if (!ui) {
  ui = join(directory, 'ui');
  console.log('Exportando o app web…');
  await promisify(execFile)('npx', ['expo', 'export', '--platform', 'web', '--output-dir', ui], { cwd: new URL('../mobile', import.meta.url).pathname, timeout: 600000, maxBuffer: 1 << 26 });
}
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }], limits: async () => ({ windows: [] }) };
const app = await createSupervisor({ directory: join(directory, 'sup'), port: 0, codex, execute: async () => ({ text: 'Pronto.', ...selection }) });
const bots = [];
for (const name of ['Atlas', 'Clara', 'Nico']) bots.push(await app.rpc('bot.create', { name, instructions: `Bot ${name}.`, face: { seed: name }, ...selection }));
app.db.transaction(() => { for (const row of fakeNotes({ notes, links: count, seed: 7, bots: bots.map(b => b.id), now: Date.now() })) saveNote(app.db, row); });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' };
const web = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  let file = normalize(join(ui, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ui) || !existsSync(file) || !statSync(file).isFile()) file = join(ui, 'index.html');
  let body = await readFile(file);
  if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script>window.MYBOTS_DESKTOP=${JSON.stringify({ port: app.port, token: app.token })}</script>`));
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
}).listen(0, '127.0.0.1');
await new Promise(resolve => web.on('listening', resolve));
const url = `http://127.0.0.1:${web.address().port}/`;
const close = async () => { web.close(); await app.close(); await rm(directory, { recursive: true, force: true }); };

if (!measure) {
  console.log(`${notes} notas prontas. Abra ${url} , clique em Memória e depois em Grafo. Ctrl+C encerra e apaga tudo.`);
  process.on('SIGINT', () => close().then(() => process.exit(0)));
} else {
  const { chromium } = createRequire(new URL('../pc/package.json', import.meta.url))('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.MYBOTS_TEST_BROWSER || '/usr/bin/google-chrome-stable', headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.getByRole('button', { name: 'Memória', exact: true }).first().click();
    await page.getByRole('button', { name: 'Ver como grafo', exact: true }).click();
    await page.waitForFunction(() => globalThis.mybotsGraphStats?.layoutMs !== undefined, null, { timeout: 60000 });
    const stats = await page.evaluate(() => ({ ...globalThis.mybotsGraphStats }));
    const shot = arg('screenshot', null);
    if (shot) await page.screenshot({ path: shot });
    const box = await page.getByLabel(/^Grafo da memória com/).boundingBox();
    // Frames while dragging the background and zooming with the wheel, one input per animation frame.
    const fps = async action => page.evaluate(async kind => {
      const el = [...document.querySelectorAll('[aria-label^="Grafo da memória com"]')][0], rect = el.getBoundingClientRect();
      const times = []; let last = performance.now();
      const mouse = (type, i) => (type === 'mousedown' ? el : document).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, buttons: type === 'mouseup' ? 0 : 1,
        clientX: rect.left + rect.width / 2 + Math.sin(i / 10) * 150, clientY: rect.top + rect.height / 2 + Math.cos(i / 10) * 90 }));
      if (kind === 'pan') mouse('mousedown', 0);
      for (let i = 0; i < 120; i++) {
        if (kind === 'pan') mouse('mousemove', i + 1);
        if (kind === 'wheel') el.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 40 < 20 ? -20 : 20, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
        await new Promise(requestAnimationFrame);
        const now = performance.now(); times.push(now - last); last = now;
      }
      if (kind === 'pan') mouse('mouseup', 121);
      times.sort((a, b) => a - b);
      return { fps: Math.round(1000 / (times.reduce((a, b) => a + b) / times.length)), p95ms: Math.round(times[Math.floor(times.length * 0.95)]) };
    }, action);
    const wheel = await fps('wheel');
    const panStart = await page.evaluate(() => document.querySelector('[aria-label^="Grafo da memória com"] g')?.getAttribute('transform'));
    const pan = await fps('pan');
    pan.moved = panStart !== await page.evaluate(() => document.querySelector('[aria-label^="Grafo da memória com"] g')?.getAttribute('transform'));
    // Pan with real mouse events (the responder system), timed from outside.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    const began = Date.now();
    for (let i = 0; i < 120; i++) await page.mouse.move(box.x + box.width / 2 + Math.sin(i / 10) * 200, box.y + box.height / 2 + Math.cos(i / 10) * 120);
    await page.mouse.up();
    const panMs = (Date.now() - began) / 120;
    const transform = await page.evaluate(() => document.querySelector('[aria-label^="Grafo da memória com"] g')?.getAttribute('transform'));
    const circles = await page.evaluate(() => document.querySelectorAll('[aria-label^="Grafo da memória com"] circle').length);
    console.log(JSON.stringify({ notes, stats, wheel, pan, panMsPerMove: Math.round(panMs * 10) / 10, circles, transform, errors }, null, 1));
  } finally { await browser.close(); await close(); }
}
