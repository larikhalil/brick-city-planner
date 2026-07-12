// Round-1 feedback (items 2a/2b): retired resolution — curated lists first, then the year rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveRetired, indexAvailability } from '../tools/lib/availability.mjs';

const avail = indexAvailability({
  availableFromYear: 2025,
  available: ['60304', '10326'],
  retired: ['60365'],
});

test('curated lists beat the year rule in both directions', () => {
  assert.equal(resolveRetired('60304', 2021, avail), false, 'evergreen road plates stay available');
  assert.equal(resolveRetired('10326', 2024, avail), false, 'confirmed-available modular');
  assert.equal(resolveRetired('60365', 2023, avail), true, 'confirmed retired');
});

test('the year rule covers everything unlisted', () => {
  assert.equal(resolveRetired('60500', 2026, avail), false);
  assert.equal(resolveRetired('60419', 2025, avail), false);
  assert.equal(resolveRetired('60316', 2022, avail), true);
  assert.equal(resolveRetired('6390', 1980, avail), true);
});

test('the shipped tools/availability.json is well-formed and self-consistent', () => {
  const shipped = JSON.parse(readFileSync(new URL('../tools/availability.json', import.meta.url), 'utf8'));
  assert.ok(Number.isInteger(shipped.availableFromYear));
  assert.ok(Array.isArray(shipped.available) && shipped.available.length > 0);
  assert.ok(Array.isArray(shipped.retired) && shipped.retired.length > 0);
  const overlap = shipped.available.filter((n) => shipped.retired.includes(n));
  assert.deepEqual(overlap, [], 'a set can not be both available and retired');
});
