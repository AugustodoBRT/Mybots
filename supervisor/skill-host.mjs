// Runs one skill inside `node --permission` (files: only the skill's own folder; no child processes, workers or
// addons). Before the skill loads, raw sockets and process modules are refused at import, and fetch only reaches
// the sites its manifest declares. Input comes on stdin as JSON; the result goes to stdout as one JSON line.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const BLOCKED = new Set(['net', 'tls', 'dgram', 'http', 'https', 'http2', 'dns', 'child_process', 'cluster', 'worker_threads', 'inspector', 'vm', 'repl', 'sqlite', 'module', 'process', 'v8', 'wasi']);
registerHooks({
  resolve(specifier, context, next) {
    const name = specifier.replace(/^node:/, '').split('/')[0];
    if (BLOCKED.has(name)) throw new Error(`A habilidade não pode usar ${specifier}. Use fetch para a internet.`);
    return next(specifier, context);
  }
});

const [folder, sites] = [process.argv[2], JSON.parse(process.argv[3] || '[]')];
const allowed = host => sites.some(site => host === site || host.endsWith('.' + site));
const realFetch = globalThis.fetch;
const guardedFetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['http:', 'https:'].includes(url.protocol) || !allowed(url.hostname)) throw new Error(`A habilidade só pode acessar ${sites.join(', ') || 'nenhum site'}; ${url.hostname} não está no manifesto.`);
  return realFetch(input, { ...init, redirect: 'manual' }).then(async response => {
    // Redirects are followed only inside the declared sites.
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) return guardedFetch(new URL(response.headers.get('location'), url), init);
    return response;
  });
};
Object.defineProperty(globalThis, 'fetch', { value: guardedFetch, writable: false, configurable: false });

let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 20000) break; }
const input = raw ? JSON.parse(raw) : {};
const log = [];
const kit = { fetch: guardedFetch, log: (...parts) => { if (log.length < 50) log.push(parts.join(' ').slice(0, 300)); }, now: () => new Date().toISOString() };
try {
  const skill = await import(pathToFileURL(join(folder, 'index.mjs')).href);
  if (typeof skill.run !== 'function') throw new Error('A habilidade precisa exportar uma função run(input, kit).');
  const result = await skill.run(input, kit);
  process.stdout.write(JSON.stringify({ ok: true, result: result ?? null, log }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 1000), log }) + '\n');
}
