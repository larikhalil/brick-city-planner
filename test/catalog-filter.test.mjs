// Round-1 feedback 2b: the pure catalog filter predicate (Legacy gate + decor scoping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter } from '../js/catalog.js';

const set = (o) => ({ name: 'Police Station', num: '60316', category: 'police', kind: 'building', ...o });

test('legacy off hides retired sets; legacy on shows them', () => {
  assert.equal(matchesFilter(set({ retired: true }), { legacy: false }), false);
  assert.equal(matchesFilter(set({ retired: true }), { legacy: true }), true);
  assert.equal(matchesFilter(set({ retired: false }), { legacy: false }), true);
  assert.equal(matchesFilter(set({}), { legacy: false }), true, 'records without the flag (pieces.json) always pass');
});

test('filters compose: category and search still apply', () => {
  assert.equal(matchesFilter(set({}), { category: 'fire' }), false);
  assert.equal(matchesFilter(set({}), { category: 'police' }), true);
  assert.equal(matchesFilter(set({}), { text: 'police' }), true);
  assert.equal(matchesFilter(set({}), { text: '60316' }), true);
  assert.equal(matchesFilter(set({}), { text: 'hospital' }), false);
});

test('pack elements (decor) hide from browse-All but stay searchable + on their chip', () => {
  const plant = set({ name: 'Plant Plate (Bright Green)', num: '6182261', category: 'pack', kind: 'decor', retired: true });
  assert.equal(matchesFilter(plant, { legacy: true }), false, 'not in the browse-All flood');
  assert.equal(matchesFilter(plant, { legacy: true, category: 'pack' }), true, 'Packs chip shows them');
  assert.equal(matchesFilter(plant, { legacy: true, text: 'plant' }), true, 'search finds them');
});
