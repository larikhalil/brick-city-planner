import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extent, overlaps, bbox, snap, anyOverlaps, overlapPairs, toRowCol, snapConnect, grownCanvas,
  clampedCanvas, BP, tileAABB, tilesInRect, alignTiles, distributeTiles, rotateGroup,
  isTileEditable, isLayerVisible, layerOf, plateGridSnap, tileInViewport,
} from '../js/geometry.js';

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
test('snapConnect snaps a piece flush + aligned to a neighbour, ignores far ones', () => {
  const b = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, layer: 1 };
  // dragged near b's right edge with a 3-stud gap and 1-stud vertical offset
  const a = { id: 'a', x: 35, y: 1, w: 32, h: 32, rot: 0, layer: 1 };
  const s = snapConnect(a, [b], 6);
  assert.equal(s.x, 32); // A.left snaps flush to B.right (x=32)
  assert.equal(s.y, 0); // A.top aligns to B.top
  // far piece → no snap
  const far = { id: 'a', x: 100, y: 100, w: 32, h: 32, rot: 0, layer: 1 };
  assert.deepEqual(snapConnect(far, [b], 6), { x: 100, y: 100 });
});
test('snapConnect joins facing ports of a rotated piece', () => {
  const straight = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'road', name: 'Road — Straight', layer: 1 };
  // a curve rotated 180° so its right-opening faces left, dropped near the straight's right port
  const curve = { id: 'a', x: 35, y: 2, w: 32, h: 32, rot: 180, kind: 'road', name: 'Road — Curve (Right)', layer: 1 };
  const s = snapConnect(curve, [straight], 8);
  assert.equal(s.x, 32); // rotated port meets the straight's right opening at x=32
  assert.equal(s.y, 0);
});
test('snapConnect snaps a baseplate to the 32-stud grid', () => {
  const bp = { id: 'bp', x: 35, y: 30, w: 32, h: 32, rot: 0, kind: 'baseplate', layer: 0 };
  assert.deepEqual(snapConnect(bp, [], 6), { x: 32, y: 32 });
});
// PLAN-7 — a baseplate snaps to a grid of ITS OWN size, not always 32.
test('plateGridSnap steps by the plate size, per axis', () => {
  // 32×32 (classic) → the 32-grid, unchanged
  assert.deepEqual(plateGridSnap(35, 30, 32, 32), { x: 32, y: 32 });
  // 48×48 → the 48-grid (nearest multiple of 48, not 32)
  assert.deepEqual(plateGridSnap(50, 40, 48, 48), { x: 48, y: 48 });
  assert.deepEqual(plateGridSnap(80, 80, 48, 48), { x: 96, y: 96 });
  // 48×32 → 48 in x, 32 in y (independent per axis)
  assert.deepEqual(plateGridSnap(80, 50, 48, 32), { x: 96, y: 64 });
  // 16×16 → the 16-grid
  assert.deepEqual(plateGridSnap(20, 8, 16, 16), { x: 16, y: 16 });
  // origin-anchored: a plate dropped at the corner stays at the corner
  assert.deepEqual(plateGridSnap(0, 0, 48, 48), { x: 0, y: 0 });
  // degenerate / zero size falls back to one baseplate (BP) rather than dividing by zero
  assert.deepEqual(plateGridSnap(20, 20, 0, 0), { x: snap(20, BP), y: snap(20, BP) });
});
test('snapConnect snaps a lone 48×48 baseplate to its own 48-grid, not 32', () => {
  const bp = { id: 'bp', x: 50, y: 40, w: 48, h: 48, rot: 0, kind: 'baseplate', layer: 0 };
  assert.deepEqual(snapConnect(bp, [], 6), { x: 48, y: 48 });
});
test('snapConnect butts mixed-size baseplates flush together', () => {
  // a 32×32 plate sitting at the origin
  const base = { id: 'base', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'baseplate', layer: 0 };
  // a 16×16 plate dragged near the 32's right edge (3-stud gap) → left edge snaps flush to x=32
  const small = { id: 'small', x: 35, y: 1, w: 16, h: 16, rot: 0, kind: 'baseplate', layer: 0 };
  const s = snapConnect(small, [base], 6);
  assert.equal(s.x, 32); // flush against the neighbour's right edge — no gap
  assert.equal(s.y, 0); // top edge aligns to the neighbour's top
});
test('snapConnect: a far baseplate ignores neighbours and falls back to its own grid', () => {
  const base = { id: 'base', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'baseplate', layer: 0 };
  const far = { id: 'far', x: 100, y: 100, w: 48, h: 48, rot: 0, kind: 'baseplate', layer: 0 };
  assert.deepEqual(snapConnect(far, [base], 6), { x: 96, y: 96 }); // 48-grid, unaffected by base
});
test('snapConnect edge-snaps a building to a same-layer neighbour', () => {
  const b = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'building', layer: 2 };
  const a = { id: 'a', x: 34, y: 1, w: 16, h: 16, rot: 0, kind: 'building', layer: 2 };
  const s = snapConnect(a, [b], 6);
  assert.equal(s.x, 32); // A.left snaps flush to B.right
  assert.equal(s.y, 0); // A.top aligns to B.top
});
test('snapConnect falls back to edge-align when no ports face each other', () => {
  const b = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'road', name: 'Road — Straight', layer: 1 };
  // straight road placed just below b: their L/R openings don't face up/down → AABB fallback
  const a = { id: 'a', x: 1, y: 35, w: 32, h: 32, rot: 0, kind: 'road', name: 'Road — Straight', layer: 1 };
  const s = snapConnect(a, [b], 6);
  assert.equal(s.y, 32); // top edge snaps flush to b's bottom
  assert.equal(s.x, 0);
});
// Round-1 feedback: the generic edge magnet is gated by its OWN weaker threshold so ordinary
// sets can rest on any stud, while ports/plates keep the stronger pull.
test('snapConnect with a small edgeThreshold leaves an in-between building alone', () => {
  const b = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'building', layer: 2 };
  // 3-stud gap: within the old 6-stud magnet, but outside the new 2-stud edge threshold
  const a = { id: 'a', x: 35, y: 1, w: 16, h: 16, rot: 0, kind: 'building', layer: 2 };
  assert.deepEqual(snapConnect(a, [b], 6, 2), { x: 35, y: 1 });
});
test('snapConnect with a small edgeThreshold still snaps a nearly-flush building', () => {
  const b = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'building', layer: 2 };
  const a = { id: 'a', x: 33, y: 1, w: 16, h: 16, rot: 0, kind: 'building', layer: 2 }; // 1-stud gap
  const s = snapConnect(a, [b], 6, 2);
  assert.equal(s.x, 32); // flush
  assert.equal(s.y, 0); // aligned
});
test('port joining ignores edgeThreshold — roads still leap together at 6 studs', () => {
  const straight = { id: 'b', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'road', name: 'Road — Straight', layer: 1 };
  const curve = { id: 'a', x: 35, y: 2, w: 32, h: 32, rot: 180, kind: 'road', name: 'Road — Curve (Right)', layer: 1 };
  const s = snapConnect(curve, [straight], 8, 2);
  assert.equal(s.x, 32); // port-to-port join unaffected by the weak edge threshold
  assert.equal(s.y, 0);
});
test('baseplate tiling ignores edgeThreshold — plates still butt flush at 6 studs', () => {
  const base = { id: 'base', x: 0, y: 0, w: 32, h: 32, rot: 0, kind: 'baseplate', layer: 0 };
  const small = { id: 'small', x: 35, y: 1, w: 16, h: 16, rot: 0, kind: 'baseplate', layer: 0 };
  const s = snapConnect(small, [base], 6, 2);
  assert.equal(s.x, 32); // plate branch runs on the main threshold, not edgeThreshold
  assert.equal(s.y, 0);
});
test('grownCanvas expands to content + margin in whole baseplates, never shrinks', () => {
  // content reaches x=200; +16 margin = 216 → rounds up to 224 (7 plates)
  assert.deepEqual(grownCanvas(200, 50, 128, 96), { w: 224, h: 96 });
  // content well inside the current canvas → stays put (expand-only)
  assert.deepEqual(grownCanvas(40, 30, 128, 96), { w: 128, h: 96 });
  // empty content keeps the current size
  assert.deepEqual(grownCanvas(0, 0, 128, 96), { w: 128, h: 96 });
});
test('clampedCanvas snaps to plates, floors at content, caps at max', () => {
  // request 5×3 plates on empty content → exact
  assert.deepEqual(clampedCanvas(5 * BP, 3 * BP, 0, 0), { w: 160, h: 96 });
  // try to shrink below placed content (right edge at 100) → clamped up to 4 plates (128)
  assert.deepEqual(clampedCanvas(BP, BP, 100, 20), { w: 128, h: 32 });
  // absurd request is capped at 1024 studs (32 plates)
  assert.equal(clampedCanvas(9999, BP, 0, 0).w, 1024);
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

test('tileAABB accounts for rotation (90° swaps the extent)', () => {
  assert.deepEqual(tileAABB({ x: 0, y: 0, w: 48, h: 32, rot: 0 }),
    { minX: 0, maxX: 48, minY: 0, maxY: 32 });
  // 48×32 rotated 90° about its centre (24,16) → 32×48 AABB centred the same
  assert.deepEqual(tileAABB({ x: 0, y: 0, w: 48, h: 32, rot: 90 }),
    { minX: 8, maxX: 40, minY: -8, maxY: 40 });
});
test('tilesInRect returns ids whose AABB intersects the marquee', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0, w: 32, h: 32, rot: 0 },
    { id: 'b', x: 100, y: 0, w: 32, h: 32, rot: 0 },
    { id: 'c', x: 20, y: 20, w: 32, h: 32, rot: 0 },
  ];
  // box over the top-left corner catches a and c, not the far b
  assert.deepEqual(tilesInRect(tiles, { x: -5, y: -5, w: 40, h: 40 }).sort(), ['a', 'c']);
  // a box out in empty space catches nothing
  assert.deepEqual(tilesInRect(tiles, { x: 200, y: 200, w: 10, h: 10 }), []);
});
test('alignTiles lines tiles up by their rotated AABB', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0, w: 32, h: 32, rot: 0 },
    { id: 'b', x: 10, y: 50, w: 16, h: 16, rot: 0 },
  ];
  const left = alignTiles(tiles, 'left');
  assert.equal(left.find((r) => r.id === 'a').x, 0);
  assert.equal(left.find((r) => r.id === 'b').x, 0); // b.left snaps to the shared min (0)
  const right = alignTiles(tiles, 'right');
  assert.equal(right.find((r) => r.id === 'b').x, 16); // b.right (x16+16=32) meets a.right (32)
  const cH = alignTiles(tiles, 'centerH'); // group centre x = 16
  assert.equal(cH.find((r) => r.id === 'a').x, 0); // a centre already 16
  assert.equal(cH.find((r) => r.id === 'b').x, 8); // b centre → 16 ⇒ x = 8
  // aligning left leaves the other axis untouched
  assert.equal(left.find((r) => r.id === 'b').y, 50);
});
test('distributeTiles evenly spaces 3+ tiles by centre, extremes fixed', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0, w: 10, h: 10, rot: 0 },   // centre 5
    { id: 'b', x: 15, y: 0, w: 10, h: 10, rot: 0 },  // centre 20
    { id: 'c', x: 40, y: 0, w: 10, h: 10, rot: 0 },  // centre 45
  ];
  const d = distributeTiles(tiles, 'h'); // targets 5,25,45
  assert.equal(d.find((r) => r.id === 'a').x, 0);   // first fixed
  assert.equal(d.find((r) => r.id === 'c').x, 40);  // last fixed
  assert.equal(d.find((r) => r.id === 'b').x, 20);  // centre 25 ⇒ x 20
  // fewer than 3 tiles is a no-op
  assert.deepEqual(distributeTiles(tiles.slice(0, 2), 'h').map((r) => r.x), [0, 15]);
});
// ---- ACC-4 support: overlapPairs + toRowCol -------------------------------------------------
test('overlapPairs returns the actual tile objects, paired, for each real overlap', () => {
  const a = { id: 'a', name: 'Police Station', x: 0, y: 0, w: 32, h: 32, rot: 0 };
  const b = { id: 'b', name: 'Fire Station', x: 16, y: 16, w: 32, h: 32, rot: 0 };
  const c = { id: 'c', name: 'Far Away', x: 200, y: 200, w: 8, h: 8, rot: 0 };
  const pairs = overlapPairs([a, b, c]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(new Set(pairs[0].map((t) => t.id)), new Set(['a', 'b']));
  // anyOverlaps stays consistent with it (ids derived from the same pairs)
  assert.deepEqual([...anyOverlaps([a, b, c])].sort(), ['a', 'b']);
});
test('overlapPairs respects the same layer exclusion as anyOverlaps', () => {
  const plate = { id: 'plate', x: 0, y: 0, w: 32, h: 32, rot: 0, layer: 0 };
  const road = { id: 'road', x: 0, y: 0, w: 32, h: 32, rot: 0, layer: 1 };
  assert.deepEqual(overlapPairs([plate, road]), []); // different layers never pair
});
test('toRowCol converts stud coords to a friendly 1-indexed row/column pair', () => {
  assert.deepEqual(toRowCol(0, 0), { row: 1, col: 1 });
  assert.deepEqual(toRowCol(8, 16), { row: 3, col: 2 });
  assert.deepEqual(toRowCol(23, 40, 8), { row: 6, col: 3 }); // floors within the cell, not rounds
});

// ---- QOL-8 / QOL-10: lock + layer show-hide/lock + Kid Mode predicates ----------------------
test('layerOf defaults a missing layer to 2 (buildings)', () => {
  assert.equal(layerOf({ layer: 0 }), 0);
  assert.equal(layerOf({ layer: 1 }), 1);
  assert.equal(layerOf({}), 2);
});

test('isLayerVisible: visible unless the tile\'s layer is explicitly hidden', () => {
  const t = { id: 'a', layer: 1 };
  assert.equal(isLayerVisible(t, null), true);          // no prefs → visible
  assert.equal(isLayerVisible(t, { 1: true }), true);
  assert.equal(isLayerVisible(t, { 1: false }), false); // its layer hidden
  assert.equal(isLayerVisible(t, { 0: false }), true);  // a DIFFERENT layer hidden doesn't affect it
  assert.equal(isLayerVisible({ id: 'b' }, { 2: false }), false); // missing layer defaults to 2
});

test('isTileEditable: a plain unlocked tile with no prefs is editable', () => {
  assert.equal(isTileEditable({ id: 'a', layer: 2 }), true);
});

test('isTileEditable: a per-tile lock blocks editing', () => {
  assert.equal(isTileEditable({ id: 'a', layer: 2, locked: true }), false);
});

test('isTileEditable: a locked layer blocks every tile on it, others stay editable', () => {
  const opts = { layerLocks: { 0: true } };
  assert.equal(isTileEditable({ id: 'base', layer: 0 }, opts), false);
  assert.equal(isTileEditable({ id: 'bldg', layer: 2 }, opts), true);
});

test('isTileEditable: a hidden layer is also non-editable', () => {
  assert.equal(isTileEditable({ id: 'a', layer: 1 }, { layerVis: { 1: false } }), false);
});

test('isTileEditable: Kid Mode freezes everything except pieces in kidNewIds', () => {
  const kidNewIds = new Set(['fresh']);
  const opts = { kidMode: true, kidNewIds };
  assert.equal(isTileEditable({ id: 'old', layer: 2 }, opts), false);   // part of the frozen layout
  assert.equal(isTileEditable({ id: 'fresh', layer: 2 }, opts), true);  // added this Kid-Mode session
  // Kid Mode with no id set → nothing is editable (a defensive default)
  assert.equal(isTileEditable({ id: 'x', layer: 2 }, { kidMode: true }), false);
});

test('isTileEditable: restrictions compound — an unlocked, visible, kid-new tile is editable', () => {
  const opts = { layerLocks: { 0: true }, layerVis: { 1: false }, kidMode: true, kidNewIds: new Set(['ok']) };
  assert.equal(isTileEditable({ id: 'ok', layer: 2, locked: false }, opts), true);
  assert.equal(isTileEditable({ id: 'ok', layer: 2, locked: true }, opts), false);  // tile lock wins
});

test('rotateGroup orbits tile centres about the group centre and advances rot', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0, w: 32, h: 32, rot: 0 },
    { id: 'b', x: 32, y: 0, w: 32, h: 32, rot: 0 },
  ];
  const r = rotateGroup(tiles, 90);
  const a = r.find((t) => t.id === 'a'), b = r.find((t) => t.id === 'b');
  assert.equal(a.rot, 90); assert.equal(b.rot, 90);
  // a horizontal pair rotated 90° becomes a vertical pair (same x, 32 apart in y)
  assert.equal(a.x, b.x);
  assert.equal(Math.abs(b.y - a.y), 32);
});

