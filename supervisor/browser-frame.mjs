// MBF1: UUID (16 bytes), width/height (u16), seq (u32), three u16 lengths, changed metadata, JPEG.
const MAGIC = Buffer.from('MBF1'), HEADER = 34, ABSENT = 65535;
const sameTabs = (a, b) => a?.length === b?.length && (a || []).every((tab, n) => ['tab','active','title'].every(key => tab[key] === b[n][key]));
export function encodeFrame(frame, previous = {}) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(frame.botId) || !Buffer.isBuffer(frame.image) || frame.image.length > 4_000_000 || ![frame.width, frame.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || !Number.isInteger(frame.seq) || frame.seq < 0 || frame.seq > 0xffffffff) throw new Error('Quadro inválido.');
  const url = frame.url !== previous.url ? Buffer.from(String(frame.url || '').slice(0, 2000)) : null;
  const title = frame.title !== previous.title ? Buffer.from(String(frame.title || '').slice(0, 200)) : null;
  let tabs = null;
  if (!sameTabs(frame.tabs, previous.tabs)) {
    const list = (frame.tabs || []).slice(0, 5); const parts = [Buffer.from([list.length])];
    for (const tab of list) { const text = Buffer.from(String(tab.title || '').slice(0, 100)); const head = Buffer.alloc(4); head[0] = tab.tab; head[1] = tab.active ? 1 : 0; head.writeUInt16BE(text.length, 2); parts.push(head, text); }
    tabs = Buffer.concat(parts);
  }
  const head = Buffer.alloc(HEADER); MAGIC.copy(head); Buffer.from(frame.botId.replaceAll('-', ''), 'hex').copy(head, 4);
  head.writeUInt16BE(frame.width, 20); head.writeUInt16BE(frame.height, 22); head.writeUInt32BE(frame.seq, 24);
  [url, title, tabs].forEach((part, n) => head.writeUInt16BE(part ? part.length : ABSENT, 28 + n * 2));
  return Buffer.concat([head, ...[url, title, tabs].filter(part => part !== null), frame.image]);
}
export function decodeFrame(bytes, previous = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER || bytes.length > 4_020_000 || !bytes.subarray(0, 4).equals(MAGIC)) throw new Error('Quadro inválido.');
  const hex = bytes.subarray(4, 20).toString('hex'); const botId = hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  const frame = { ...previous, botId, width: bytes.readUInt16BE(20), height: bytes.readUInt16BE(22), seq: bytes.readUInt32BE(24) };
  let at = HEADER;
  for (const [n, name] of ['url', 'title', 'tabs'].entries()) {
    const length = bytes.readUInt16BE(28 + n * 2); if (length === ABSENT) continue;
    if (at + length > bytes.length) throw new Error('Quadro inválido.');
    const part = bytes.subarray(at, at + length); at += length;
    if (name !== 'tabs') frame[name] = part.toString('utf8');
    else {
      if (!part.length || part[0] > 5) throw new Error('Quadro inválido.');
      const tabs = []; let pos = 1;
      for (let i = 0; i < part[0]; i++) { if (pos + 4 > part.length) throw new Error('Quadro inválido.'); const size = part.readUInt16BE(pos + 2); if (pos + 4 + size > part.length) throw new Error('Quadro inválido.'); tabs.push({ tab: part[pos], active: part[pos + 1] === 1, title: part.subarray(pos + 4, pos + 4 + size).toString('utf8') }); pos += 4 + size; }
      if (pos !== part.length) throw new Error('Quadro inválido.'); frame.tabs = tabs;
    }
  }
  if (!frame.width || !frame.height || frame.width > 8192 || frame.height > 8192 || bytes.length <= at) throw new Error('Quadro inválido.');
  frame.image = bytes.subarray(at); return frame;
}
export const frameMetadata = ({ image, ...metadata }) => metadata;

export function viewSize({ maxWidth, maxHeight } = {}) {
  const size = (value, fallback, max) => Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(max, Math.round(value))) : fallback;
  return { maxWidth: size(maxWidth, 1280, 2560), maxHeight: size(maxHeight, 800, 1600) };
}
