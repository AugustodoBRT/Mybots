#!/usr/bin/env node
// Bundles the 3D bot (mobile/office/avatar3d-entry.js with three.js and the bot code) into the one HTML file the Android app loads in
// its hidden WebView. The result is committed (mobile/modules/termux-bridge/android/src/main/assets/avatar3d.html), so building the APK
// needs no network; run this again only when the bot's 3D code changes. Usage: node scripts/build-avatar3d.mjs [path to esbuild]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'mobile/modules/termux-bridge/android/src/main/assets/avatar3d.html');
const dir = mkdtempSync(join(tmpdir(), 'avatar3d-'));
try {
  const bin = process.argv[2] || 'esbuild';
  execFileSync(bin, [join(root, 'mobile/office/avatar3d-entry.js'), '--bundle', '--format=iife', '--minify', '--target=chrome90', `--outfile=${join(dir, 'a.js')}`], { stdio: 'inherit' });
  const js = readFileSync(join(dir, 'a.js'), 'utf8').replaceAll('</script', '<\\/script');
  writeFileSync(out, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><script>${js}</script>`);
  console.log(`avatar3d.html: ${(js.length / 1024).toFixed(0)} KB`);
} finally { rmSync(dir, { recursive: true, force: true }); }
