'use strict';
// Background jobs: a command a bot starts and leaves running after its turn ends, like `cmd &` in a terminal that stays open.
// The same code runs on the computer (inside the bot's sandbox, `wrap`) and on the phone's own Linux. A job keeps its output in a log
// file and its record in jobs.json; when it ends, `onDone` tells whoever woke the bot. A job lives only while this process does:
// after a restart the ones that were running are reported as lost (their log stays readable).
const { spawn } = require('node:child_process');
const { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, readSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_RUNNING_PER_BOT = 5, MAX_RECORDS = 200, MAX_LOG_BYTES = 100 * 1024 * 1024, DEFAULT_MINUTES = 360, MAX_MINUTES = 1440;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

class JobProcs {
  constructor({ directory, onDone = () => {} }) {
    this.directory = directory; this.onDone = onDone; this.live = new Map(); mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'jobs.json'); this.records = this.load();
    // What was running when the last process ended is gone: say so (once) instead of showing it as running forever.
    for (const record of this.records) if (record.state === 'running') Object.assign(record, { state: 'lost', endedAt: new Date().toISOString(), reported: false });
    this.save();
    this.guard = setInterval(() => this.watchLogs(), 30000); this.guard.unref?.();
  }
  load() { try { const list = JSON.parse(readFileSync(this.file, 'utf8')); return Array.isArray(list) ? list.filter(item => item && typeof item.id === 'string' && typeof item.botId === 'string') : []; } catch { return []; } }
  save() {
    // Old finished jobs go first; running ones always stay.
    const keep = this.records.filter(item => item.state === 'running'), rest = this.records.filter(item => item.state !== 'running');
    for (const gone of rest.slice(0, Math.max(0, rest.length + keep.length - MAX_RECORDS))) { try { rmSync(this.logPath(gone), { force: true }); } catch {} }
    this.records = [...rest.slice(Math.max(0, rest.length + keep.length - MAX_RECORDS)), ...keep].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    try { writeFileSync(this.file + '.tmp', JSON.stringify(this.records), { mode: 0o600 }); renameSync(this.file + '.tmp', this.file); } catch {}
  }
  logPath(record) { return join(this.directory, record.botId, record.id + '.log'); }
  view(record) { const { botId, pid, reported, owner, ...rest } = record; return rest; }
  find(botId, id) {
    const record = this.records.find(item => item.botId === botId && (item.id === id || item.id.startsWith(String(id).slice(0, 8)) && String(id).length >= 8));
    if (!record) throw new Error('Não achei esse job. Veja os ids com job_list.');
    return record;
  }
  list(botId) { return this.records.filter(item => item.botId === botId).map(item => this.view(item)).reverse(); }
  /** Starts `command` (through `wrap`, the sandbox's argument list, when there is one) and returns at once. */
  start({ botId, command, label, cwd, wrap = null, env = process.env, minutes = DEFAULT_MINUTES, owner }) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('Diga o comando.');
    if (this.records.filter(item => item.botId === botId && item.state === 'running').length >= MAX_RUNNING_PER_BOT) throw new Error(`Você já tem ${MAX_RUNNING_PER_BOT} jobs rodando: espere um terminar ou pare um com job_stop.`);
    const id = randomUUID(), record = { id, botId, label: String(label || command).slice(0, 80), command: command.slice(0, 4000), cwd, state: 'running', startedAt: new Date().toISOString(), reported: true, ...(owner ? { owner } : {}) };
    mkdirSync(join(this.directory, botId), { recursive: true, mode: 0o700 });
    const fd = openSync(this.logPath(record), 'a', 0o600);
    const argv = [...(wrap || []), ...(process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', command] : ['/bin/sh', '-c', command])];
    let child;
    try { child = spawn(argv[0], argv.slice(1), { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd], windowsHide: true }); }
    finally { closeSync(fd); }
    record.pid = child.pid; this.records.push(record); this.save();
    const entry = { child, stopped: false, timer: setTimeout(() => { entry.timedOut = true; this.kill(entry); }, Math.min(MAX_MINUTES, Math.max(1, minutes)) * 60000) };
    entry.timer.unref?.(); this.live.set(id, entry);
    let ended = false;
    const end = (code, signal, error) => {
      if (ended) return; ended = true; clearTimeout(entry.timer); this.live.delete(id);
      Object.assign(record, { state: entry.stopped ? 'stopped' : code === 0 ? 'done' : 'failed', code: code ?? null, signal: signal || null, endedAt: new Date().toISOString(), reported: false, ...(entry.timedOut ? { note: 'Passou do tempo máximo e foi parado.' } : {}), ...(entry.tooBig ? { note: 'O log passou de 100 MB e o job foi parado.' } : {}), ...(error ? { note: error.message } : {}) });
      if (entry.timedOut || entry.tooBig) record.state = 'failed';
      this.save();
      try { this.onDone(this.view(record), this.tail(record, 3000), record); } catch {}
    };
    child.on('error', error => end(null, null, error));
    child.on('close', (code, signal) => end(code, signal));
    return this.view(record);
  }
  kill(entry, signal = 'SIGTERM') {
    try { if (process.platform !== 'win32') process.kill(-entry.child.pid, signal); else entry.child.kill(signal); } catch {}
    if (signal === 'SIGTERM') setTimeout(() => { if (!entry.child.exitCode && !entry.child.signalCode) this.kill(entry, 'SIGKILL'); }, 3000).unref?.();
  }
  stop(botId, id) {
    const record = this.find(botId, id), entry = this.live.get(record.id);
    if (!entry) return { ...this.view(record), message: 'Este job já tinha terminado.' };
    entry.stopped = true; this.kill(entry);
    return { ...this.view(record), message: 'Pedi para o job parar; o aviso chega quando ele encerrar.' };
  }
  /** The end of the log (plain text, colors removed). */
  tail(record, bytes = 4000) {
    const path = this.logPath(record);
    try {
      const size = statSync(path).size, length = Math.min(size, Math.max(200, Math.min(bytes, 20000)));
      const buffer = Buffer.alloc(length), fd = openSync(path, 'r');
      try { readSync(fd, buffer, 0, length, size - length); } finally { closeSync(fd); }
      return (size > length ? '…' : '') + buffer.toString('utf8').replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
    } catch { return ''; }
  }
  log(botId, id, { bytes } = {}) { const record = this.find(botId, id); return { ...this.view(record), log: this.tail(record, bytes) }; }
  /** Jobs that ended without their supervisor confirming it was told (it was away, or older): handed over again when it reconnects. `owner` is the supervisor that started the job. */
  unreported(owner) { return this.records.filter(item => item.reported === false && (!owner || !item.owner || item.owner === owner)).map(item => ({ job: this.view(item), botId: item.botId, owner: item.owner, tail: this.tail(item, 3000) })); }
  markReported(id) { const record = this.records.find(item => item.id === id); if (record && record.reported === false) { record.reported = true; this.save(); } }
  watchLogs() {
    for (const [id, entry] of this.live) {
      const record = this.records.find(item => item.id === id);
      try { if (record && existsSync(this.logPath(record)) && statSync(this.logPath(record)).size > MAX_LOG_BYTES) { entry.tooBig = true; this.kill(entry); } } catch {}
    }
  }
  /** Stops everything still running (the process is ending). */
  close() { clearInterval(this.guard); for (const entry of this.live.values()) { entry.stopped = true; this.kill(entry); } }
}

module.exports = { JobProcs, MAX_RUNNING_PER_BOT };
