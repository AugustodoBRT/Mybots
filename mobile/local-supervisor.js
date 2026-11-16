/** Reconnect the local socket first. A failed RPC after authentication is not a reason to start Linux again. */
export function localSupervisorRecovery({ client, readPairing, start, savePairing, isAlive = async () => false, now = Date.now }) {
  let running = null, failures = 0, retryAt = 0;
  async function recover() {
    if (client.authenticated) return;
    const existing = await readPairing();
    if (existing) {
      try { await client.connect(existing); if (now() > retryAt + 60000) { failures = 0; retryAt = 0; } return; }
      catch {
        client.close();
        if (await isAlive(existing)) throw new Error('O MyBots deste celular está ativo, mas a conexão ainda não respondeu. Reconectando…');
      }
    }
    if (now() < retryAt) throw new Error('O MyBots deste celular ainda não respondeu. A próxima tentativa será automática.');
    // Also space successful starts whose process/socket dies immediately, rather than starting a new Linux every few seconds.
    retryAt = now() + Math.min(60000, 10000 * 2 ** Math.min(failures++, 3));
    const result = await start();
    const credentials = await savePairing(result);
    await client.connect(credentials);
  }
  return () => {
    if (running) return running;
    const work = recover().finally(() => { if (running === work) running = null; });
    running = work; return work;
  };
}

/** This health probe is authenticated and local; it does not depend on internet or on any AI. */
export async function localSupervisorAlive(credentials) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const result = await fetch(`http://127.0.0.1:${credentials.port}/health`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: controller.signal });
    return result.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
