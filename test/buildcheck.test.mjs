// PLAN-3: buildability checker ("Check my city") — one detector per issue kind, all pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCity, isBaseplate, needsSupport, coverage } from '../js/buildcheck.js';

// ---- tile helpers ---------------------------------------------------------------------------
const plate = (id, x, y, w, h) =>
  ({ id, x, y, w, h, rot: 0, kind: 'baseplate', category: 'baseplate', name: 'Baseplate', layer: 0, approx: false });
const building = (id, x, y, w = 16, h = 16, extra = {}) =>
  ({ id, x, y, w, h, rot: 0, kind: 'building', category: 'city', name: 'House', layer: 2, approx: false, ...extra });
const track = (id, x, y, rot = 0, name = 'Track — Straight') =>
  ({ id, x, y, w: 16, h: 16, rot, kind: 'track', category: 'track', name, layer: 1, approx: false });

// ---- predicates -----------------------------------------------------------------------------
test('isBaseplate / needsSupport predicates', () => {
  assert.equal(isBaseplate(plate('bp', 0, 0, 32, 32)), true);
  assert.equal(isBaseplate(building('b', 0, 0)), false);
  assert.equal(isBaseplate(null), false);
  assert.equal(needsSupport(building('b', 0, 0)), true);
  assert.equal(needsSupport(track('t', 0, 0)), true);
  assert.equal(needsSupport(plate('bp', 0, 0, 32, 32)), false, 'a baseplate is the ground, not a seeker');
  assert.equal(needsSupport({ kind: 'terrain', layer: -1 }), false, 'terrain paint needs no support');
  assert.equal(needsSupport({ kind: 'note', layer: 3 }), false, 'notes need no support');
});

// ---- coverage -------------------------------------------------------------------------------
test('coverage: fully-on, fully-off and partial footprints over a baseplate', () => {
  const bp = [plate('bp', 0, 0, 64, 64)];
  const on = coverage(building('b', 8, 8), bp);
  assert.equal(on.inside, on.total, 'a piece well inside the plate is fully supported');
  const off = coverage(building('b', 200, 200), bp);
  assert.equal(off.inside, 0, 'a piece far from any plate has no support');
  const half = coverage(building('b', 56, 8), bp); // spans x 56..72, plate ends at 64
  assert.ok(half.inside > 0 && half.inside < half.total, 'a piece straddling the edge is partial');
});

test('coverage spans the UNION of adjacent baseplates across their seam', () => {
  const plates = [plate('a', 0, 0, 32, 32), plate('b', 32, 0, 32, 32)];
  const c = coverage(building('road', 24, 8), plates); // straddles the 32-stud seam
  assert.equal(c.inside, c.total, 'the two plates together fully support the piece');
});

// ---- (c) floating ---------------------------------------------------------------------------
test('a building with no baseplate under it is FLOATING (error)', () => {
  const r = checkCity([plate('bp', 0, 0, 32, 32), building('b', 100, 100)]);
  const f = r.issues.find((i) => i.type === 'floating');
  assert.ok(f, 'floating issue raised');
  assert.equal(f.severity, 'error');
  assert.deepEqual(f.ids, ['b']);
  assert.equal(r.ok, false);
});

// ---- (a) overhang ---------------------------------------------------------------------------
test('a building hanging off the plate edge is an OVERHANG (warn)', () => {
  const r = checkCity([plate('bp', 0, 0, 64, 64), building('b', 56, 8)]); // right half off
  const o = r.issues.find((i) => i.type === 'overhang');
  assert.ok(o, 'overhang issue raised');
  assert.equal(o.severity, 'warn');
  assert.deepEqual(o.ids, ['b']);
  assert.match(o.message, /unsupported/);
});

// ---- (b) overlap ----------------------------------------------------------------------------
test('two same-layer buildings overlapping is an OVERLAP (error), both ids reported', () => {
  const r = checkCity([plate('bp', 0, 0, 32, 32), building('a', 0, 0), building('b', 8, 8)]);
  const ov = r.issues.filter((i) => i.type === 'overlap');
  assert.equal(ov.length, 1, 'one overlap pair');
  assert.equal(ov[0].severity, 'error');
  assert.deepEqual([...ov[0].ids].sort(), ['a', 'b']);
});

