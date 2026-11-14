(() => {
  if (window.__mybotsCardObserve) return;
  const cardField = (__MYBOTS_CARD_FIELD__);
  const seen = new Set();
  const observe = el => {
    if (!el || el.nodeType !== 1) return;
    const kind = cardField(el), value = String(el.value || '');
    if (!((kind === 'number' && value.replace(/\D/g, '').length >= 12) || (kind === 'security' && value.length >= 3))) return;
    if (seen.has(value)) return;
    if (value.length > 100 || seen.size >= 200) {
      try { window.mybotsCardSecret?.postMessage(JSON.stringify({ kind: 'overflow' })); } catch {}
      return;
    }
    seen.add(value);
    try { window.mybotsCardSecret?.postMessage(JSON.stringify({ kind, value })); } catch {}
  };
  const scan = node => {
    if (!node) return;
    observe(node);
    node.querySelectorAll?.('input,textarea,select').forEach(observe);
  };
  window.__mybotsCardObserve = true;
  // Payment frames (another origin) are filled here, inside the frame, when the app sends the card to this frame alone.
  if (window !== window.top && window.mybotsCardSecret) {
    const fillCard = (__MYBOTS_CARD_FILL__);
    window.mybotsCardSecret.addEventListener('message', event => {
      try {
        const { fill } = JSON.parse(event.data);
        const { filled } = fillCard(fill);
        if (!fill.clear) window.mybotsCardSecret.postMessage(JSON.stringify({ kind: 'filled', count: filled.length }));
      } catch {}
    });
    try { window.mybotsCardSecret.postMessage(JSON.stringify({ kind: 'hello' })); } catch {}
  }
  for (const name of ['input', 'change', 'blur']) document.addEventListener(name, event => observe(event.target), true);
  for (const proto of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype, HTMLSelectElement.prototype]) {
    const property = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!property?.get || !property?.set || !property.configurable) continue;
    Object.defineProperty(proto, 'value', { ...property, set(value) { observe(this); property.set.call(this, value); observe(this); } });
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') observe(record.target);
      for (const node of record.addedNodes) scan(node);
      for (const node of record.removedNodes) scan(node);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['autocomplete', 'name', 'id', 'aria-label', 'placeholder', 'value'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(document), { once: true });
  else scan(document);
})();
