import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeCity, validateCity, exportCityJson, importCityJson,
  saveCity, loadCity, currentCityName, renameCity, loadCities, deleteCity,
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
test('renameCity moves the slot and follows the "current" pointer when it pointed there', () => {
  saveCity(serializeCity({ name: 'Old Name', placed })); // also sets current -> 'Old Name'
  assert.equal(renameCity('Old Name', 'New Name'), true);
  assert.equal(loadCity('Old Name'), null);
  assert.equal(loadCity('New Name').name, 'New Name');
  assert.equal(currentCityName(), 'New Name');
});
test('renameCity leaves the "current" pointer alone when renaming a DIFFERENT saved city', () => {
  saveCity(serializeCity({ name: 'Active City', placed })); // current -> 'Active City'
  saveCity(serializeCity({ name: 'Side City', placed }));   // current -> 'Side City' (bumped)
  saveCity(serializeCity({ name: 'Active City', placed })); // re-save so current -> 'Active City' again
  assert.equal(renameCity('Side City', 'Side City Renamed'), true);
  assert.equal(currentCityName(), 'Active City'); // untouched
  assert.equal(loadCity('Side City Renamed').name, 'Side City Renamed');
  deleteCity('Active City'); deleteCity('Side City Renamed'); // tidy up for later tests
});
test('renameCity is a no-op (false) for an unknown source name', () => {
  assert.equal(renameCity('Does Not Exist', 'Whatever'), false);
});
test('renameCity is a no-op (false) when old and new names are identical', () => {
  saveCity(serializeCity({ name: 'Same Name', placed }));
  assert.equal(renameCity('Same Name', 'Same Name'), false);
  deleteCity('Same Name');
});
test('deleteCity removes a saved slot', () => {
  saveCity(serializeCity({ name: 'Temp City', placed }));
  assert.notEqual(loadCity('Temp City'), null);
  deleteCity('Temp City');
  assert.equal(loadCity('Temp City'), null);
});
test('loadCities returns every saved slot keyed by name', () => {
  saveCity(serializeCity({ name: 'Multi A', placed }));
  saveCity(serializeCity({ name: 'Multi B', placed }));
  const all = loadCities();
  assert.ok('Multi A' in all && 'Multi B' in all);
  deleteCity('Multi A'); deleteCity('Multi B');
});
