import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extent, overlaps, bbox, snap, anyOverlaps } from '../js/geometry.js';

test('extent swaps on 90/270', () => {
  assert.deepEqual(extent({ w: 48, h: 32, rot: 0 }), { w: 48, h: 32 });
  assert.deepEqual(extent({ w: 48, h: 32, rot: 90 }), { w: 32, h: 48 });
});
test('overlap true when intersecting, false when edge-touching', () => {
  const a = { x: 0, y: 0, w: 32, h: 32, rot: 0 };
  assert.equal(overlaps(a, { x: 16, y: 16, w: 32, h: 32, rot: 0 }), true);
  assert.equal(overlaps(a, { x: 32, y: 0, w: 32, h: 32, rot: 0 }), false); // touching
});
test('bbox spans all tiles; empty is zero', () => {
  assert.deepEqual(bbox([]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(
    bbox([{ x: 0, y: 0, w: 32, h: 32, rot: 0 }, { x: 40, y: 10, w: 16, h: 16, rot: 0 }]),
    { x: 0, y: 0, w: 56, h: 32 });
});
test('snap rounds to step', () => {
  assert.equal(snap(17, 1), 17);
  assert.equal(snap(17, 16), 16);
  assert.equal(snap(25, 16), 32);
});
test('anyOverlaps returns ids of overlapping tiles', () => {
  const ids = anyOverlaps([
    { id: 'a', x: 0, y: 0, w: 32, h: 32, rot: 0 },
    { id: 'b', x: 16, y: 16, w: 32, h: 32, rot: 0 },
    { id: 'c', x: 100, y: 100, w: 8, h: 8, rot: 0 },
  ]);
  assert.deepEqual([...ids].sort(), ['a', 'b']);
});
test('anyOverlaps ignores a building resting on a baseplate but flags same-layer overlaps', () => {
  const plate = { id: 'plate', x: 0, y: 0, w: 32, h: 32, rot: 0, ground: true };
  const house = { id: 'house', x: 4, y: 4, w: 16, h: 16, rot: 0 };
  // building on a baseplate → no warning
  assert.deepEqual([...anyOverlaps([plate, house])], []);
  // two baseplates overlapping → still flagged
  const plate2 = { id: 'plate2', x: 8, y: 8, w: 32, h: 32, rot: 0, ground: true };
  assert.deepEqual([...anyOverlaps([plate, plate2])].sort(), ['plate', 'plate2']);
  // two buildings overlapping → still flagged
  const house2 = { id: 'house2', x: 8, y: 8, w: 16, h: 16, rot: 0 };
  assert.deepEqual([...anyOverlaps([house, house2])].sort(), ['house', 'house2']);
});
