import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIncludedThemeIds } from '../tools/lib/themes.mjs';

const rows = [
  { id: '52', name: 'City', parent_id: '' },
  { id: '61', name: 'Police', parent_id: '52' },
  { id: '999', name: 'Sub-Police', parent_id: '61' },   // 2 levels deep
  { id: '158', name: 'Star Wars', parent_id: '' },
];

test('collects root + all descendants, excludes others', () => {
  const ids = buildIncludedThemeIds(rows, [52]);
  assert.ok(ids.has(52) && ids.has(61) && ids.has(999));
  assert.ok(!ids.has(158));
});

test('handles multiple roots', () => {
  const ids = buildIncludedThemeIds(rows, [52, 158]);
  assert.equal(ids.size, 4);
});
