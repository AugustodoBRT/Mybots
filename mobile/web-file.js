/**
 * The iPhone's web app has no files of its own: a file the bot made is read from the computer in pieces and handed to the browser
 * as a download (Safari then offers to open it or save it in Files).
 */
export async function downloadFromComputer(call, file, page = globalThis) {
  const parts = []; let offset = 0;
  do {
    const part = await call('file.read', { id: file.id, offset });
    const binary = page.atob(part.chunk); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes); offset = part.next;
  } while (offset !== null);
  const url = page.URL.createObjectURL(new page.Blob(parts, { type: file.mime || 'application/octet-stream' }));
  const link = page.document.createElement('a'); link.href = url; link.download = file.name;
  page.document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => page.URL.revokeObjectURL(url), 60000);
}
