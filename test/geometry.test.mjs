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
