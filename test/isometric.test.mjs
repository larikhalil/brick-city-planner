// PLAN-12: isometric preview — projection maths + painter's depth sort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISO_HEIGHT, blockHeight, isElevated, footprintCorners, isoProject,
  isoDepthKey, byIsoDepth, sortForIso, isoSceneBounds, fitProjection,
  isoTilePrism, tileIsoColor, shade, drawIsoScene,
} from '../js/isometric.js';

const tile = (o) => ({ id: 'p1', x: 0, y: 0, w: 4, h: 4, rot: 0, layer: 2, z: 2, kind: 'building', category: 'city', color: null, ...o });

test('blockHeight is tall for buildings, flat for ground kinds', () => {
  assert.equal(blockHeight(tile({ kind: 'building' })), ISO_HEIGHT.building);
  assert.ok(blockHeight(tile({ kind: 'building' })) > blockHeight(tile({ kind: 'vehicle' })));
  for (const k of ['road', 'track', 'terrain', 'note']) {
    assert.equal(blockHeight(tile({ kind: k })), 0, `${k} is flat`);
  }
});

test('blockHeight forces layer-0 baseplates flat even if mis-kinded', () => {
  assert.equal(blockHeight(tile({ kind: 'building', layer: 0 })), 0);
  assert.equal(blockHeight(tile({ kind: 'baseplate', layer: 0 })), 0);
});

test('blockHeight falls back to a mid height for an unknown kind', () => {
  assert.ok(blockHeight(tile({ kind: 'mystery' })) > 0);
  assert.equal(blockHeight(null), 0);
});

test('isElevated splits walls-having blocks from flat ground', () => {
  assert.equal(isElevated(tile({ kind: 'building' })), true);
  assert.equal(isElevated(tile({ kind: 'road' })), false);
  assert.equal(isElevated(tile({ kind: 'baseplate', layer: 0 })), false);
});

test('footprintCorners returns the un-rotated box ring for rot 0', () => {
  const c = footprintCorners(tile({ x: 2, y: 3, w: 4, h: 6, rot: 0 }));
  assert.deepEqual(c, [[2, 3], [6, 3], [6, 9], [2, 9]]);
});

test('footprintCorners rotates about the tile centre', () => {
  const c = footprintCorners(tile({ x: 0, y: 0, w: 4, h: 2, rot: 90 }));
  // centre (2,1); 90° turns a 4×2 into a 2×4 footprint about that centre.
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - 1) < 1e-9 && Math.abs(Math.max(...xs) - 3) < 1e-9);
  assert.ok(Math.abs(Math.min(...ys) + 1) < 1e-9 && Math.abs(Math.max(...ys) - 3) < 1e-9);
});

test('isoProject: origin maps to the offset, axes point the iso way', () => {
  const o = { unit: 10, ratio: 0.5, elev: 8, ox: 100, oy: 50 };
  assert.deepEqual(isoProject(0, 0, 0, o), { x: 100, y: 50 });
  // +x runs right-and-down
  const px = isoProject(1, 0, 0, o);
  assert.ok(px.x > 100 && px.y > 50);
  // +y runs left-and-down
  const py = isoProject(0, 1, 0, o);
  assert.ok(py.x < 100 && py.y > 50);
  // +z lifts straight up (smaller screen y)
  const pz = isoProject(0, 0, 1, o);
  assert.equal(pz.x, 100);
  assert.equal(pz.y, 50 - 8);
});

test('isoProject scales uniformly with unit when elev scales too', () => {
  const at = (u) => isoProject(3, 5, 2, { unit: u, ratio: 0.5, elev: u * 0.65, ox: 0, oy: 0 });
  const a = at(4), b = at(8);
  assert.ok(Math.abs(b.x - 2 * a.x) < 1e-9);
  assert.ok(Math.abs(b.y - 2 * a.y) < 1e-9);
});

