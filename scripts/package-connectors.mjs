import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const folder = join(root, 'supervisor/connectors');
// The lockfile pins every dependency and its integrity hash; nothing floats between builds.
if (!existsSync(join(folder, 'node_modules/imapflow'))) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: folder, stdio: 'inherit' });
const esbuild = await import(pathToFileURL(join(folder, 'node_modules/esbuild/lib/main.js')));
const result = await esbuild.build({ entryPoints: [join(folder, 'entry.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  minify: true, write: false, legalComments: 'eof', logLevel: 'warning',
  // CommonJS dependencies inside an ESM bundle still call require() for Node built-ins.
  banner: { js: "import { createRequire as __mybotsRequire } from 'node:module'; const require = __mybotsRequire(import.meta.url);" } });
const bundle = gzipSync(Buffer.from(result.outputFiles[0].contents), { level: 9 });
const hash = createHash('sha256').update(bundle).digest('hex');
writeFileSync(join(root, 'mobile/modules/termux-bridge/android/src/main/assets/mybots-connectors.bin'), bundle);
// The core package carries this hash, so the supervisor only installs this exact bundle.
writeFileSync(join(root, 'supervisor/connectors.sha256'), hash + '\n');
const versions = JSON.parse(readFileSync(join(folder, 'package-lock.json'), 'utf8')).packages['node_modules/imapflow'].version;
console.log(`Conectores empacotados: ${bundle.length} bytes (imapflow ${versions}).`);
