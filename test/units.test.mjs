import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studsToCm, fmtDims, fmtArea, BASEPLATE } from '../js/units.js';

test('stud to cm', () => {
  assert.equal(BASEPLATE, 32);
  assert.equal(studsToCm(32), 25.6);
  assert.equal(studsToCm(10), 8);
});
test('format dims', () => {
  assert.equal(fmtDims(48, 32, 'studs'), '48 × 32 studs');
  assert.equal(fmtDims(32, 32, 'cm'), '25.6 × 25.6 cm');
});
test('format area switches to m² when large', () => {
  assert.equal(fmtArea(10, 10, 'studs'), '100 studs²');
  assert.equal(fmtArea(160, 160, 'cm'), '1.64 m²'); // 128×128cm = 16384cm² → 1.64 m²
});
