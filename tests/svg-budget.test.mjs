import test from 'node:test';
import assert from 'node:assert/strict';
import { SVG_BUDGET, budgetScale, contains, grow, intersect, visibleRect } from '../mobile/state/svg-budget.js';

// The phone of the bug report: density 2.75. Before, the map's layer went up to 4096 dp (11 264 px a side) and the canvas
// cords covered every card, so Android refused the bitmap and the app closed.
const density = 2.75;
const pixels = (w, h, scale) => w * scale * density * h * scale * density;

test('a big drawing is drawn at a resolution whose bitmap fits the budget', () => {
  for (const [w, h, want] of [[4000, 3000, 1], [12000, 9000, 2], [800, 1400, 1.4], [30000, 200, 1]]) {
    const scale = budgetScale(w, h, want, density);
    assert.ok(pixels(w, h, scale) <= SVG_BUDGET.pixels * 1.0001, `${w}×${h}`);
    assert.ok(Math.max(w, h) * scale * density <= SVG_BUDGET.side + 1e-6, `${w}×${h} side`);
    assert.ok(scale <= want);
  }
});

test('a small drawing keeps the resolution asked for', () => {
  assert.equal(budgetScale(300, 500, 1, density), 1);
  assert.equal(budgetScale(0, 500, 1.5, density), 1.5);
});

test('the region follows the view and is redrawn only when the screen leaves it', () => {
  const seen = visibleRect({ k: 2, x: -200, y: -100 }, 400, 800);
  assert.deepEqual(seen, { x: 100, y: 50, w: 200, h: 400 });
  const region = grow(seen, 0.5);
  assert.deepEqual(region, { x: 0, y: -150, w: 400, h: 800 });
  assert.ok(contains(region, visibleRect({ k: 2, x: -250, y: -100 }, 400, 800)));
  assert.ok(!contains(region, visibleRect({ k: 2, x: -700, y: -100 }, 400, 800)));
  assert.deepEqual(intersect(region, { x: 300, y: 500, w: 1000, h: 1000 }), { x: 300, y: 500, w: 100, h: 150 });
  assert.equal(intersect(region, { x: 900, y: 0, w: 10, h: 10 }), null);
});
