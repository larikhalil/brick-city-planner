import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateFootprint, resolveFootprint } from '../tools/lib/footprint.mjs';

test('estimate buckets by piece count', () => {
  assert.deepEqual(estimateFootprint({ num_parts: 40, category: 'city' }), { w: 8, h: 8 });
  assert.deepEqual(estimateFootprint({ num_parts: 300, category: 'city' }), { w: 16, h: 16 });
  assert.deepEqual(estimateFootprint({ num_parts: 5000, category: 'city' }), { w: 48, h: 32 });
});

test('train override is long and thin', () => {
  const fp = estimateFootprint({ num_parts: 900, category: 'train' });
  assert.equal(fp.h, 8);
  assert.ok(fp.w >= 24);
});

test('curated wins and is marked curated', () => {
  const fp = resolveFootprint({ num: '10255', num_parts: 4002, category: 'modular' },
                              { '10255': { w: 48, h: 32 } });
  assert.deepEqual(fp, { w: 48, h: 32, source: 'curated' });
});

test('falls back to estimated', () => {
  const fp = resolveFootprint({ num: '99999', num_parts: 300, category: 'city' }, {});
  assert.deepEqual(fp, { w: 16, h: 16, source: 'estimated' });
});
