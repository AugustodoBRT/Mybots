function cardField(el) {
  if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return '';
  const autocomplete = String(el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
  if (autocomplete.includes('cc-number')) return 'number';
  if (autocomplete.includes('cc-csc')) return 'security';
  if (autocomplete.some(token => /^cc-(?:exp(?:-month|-year)?|name|given-name|additional-name|family-name)$/.test(token))) return 'other';
  const parts = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder,
    ...(el.labels ? [...el.labels].map(label => label.innerText) : [])];
  const meta = parts.map(value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(?:^|[^a-z0-9])gift[-_ ]?card[-_ ]?code(?:$|[^a-z0-9])/g, ' '));
  if (meta.some(value => /(?:^|[^a-z0-9])(?:cc[-_ ]?(?:number|num)|card[-_ ]?(?:number|num)|numero.{0,12}cartao|cartao.{0,12}numero)(?:$|[^a-z0-9])/.test(value))) return 'number';
  if (meta.some(value => /(?:^|[^a-z0-9])(?:cvv|cvc|csc|cc[-_ ]?(?:cvv|cvc|csc)|card[-_ ]?(?:cvv|cvc|csc|security|verification|code)|cartao.{0,12}seguranca)(?:$|[^a-z0-9])/.test(value))) return 'security';
  if (meta.some(value => /(?:^|[^a-z0-9])(?:cc[-_ ]?(?:exp|name)|card[-_ ]?(?:expiry|expiration|exp|holder)|cartao.{0,12}validade|validade.{0,12}cartao)(?:$|[^a-z0-9])/.test(value))) return 'other';
  return '';
}
