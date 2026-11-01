import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../mobile/office/vendor/three.module.js';
import { buildBuilding } from '../mobile/office/rooms.js';

// Canvas textures do not participate in navigation.
globalThis.document = { createElement() { return { getContext() { return new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} }); } }; } };
const members = n => Array.from({ length: n }, (_, i) => ({ id: `bot-${i}`, name: `Bot ${i}` }));
function checkPath(building, from, to) {
  const path = building.findPath(from, to);
  assert.ok(path, `No route: ${from} → ${to}`);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.025));
    for (let k = 0; k <= steps; k++) assert.equal(building.blocked(a[0] + (b[0] - a[0]) * k / steps, a[2] + (b[2] - a[2]) * k / steps), false, 'Route crosses an obstacle');
  }
}
for (const count of [1, 8, 24]) test(`Office routes avoid furniture and walls with ${count} bots`, () => {
  const building = buildBuilding(new T.Scene(), [{ id: 'lobby', name: 'Office', lobby: true, members: members(count) }, { id: 'studio', name: 'Studio', members: members(4) }]);
  for (const room of building.rooms) {
    const entry = building.nearestFree(room.door.pos);
    assert.equal(building.blocked(room.origin[0], room.rect[1]), true, 'North wall must be solid');
    for (const desk of room.desks.values()) {
      const center = [desk.pos[0], 0, desk.pos[2] - 0.95];
      assert.equal(building.blocked(center[0], center[2]), true, 'Desk footprint must use x/z in the correct order');
      assert.equal(building.findPath(entry, center), null, 'Blocked destinations must never use a straight-line fallback');
    }
    for (const point of room.wander) checkPath(building, entry, point);
    for (const spot of [...room.desks.values(), ...room.beds.values()]) checkPath(building, entry, building.nearestFree(spot.pos));
  }
  checkPath(building, building.rooms[0].wander[0], building.rooms[1].wander[0]);
  assert.equal(building.findPath(building.rooms[0].wander[0], [-100, 0, -100]), null);
  assert.equal(building.findPath([-100, 0, -100], building.rooms[0].wander[0]), null);
  building.dispose();
});
