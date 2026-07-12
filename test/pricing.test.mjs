import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseNum, resolvePrice, cityCost, buyLinks, bricklinkXml, setListCsv, PIECE_PRICE,
} from '../js/pricing.js';

test('baseNum strips the -N variant suffix', () => {
  assert.equal(baseNum('60316-1'), '60316');
  assert.equal(baseNum('6614213-1'), '6614213');
  assert.equal(baseNum('piece-road-straight'), 'piece-road-straight');
});

test('resolvePrice: override > msrp > estimate', () => {
  const prices = { 60316: 59.99 };
  assert.deepEqual(resolvePrice('60316-1', { prices }), { price: 59.99, source: 'msrp' });
  assert.deepEqual(resolvePrice('60316-1', { prices, overrides: { 60316: 50 } }), { price: 50, source: 'override' });
  assert.deepEqual(resolvePrice('99999-1', { prices }), { price: null, source: 'est' });
  // blank / non-numeric override is ignored, falls through to MSRP
  assert.deepEqual(resolvePrice('60316-1', { prices, overrides: { 60316: '' } }), { price: 59.99, source: 'msrp' });
});

const placed = [
  { set_num: '60316-1' }, { set_num: '60316-1' }, // qty 2, real MSRP
  { set_num: '10255-1' },                          // qty 1, real MSRP, owned
  { set_num: '99999-1' },                          // qty 1, no price → estimate
];
const prices = { 60316: 59.99, 10255: 279.99 };
const pieces = { 99999: 100 }; // → estimate 100 * 0.11 = 11

test('cityCost splits owned vs. buy and flags estimates', () => {
  const c = cityCost(placed, { prices, owned: ['10255'], overrides: {}, pieces });
  assert.equal(c.buyCost, 130.98);   // 2×59.99 (119.98) + 11 estimate
  assert.equal(c.ownedCost, 279.99); // 10255 is owned → not counted in buy
  assert.equal(c.total, 410.97);
  assert.equal(c.estimatedCount, 1);
  assert.equal(c.estimatedBuyCount, 1);
  // one line per unique set, sorted by number
  assert.equal(c.lines.length, 3);
  const l60316 = c.lines.find((l) => l.num === '60316');
  assert.equal(l60316.qty, 2);
  assert.equal(l60316.lineTotal, 119.98);
  assert.equal(l60316.source, 'msrp');
  assert.equal(l60316.owned, false);
  const l99999 = c.lines.find((l) => l.num === '99999');
  assert.equal(l99999.estimated, true);
  assert.equal(l99999.unit, Math.round(100 * PIECE_PRICE * 100) / 100);
});

test('cityCost: a manual override beats the real MSRP', () => {
  const c = cityCost(placed, { prices, owned: ['10255'], overrides: { 60316: 50 }, pieces });
  assert.equal(c.buyCost, 111); // 2×50 (100) + 11 estimate
  assert.equal(c.lines.find((l) => l.num === '60316').source, 'override');
});

test('cityCost: nothing owned → ownedCost 0, everything in buy', () => {
  const c = cityCost(placed, { prices, owned: [], pieces });
  assert.equal(c.ownedCost, 0);
  assert.equal(c.buyCost, 410.97);
  assert.equal(c.total, 410.97);
});

test('cityCost: empty city is all zeros', () => {
  const c = cityCost([], { prices });
  assert.deepEqual(
    { ownedCost: c.ownedCost, buyCost: c.buyCost, total: c.total, estimatedCount: c.estimatedCount, lines: c.lines.length },
    { ownedCost: 0, buyCost: 0, total: 0, estimatedCount: 0, lines: 0 });
});

test('buyLinks: real set gets LEGO / BrickLink / Amazon', () => {
  const links = buyLinks('60316-1', 'Police Station');
  assert.deepEqual(links.map((l) => l.label), ['LEGO', 'BrickLink', 'Amazon']);
  assert.match(links[0].href, /lego\.com.*q=60316/);
  assert.match(links[1].href, /bricklink\.com.*S=60316-1/);
  assert.match(links[2].href, /amazon\.com.*k=LEGO%2060316/);
});

test('buyLinks: a generic piece maps to a BrickLink part search', () => {
  const links = buyLinks('piece-road-straight', 'Road — Straight');
  assert.equal(links.length, 1);
  assert.equal(links[0].label, 'BrickLink');
  assert.match(links[0].href, /bricklink\.com\/v2\/search\.page\?q=/);
});

test('bricklinkXml: sets become <ITEM>s, generic pieces are skipped', () => {
  const xml = bricklinkXml([
    { num: '60316', qty: 2 },
    { num: '10255', qty: 1 },
    { num: 'piece-road-straight', qty: 5 },
  ]);
  assert.match(xml, /^<INVENTORY>/);
  assert.match(xml, /<ITEMID>60316-1<\/ITEMID>/);
  assert.match(xml, /<ITEMTYPE>S<\/ITEMTYPE>/);
  assert.match(xml, /<MINQTY>2<\/MINQTY>/);
  assert.ok(!/piece-road/.test(xml), 'generic pieces excluded');
  assert.equal((xml.match(/<ITEM>/g) || []).length, 2);
});

