#!/usr/bin/env node
// Records the Escritório scene frame by frame: serves the repo, opens it in headless Chrome (DevTools protocol, no
// extra packages), calls window.renderAt(t) for each frame, takes a screenshot and pipes it to ffmpeg.
//
//   node record.mjs                       → escritorio.mp4 (1920×1080, 60 fps, 30 s)
//   node record.mjs --square              → escritorio-1x1.mp4 (1080×1080)
//   node record.mjs --fps 30 --seconds 10 → shorter/lighter test
//   node record.mjs --still 9             → poster.png (one frame at t = 9 s)
//   --gl swiftshader                      → software WebGL (slow) when the GPU path does not work
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../../..');
const args = process.argv.slice(2), opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const square = args.includes('--square'), fps = Number(opt('fps') || 60), seconds = Number(opt('seconds') || 30), still = opt('still');
const gl = opt('gl') || 'gpu', quality = opt('q') || 'high';
const width = square ? 1080 : 1920, height = 1080;
const out = resolve(here, opt('out') || (still !== undefined ? 'poster.png' : square ? 'escritorio-1x1.mp4' : 'escritorio.mp4'));

// Static server for the repo root (the scene imports /lib/mimo.mjs by absolute path).
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root) || !existsSync(path)) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); } catch { res.writeHead(500).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/docs/design/escritorio-3d/v2/index.html?record=1&q=${quality}${square ? '&square=1' : ''}`;

const profile = await mkdtemp(join(tmpdir(), 'escritorio-chrome-'));
const glFlags = gl === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const chrome = spawn('google-chrome-stable', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio', ...glFlags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = async () => { chrome.kill('SIGKILL'); server.close(); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

// DevTools endpoint: Chrome prints it on stderr.
const wsUrl = await new Promise((ok, fail) => { let text = ''; const timer = setTimeout(() => fail(new Error('O Chrome não abriu o DevTools.')), 20000); chrome.stderr.on('data', d => { text += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(text); if (m) { clearTimeout(timer); ok(m[1]); } }); });
const browser = new WebSocket(wsUrl); await new Promise(r => browser.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map();
browser.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const [ok, fail] = waiting.get(m.id); waiting.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const n = ++id; waiting.set(n, [ok, fail]); browser.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable'); await page('Runtime.enable');
await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await page('Page.navigate', { url });
const evaluate = async expression => { const r = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
for (let i = 0; i < 300; i++) { if (await evaluate('window.ready === true').catch(() => false)) break; await new Promise(r => setTimeout(r, 200)); if (i === 299) throw new Error('A cena não ficou pronta.'); }
console.log('WebGL:', await evaluate(`(()=>{const c=document.querySelector('canvas');const g=c.getContext('webgl2');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'})()`));

const shot = async t => { await evaluate(`renderAt(${t})`); const { data } = await page('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }); return Buffer.from(data, 'base64'); };
try {
  if (still !== undefined) { await writeFile(out, await shot(Number(still))); console.log('Quadro salvo em', out); }
  else {
    const frames = Math.round(seconds * fps), began = Date.now();
    const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((ok, fail) => ffmpeg.on('close', code => code === 0 ? ok() : fail(new Error('ffmpeg saiu com ' + code))));
    for (let f = 0; f < frames; f++) {
      const png = await shot(f / fps);
      if (!ffmpeg.stdin.write(png)) await new Promise(r => ffmpeg.stdin.once('drain', r));
      if (f % fps === 0) { const done = (f + 1) / frames, spent = (Date.now() - began) / 1000; console.log(`${Math.round(done * 100)}% · quadro ${f + 1}/${frames} · faltam ~${Math.round(spent / done - spent)} s`); }
    }
    ffmpeg.stdin.end(); await closed; console.log('Vídeo salvo em', out);
  }
} finally { await cleanup(); }
