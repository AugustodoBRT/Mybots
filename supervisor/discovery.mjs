import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

export const DISCOVERY_PORT = Number(process.env.MYBOTS_PC_DISCOVERY_PORT) || 3234;
export const tailscaleAddress = address => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) && isIP(address) === 4;
export function privateAddress(address) {
  return isIP(address) === 4 && (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) || tailscaleAddress(address));
}
export function broadcastTargets(interfaces = networkInterfaces()) {
  const targets = new Set(['255.255.255.255']);
  for (const item of Object.values(interfaces).flat()) {
    if (!item || item.internal || item.family !== 'IPv4' || isIP(item.address) !== 4 || isIP(item.netmask) !== 4) continue;
    const mask = item.netmask.split('.').map(Number);
    if (mask.every(byte => byte === 255)) continue;
    targets.add(item.address.split('.').map((byte, i) => (Number(byte) | (~mask[i] & 255))).join('.'));
  }
  return [...targets];
}

/** Discovery is only a hint: the link must still verify its pinned TLS certificate. */
export function discover(id, { targets = broadcastTargets(), port = DISCOVERY_PORT, timeout = 2000, signal, onError = () => {} } = {}) {
  return new Promise(resolve => {
    const socket = createSocket('udp4'); const found = []; const seen = new Set(); let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', finish);
      try { socket.close(); } catch {} resolve(found);
    };
    const timer = setTimeout(finish, timeout);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) { finish(); return; }
    // Loopback is accepted only when explicitly configured for isolated tests.
    const allowed = address => privateAddress(address) || targets.includes(address) && /^127\./.test(address);
    socket.on('error', error => { onError(error); finish(); });
    socket.on('message', (bytes, remote) => {
      if (done || bytes.length > 512 || !allowed(remote.address)) return;
      let value; try { value = JSON.parse(bytes); } catch { return; }
      if (value?.t !== 'mybots' || value.id !== id || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !Array.isArray(value.addresses)) return;
      const addresses = [...new Set([remote.address, ...value.addresses.filter(address => typeof address === 'string' && allowed(address))])].slice(0, 8);
      const key = value.port + ':' + addresses.join(',');
      if (!seen.has(key) && found.length < 16) { seen.add(key); found.push({ port: value.port, addresses }); }
    });
    socket.bind(0, '0.0.0.0', () => {
      if (done) return;
      try { socket.setBroadcast(true); } catch (error) { onError(error); finish(); return; }
      const bytes = Buffer.from(JSON.stringify({ t: 'mybots?', id }));
      for (const target of targets) socket.send(bytes, port, target, error => { if (error) onError(error); });
    });
  });
}
