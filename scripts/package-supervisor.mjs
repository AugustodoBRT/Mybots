import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'mybots-package-'));
try {
  for (const folder of ['supervisor', 'lib', 'mobile', 'tests']) mkdirSync(join(temporary, folder), { recursive: true });
  for (const file of ['index.mjs','database.mjs','queue.mjs','pair.mjs','process.mjs','tools.mjs','tool-policy.mjs','claude-wrapper.sh','vault.mjs','connector-bundle.mjs','email.mjs','device.mjs','routines.mjs','rooms.mjs','attachments.mjs','apps.mjs','browser.mjs','items.mjs','documents.mjs','creator.mjs','connectors.sha256','package.json','package-lock.json']) cpSync(join(root,'supervisor',file), join(temporary,'supervisor',file));
  cpSync(join(root, 'supervisor/mcp'), join(temporary, 'supervisor/mcp'), { recursive: true });
  // ws's README is documentation only; leaving it out keeps the package under the bridge limit.
  cpSync(join(root, 'supervisor/node_modules/ws'), join(temporary, 'supervisor/node_modules/ws'), { recursive: true, filter: source => !source.endsWith('README.md') });
  for (const file of ['codex.mjs','codex-runner.cjs','claude.mjs','claude-runner.cjs','models.mjs']) cpSync(join(root,'lib',file), join(temporary,'lib',file));
  for (const file of ['local.js','supervisor-client.js','routine-text.js','markdown.js']) cpSync(join(root,'mobile',file), join(temporary,'mobile',file));
  for (const file of ['supervisor.test.mjs','tools.test.mjs','claude.test.mjs','routines.test.mjs','apps.test.mjs','access.test.mjs']) cpSync(join(root,'tests',file), join(temporary,'tests',file));
  writeFileSync(join(temporary,'package.json'), JSON.stringify({ type: 'module' }));
  // Explicit file lists exclude app data, credentials, signing keys and development caches.
  const asset = join(root, 'mobile/modules/termux-bridge/android/src/main/assets/mybots-supervisor.tgz');
  execFileSync('tar', ['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',asset,'-C',temporary,'.']);
  const bytes = readFileSync(asset);
  // Above 60 KB the app stages the package in parts (pairPart); keep it bounded for slow first installs.
  if (bytes.length > 600000) throw new Error(`O pacote do supervisor está grande demais (${bytes.length} bytes).`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(asset.replace('.tgz','.sha256'), hash);
  console.log(`Supervisor empacotado: ${bytes.length} bytes.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
