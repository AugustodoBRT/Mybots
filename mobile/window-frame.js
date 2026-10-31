// A picture of a bot's Chrome as the computer's node sends it to the window (see windowFrame in pc/ui.mjs):
// 0x01, u8 id length, id, u32 meta length, meta JSON, JPEG. It is decoded off the main work into a bitmap that the
// browser view paints straight onto a canvas; an older picture that arrives late is dropped.
const newest = new Map();
export async function decodeWindowFrame(buffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  if (bytes[0] !== 1) throw new Error('Quadro inválido.');
  const text = new TextDecoder(), idLength = bytes[1], botId = text.decode(bytes.subarray(2, 2 + idLength));
  const metaLength = view.getUint32(2 + idLength), start = 6 + idLength;
  const meta = JSON.parse(text.decode(bytes.subarray(start, start + metaLength)));
  const blob = new Blob([bytes.subarray(start + metaLength)], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  if (meta.seq < (newest.get(botId) ?? -1) && meta.seq > (newest.get(botId) ?? 0) - 1000) { bitmap.close(); return null; }
  newest.set(botId, meta.seq);
  return { botId, ...meta, bitmap, blob };
}
