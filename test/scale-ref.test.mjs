// PLAN-8: realistic scale-reference overlay — tick/label maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickLabel, rulerTicks, rulerSpanStuds, RULER_TICKS, SCALE_REFS, scaleRefSVG } from '../js/scale-ref.js';
import { studsToCm } from '../js/units.js';

test('ruler ticks are the human-meaningful 10 / 50 / 100 studs', () => {
  assert.deepEqual(RULER_TICKS, [10, 50, 100]);
  assert.equal(rulerSpanStuds(), 100);
});

test('tickLabel respects the unit toggle', () => {
  assert.equal(tickLabel(10, 'studs'), '10 studs');
  assert.equal(tickLabel(50, 'studs'), '50 studs');
  assert.equal(tickLabel(100, 'studs'), '100 studs');
  // cm reuses the shared stud→cm rounding: 10→8, 50→40, 100→80.
  assert.equal(tickLabel(10, 'cm'), '8 cm');
  assert.equal(tickLabel(50, 'cm'), '40 cm');
  assert.equal(tickLabel(100, 'cm'), '80 cm');
  assert.equal(tickLabel(10, 'cm'), `${studsToCm(10)} cm`);
});

test('tickLabel defaults to studs', () => {
  assert.equal(tickLabel(50), '50 studs');
});

test('rulerTicks maps stud counts to pixel offsets + labels', () => {
  const ticks = rulerTicks('studs', 6);
  assert.equal(ticks.length, 3);
  assert.deepEqual(ticks.map((t) => t.studs), [10, 50, 100]);
  assert.deepEqual(ticks.map((t) => t.x), [60, 300, 600]); // studs × 6px
  assert.deepEqual(ticks.map((t) => t.label), ['10 studs', '50 studs', '100 studs']);
});

test('rulerTicks scales pixel offsets with pxPerStud', () => {
  assert.deepEqual(rulerTicks('studs', 10).map((t) => t.x), [100, 500, 1000]);
  assert.deepEqual(rulerTicks('cm', 6).map((t) => t.label), ['8 cm', '40 cm', '80 cm']);
});

test('rulerTicks defaults to PX=6 pixels per stud', () => {
  assert.deepEqual(rulerTicks('studs').map((t) => t.x), [60, 300, 600]);
});

test('SCALE_REFS carry a minifig, a car and a door with stud footprints', () => {
  const keys = SCALE_REFS.map((r) => r.key);
  assert.deepEqual(keys, ['minifig', 'car', 'door']);
  for (const r of SCALE_REFS) {
    assert.ok(r.w > 0 && r.h > 0, `${r.key} has a positive footprint`);
    assert.equal(typeof r.label, 'string');
  }
  // the car is the biggest footprint (human gut-check anchor)
  const car = SCALE_REFS.find((r) => r.key === 'car');
  assert.ok(car.w >= 4 && car.h >= 8);
});

test('scaleRefSVG emits a sized, non-interactive svg carrying every tick label + silhouette label', () => {
  const svg = scaleRefSVG({ gridW: 128, gridH: 96, unit: 'studs', px: 6 });
  assert.match(svg, /^<svg class="scale-ref-overlay"/);
  assert.match(svg, /width="768"/); // 128 studs × 6px
  assert.match(svg, /height="576"/); // 96 studs × 6px
  assert.match(svg, /aria-hidden="true"/);
  for (const s of [10, 50, 100]) assert.ok(svg.includes(`${s} studs`), `has ${s} studs label`);
  for (const r of SCALE_REFS) assert.ok(svg.includes(`>${r.label}</text>`), `has ${r.label} label`);
});

test('scaleRefSVG switches ruler labels to cm with the unit', () => {
  const svg = scaleRefSVG({ gridW: 128, gridH: 96, unit: 'cm', px: 6 });
  assert.ok(svg.includes('80 cm'));
  assert.ok(!svg.includes('100 studs'));
});
