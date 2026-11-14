// On Android, react-native-svg paints each <Svg> into a bitmap the size of the view in real pixels, and makes a new one
// on every redraw. A view thousands of dp wide (a big memory map, a spread-out canvas) asks for hundreds of MB: Android
// refuses it ("trying to draw too large bitmap") and the app closes, or each frame takes a second. These helpers keep
// that bitmap to roughly a few screens.

export const SVG_BUDGET = { pixels: 3.5e6, side: 4096 };

/** How many dp to draw per unit of a `w`×`h` area so its bitmap fits the budget; never more than `want`. */
export function budgetScale(w, h, want, density = 1, budget = SVG_BUDGET) {
  if (!(w > 0) || !(h > 0)) return want;
  const area = Math.sqrt(budget.pixels / (w * h)) / density, side = budget.side / (Math.max(w, h) * density);
  return Math.max(1e-4, Math.min(want, area, side));
}

/** The visible rectangle (in drawing units) of a view {k, x, y} over a `width`×`height` screen. */
export function visibleRect(view, width, height) {
  return { x: -view.x / view.k, y: -view.y / view.k, w: width / view.k, h: height / view.k };
}

export const contains = (outer, inner) => Boolean(outer) && inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** `rect` grown by `margin` of its own size on each side. */
export const grow = (rect, margin) => ({ x: rect.x - rect.w * margin, y: rect.y - rect.h * margin, w: rect.w * (1 + 2 * margin), h: rect.h * (1 + 2 * margin) });

export function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}
