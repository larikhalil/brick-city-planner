import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSetRecord } from '../tools/record.mjs';

test('builds a normalized catalog record', () => {
  const raw = { set_num: '60316-1', name: 'Police Station', year: '2022',
                theme_id: '61', num_parts: '668', img_url: 'https://x/y.jpg' };
  const rec = buildSetRecord(raw, {
    themeName: 'Police', root: 'City', category: 'police',
    footprint: { w: 48, h: 32, source: 'curated' }, img: 'img/sets/60316-1.jpg',
  });
  assert.deepEqual(rec, {
    set_num: '60316-1', num: '60316', name: 'Police Station', year: 2022,
    theme_id: 61, theme: 'Police', root: 'City', category: 'police',
    pieces: 668, img: 'img/sets/60316-1.jpg',
    footprint: { w: 48, h: 32, source: 'curated' },
    retired: false,
  });
});

test('retired flag passes through (and defaults false when absent)', () => {
  const raw = { set_num: '60097-1', name: 'City Square', year: '2015', theme_id: '52', num_parts: '1683', img_url: '' };
  const ctx = { themeName: 'City', root: 'City', category: 'city', footprint: { w: 48, h: 32, source: 'curated' }, img: null };
  assert.equal(buildSetRecord(raw, { ...ctx, retired: true }).retired, true);
  assert.equal(buildSetRecord(raw, ctx).retired, false);
});

test('null image is preserved', () => {
  const rec = buildSetRecord(
    { set_num: '1-1', name: 'X', year: '2000', theme_id: '52', num_parts: '10', img_url: '' },
    { themeName: 'City', root: 'City', category: 'city', footprint: { w: 8, h: 8, source: 'estimated' }, img: null });
  assert.equal(rec.img, null);
});
