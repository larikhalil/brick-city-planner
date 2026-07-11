import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor } from '../tools/lib/category.mjs';

test('explicit map override wins', () => {
  assert.equal(categoryFor('Fire', 'City', { fire: 'fire' }), 'fire');
});
test('heuristics by keyword', () => {
  assert.equal(categoryFor('Police', 'City', {}), 'police');
  assert.equal(categoryFor('Cargo Train', 'City', {}), 'train');
  assert.equal(categoryFor('Arctic', 'City', {}), 'arctic');
});
test('modular root fallback', () => {
  assert.equal(categoryFor('Assembly Square', 'Modular', {}), 'modular');
});
test('unknown falls back to city', () => {
  assert.equal(categoryFor('Whatever', 'Town', {}), 'city');
});
