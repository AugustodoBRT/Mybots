import { readFileSync } from 'node:fs';
export function processIdentity(pid) {
  try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]; }
  catch { return null; }
}
export function stopOrphan(task) {
  if (!task.worker_pid || !task.worker_start || processIdentity(task.worker_pid) !== task.worker_start) return;
  try { process.kill(-task.worker_pid, 'SIGKILL'); } catch { try { process.kill(task.worker_pid, 'SIGKILL'); } catch {} }
}
