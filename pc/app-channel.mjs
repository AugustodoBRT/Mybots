import { EventEmitter } from 'node:events';
import { serverChannel } from '../mobile/pc-channel.js';

const IDLE_MS = 70000;

/**
 * The computer's end of the phone app's secure channel (mobile/pc-channel.js). A phone that uses this computer's MyBots connects here
 * (straight to the node's port, or through the relay), proves it knows its secret, and then speaks to the computer's own MyBots
 * exactly like the window does. `duplex` is any byte stream: a socket, or a WebSocket made into a stream.
 * Calls `onReady(socket, device)` with a WebSocket-shaped object (send, on('message'), on('close'), bufferedAmount, close).
 */
export function acceptApp(duplex, context, onReady, { timeout = 10000 } = {}) {
  const pipe = { send: bytes => { if (!duplex.destroyed) duplex.write(Buffer.from(bytes)); }, close: () => duplex.destroy() };
  const endpoint = serverChannel(pipe, context, timeout);
  duplex.on('data', data => endpoint.deliver(new Uint8Array(data.buffer, data.byteOffset, data.length)));
  duplex.on('close', () => endpoint.ended());
  duplex.on('error', () => {});
  endpoint.done.then(({ channel, device }) => onReady(channelSocket(channel, duplex), device), () => {});
  duplex.resume?.();
  return endpoint;
}

/** The channel as the window's WebSocket: the interface code serves both the same way. */
export function channelSocket(channel, duplex) {
  const socket = new EventEmitter(); socket.readyState = 1; socket.remote = true;
  Object.defineProperty(socket, 'bufferedAmount', { get: () => duplex.writableLength || 0 });
  socket.send = data => { if (socket.readyState !== 1) return; if (typeof data === 'string') channel.sendText(data); else channel.sendBinary(data); };
  socket.close = socket.terminate = () => channel.close();
  channel.on('message', (data, binary) => socket.emit('message', binary ? Buffer.from(data) : data, binary));
  channel.on('close', () => { socket.readyState = 3; clearInterval(idle); socket.emit('close'); });
  // The phone pings; a channel that has been silent for too long is dropped.
  const idle = setInterval(() => { if (Date.now() - channel.lastSeen > IDLE_MS) channel.close(); }, 15000); idle.unref?.();
  return socket;
}
