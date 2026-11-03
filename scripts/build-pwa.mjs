#!/usr/bin/env node
// Builds the iPhone's web app: the app's own interface exported for the browser (no computer-injected connection, so it
// pairs with the computer and talks to it through the relay), plus what iOS needs to install it on the Home Screen.
// Usage: node scripts/build-pwa.mjs [outputDirectory]   (default: dist/pwa)
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, 'dist', 'pwa'));
rmSync(out, { recursive: true, force: true });
execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', out], { cwd: join(root, 'mobile'), stdio: 'inherit' });
for (const file of ['manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png']) cpSync(join(root, 'mobile', 'pwa', file), join(out, file));

const head = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="MyBots">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon-192.png">`;
const file = join(out, 'index.html');
let html = readFileSync(file, 'utf8');
html = html.replace(/<meta name="viewport"[^>]*>/i, '').replace(/<title>[^<]*<\/title>/i, '<title>MyBots</title>').replace('</head>', `${head}\n</head>`);
if (!/<title>/i.test(html)) html = html.replace('</head>', '<title>MyBots</title>\n</head>');
writeFileSync(file, html);
if (!existsSync(join(out, 'manifest.webmanifest'))) throw new Error('Faltou o manifesto.');
console.log(`Web app do iPhone em ${out}`);