test('isoDepthKey grows toward the front (larger x+y)', () => {
  const back = tile({ x: 0, y: 0, w: 2, h: 2 });
  const front = tile({ x: 20, y: 20, w: 2, h: 2 });
  assert.ok(isoDepthKey(front) > isoDepthKey(back));
});

test('byIsoDepth paints flat ground before elevated blocks', () => {
  const plate = tile({ id: 'plate', kind: 'baseplate', layer: 0, x: 40, y: 40, w: 32, h: 32 });
  const shed = tile({ id: 'shed', kind: 'building', x: 0, y: 0, w: 2, h: 2 });
  // Even though the plate is far in front, a ground tile must never paint over a building.
  const order = sortForIso([shed, plate]).map((t) => t.id);
  assert.deepEqual(order, ['plate', 'shed']);
});

test('sortForIso orders back building before front building and is non-mutating', () => {
  const back = tile({ id: 'b', x: 0, y: 0 });
  const front = tile({ id: 'f', x: 30, y: 30 });
  const input = [front, back];
  const out = sortForIso(input);
  assert.deepEqual(out.map((t) => t.id), ['b', 'f']);
  assert.deepEqual(input.map((t) => t.id), ['f', 'b'], 'input untouched');
});

test('byIsoDepth breaks exact ties by z then id deterministically', () => {
  const a = tile({ id: 'a', z: 2 });
  const b = tile({ id: 'b', z: 2 });
  const c = tile({ id: 'c', z: 5 });
  const order = sortForIso([c, b, a]).map((t) => t.id);
  assert.deepEqual(order, ['a', 'b', 'c']); // same depth+z → id; higher z last
});

test('isoSceneBounds encloses base and lifted top corners', () => {
  const bounds = isoSceneBounds([tile({ x: 0, y: 0, w: 4, h: 4, kind: 'building' })],
    { unit: 10, ratio: 0.5, elev: 6 });
  assert.ok(bounds.w > 0 && bounds.h > 0);
  // top corners (z=height) push minY above the flat-only min.
  const flat = isoSceneBounds([tile({ x: 0, y: 0, w: 4, h: 4, kind: 'road' })],
    { unit: 10, ratio: 0.5, elev: 6 });
  assert.ok(bounds.minY < flat.minY, 'height lifts the top of the box');
});

test('isoSceneBounds is empty for no tiles', () => {
  assert.deepEqual(isoSceneBounds([]), { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 });
});

test('fitProjection centres the scene inside the padded canvas', () => {
  const tiles = [tile({ x: 0, y: 0, w: 8, h: 8, kind: 'building' })];
  const proj = fitProjection(tiles, { width: 800, height: 600, pad: 20 });
  assert.ok(proj.unit > 0 && proj.elev > 0);
  const b = isoSceneBounds(tiles, { unit: proj.unit, ratio: proj.ratio, elev: proj.elev });
  // Projected scene must sit fully inside the canvas.
  assert.ok(proj.ox + b.minX >= 20 - 1e-6);
  assert.ok(proj.oy + b.minY >= 20 - 1e-6);
  assert.ok(proj.ox + b.maxX <= 800 - 20 + 1e-6);
  assert.ok(proj.oy + b.maxY <= 600 - 20 + 1e-6);
});

test('fitProjection clamps a tiny city to maxUnit rather than over-zooming', () => {
  const proj = fitProjection([tile({ x: 0, y: 0, w: 1, h: 1, kind: 'vehicle' })],
    { width: 4000, height: 4000, maxUnit: 22 });
  assert.ok(proj.unit <= 22 + 1e-9);
});

