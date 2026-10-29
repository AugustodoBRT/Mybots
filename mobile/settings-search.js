// Search in Ajustes: a query matches a category when every word is in its title, summary or keywords (case and accents ignored).
export const plain = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matchCategories(query, categories) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return categories;
  return categories.filter(category => { const hay = plain([category.title, category.summary, ...(category.keywords || [])].join(' ')); return words.every(word => hay.includes(word)); });
}
