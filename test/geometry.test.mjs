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
test('overlaps handles rotated rectangles (SAT)', () => {
  const a = { x: 0, y: 0, w: 30, h: 30, rot: 45 };
  const b = { x: 10, y: 10, w: 30, h: 30, rot: 0 };
  assert.equal(overlaps(a, b), true); // overlapping, one rotated 45°
  const far = { x: 200, y: 0, w: 30, h: 30, rot: 45 };
  assert.equal(overlaps(a, far), false); // clearly apart
  // edge-adjacent rotated pieces (share an edge) must NOT warn
  const c = { x: 0, y: 0, w: 20, h: 20, rot: 0 };
  const d = { x: 20, y: 0, w: 20, h: 20, rot: 0 };
  assert.equal(overlaps(c, d), false);
});
test('anyOverlaps only flags same-layer overlaps (baseplate/road/building layering)', () => {
  const plate = { id: 'plate', x: 0, y: 0, w: 32, h: 32, rot: 0, layer: 0 };
  const road = { id: 'road', x: 0, y: 0, w: 32, h: 32, rot: 0, layer: 1 };
  const house = { id: 'house', x: 4, y: 4, w: 16, h: 16, rot: 0, layer: 2 };
  // different layers never clash (building on road on baseplate)
  assert.deepEqual([...anyOverlaps([plate, road, house])], []);
  // same layer clashes: two roads
  const road2 = { id: 'road2', x: 8, y: 8, w: 32, h: 32, rot: 0, layer: 1 };
  assert.deepEqual([...anyOverlaps([road, road2])].sort(), ['road', 'road2']);
  // same layer clashes: two buildings
  const house2 = { id: 'house2', x: 8, y: 8, w: 16, h: 16, rot: 0, layer: 2 };
  assert.deepEqual([...anyOverlaps([house, house2])].sort(), ['house', 'house2']);
  // tiles with no layer default to buildings (layer 2)
  const plain = { id: 'plain', x: 8, y: 8, w: 16, h: 16, rot: 0 };
  assert.deepEqual([...anyOverlaps([house, plain])].sort(), ['house', 'plain']);
});