test('isoTilePrism gives a flat tile just a top face, a block two walls', () => {
  const proj = { unit: 10, ratio: 0.5, elev: 8, ox: 0, oy: 0 };
  const flat = isoTilePrism(tile({ kind: 'road' }), proj);
  assert.equal(flat.height, 0);
  assert.equal(flat.top.length, 4);
  assert.equal(flat.sideA.length, 0);
  assert.equal(flat.sideB.length, 0);

  const block = isoTilePrism(tile({ kind: 'building' }), proj);
  assert.ok(block.height > 0);
  assert.equal(block.top.length, 4);
  assert.equal(block.sideA.length, 4);
  assert.equal(block.sideB.length, 4);
  // The roof sits above the base (all top pts lifted by elev*height vs their base).
  const base = footprintCorners(tile({ kind: 'building' })).map(([x, y]) => isoProject(x, y, 0, proj));
  block.top.forEach((p, i) => assert.ok(p.y < base[i].y, 'roof corner is above its base'));
});

test('shade darkens and lightens hex, and passes through non-hex', () => {
  assert.equal(shade('#ffffff', -1), '#000000');
  assert.equal(shade('#000000', 1), '#ffffff');
  assert.equal(shade('#808080', 0), '#808080');
  assert.equal(shade('#abc', -1), '#000000'); // 3-digit expands
  assert.equal(shade('rgba(1,2,3,.5)', -0.5), 'rgba(1,2,3,.5)'); // translucent terrain untouched
});

test('tileIsoColor resolves var()/category/literal like the exporter', () => {
  assert.match(tileIsoColor(tile({ color: '#123456' })), /^#123456$/i);
  assert.match(tileIsoColor(tile({ color: null, category: 'police' })), /^#/); // category tint hex
  assert.equal(tileIsoColor(tile({ kind: 'note' })), '#ffe89a');
});

// A minimal recording 2D context so the ctx-only drawing helper can run under node --test.
function mockCtx() {
  const calls = [];
  const rec = (name) => (...a) => calls.push([name, ...a]);
  return {
    calls, set fillStyle(v) { calls.push(['fillStyle', v]); }, get fillStyle() { return ''; },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); }, get strokeStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 1; },
    clearRect: rec('clearRect'), fillRect: rec('fillRect'), beginPath: rec('beginPath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), closePath: rec('closePath'),
    fill: rec('fill'), stroke: rec('stroke'),
  };
}

test('drawIsoScene paints a background then every tile without throwing', () => {
  const tiles = [
    tile({ id: 'plate', kind: 'baseplate', layer: 0, x: 0, y: 0, w: 32, h: 32, color: 'var(--g-green)' }),
    tile({ id: 'house', kind: 'building', x: 4, y: 4, w: 6, h: 6, category: 'modular' }),
    tile({ id: 'grass', kind: 'terrain', layer: -1, x: 0, y: 0, w: 8, h: 8, color: 'rgba(123,171,84,.34)' }),
  ];
  const proj = fitProjection(tiles, { width: 400, height: 300 });
  const ctx = mockCtx();
  assert.doesNotThrow(() => drawIsoScene(ctx, { tiles, proj, width: 400, height: 300 }));
  assert.ok(ctx.calls.some(([n]) => n === 'clearRect'));
  assert.ok(ctx.calls.some(([n]) => n === 'fill'));
  // The elevated building contributes more fills (2 walls + roof) than a flat tile (1 face).
  const fills = ctx.calls.filter(([n]) => n === 'fill').length;
  assert.ok(fills >= 5, `expected several polygon fills, got ${fills}`);
});

// ---- Round-1 feedback: rotatable 3D view (camera yaw threaded through the pure pipeline) --------

test('isoProject honours yaw: a quarter turn maps +x onto +y', () => {
  const o = { unit: 10, ratio: 0.5 };
  const turned = isoProject(1, 0, 0, { ...o, yaw: Math.PI / 2 });
  const straight = isoProject(0, 1, 0, o);
  assert.ok(Math.abs(turned.x - straight.x) < 1e-9);
  assert.ok(Math.abs(turned.y - straight.y) < 1e-9);
  // default yaw 0 reproduces the unrotated mapping exactly
  assert.deepEqual(isoProject(3, 5, 2, o), isoProject(3, 5, 2, { ...o, yaw: 0 }));
});