// ---- (d) estimated --------------------------------------------------------------------------
test("a set with an estimated ('≈') footprint is flagged (info)", () => {
  const r = checkCity([plate('bp', 0, 0, 32, 32), building('b', 4, 4, 16, 16, { approx: true })]);
  const est = r.issues.filter((i) => i.type === 'estimated');
  assert.equal(est.length, 1);
  assert.equal(est[0].severity, 'info');
  assert.deepEqual(est[0].ids, ['b']);
});

// ---- (e) track gaps -------------------------------------------------------------------------
test('a 2-stud track gap surfaces as ONE track-gap issue naming both pieces', () => {
  const bp = plate('bp', 0, 0, 64, 32);
  const r = checkCity([bp, track('a', 0, 0), track('b', 18, 0)]); // a.R at x16 vs b.L at x18
  const gaps = r.issues.filter((i) => i.type === 'track-gap');
  assert.equal(gaps.length, 1, 'the reciprocal gap ports collapse into one issue');
  assert.equal(gaps[0].severity, 'warn');
  assert.deepEqual([...gaps[0].ids].sort(), ['a', 'b']);
  assert.match(gaps[0].message, /don't quite meet/);
});

// ---- all-clear ------------------------------------------------------------------------------
test('a clean, fully-supported city is All clear (ok:true, no issues)', () => {
  const r = checkCity([
    plate('bp', 0, 0, 64, 64),
    building('b', 8, 8),
    track('t', 32, 40, 0, 'Track — Straight'),
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.counts, { error: 0, warn: 0, info: 0 });
});

test('an empty city (or non-array) is trivially clear', () => {
  assert.equal(checkCity([]).ok, true);
  assert.equal(checkCity(undefined).ok, true);
});

// ---- no baseplates at all -------------------------------------------------------------------
test('pieces with no baseplate anywhere collapse into ONE add-a-baseplate issue', () => {
  const r = checkCity([building('a', 0, 0), building('b', 40, 0)]);
  const f = r.issues.filter((i) => i.type === 'floating');
  assert.equal(f.length, 1, 'one aggregate issue, not one per piece');
  assert.deepEqual([...f[0].ids].sort(), ['a', 'b']);
  assert.match(f[0].message, /baseplate/);
});

// ---- ordering + counts ----------------------------------------------------------------------
test('issues are sorted errors → warnings → info, with per-severity counts', () => {
  const r = checkCity([
    plate('bp', 0, 0, 64, 64),
    building('a', 0, 0),                       // clean
    building('b', 8, 8),                       // overlaps a (error)
    building('e', 40, 40, 16, 16, { approx: true }), // estimated (info)
    building('o', 56, 20),                     // overhang (warn)
  ]);
  const ranks = { error: 0, warn: 1, info: 2 };
  const seq = r.issues.map((i) => ranks[i.severity]);
  assert.deepEqual(seq, [...seq].sort((x, y) => x - y), 'non-decreasing severity rank');
  assert.equal(r.counts.error >= 1, true);
  assert.equal(r.counts.warn >= 1, true);
  assert.equal(r.counts.info >= 1, true);
  assert.equal(r.ok, false);
});

// ---- non-physical objects never need support ------------------------------------------------
test('terrain paint and sticky notes are never reported as floating', () => {
  const r = checkCity([
    plate('bp', 0, 0, 32, 32),
    { id: 'g', x: 100, y: 100, w: 16, h: 16, rot: 0, kind: 'terrain', category: 'terrain', name: 'Grass', layer: -1, approx: false },
    { id: 'n', x: 100, y: 100, w: 26, h: 16, rot: 0, kind: 'note', category: 'note', name: 'Note', layer: 3, approx: false },
  ]);
  assert.deepEqual(r.issues, [], 'landscaping + annotation off the plate are fine');
});
