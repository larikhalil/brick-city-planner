// Round-1 feedback (items 3a/3b): pack contents + placeable element records, all pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partPlan, suppliesFor, elementSetNum, buildPack, elementRecords } from '../tools/lib/packs.mjs';
import { baseNum } from '../js/pricing.js';

test('partPlan reads NxM plan sizes and defaults props to 1x1', () => {
  assert.deepEqual(partPlan('Plant Plate 1 x 1 with 3 Leaves'), { w: 1, h: 1 });
  assert.deepEqual(partPlan('Fence 1 x 4 x 2 [4 Posts]'), { w: 1, h: 4 });
  assert.deepEqual(partPlan('Dish 2 x 2 Inverted [Radar]'), { w: 2, h: 2 });
  assert.deepEqual(partPlan('Banana'), { w: 1, h: 1 });
  assert.deepEqual(partPlan('Plate Special 16 x 16 x 2/3 with Eight Recessed Edges', '69958'), { w: 16, h: 16 });
  assert.deepEqual(partPlan('Baseplate Road 32 x 32 7-Stud Straight'), { w: 32, h: 32 });
});

test('suppliesFor maps track/road pack parts onto the generic placeable pieces', () => {
  assert.deepEqual(suppliesFor('Train Track Straight'), ['piece-track-straight']);
  assert.deepEqual(suppliesFor('Train Track Curved'), ['piece-track-curve-left', 'piece-track-curve-right']);
  assert.deepEqual(suppliesFor('Train Track Switch Point Left'), ['piece-track-switch-left']);
  assert.deepEqual(suppliesFor('Baseplate Road 32 x 32 7-Stud T-Junction'), ['piece-road-tjunction']);
  assert.equal(suppliesFor('Plant Plate 1 x 1 with 3 Leaves'), null);
});

test('element set numbers survive baseNum grouping intact', () => {
  const sn = elementSetNum('40310', '6182261');
  assert.equal(sn, 'piece-el:40310:6182261');
  assert.equal(baseNum(sn), sn, 'baseNum must not truncate the element id');
  assert.ok(sn.startsWith('piece-'), 'keeps the generic-piece export guards');
});

const packRecord = { num: '40310', set_num: '40310-1', name: 'xtra Botanical Accessories', year: 2018, retired: true, img: 'img/sets/40310-1.jpg' };
const rows = [
  { partNum: '32607', partName: 'Plant Plate 1 x 1 with 3 Leaves', partCatId: '14', colorId: '10', colorName: 'Bright Green', colorRgb: '4B9F4A', quantity: '3', isSpare: false, imgUrl: 'https://x/32607.jpg', element: '6182261' },
  { partNum: '32607', partName: 'Plant Plate 1 x 1 with 3 Leaves', partCatId: '14', colorId: '10', colorName: 'Bright Green', colorRgb: '4B9F4A', quantity: '1', isSpare: true, imgUrl: null, element: '6182261' }, // spare — excluded
  { partNum: '33303', partName: 'Fence 1 x 4 x 2 [4 Posts]', partCatId: '32', colorId: '15', colorName: 'White', colorRgb: 'FFFFFF', quantity: '2', isSpare: false, imgUrl: null, element: '4111963' },
  { partNum: '53401', partName: 'Train Track Straight', partCatId: '24', colorId: '72', colorName: 'Dark Bluish Gray', colorRgb: '6C6E68', quantity: '4', isSpare: false, imgUrl: null, element: '4585724' },
];

test('buildPack merges rows, drops spares and carries supplies mappings', () => {
  const pack = buildPack(packRecord, rows);
  assert.equal(pack.num, '40310');
  assert.equal(pack.retired, true);
  assert.equal(pack.contents.length, 3);
  const plant = pack.contents.find((c) => c.part === '32607');
  assert.equal(plant.qty, 3, 'spare copy excluded from designed contents');
  assert.equal(plant.element, '6182261');
  assert.equal(plant.color, 'Bright Green');
  assert.deepEqual([plant.w, plant.h], [1, 1]);
  const track = pack.contents.find((c) => c.part === '53401');
  assert.deepEqual(track.supplies, ['piece-track-straight']);
});

test('elementRecords: one placeable decor record per non-track piece', () => {
  const pack = buildPack(packRecord, rows);
  const recs = elementRecords(pack);
  assert.equal(recs.length, 2, 'track part is supplied by the existing generic piece, not duplicated');
  const plant = recs.find((r) => r.num === '6182261');
  assert.equal(plant.set_num, 'piece-el:40310:6182261');
  assert.equal(plant.kind, 'decor');
  assert.equal(plant.layer, 2);
  assert.equal(plant.category, 'pack');
  assert.equal(plant.retired, true);
  assert.equal(plant.pack, '40310');
  assert.deepEqual(plant.footprint, { w: 1, h: 1, source: 'curated' });
  assert.match(plant.name, /Bright Green/);
});

test('a 16x16 road-plate element places as real road (ground)', () => {
  const roadRows = [{ partNum: '69958', partName: 'Plate Special 16 x 16 x 2/3 with Eight Recessed Edges', partCatId: '9', colorId: '72', colorName: 'Dark Bluish Gray', colorRgb: '6C6E68', quantity: '4', isSpare: false, imgUrl: null, element: '6337029' }];
  const pack = buildPack({ num: '60304', set_num: '60304-1', name: 'Road Plates', year: 2021, retired: false }, roadRows);
  const [rec] = elementRecords(pack);
  assert.equal(rec.kind, 'road');
  assert.equal(rec.layer, 1);
  assert.equal(rec.category, 'road');
  assert.deepEqual(rec.footprint, { w: 16, h: 16, source: 'curated' });
});