test('setListCsv: header + RFC-4180 quoting, blank price when unknown', () => {
  const csv = setListCsv([
    { num: '60316', name: 'Police, "HQ"', qty: 2, price: 59.99 },
    { num: '99999', name: 'Mystery', qty: 1, price: null },
  ]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'Set number,Name,Qty,Price (USD)');
  assert.equal(lines[1], '60316,"Police, ""HQ""",2,59.99');
  assert.equal(lines[2], '99999,Mystery,1,');
});

// ---- Round-1 feedback 3b: pack rollup (elements + track pieces → whole-pack purchases) ---------
import { packRollup, packSupplyIndex, contentId } from '../js/pricing.js';

const PACKS = {
  '40310': {
    num: '40310', set_num: '40310-1', name: 'xtra Botanical Accessories', retired: true,
    contents: [
      { element: '6182261', part: '32607', name: 'Plant Plate 1 x 1 with 3 Leaves', color: 'Bright Green', qty: 3, w: 1, h: 1 },
      { element: '6206148', part: '24866', name: 'Flower Plate Round 1 x 1', color: 'Red', qty: 4, w: 1, h: 1 },
    ],
  },
  '60205': {
    num: '60205', set_num: '60205-1', name: 'Tracks', retired: false,
    contents: [
      { element: '6109157', part: '53401', name: 'Train Track Straight', color: 'Dark Bluish Gray', qty: 8, w: 16, h: 8, supplies: ['piece-track-straight'] },
      { element: '6109158', part: '53400', name: 'Train Track Curved', color: 'Dark Bluish Gray', qty: 4, w: 16, h: 8, supplies: ['piece-track-curve-left', 'piece-track-curve-right'] },
    ],
  },
};
const BY_NUM = new Map([
  ['piece-el:40310:6182261', { set_num: 'piece-el:40310:6182261', pack: '40310', element: '6182261' }],
  ['60316-1', { set_num: '60316-1' }],
]);
const tile = (set_num) => ({ set_num });

test('packRollup: elements group into one pack purchase, plain sets pass through', () => {
  const tiles = [tile('piece-el:40310:6182261'), tile('piece-el:40310:6182261'), tile('60316-1')];
  const { plain, packRows, spares } = packRollup(tiles, BY_NUM, PACKS);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].set_num, '60316-1');
  assert.deepEqual(packRows, [{ set_num: '40310-1', num: '40310', name: 'xtra Botanical Accessories', qty: 1 }]);
  // 2 of 3 plants used → 1 plant + all 4 flowers left over
  const s = spares['40310'];
  assert.equal(s.needed, 1);
  assert.equal(s.used, 2);
  assert.deepEqual(s.leftovers.map((l) => l.qty), [1, 4]);
});

test('packRollup: exceeding one element quantity needs another whole box', () => {
  const tiles = Array.from({ length: 5 }, () => tile('piece-el:40310:6182261')); // 5 plants, 3 per box
  const { packRows, spares } = packRollup(tiles, BY_NUM, PACKS);
  assert.equal(packRows[0].qty, 2);
  // 2 boxes = 6 plants + 8 flowers; 5 plants used → 1 plant + 8 flowers spare
  assert.deepEqual(spares['40310'].leftovers.map((l) => l.qty), [1, 8]);
});

test('packRollup: generic track pieces are supplied by the track pack', () => {
  const tiles = [
    ...Array.from({ length: 9 }, () => tile('piece-track-straight')), // 9 straights, 8 per box
    tile('piece-track-curve-left'), tile('piece-track-curve-right'), // both curves share one part
  ];
  const { plain, packRows, spares } = packRollup(tiles, new Map(), PACKS);
  assert.equal(plain.length, 0);
  assert.deepEqual(packRows, [{ set_num: '60205-1', num: '60205', name: 'Tracks', qty: 2 }]);
  // 2 boxes = 16 straight + 8 curved; used 9 + 2 → 7 straight + 6 curved spare
  assert.deepEqual(spares['60205'].leftovers.map((l) => l.qty), [7, 6]);
});

test('packSupplyIndex prefers available packs, then bigger per-box quantities', () => {
  const two = {
    old: { num: 'old', set_num: 'old-1', name: 'Old', retired: true,
      contents: [{ part: 'a', name: 'Train Track Straight', color: 'Gray', qty: 12, supplies: ['piece-track-straight'] }] },
    cur: { num: 'cur', set_num: 'cur-1', name: 'Current', retired: false,
      contents: [{ part: 'a', name: 'Train Track Straight', color: 'Gray', qty: 8, supplies: ['piece-track-straight'] }] },
  };
  const idx = packSupplyIndex(two);
  assert.equal(idx.get('piece-track-straight').pack.num, 'cur', 'still-sold pack wins even with fewer per box');
});

test('contentId falls back to part+colour when no element id exists', () => {
  assert.equal(contentId({ element: '6182261', part: 'x', color: 'Red' }), '6182261');
  assert.equal(contentId({ element: null, part: '32607', color: 'Bright Green' }), '32607-brightgreen');
});

test('bricklinkXml skips element rows but keeps pack rows', () => {
  const xml = bricklinkXml([{ num: 'piece-el:40310:6182261', qty: 2 }, { num: '40310', qty: 1 }]);
  assert.ok(!xml.includes('piece-el'), 'element rows never leak into BrickLink XML');
  assert.ok(xml.includes('<ITEMID>40310-1</ITEMID>'));
});
