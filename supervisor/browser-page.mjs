// These functions also run in Android's WebView; keep them self-contained.
export function readPage({ query = '', limit = 5 } = {}) {
  const elements = [], texts = [];
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = normalize(query).split(/\s+/).filter(word => !['botao','campo','link','de','o','a'].includes(word));
  window.__mybotsNext ||= 1;
  let frame = 0;
  const visit = (doc, ox = 0, oy = 0, parentFrame = '') => {
    const win = doc.defaultView;
    for (const el of doc.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[onclick],[contenteditable=true],summary')) {
      if (elements.length >= 300) break;
      const r = el.getBoundingClientRect(), style = win.getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      if (!visible && el.type !== 'file') continue;
      if (!el.dataset.mybotsId) el.dataset.mybotsId = String(window.__mybotsNext++);
      const kind = el.type === 'password' ? 'password' : el.type === 'file' ? 'file' : el.type === 'submit' || el.type === 'image' || el.tagName === 'BUTTON' && el.type !== 'button' && el.form ? 'submit' : el.tagName.toLowerCase();
      const label = clean(el.getAttribute('aria-label') || (el.labels?.[0]?.innerText) || el.getAttribute('placeholder') || el.textContent || el.title || el.name || el.getAttribute('href'));
      const item = { id: Number(el.dataset.mybotsId), kind, label };
      if (visible && r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth) item.box = { x: r.x + ox, y: r.y + oy, w: r.width, h: r.height };
      if (parentFrame) item.frame = parentFrame;
      if (el.tagName === 'SELECT') item.options = [...el.options].map(o => clean(o.text)).slice(0, 50);
      if (query) {
        const haystack = normalize([label, el.textContent, el.placeholder, el.getAttribute('aria-label'), el.title, el.name].join(' '));
        item.score = words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
      }
      elements.push(item);
    }
    const copy = doc.body?.cloneNode(true);
    copy?.querySelectorAll('input,textarea,script,style,noscript,[data-mybots-marks]').forEach(el => el.remove());
    texts.push((copy?.textContent || '').replace(/\s+/g, ' '));
    for (const el of doc.querySelectorAll('iframe')) {
      try {
        if (!el.contentDocument?.body || el.contentWindow.location.origin !== location.origin) continue;
        const r = el.getBoundingClientRect(); visit(el.contentDocument, ox + r.x, oy + r.y, `frame:${++frame}`);
      } catch {}
    }
  };
  visit(document);
  return { text: texts.join('\n').slice(0, 20000), elements: query ? elements.filter(el => el.score > 0).sort((a, b) => b.score - a.score).slice(0, limit) : elements, scroll: { y: scrollY, height: document.documentElement.scrollHeight } };
}

export function inspectPoint(args) {
  let doc = document, el = args.action === 'key' ? doc.activeElement : doc.elementFromPoint(args.x, args.y);
  while (el?.tagName === 'IFRAME') {
    try { const r = el.getBoundingClientRect(); doc = el.contentDocument; if (!doc) break; el = args.action === 'key' ? doc.activeElement : doc.elementFromPoint(args.x - r.x, args.y - r.y); } catch { break; }
  }
  el = el?.closest('button,a,input,textarea,select,[role=button],[contenteditable=true]') || el;
  const label = String(el?.getAttribute('aria-label') || el?.textContent || el?.name || '').replace(/\s+/g, ' ').slice(0, 200);
  const write = !!el && (el.type === 'submit' || el.type === 'image' || !!el.form || el.tagName === 'A' && /comprar|pagar|pagamento|checkout|buy|purchase|pay/i.test(label + ' ' + el.getAttribute('href')));
  return { kind: el?.type === 'password' ? 'password' : write ? 'submit' : 'field', label, url: location.href };
}

export function markPage(elements) {
  document.querySelector('[data-mybots-marks]')?.remove();
  if (!elements) return;
  const layer = document.createElement('div'); layer.setAttribute('data-mybots-marks', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  for (const { id, box } of elements) {
    if (!box) continue;
    const node = document.createElement('div'); node.textContent = String(id);
    node.style.cssText = `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;border:2px solid #e22;color:#fff;background:#a0000022;font:bold 14px sans-serif;box-sizing:border-box`;
    layer.append(node);
  }
  document.documentElement.append(layer);
}
