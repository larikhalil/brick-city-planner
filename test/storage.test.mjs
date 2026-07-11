import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeCity, validateCity, exportCityJson, importCityJson,
  saveCity, loadCity, currentCityName,
} from '../js/storage.js';

// in-memory localStorage mock
globalThis.localStorage = (() => {
  let m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
           removeItem: (k) => { delete m[k]; }, clear: () => { m = {}; } };
})();

const placed = [{ id: 'p1', set_num: '10255-1', x: 0, y: 0, w: 48, h: 32, rot: 0 }];

test('serialize stamps app + version', () => {
  const c = serializeCity({ name: 'T', units: 'studs', placed });
  assert.equal(c.app, 'brick-city-planner');
  assert.equal(c.version, 1);
  assert.deepEqual(c.placed, placed);
});
test('validate rejects foreign / malformed', () => {
  assert.equal(validateCity({ app: 'other' }).ok, false);
  assert.equal(validateCity({ app: 'brick-city-planner', version: 2 }).ok, false);
  assert.equal(validateCity({ app: 'brick-city-planner', version: 1, placed: [{}] }).ok, false);
});
test('export → import round-trips', () => {
  const c = serializeCity({ name: 'T', placed });
  const back = importCityJson(exportCityJson(c));
  assert.equal(back.ok, true);
  assert.deepEqual(back.city.placed, placed);
});
test('import rejects non-JSON', () => {
  assert.equal(importCityJson('{nope').ok, false);
});
test('grid size round-trips when present, is omitted when absent', () => {
  assert.equal('grid' in serializeCity({ name: 'T', placed }), false);
  const c = serializeCity({ name: 'T', placed, grid: { w: 256, h: 192 } });
  const back = importCityJson(exportCityJson(c));
  assert.deepEqual(back.city.grid, { w: 256, h: 192 });
});
test('save then load via localStorage', () => {
  saveCity(serializeCity({ name: 'Town A', placed }));
  assert.equal(currentCityName(), 'Town A');
  assert.deepEqual(loadCity('Town A').placed, placed);
});
