// MOTION-4: unit tests for the non-rectangular footprint outlines (corner/L-shaped modulars).
// Assert the pure outline geometry + its clip-path serialisation; the rectangular path stays null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlinePoints, outlineClipPath, OUTLINE_OVERRIDES } from '../js/footprint-shapes.js';

// Shoelace area of a normalised polygon (fraction of the unit box it covers).
function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

test('rectangular sets (and unknowns) have no outline override', () => {
  assert.equal(outlinePoints('10182'), null); // Cafe Corner — a plain 32×32 rectangle
  assert.equal(outlinePoints('99999'), null); // unknown set
  assert.equal(outlineClipPath('10182'), '');
  assert.equal(outlineClipPath('99999'), '');
});

test('known corner sets return a valid, non-degenerate cut polygon', () => {
  for (const num of Object.keys(OUTLINE_OVERRIDES)) {
    const pts = outlinePoints(num);
    assert.ok(Array.isArray(pts) && pts.length >= 3, `${num} has a real polygon`);
    for (const [x, y] of pts) {
      assert.ok(x >= 0 && x <= 1, `${num} x within the box`);
      assert.ok(y >= 0 && y <= 1, `${num} y within the box`);
    }
    // A corner/L outline must actually remove area from the bounding box (0 < area < full box).
    const a = area(pts);
    assert.ok(a > 0 && a < 1, `${num} clips part of the bounding box (area ${a})`);
  }
});

test('the "-1" variant suffix resolves to the same outline as the bare number', () => {
  assert.deepEqual(outlinePoints('10255-1'), outlinePoints('10255'));
  assert.equal(outlineClipPath('10255-1'), outlineClipPath('10255'));
  assert.notEqual(outlineClipPath('10255'), '');
});

test('outlineClipPath serialises to a percent polygon() clip', () => {
  const clip = outlineClipPath('10255');
  assert.match(clip, /^polygon\(/);
  assert.match(clip, /%/);
  // One coordinate pair per polygon point.
  const pairs = clip.slice('polygon('.length, -1).split(',');
  assert.equal(pairs.length, outlinePoints('10255').length);
  // Every emitted percentage is a finite number in 0..100.
  for (const p of pairs) {
    for (const n of p.trim().split(/\s+/)) {
      const v = parseFloat(n);
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 100, `percent ${n} in range`);
    }
  }
});

test('the chamfered corner-cut and the L are distinct shapes', () => {
  assert.notDeepEqual(outlinePoints('10255'), outlinePoints('10264')); // corner-cut vs L
});
