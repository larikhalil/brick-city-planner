// Unit tests for the pure schematicSVG() art generator (MOTION-2 styled roads/tracks + kinds).
// These assert structure/variant detection + port invariants, not exact pixel strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schematicSVG } from '../js/schematic.js';

const sq = { w: 8, h: 8 };       // square footprint (wide === true, w >= h)
const tall = { w: 4, h: 8 };     // portrait footprint (wide === false)

test('unknown / baseplate / generic kinds render nothing', () => {
  assert.equal(schematicSVG('baseplate', sq, 'x'), '');
  assert.equal(schematicSVG('generic', sq, 'x'), '');
  assert.equal(schematicSVG('nope', sq, 'x'), '');
});

test('every drawn kind is wrapped in a non-scaling <svg class="schem">', () => {
  for (const k of ['road', 'track', 'building', 'park', 'vehicle']) {
    const s = schematicSVG(k, sq, k);
    assert.match(s, /^<svg class="schem"/, `${k} wraps in schem svg`);
    assert.match(s, /preserveAspectRatio="none"/);
    assert.match(s, /aria-hidden="true"/);
    assert.ok(s.endsWith('</svg>'));
  }
});

test('road straight: asphalt gradient + sidewalks + dashed centre lane on the 50-line', () => {
  const s = schematicSVG('road', tall, 'Road Plate Straight');
  assert.match(s, /<linearGradient/, 'has an asphalt gradient');
  assert.match(s, /fill="url\(#g\d+\)"/, 'asphalt filled from the gradient');
  assert.match(s, /stroke-dasharray="10 8"/, 'dashed lane markings');
  assert.match(s, /x1="50" y1="0" x2="50" y2="100"/, 'centre lane sits on the 50-line (port unchanged)');
  assert.match(s, /fill="#aeb3ba"/, 'has grey sidewalk strips');
});

test('road variants are detected from the name', () => {
  // curve → arc paths (has an "A" arc command in a path), no straight centre line
  const curve = schematicSVG('road', sq, 'Road Curve');
  assert.match(curve, /<path d="M50 100 A50 50/, 'curve draws the r=50 centre-lane arc');
  // T-junction → a spur, i.e. two dashed lane segments (through + spur)
  const tee = schematicSVG('road', sq, 'T-Junction Road');
  assert.equal((tee.match(/stroke-dasharray/g) || []).length >= 2, true, 'tee has through + spur lane dashes');
  // crossroad → dashes on both the horizontal and vertical centre lines
  const cross = schematicSVG('road', sq, 'Crossroad');
  assert.match(cross, /x1="0" y1="50" x2="100" y2="50"/);
  assert.match(cross, /x1="50" y1="0" x2="50" y2="100"/);
});

test('road curve mirrors left vs right', () => {
  const right = schematicSVG('road', sq, 'Road Curve');
  const left = schematicSVG('road', sq, 'Road Curve Left');
  assert.notEqual(right, left);
  assert.match(left, /A50 50 0 0 0 0 50/, 'left curve sweeps the other way to the left edge');
  assert.match(right, /A50 50 0 0 1 100 50/, 'right curve sweeps to the right edge');
});

test('track straight: ballast + wood ties + two rails on the 33/63 lines (ports unchanged)', () => {
  const s = schematicSVG('track', tall, 'Train Track Straight');
  assert.match(s, /<linearGradient/, 'ballast gradient');
  assert.match(s, /fill="#6d5a45"/, 'wood sleepers');
  assert.match(s, /x="33"/, 'left rail on the 33-line');
  assert.match(s, /x="63"/, 'right rail on the 63-line');
  assert.match(s, /fill="#33333a"/, 'steel rail colour');
  assert.match(s, /fill="#7c7c86"/, 'rail highlight for depth');
});

test('track variants: curve / cross / switch each detected and distinct', () => {
  const straight = schematicSVG('track', sq, 'Track Straight');
  const curve = schematicSVG('track', sq, 'Track Curve');
  const cross = schematicSVG('track', sq, 'Track Crossing');
  const sw = schematicSVG('track', sq, 'Track Switch Left');
  assert.notEqual(curve, straight);
  assert.match(curve, /A62 62/, 'curve draws the outer rail arc');
  assert.match(cross, /rotate\(45 50 50\)/, 'crossing has a 45° frog');
  assert.match(cross, /y="33"/, 'crossing has rails in both directions');
  assert.match(sw, /Q8 56 0 86|Q92 56 100 86/, 'switch draws a diverging branch rail');
});

test('gradient ids are unique per call (no duplicate-id clashes across tiles)', () => {
  const a = schematicSVG('road', sq, 'Road');
  const b = schematicSVG('road', sq, 'Road');
  const idA = a.match(/id="(g\d+)"/)[1];
  const idB = b.match(/id="(g\d+)"/)[1];
  assert.notEqual(idA, idB);
});
