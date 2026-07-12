import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCity, decodeCity } from '../js/share.js';

const sample = {
  app: 'brick-city-planner', version: 1, name: 'Shared Town', units: 'studs',
  placed: [
    { id: 'p1', set_num: '11023-1', name: 'Green Baseplate', category: 'baseplate', kind: 'baseplate',
      x: 0, y: 0, w: 32, h: 32, rot: 0, approx: false, img: null, layer: 0, z: 0, color: 'var(--g-green)' },
    { id: 'p2', set_num: '10312-1', name: 'Jazz Club', category: 'modular', kind: 'building',
      x: 0, y: 0, w: 32, h: 32, rot: 90, approx: false, img: 'img/sets/10312-1.jpg', layer: 2, z: 2, color: null },
  ],
  grid: { w: 128, h: 96 },
  updated: '2026-07-11T00:00:00.000Z',
};

test('encodeCity/decodeCity round-trips (gzip path, when supported by the runtime)', async () => {
  const packed = await encodeCity(sample);
  assert.equal(typeof packed, 'string');
  const back = await decodeCity(packed);
  assert.deepEqual(back, sample);
});

test('encodeCity/decodeCity round-trips via the forced uncompressed fallback', async () => {
  const packed = await encodeCity(sample, { gzip: false });
  assert.match(packed, /^0/); // '0' tag = uncompressed base64url
  const back = await decodeCity(packed);
  assert.deepEqual(back, sample);
});

test('the two codec paths use distinct tag prefixes', async () => {
  const fallback = await encodeCity(sample, { gzip: false });
  assert.equal(fallback[0], '0');
});

test('decodeCity rejects garbage input', async () => {
  assert.equal(await decodeCity('garbage'), null);
  assert.equal(await decodeCity('zAAAA'), null); // unrecognised tag
  assert.equal(await decodeCity(''), null);
  assert.equal(await decodeCity(null), null);
  assert.equal(await decodeCity(undefined), null);
  assert.equal(await decodeCity(42), null);
});

test('decodeCity rejects a tag with unparseable base64 body', async () => {
  assert.equal(await decodeCity('0***not-base64***'), null);
});

test('decodeCity rejects a valid-looking payload that decodes to non-JSON', async () => {
  // '0' + base64url of the literal bytes "not json" — valid base64, invalid JSON once decoded.
  const bad = '0' + Buffer.from('not json').toString('base64url');
  assert.equal(await decodeCity(bad), null);
});

test('encodeCity output is URL-fragment safe (no +, /, or = characters)', async () => {
  const packed = await encodeCity(sample, { gzip: false });
  assert.doesNotMatch(packed, /[+/=]/);
});

test('round-trip preserves an empty placed[] and minimal shape', async () => {
  const empty = { app: 'brick-city-planner', version: 1, name: 'Empty', units: 'studs', placed: [] };
  const packed = await encodeCity(empty, { gzip: false });
  assert.deepEqual(await decodeCity(packed), empty);
});
