// The Android app draws the 3D bots in a hidden WebView with this page (scripts/build-avatar3d.mjs bundles it with three.js into one
// file of the native module's assets). The app asks for a picture of one bot at a size and a moment; the answer is a PNG data URL.
import { mountAvatar } from './avatar.js';

const cache = new Map(); const MAX = 40;
globalThis.mybots3d = {
  render({ id, bot, size, mood, animated, t }) {
    const key = id + ':' + size;
    let item = cache.get(key);
    if (!item) {
      const canvas = document.createElement('canvas');
      item = { canvas, api: mountAvatar(canvas, bot, { size, mood, animated: Boolean(animated), manual: true }), mood, animated: Boolean(animated) };
      cache.set(key, item);
      if (cache.size > MAX) { const [oldKey, old] = cache.entries().next().value; old.api.dispose(); cache.delete(oldKey); }
    } else { cache.delete(key); cache.set(key, item); }
    if (item.mood !== mood || item.animated !== Boolean(animated)) { item.api.set({ mood, animated: Boolean(animated) }); item.mood = mood; item.animated = Boolean(animated); }
    item.api.draw(t);
    return item.canvas.toDataURL('image/webp', 0.9);
  },
  drop(id) { for (const [key, item] of cache) if (key.startsWith(id + ':')) { item.api.dispose(); cache.delete(key); } }
};
