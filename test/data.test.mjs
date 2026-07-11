import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexByNum } from '../js/data.js';

test('indexes by set_num', () => {
  const m = indexByNum([{ set_num: 'a-1' }, { set_num: 'b-1' }]);
  assert.equal(m.get('b-1').set_num, 'b-1');
  assert.equal(m.size, 2);
});
