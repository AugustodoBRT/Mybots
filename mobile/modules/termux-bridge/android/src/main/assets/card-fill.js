function fillCard(card) {
  const cardField = (__MYBOTS_CARD_FIELD__);
  const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const kindOf = el => {
    const autocomplete = fold(el.getAttribute('autocomplete')).split(/\s+/);
    for (const [token, kind] of [['cc-exp-month', 'month'], ['cc-exp-year', 'year'], ['cc-exp', 'exp'], ['cc-name', 'name']]) if (autocomplete.includes(token)) return kind;
    const base = cardField(el);
    if (base !== 'other') return base;
    const meta = fold([el.name, el.id, el.getAttribute('aria-label'), el.placeholder].join(' '));
    if (/name|holder|titular|nome/.test(meta)) return 'name';
    if (/month|mes(?![a-z])|(?:^|[^a-z])mm(?:$|[^a-z])/.test(meta) && !/year|ano|aa|yy/.test(meta)) return 'month';
    if (/year|ano|(?:^|[^a-z])(?:aa|yy|aaaa|yyyy)(?:$|[^a-z])/.test(meta) && !/month|mes|mm/.test(meta)) return 'year';
    return 'exp';
  };
  const month = String(card.month).padStart(2, '0'), year = String(card.year);
  const value = (el, kind) => {
    const meta = fold([el.placeholder, el.getAttribute('aria-label')].join(' '));
    const short = el.maxLength === 2 || /(?:^|[^a-z])(?:aa|yy)(?:$|[^a-z])/.test(meta) && !/aaaa|yyyy/.test(meta);
    if (kind === 'number') return card.number;
    if (kind === 'security') return card.cvv;
    if (kind === 'name') return card.name;
    if (kind === 'month') return month;
    if (kind === 'year') return short ? year.slice(-2) : year;
    return month + '/' + (el.maxLength >= 7 || /aaaa|yyyy/.test(meta) ? year : year.slice(-2));
  };
  const set = (el, text) => {
    if (el.tagName === 'SELECT') {
      const option = [...el.options].find(item => [item.value, item.text.trim()].some(label => label === text || label === String(Number(text)) || label === text.slice(-2)));
      if (!option) return false;
      text = option.value;
    }
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    el.focus?.();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    for (const name of ['input', 'change']) el.dispatchEvent(new Event(name, { bubbles: true }));
    el.blur?.();
    return true;
  };
  const filled = [];
  const visit = doc => {
    for (const el of doc.querySelectorAll('input,select,textarea')) {
      const rect = el.getBoundingClientRect();
      if (el.disabled || el.readOnly || el.type === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
      const kind = kindOf(el);
      if (kind && set(el, value(el, kind))) filled.push(kind);
    }
    for (const frame of doc.querySelectorAll('iframe')) { try { if (frame.contentDocument) visit(frame.contentDocument); } catch {} }
  };
  if (card.clear) {
    const clear = doc => {
      for (const el of doc.querySelectorAll('input,select,textarea')) if (cardField(el) && el.tagName !== 'SELECT') { Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); filled.push('cleared'); }
      for (const frame of doc.querySelectorAll('iframe')) { try { if (frame.contentDocument) clear(frame.contentDocument); } catch {} }
    };
    clear(document);
    return { filled };
  }
  if (card.url && location.href !== card.url && window === window.top) return { filled, moved: true };
  visit(document);
  return { filled };
}
