import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../tools/lib/csv.mjs';

test('parses simple rows to objects', () => {
  const rows = parseCsv('id,name\n1,Alpha\n2,Beta\n');
  assert.deepEqual(rows, [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }]);
});

test('handles quoted field with comma and escaped quote', () => {
  const rows = parseCsv('id,name\n1,"Smith, ""Bob"""\n');
  assert.equal(rows[0].name, 'Smith, "Bob"');
});

test('ignores trailing empty line and \\r', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});
