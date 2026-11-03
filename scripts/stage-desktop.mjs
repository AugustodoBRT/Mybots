#!/usr/bin/env node
// Assembles what the installer carries in dist/stage, keeping the repository's own layout (the code reaches its neighbours with
// ../mobile, ../supervisor...): the window, the computer's node, the supervisor, lib, the interface already exported to pc/ui
// and the few files of the app the node shares. The AIs and Chrome are not included (the user installs and logs into them).
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); const out = join(root, 'dist', 'stage');
if (!existsSync(join(root, 'pc', 'ui', 'index.html'))) { console.error('Falta a interface em pc/ui: rode (cd mobile && npx expo export --platform web --output-dir ../pc/ui).'); process.exit(1); }
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const skip = path => /(^|[\\/])(tests?|\.git|native-mimo|__pycache__)([\\/]|$)|\.test\.mjs$|\.md$/.test(path);
const copy = (from, to = from) => cpSync(join(root, from), join(out, to), { recursive: true, filter: source => !skip(source.slice(root.length)) });
for (const item of ['pc', 'supervisor', 'lib', 'relay', 'desktop/electron', 'desktop/loader']) copy(item);
for (const file of ['local.js', 'routine-text.js', 'markdown.js', 'file-references.js', 'pc-channel.js']) copy(`mobile/${file}`);
copy('mobile/node_modules/@noble');
for (const file of ['card-field.js', 'card-fill.js']) copy(`mobile/modules/termux-bridge/android/src/main/assets/${file}`);
// the Electron window's own manifest at the root of the app (electron-builder reads name, version and main from here)
const version = JSON.parse(readFileSync(join(root, 'mobile', 'app.json'), 'utf8')).expo.version;
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'mybots', productName: 'MyBots', version, description: 'Seus bots pessoais: o computador executa, o celular é a tela.', author: 'MyBots', homepage: 'https://github.com/AugustodoBRT/Mybots', license: 'UNLICENSED', main: 'desktop/electron/main.js', type: 'commonjs', dependencies: { 'electron-updater': '6.8.11' } }, null, 2));
// "type": "module" belongs to the folders that need it (they carry their own package.json); the window's files are CommonJS.
mkdirSync(join(out, 'mobile'), { recursive: true });
for (const folder of ['pc', 'supervisor', 'mobile', 'relay']) if (!existsSync(join(out, folder, 'package.json'))) writeFileSync(join(out, folder, 'package.json'), '{"type":"module"}');
// the window's only own dependency (updates), installed at the app's root like any Electron app
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' });
console.log(`Montado em ${out} (versão ${version}).`);
