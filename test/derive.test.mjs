// Round-1 feedback (item 4): inventory-derived footprints — signals + derivation, all pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSignal, emptySignal, joinPlates, deriveFootprint, plateFloor } from '../tools/lib/derive.mjs';

const sig = (rows) => {
  const s = emptySignal();
  for (const r of rows) collectSignal(s, r);
  return s;
};

test('collectSignal sorts parts into the right buckets', () => {
  const s = sig([
    { partNum: '3811', partName: 'Baseplate 32 x 32', partCatId: '1', quantity: '1' },
    { partNum: '3867', partName: 'Baseplate 16 x 32', partCatId: '1', quantity: '1' },
    { partNum: '69958', partName: 'Plate Special 16 x 16 x 2/3 with Eight Recessed Edges', partCatId: '9', quantity: '2' },
    { partNum: '92088', partName: 'Train Base 6 x 28', partCatId: '39', quantity: '1' },
    { partNum: '52036', partName: 'Vehicle Base 4 x 12 x 1 1/3', partCatId: '36', quantity: '2' },
    { partNum: '91405', partName: 'Plate 16 x 16', partCatId: '14', quantity: '1' },
    { partNum: '3020', partName: 'Plate 2 x 4', partCatId: '14', quantity: '10' }, // too small — ignored
    { partNum: 'dup1', partName: 'Duplo Train Base 4 x 8 with Wheels', partCatId: '4', quantity: '1' }, // Duplo — ignored
  ]);
  assert.deepEqual(s.baseplates, [[32, 32, 1], [16, 32, 1]]);
  assert.equal(s.roadPlates, 2);
  assert.deepEqual(s.trainBases, [[6, 28, 1]]);
  assert.deepEqual(s.vehicleBases, [[4, 12, 2]]);
  assert.deepEqual(s.largePlates, [[16, 16, 1]]);
});

test('joinPlates: single, side-by-side, stacked and mixed', () => {
  assert.deepEqual(joinPlates([[32, 32, 1]]), { w: 32, h: 32 });
  // Assembly Square: 32x32 + 16x32 share the 32 edge → 48x32
  assert.deepEqual(joinPlates([[32, 32, 1], [16, 32, 1]]), { w: 48, h: 32 });
  // two 32x32 → 64x32
  assert.deepEqual(joinPlates([[32, 32, 2]]), { w: 64, h: 32 });
  assert.equal(joinPlates([]), null);
});

test('deriveFootprint: baseplates beat everything; road plates tile; bases bound vehicles', () => {
  const bp = sig([{ partNum: '3811', partName: 'Baseplate 32 x 32', partCatId: '1', quantity: '1' }]);
  assert.deepEqual(deriveFootprint(bp, { kind: 'building' }), { w: 32, h: 32 });
  const road = sig([{ partNum: '69958', partName: 'Plate Special 16 x 16 x 2/3 with Eight Recessed Edges', partCatId: '9', quantity: '2' }]);
  assert.deepEqual(deriveFootprint(road, { kind: 'building' }), { w: 32, h: 16 });
  const train = sig([{ partNum: '92088', partName: 'Train Base 6 x 28', partCatId: '39', quantity: '2' }]);
  assert.deepEqual(deriveFootprint(train, { kind: 'vehicle' }), { w: 64, h: 6 }); // 2 × (28+4) long, 6 wide
  const car = sig([{ partNum: '52036', partName: 'Vehicle Base 4 x 12 x 1 1/3', partCatId: '36', quantity: '1' }]);
  assert.deepEqual(deriveFootprint(car, { kind: 'vehicle' }), { w: 16, h: 6 }); // 12+4 long, 4+2 wide
  assert.equal(deriveFootprint(emptySignal(), { kind: 'building' }), null);
  assert.equal(deriveFootprint(null), null);
});

test('plateFloor: the largest plate is a floor minimum, never a full print', () => {
  const s = sig([
    { partNum: '91405', partName: 'Plate 16 x 16', partCatId: '14', quantity: '3' },
    { partNum: '3958', partName: 'Plate 8 x 16', partCatId: '14', quantity: '1' },
  ]);
  assert.deepEqual(plateFloor(s), { w: 16, h: 16 });
  assert.equal(plateFloor(emptySignal()), null);
});
