import { setRandom } from './pc-channel.js';
import { pairWithComputer, remoteSocketClass } from './pc-client.js';
import { readPcLink, savePcLink, clearPcLink, randomBytesNative } from './native.js';

/**
 * The phone app using the computer's MyBots as its backend. This keeps the pairing (encrypted by the native side),
 * hands the app's SupervisorClient a socket that goes to the computer, and learns the computer's addresses on every connection.
 * Needs the computer on: nothing is stored on the phone except the pairing and the cache of open conversations.
 */
let link = null;   // { target: { id, name, port, addresses, relay, secret }, phone: { id, name } }
let random = false;
const ensureRandom = () => { if (!random) { setRandom(randomBytesNative); random = true; } };

const newPhoneId = () => { ensureRandom(); const bytes = randomBytesNative(12); let hex = ''; for (const byte of bytes) hex += byte.toString(16).padStart(2, '0'); return `app-${hex}`; };

export const loadLink = async () => { link = await readPcLink(); return link; };
export const currentLink = () => link;

/** First pairing, from the QR the computer shows (Ajustes → Celular, or `node pc/node.mjs pair`). */
export async function pairFromQr(text, name = 'Celular') {
  ensureRandom();
  const phone = link?.phone || { id: newPhoneId(), name };
  const { target, channel } = await pairWithComputer(globalThis.WebSocket, text, phone);
  channel.close();
  link = { target, phone }; await savePcLink(link); return link;
}
export async function forgetLink() { link = null; await clearPcLink(); }

/** What the computer says about itself on each connection (its addresses, port and relay) is kept for the next one. */
const learn = info => {
  if (!link || !info) return;
  const target = { ...link.target }; let changed = false;
  if (Array.isArray(info.addresses)) { const addresses = [...new Set([...info.addresses.filter(item => typeof item === 'string'), ...target.addresses])].slice(0, 8); if (addresses.join() !== target.addresses.join()) { target.addresses = addresses; changed = true; } }
  if (Number.isInteger(info.port) && info.port > 0 && info.port !== target.port) { target.port = info.port; changed = true; }
  if (typeof info.relay === 'string' && info.relay && info.relay !== target.relay) { target.relay = info.relay; changed = true; }
  if (changed) { link = { ...link, target }; savePcLink(link).catch(() => {}); }
};

/** The class the app's SupervisorClient opens instead of a WebSocket to the phone's own supervisor. */
export const RemoteSocket = class {
  constructor(url) {
    ensureRandom();
    if (!link) throw new Error('Este celular ainda não está pareado com um computador.');
    const Remote = remoteSocketClass(globalThis.WebSocket, () => ({ target: link.target, phone: link.phone, update: learn }));
    return new Remote(url);
  }
};
