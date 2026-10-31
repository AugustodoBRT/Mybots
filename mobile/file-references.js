// Only file-shaped references become local actions; never launch arbitrary URL schemes.
export function fileReference(value) {
  if (typeof value !== 'string' || /[\n\r\0]/.test(value)) return null;
  let path = value.trim();
  if (/^(?:https?:|mailto:|javascript:|data:)/i.test(path)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^(sandbox:|file:\/\/)/i.test(path)) return null;
  path = path.replace(/^(?:sandbox:|file:\/\/)/i, '').replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/, '');
  try { path = decodeURIComponent(path); } catch { return null; }
  if (!/\.(?:md|txt|csv|json|log|ya?ml|xml|html?|css|jsx?|tsx?|py|sh|sql|pdf|png|jpe?g|gif|webp|svg|mp4|webm|mov|mp3|wav|ogg|m4a|zip|gz|tar|7z|rar|docx?|xlsx?|pptx?)$/i.test(path)) return null;
  return { reference: path, name: path.split(/[\\/]/).pop() };
}
export function previewKind(file) {
  const name = file?.name || '', mime = file?.mime || '';
  if (/\.(zip|gz|tar|7z|rar)$/i.test(name)) return 'archive';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name) || mime.startsWith('image/')) return 'image';
  if (/\.(mp4|webm|mov)$/i.test(name) || mime.startsWith('video/')) return 'video';
  if (/\.(mp3|wav|ogg|m4a)$/i.test(name) || mime.startsWith('audio/')) return 'audio';
  if (/\.pdf$/i.test(name) || mime === 'application/pdf') return 'pdf';
  if (/\.(md|txt|csv|json|log|ya?ml|xml|html?|css|jsx?|tsx?|py|sh|sql)$/i.test(name) || mime.startsWith('text/')) return 'text';
  return 'other';
}
export function referenceRuns(runs) {
  return runs.flatMap(run => {
    if (run.href || run.code || run.file) return [run];
    // Plain filenames and paths without spaces; Markdown links handle spaced names.
    const strict = /(?:\/?[\w@.~+-]+\/)*[\w@+-][\w@.+-]*\.(?:md|txt|csv|json|pdf|png|jpe?g|webp|gif|mp4|webm|mp3|wav|zip|docx|xlsx|pptx)\b/gi;
    let offset = 0; const parts = []; let match;
    while ((match = strict.exec(run.text))) {
      if (match.index > offset) parts.push({ ...run, text: run.text.slice(offset, match.index) });
      parts.push({ ...run, text: match[0], file: match[0] }); offset = strict.lastIndex;
    }
    if (offset < run.text.length) parts.push({ ...run, text: run.text.slice(offset) });
    return parts.length ? parts : [run];
  });
}