test('yaw leaves height alone — pitch stays fixed', () => {
  const o = { unit: 10, ratio: 0.5, elev: 8, yaw: Math.PI / 3 };
  const ground = isoProject(2, 4, 0, o);
  const lifted = isoProject(2, 4, 3, o);
  assert.equal(lifted.x, ground.x);
  assert.ok(Math.abs((ground.y - lifted.y) - 3 * 8) < 1e-9);
});

test('isoDepthKey flips front/back under a half turn', () => {
  const back = tile({ x: 0, y: 0, w: 2, h: 2 });
  const front = tile({ x: 20, y: 20, w: 2, h: 2 });
  assert.ok(isoDepthKey(front) > isoDepthKey(back)); // yaw 0 baseline
  assert.ok(isoDepthKey(front, Math.PI) < isoDepthKey(back, Math.PI)); // θ=180° reverses depth
});

test('sortForIso at yaw π reverses building order; flat-first survives any yaw', () => {
  const back = tile({ id: 'b', x: 0, y: 0 });
  const front = tile({ id: 'f', x: 30, y: 30 });
  assert.deepEqual(sortForIso([front, back], Math.PI).map((t) => t.id), ['f', 'b']);
  const plate = tile({ id: 'plate', kind: 'baseplate', layer: 0, x: 40, y: 40, w: 32, h: 32 });
  const shed = tile({ id: 'shed', kind: 'building', x: 0, y: 0, w: 2, h: 2 });
  for (const yaw of [Math.PI / 4, Math.PI]) {
    assert.deepEqual(sortForIso([shed, plate], yaw).map((t) => t.id), ['plate', 'shed'],
      `ground never paints over a building at yaw ${yaw}`);
  }
});

test('fitProjection carries yaw and still contains the rotated scene', () => {
  const tiles = [tile({ x: 0, y: 0, w: 20, h: 8, kind: 'building' })];
  const proj = fitProjection(tiles, { width: 800, height: 600, pad: 20, yaw: 0.7 });
  assert.equal(proj.yaw, 0.7);
  const b = isoSceneBounds(tiles, { unit: proj.unit, ratio: proj.ratio, elev: proj.elev, yaw: 0.7 });
  assert.ok(proj.ox + b.minX >= 20 - 1e-6);
  assert.ok(proj.oy + b.minY >= 20 - 1e-6);
  assert.ok(proj.ox + b.maxX <= 800 - 20 + 1e-6);
  assert.ok(proj.oy + b.maxY <= 600 - 20 + 1e-6);
});

test('a full 2π turn is the identity projection', () => {
  const tiles = [tile({ x: 3, y: 5, w: 8, h: 4, kind: 'building' })];
  const a = fitProjection(tiles, { width: 640, height: 480, yaw: 0 });
  const b = fitProjection(tiles, { width: 640, height: 480, yaw: 2 * Math.PI });
  assert.ok(Math.abs(a.unit - b.unit) < 1e-9);
  assert.ok(Math.abs(a.ox - b.ox) < 1e-9);
  assert.ok(Math.abs(a.oy - b.oy) < 1e-9);
});

test('drawIsoScene renders a yawed scene without throwing', () => {
  const tiles = [
    tile({ id: 'plate', kind: 'baseplate', layer: 0, x: 0, y: 0, w: 32, h: 32, color: 'var(--g-green)' }),
    tile({ id: 'house', kind: 'building', x: 4, y: 4, w: 6, h: 6, category: 'modular' }),
  ];
  const proj = fitProjection(tiles, { width: 400, height: 300, yaw: 2.1 });
  const ctx = mockCtx();
  assert.doesNotThrow(() => drawIsoScene(ctx, { tiles, proj, width: 400, height: 300 }));
  const fills = ctx.calls.filter(([n]) => n === 'fill').length;
  assert.ok(fills >= 4, `expected several polygon fills, got ${fills}`);
});
