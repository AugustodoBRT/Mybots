import { createSocket } from 'node:dgram';
import { DISCOVERY_PORT, privateAddress } from '../supervisor/discovery.mjs';

export function discoveryHandler({ id, port, addresses, send, allowLoopback = false, now = Date.now }) {
  const recent = new Map();
  return (bytes, remote) => {
    if (bytes.length > 512 || !privateAddress(remote.address) && !(allowLoopback && /^127\./.test(remote.address))) return;
    let value; try { value = JSON.parse(bytes); } catch { return; }
    if (value?.t !== 'mybots?' || value.id !== id) return;
    const time = now();
    if (recent.has(remote.address) && time - recent.get(remote.address) < 2000) return;
    for (const [address, last] of recent) if (time - last >= 2000) recent.delete(address);
    if (recent.size >= 1024) return;
    recent.set(remote.address, time);
    const response = Buffer.from(JSON.stringify({ t: 'mybots', id, port, addresses: addresses().slice(0, 6) }));
    if (response.length <= 512) send(response, remote.port, remote.address);
  };
}

export async function createDiscovery({ id, port, addresses, discoveryPort = DISCOVERY_PORT, allowLoopback = false, log = () => {} }) {
  const socket = createSocket({ type: 'udp4', reuseAddr: true }); let listening = false;
  socket.on('message', discoveryHandler({ id, port, addresses, allowLoopback, send: (bytes, targetPort, address) => socket.send(bytes, targetPort, address, () => {}) }));
  socket.on('error', error => log(`Descoberta local indisponível (${error.code || 'erro de rede'}). O pareamento por QR continua disponível.`));
  await new Promise(resolve => {
    socket.once('error', () => resolve());
    socket.bind(discoveryPort, '0.0.0.0', () => { listening = true; resolve(); });
  });
  return { port: listening ? socket.address().port : null, close: () => new Promise(resolve => { try { socket.close(resolve); } catch { resolve(); } }) };
}
