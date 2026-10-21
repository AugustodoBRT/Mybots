import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_MS = 10 * 60000;
// Better models first; the person keeps one of them in ~/.mybots-pc/whisper/.
const MODELS = ['large-v3-turbo', 'medium', 'small', 'base', 'tiny'];
const find = (name, extra = []) => [...extra, ...(process.env.PATH || '').split(delimiter).map(folder => join(folder, name))].find(path => existsSync(path)) || null;

/**
 * Dictation in the MyBots window on the computer: the node records the computer's microphone (PipeWire or
 * PulseAudio) and, when the person stops, transcribes it here: with faster-whisper (a Python with it, named in
 * ~/.mybots-pc/whisper/python, kept running with the model loaded) or else whisper.cpp. The audio never leaves
 * the computer and is deleted right after; only the text goes to the message box.
 */
export function createDictation(directory, { recorder, whisper, model, python } = {}) {
  const folder = join(directory, 'whisper');
  const pythonPath = () => {
    if (python !== undefined) return python;
    try { const path = (process.env.MYBOTS_WHISPER_PYTHON || readFileSync(join(folder, 'python'), 'utf8')).trim(); return existsSync(path) ? path : null; } catch { return null; }
  };
  const tools = () => {
    const record = recorder || find('pw-record') || find('parecord');
    if (!record) throw new Error('Para ditar no computador, instale o PipeWire (pw-record) ou o PulseAudio (parecord).');
    const interpreter = pythonPath();
    if (interpreter) return { record, python: interpreter };
    const binary = whisper || find('whisper-cli', [join(folder, 'whisper-cli')]);
    let file = model;
    if (!file && existsSync(folder)) { const names = readdirSync(folder).filter(name => /^ggml-.*\.bin$/.test(name)); file = MODELS.map(size => names.find(name => name.includes(size))).find(Boolean) || names[0]; file &&= join(folder, file); }
    if (!binary || !file) throw new Error(`Para ditar no computador, indique um Python com faster-whisper em ${join(folder, 'python')} ou instale o whisper.cpp (whisper-cli) com um modelo ggml em ${folder}.`);
    return { record, binary, file };
  };
  // faster-whisper stays loaded between dictations and closes after 10 idle minutes.
  let worker = null;
  const transcriber = interpreter => {
    if (worker && !worker.child.killed && worker.child.exitCode === null) { worker.touch(); return worker; }
    const child = spawn(interpreter, ['-I', fileURLToPath(new URL('./transcribe.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HF_HUB_OFFLINE: '1' } });
    const waiting = []; let idle;
    const current = worker = { child, ready: null, touch: () => { clearTimeout(idle); idle = setTimeout(() => child.kill(), 10 * 60000); },
      ask: audio => new Promise((resolve, reject) => { waiting.push({ resolve, reject }); child.stdin.write(JSON.stringify({ audio }) + '\n'); }) };
    current.ready = new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    current.ready.catch(() => {});
    createInterface({ input: child.stdout }).on('line', line => { let message; try { message = JSON.parse(line); } catch { return; } const next = waiting.shift(); if (!next) return; message.error ? next.reject(new Error(message.error)) : next.resolve(message); });
    child.on('exit', () => { clearTimeout(idle); if (worker === current) worker = null; for (const next of waiting.splice(0)) next.reject(new Error('O Whisper do computador parou.')); });
    child.on('error', () => {});
    current.touch();
    return current;
  };
  const sessions = new Map();
  const end = id => { const session = sessions.get(id); if (!session) return null; sessions.delete(id); clearTimeout(session.timer); return session; };
  return {
    start(id) {
      this.cancel(id);
      const { record, binary, file, python: interpreter } = tools();
      // Loads the model while the person speaks.
      const whisperWorker = interpreter ? transcriber(interpreter) : null;
      mkdirSync(join(folder, 'tmp'), { recursive: true, mode: 0o700 });
      const audio = join(folder, 'tmp', randomUUID() + '.wav');
      const args = record.endsWith('parecord') ? ['--rate=16000', '--channels=1', '--format=s16le', '--file-format=wav', audio] : ['--rate', '16000', '--channels', '1', '--format', 's16', audio];
      const child = spawn(record, args, { stdio: 'ignore' });
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.once('error', () => {});
      sessions.set(id, { child, exited, audio, binary, file, whisperWorker, timer: setTimeout(() => child.kill('SIGINT'), MAX_MS) });
      return { recording: true };
    },
    async stop(id) {
      const session = end(id);
      if (!session) throw new Error('O ditado já terminou.');
      session.child.kill('SIGINT'); await session.exited;
      try {
        if (!existsSync(session.audio)) throw new Error('O microfone do computador não gravou nada.');
        if (session.whisperWorker) {
          await session.whisperWorker.ready.catch(error => { throw new Error('O Whisper do computador não abriu: ' + error.message); });
          const { text } = await session.whisperWorker.ask(session.audio);
          return { text: text.replace(/\s+/g, ' ').trim() };
        }
        const text = await new Promise((resolve, reject) => execFile(session.binary, ['-m', session.file, '-l', 'pt', '-nt', '-np', '-f', session.audio], { timeout: 120000, maxBuffer: 4_000_000 },
          (error, stdout) => error ? reject(new Error('O whisper.cpp não conseguiu transcrever o áudio.')) : resolve(stdout)));
        return { text: text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() };
      } finally { rmSync(session.audio, { force: true }); }
    },
    cancel(id) {
      const session = end(id);
      if (!session) return { cancelled: false };
      session.child.kill('SIGKILL'); session.exited.then(() => rmSync(session.audio, { force: true }));
      return { cancelled: true };
    },
    close() { for (const id of [...sessions.keys()]) this.cancel(id); worker?.child.kill(); }
  };
}
