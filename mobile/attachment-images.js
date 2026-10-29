// Pictures that come in a conversation (a bot's image, a photo you sent) are read from the supervisor once and kept, so the chat shows them
// right in the bubble. App.js tells how to read a file; nothing here touches the network.
let reader = null; const cache = new Map(); const pending = new Map();
export const setImageReader = fn => { reader = fn; };
export const isPicture = file => /^image\/(png|jpe?g|webp|gif)$/i.test(file?.mime || '') && (file.size || 0) <= 8 * 1024 * 1024;
export function readImage(file) {
  if (cache.has(file.id)) return Promise.resolve(cache.get(file.id));
  if (!reader) return Promise.reject(new Error('Não consegui abrir a imagem agora.'));
  if (!pending.has(file.id)) pending.set(file.id, reader(file).then(uri => { cache.set(file.id, uri); if (cache.size > 30) cache.delete(cache.keys().next().value); return uri; }).finally(() => pending.delete(file.id)));
  return pending.get(file.id);
}
export const cachedImage = file => cache.get(file?.id) || null;
