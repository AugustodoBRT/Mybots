import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * A string that tells a process apart from another one that later reuses the same pid (its start time), or null when it is gone.
 * Linux and Android read /proc; macOS asks ps; Windows asks PowerShell. `run` and `read` are replaceable for the tests.
 */
export function processIdentity(pid, platform = process.platform, { run = execFileSync, read = readFileSync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (platform === 'darwin') return String(run('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 })).trim() || null;
    if (platform === 'win32') return String(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`], { encoding: 'utf8', timeout: 10000, windowsHide: true })).trim() || null;
    const stat = read(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  } catch { return null; }
}
export function stopOrphan(task, platform = process.platform, { run = execFileSync, identity = processIdentity, kill = process.kill.bind(process) } = {}) {
  if (!task.worker_pid || !task.worker_start || identity(task.worker_pid, platform) !== task.worker_start) return;
  if (platform === 'win32') { try { run('taskkill', ['/PID', String(task.worker_pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} return; }
  try { kill(-task.worker_pid, 'SIGKILL'); } catch { try { kill(task.worker_pid, 'SIGKILL'); } catch {} }
}
