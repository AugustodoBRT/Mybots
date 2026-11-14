function readCheckoutTotal() {
  const candidates = [];
  const label = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const isTotal = value => /^(?:total|total do pedido|total da compra|valor total|order total|total a pagar|total geral)\s*:?$/i.test(label(value));
  const parse = value => {
    const text = String(value || '').trim();
    const match = text.match(/^(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/);
    if (!match) return null;
    const cents = Number(match[1].replace(/\./g, '').replace(',', ''));
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  };
  const visible = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  for (const element of document.querySelectorAll('[data-order-total], [data-checkout-total], [aria-label], dt, th, label, span, div')) {
    if (!visible(element)) continue;
    const data = element.getAttribute('data-order-total') ?? element.getAttribute('data-checkout-total');
    if (data !== null) { const value = parse(element.textContent); if (value !== null) candidates.push(value); continue; }
    const aria = element.getAttribute('aria-label');
    if (isTotal(aria)) { const value = parse(element.textContent); if (value !== null) candidates.push(value); continue; }
    if (element.children.length || !isTotal(element.textContent)) continue;
    const next = element.nextElementSibling;
    if (next && visible(next)) { const value = parse(next.textContent); if (value !== null) candidates.push(value); }
  }
  const totals = [...new Set(candidates)];
  return totals.length === 1 ? { total: totals[0] } : { total: null };
}
