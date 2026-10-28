'use strict';
// Groups the pieces of a reply that is being written into one update every `ms`, so a fast model does not flood the link.
// `set` keeps only the latest full text; the first one goes out at once, the rest wait for the window to close.
function createBatcher(emit, { ms = 32, timers = { setTimeout, clearTimeout } } = {}) {
  let latest = null, sent = null, timer = null;
  const flush = () => {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (latest !== null && latest !== sent) { sent = latest; try { emit(sent); } catch {} }
  };
  return {
    set(text) {
      latest = String(text);
      if (timer) return;
      if (sent === null) flush();
      timer = timers.setTimeout(() => { timer = null; flush(); }, ms);
      timer?.unref?.();
    },
    /** Sends what is pending now (the end of a block), or clears the draft when `text` is given. */
    flush,
    clear() { latest = ''; flush(); sent = null; latest = null; }
  };
}
module.exports = { createBatcher };
