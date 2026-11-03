const { spawnCli } = require('./cli-bin.cjs');

/**
 * Runs one CLI turn (the shape the Claude runner also uses): the process in its own group so it can be stopped as a
 * whole, an idle and a total time limit, the abort signal, and its stdout split into JSON lines (non-JSON lines such as
 * a wrapper's warnings are ignored). Resolves with the exit code and the tail of stderr.
 */
function runCli({ binary, args, env, cwd, wrap, signal, input, onProcess = () => {}, onEvent, idleMs, maxMs, label }) {
  let stderr = '', buffer = '', timedOut = false, tooBig = false, killTimer;
  return new Promise((resolve, reject) => {
    const child = spawnCli(binary, args, wrap, { cwd: cwd || process.cwd(), env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const kill = name => { try { if (process.platform !== 'win32') process.kill(-child.pid, name); else child.kill(name); } catch {} };
    const stop = () => { kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 2000); killTimer.unref(); };
    let idle;
    const alive = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; stop(); }, idleMs); };
    alive();
    const timer = setTimeout(() => { timedOut = true; stop(); }, maxMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { alive(); stderr = (stderr + chunk).slice(-16000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      alive(); buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line.startsWith('{')) continue;
        let event; try { event = JSON.parse(line); } catch { continue; }
        try { onEvent(event, stop); } catch (error) { stderr += '\n' + error.message; }
      }
      if (buffer.length > 4_000_000) { tooBig = true; stop(); }
    });
    if (child.pid) { try { onProcess(child.pid); } catch (error) { stop(); reject(error); } }
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); clearTimeout(idle); clearTimeout(killTimer); signal?.removeEventListener('abort', stop); resolve({ code, stderr, timedOut, tooBig, aborted: Boolean(signal?.aborted) }); });
  });
}

module.exports = { runCli };
