import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NON_SET_KINDS, isCitySet, isPhysical, CELL, TERRAIN_TYPES, terrainColor,
  makeTerrain, makeNote, makeCustom, snapRect, rectsIntersect,
} from '../js/objects.js';
import { anyOverlaps } from '../js/geometry.js';

test('isCitySet excludes terrain/note/custom, keeps real sets', () => {
  assert.equal(isCitySet({ kind: 'building' }), true);
  assert.equal(isCitySet({ kind: 'road' }), true);
  assert.equal(isCitySet({ kind: 'terrain' }), false);
  assert.equal(isCitySet({ kind: 'note' }), false);
  assert.equal(isCitySet({ kind: 'custom' }), false);
  for (const k of ['terrain', 'note', 'custom']) assert.ok(NON_SET_KINDS.has(k));
});

test('isPhysical counts footprint objects: sets + custom blocks, but not terrain/notes', () => {
  // Footprint asks a different question than purchasing: custom MOC blocks DO occupy footprint
  // (they stand in for a real build) even though isCitySet excludes them.
  assert.equal(isPhysical({ kind: 'building' }), true);
  assert.equal(isPhysical({ kind: 'road' }), true);
  assert.equal(isPhysical({ kind: 'custom' }), true, 'custom blocks count toward footprint');
  assert.equal(isPhysical({ kind: 'terrain' }), false, 'terrain paint carries no footprint');
  assert.equal(isPhysical({ kind: 'note' }), false, 'sticky notes carry no footprint');
  assert.equal(isPhysical(null), false);
  assert.equal(isPhysical(undefined), false);
  // isPhysical and isCitySet agree on everything EXCEPT custom blocks.
  assert.equal(isCitySet({ kind: 'custom' }), false);
});

test('terrainColor resolves known types, falls back to the first', () => {
  assert.equal(terrainColor('water'), 'var(--g-blue)');
  assert.equal(terrainColor('nope'), TERRAIN_TYPES[0].color);
});

test('makeTerrain builds a below-baseplate, non-collidable fill', () => {
  const t = makeTerrain({ id: 'p1', x: 8, y: 16, w: 24, h: 24, type: 'water' });
  assert.equal(t.kind, 'terrain');
  assert.equal(t.layer, -1);
  assert.equal(t.terrain, 'water');
  assert.equal(t.color, 'var(--g-blue)');
  assert.equal(t.set_num, 'terrain');
  assert.equal(t.rot, 0);
});

test('makeNote stores editable text and sits on top', () => {
  const n = makeNote({ id: 'p2', x: 4, y: 4, text: 'Town hall here' });
  assert.equal(n.kind, 'note');
  assert.equal(n.text, 'Town hall here');
  assert.equal(n.layer, 3);
  assert.ok(n.w > 0 && n.h > 0);
});

test('makeCustom is a building-layer placeholder carrying a label', () => {
  const c = makeCustom({ id: 'p3', x: 0, y: 0, w: 16, h: 32, label: 'My MOC' });
  assert.equal(c.kind, 'custom');
  assert.equal(c.layer, 2);
  assert.equal(c.name, 'My MOC');
  assert.equal(makeCustom({ id: 'p4', x: 0, y: 0, w: 8, h: 8 }).name, 'MOC'); // default label
});

test('snapRect normalises corners, snaps to step, clamps to >=0 and >=min', () => {
  // dragged bottom-right → top-left, snapped to CELL
  assert.deepEqual(snapRect(30, 20, 5, 3, CELL, CELL), { x: 8, y: 0, w: 24, h: 24 });
  // a click (zero-size) still yields a minimum cell
  assert.deepEqual(snapRect(10, 10, 10, 10, CELL, CELL), { x: 8, y: 8, w: CELL, h: CELL });
  // a corner dragged off the top-left edge clamps to 0 and the extent shrinks (never slides right)
  assert.deepEqual(snapRect(-5, -5, 4, 4, 1, 1), { x: 0, y: 0, w: 4, h: 4 });
});

test('rectsIntersect: overlap true, edge-touch false', () => {
  const a = { x: 0, y: 0, w: 16, h: 16 };
  assert.equal(rectsIntersect(a, { x: 8, y: 8, w: 16, h: 16 }), true);
  assert.equal(rectsIntersect(a, { x: 16, y: 0, w: 16, h: 16 }), false); // touching
  assert.equal(rectsIntersect(a, { x: 40, y: 40, w: 4, h: 4 }), false);
});

test('anyOverlaps ignores terrain & notes, still flags overlapping custom blocks', () => {
  const terrainA = makeTerrain({ id: 't1', x: 0, y: 0, w: 32, h: 32 });
  const terrainB = makeTerrain({ id: 't2', x: 8, y: 8, w: 32, h: 32 }); // overlaps t1 — must NOT warn
  const note = makeNote({ id: 'n1', x: 4, y: 4 });
  const custA = makeCustom({ id: 'c1', x: 0, y: 0, w: 24, h: 24 });
  const custB = makeCustom({ id: 'c2', x: 8, y: 8, w: 24, h: 24 }); // overlaps c1 — must warn
  const ids = anyOverlaps([terrainA, terrainB, note, custA, custB]);
  assert.deepEqual([...ids].sort(), ['c1', 'c2']);
});
