// Resolve the display spelling against the destinations returned by notes.read.
export function noteDestination(name, links) {
  let path = name.trim();
  if (!path.includes('/')) path = 'chefe/' + path;
  if (!path.endsWith('.md')) path += '.md';
  return links.find(item => item.path === path);
}

export function noteChanged(original, latest) {
  return Boolean(original && (!latest || latest.path !== original.path || original.updatedAt !== latest.updatedAt || original.body !== latest.body));
}
