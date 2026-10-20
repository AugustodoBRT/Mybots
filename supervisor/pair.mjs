import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { processIdentity } from './process.mjs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { publicEncrypt, createPublicKey } from 'node:crypto';
import { spawn } from 'node:child_process';
const directory = process.env.MYBOTS_HOME || join(homedir(), '.mybots');
const release = process.env.MYBOTS_RELEASE;
const endpoint = join(directory, 'endpoint.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function credentials() {
  try { return { ...JSON.parse(readFileSync(endpoint, 'utf8')), token: readFileSync(join(directory, 'token'), 'utf8').trim() }; }
  catch { return null; }
}
async function health(value) {
  if (!value || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) return null;
  try {
    const result = await fetch(`http://127.0.0.1:${value.port}/health`, { headers: { Authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(1000) });
    return result.ok ? await result.json() : null;
  } catch { return null; }
}
function deliver(value) {
  const publicKey = createPublicKey({ key: Buffer.from(process.env.MYBOTS_PAIR_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
  const encryptedToken = publicEncrypt({ key: publicKey, oaepHash: process.env.MYBOTS_PAIR_DIGEST || 'sha256' }, Buffer.from(value.token)).toString('base64');
  // RUN_COMMAND reports may retain stdout: only an app-decryptable token crosses this channel.
  console.log(JSON.stringify({ port: value.port, release, instanceId: value.instanceId, encryptedToken }));
}
// A supervisor that holds the lock but no longer answers (stuck while closing) would block every new start.
// It is stopped only when the lock's pid still is that same process (same start time).
async function releaseStuckLock() {
  const lock = join(directory, 'supervisor.lock');
  let owner; try { owner = JSON.parse(readFileSync(lock, 'utf8')); } catch { return; }
  for (let i = 0; i < 80; i++) {
    if (!owner.start || processIdentity(owner.pid) !== owner.start) { try { unlinkSync(lock); } catch {} return; }
    if (i === 30) try { process.kill(owner.pid, 'SIGTERM'); } catch {}
    if (i === 60) try { process.kill(owner.pid, 'SIGKILL'); } catch {}
    await sleep(100);
  }
}
async function main() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const previous = credentials(); const running = await health(previous);
  if (running && running.release === release) { deliver(previous); return; }
  if (running) {
    await fetch(`http://127.0.0.1:${previous.port}/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${previous.token}` }, signal: AbortSignal.timeout(10000) });
    for (let i = 0; i < 100 && await health(previous); i++) await sleep(100);
  }
  await releaseStuckLock();
  const log = openSync(join(directory, 'supervisor.log'), 'a', 0o600);
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'index.mjs')], { detached: true, stdio: ['ignore', log, log], env: process.env });
  child.unref(); closeSync(log);
  for (let i = 0; i < 150; i++) {
    const current = credentials(); const status = await health(current);
    if (status?.release === release) { deliver(current); return; }
    await sleep(100);
  }
  throw new Error('O supervisor não respondeu. Confira o ambiente e o diagnóstico no Termux.');
}
main().catch(() => { console.error('Não consegui iniciar o supervisor. Verifique ~/.mybots/supervisor.log no Termux.'); process.exitCode = 1; });
