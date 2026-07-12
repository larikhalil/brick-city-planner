import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushRecent } from '../js/lists.js';

test('pushRecent moves an existing id to the front', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
});

test('pushRecent adds a new id to the front', () => {
  assert.deepEqual(pushRecent(['a', 'b'], 'c'), ['c', 'a', 'b']);
});

test('pushRecent caps at the default max of 8', () => {
  const arr = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const next = pushRecent(arr, '9');
  assert.deepEqual(next, ['9', '1', '2', '3', '4', '5', '6', '7']);
  assert.equal(next.length, 8);
});

test('pushRecent respects a custom max', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 2), ['d', 'a']);
});

test('pushRecent never mutates the input array', () => {
  const arr = ['a', 'b'];
  pushRecent(arr, 'c');
  assert.deepEqual(arr, ['a', 'b']);
});

test('pushRecent re-adding the most-recent id is a no-op reorder', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'a'), ['a', 'b', 'c']);
});
