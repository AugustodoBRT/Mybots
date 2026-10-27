// Inverse of the centered local transform; display rotation is independent from page coordinates.
export function framePoint({ x, y, width, height, scale = 1, translateX = 0, translateY = 0, rotation = 0 }) {
  const angle = rotation * Math.PI / 180, dx = x - width / 2 - translateX, dy = y - height / 2 - translateY;
  const clamp = value => Math.max(0, Math.min(1, value));
  return { x: clamp(((dx * Math.cos(angle) + dy * Math.sin(angle)) / scale + width / 2) / width), y: clamp(((-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale + height / 2) / height) };
}
export function zoomAt(view, point, scale, width, height) {
  scale = Math.max(1, Math.min(5, scale)); const ratio = scale / view.scale;
  return { ...view, scale, translateX: point.x - width / 2 - (point.x - width / 2 - view.translateX) * ratio, translateY: point.y - height / 2 - (point.y - height / 2 - view.translateY) * ratio };
}