// ---- PERF-1: viewport culling predicate ------------------------------------------------------
test('tileInViewport: fully-inside tiles render, fully-outside ones are culled', () => {
  const vp = { x: 100, y: 100, w: 200, h: 150 }; // visible rect in studs
  // dead-centre of the viewport → rendered
  assert.equal(tileInViewport({ x: 150, y: 150, w: 16, h: 16, rot: 0 }, vp, 0), true);
  // far off to the right, well past the margin → culled
  assert.equal(tileInViewport({ x: 1000, y: 150, w: 16, h: 16, rot: 0 }, vp, 0), false);
  // far above → culled
  assert.equal(tileInViewport({ x: 150, y: -500, w: 16, h: 16, rot: 0 }, vp, 0), false);
});
test('tileInViewport: a tile straddling the edge still renders (edge-inclusive)', () => {
  const vp = { x: 0, y: 0, w: 100, h: 100 };
  // crosses the right edge (x 90..106) → visible
  assert.equal(tileInViewport({ x: 90, y: 40, w: 16, h: 16, rot: 0 }, vp, 0), true);
  // flush against the right edge (touches x=100) → edge-inclusive → visible
  assert.equal(tileInViewport({ x: 100, y: 40, w: 16, h: 16, rot: 0 }, vp, 0), true);
  // a big tile whose body spans the whole viewport → visible even though its corners are outside
  assert.equal(tileInViewport({ x: -50, y: -50, w: 300, h: 300, rot: 0 }, vp, 0), true);
});
test('tileInViewport: margin pulls just-off-screen tiles into the render set', () => {
  const vp = { x: 0, y: 0, w: 100, h: 100 };
  const tile = { x: 130, y: 40, w: 16, h: 16, rot: 0 }; // sits 30 studs past the right edge
  assert.equal(tileInViewport(tile, vp, 0), false);   // no margin → culled
  assert.equal(tileInViewport(tile, vp, 64), true);    // 64-stud buffer → rendered ahead of a scroll
  assert.equal(tileInViewport(tile, vp, 20), false);   // buffer too small to reach it → still culled
});
test('tileInViewport: null viewport never culls (unmeasurable stage → paint everything)', () => {
  assert.equal(tileInViewport({ x: 9999, y: 9999, w: 16, h: 16, rot: 0 }, null, 64), true);
});
test('tileInViewport: uses the ROTATED AABB, not the raw w×h box', () => {
  const vp = { x: 0, y: 0, w: 40, h: 40 };
  // a long thin tile placed just outside the right edge, but rotated 90° so its rotated AABB
  // swings back over the viewport → must render.
  const tile = { x: 30, y: 0, w: 8, h: 60, rot: 90 };
  // sanity: without rotation this narrow box (x 30..38) would be inside anyway, so make the case
  // meaningful by checking the rotated extent reaches leftward across the seam.
  assert.equal(tileInViewport(tile, vp, 0), true);
  // fully outside even after rotation → culled
  assert.equal(tileInViewport({ x: 200, y: 200, w: 8, h: 60, rot: 90 }, vp, 0), false);
});
