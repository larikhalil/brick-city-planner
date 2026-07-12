// PLAN-4: unit tests for the pure PNG-export layout maths — canvas dimensions per scale, the
// stud→pixel tile mapping, the title-card edge geometry, colour resolution and the max-size clamp —
// plus the ctx-only drawing routines driven through a recording mock 2D context (the real <canvas>
// + image preloading + download live in app.js and run in the browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_SCALES, STUD_PX, PALETTE, resolveColor, catFill,
  computeLayout, tileRect, fitScale, exportPaintKey, drawTile, drawScene,
} from '../js/export-image.js';

const BOX = { x: 0, y: 0, w: 32, h: 32 }; // one baseplate

test('EXPORT_SCALES offers 1×/2×/4×', () => {
  assert.deepEqual(EXPORT_SCALES, [1, 2, 4]);
  assert.equal(STUD_PX, 6);
});

test('computeLayout: dimensions scale linearly with the magnification', () => {
  const l1 = computeLayout(BOX, { scale: 1 });
  // ppu = 6, pad = 4*6 = 24, content = 32*6 = 192 → 24*2 + 192 = 240
  assert.equal(l1.ppu, 6);
  assert.equal(l1.pad, 24);
  assert.equal(l1.width, 240);
  assert.equal(l1.height, 240);

  const l2 = computeLayout(BOX, { scale: 2 });
  assert.equal(l2.ppu, 12);
  assert.equal(l2.width, 480); // exactly 2× the 1× canvas
  assert.equal(l2.height, 480);

  const l4 = computeLayout(BOX, { scale: 4 });
  assert.equal(l4.ppu, 24);
  assert.equal(l4.width, 960);
  assert.equal(l4.height, 960);
});

test('tileRect: a tile at the content origin lands at the pad inset', () => {
  const l = computeLayout(BOX, { scale: 1 });
  const r = tileRect({ x: 0, y: 0, w: 16, h: 16 }, l);
  assert.deepEqual(r, { x: 24, y: 24, w: 96, h: 96 });
});

test('tileRect: an offset content box keeps its top-left tile at the pad', () => {
  const box = { x: 10, y: 4, w: 20, h: 20 };
  const l = computeLayout(box, { scale: 2 }); // ppu 12, pad 4*12 = 48
  const r = tileRect({ x: 10, y: 4, w: 8, h: 8 }, l);
  assert.equal(r.x, 48);
  assert.equal(r.y, 48);
  assert.equal(r.w, 96);  // 8 studs * 12
  assert.equal(r.h, 96);
  // a tile further along maps proportionally
  const r2 = tileRect({ x: 30, y: 4, w: 8, h: 8 }, l);
  assert.equal(r2.x, 48 + 20 * 12);
});

test('computeLayout: title card adds space on the chosen edge only', () => {
  const base = computeLayout(BOX, { scale: 1 });
  const bottom = computeLayout(BOX, { scale: 1, titleCard: true, cardEdge: 'bottom', cardStuds: 26 });
  assert.equal(bottom.width, base.width);                 // width unchanged
  assert.equal(bottom.height, base.height + 26 * 6);      // card added below
  assert.deepEqual(bottom.cardRect, { x: 0, y: base.height, w: base.width, h: 26 * 6 });

  const right = computeLayout(BOX, { scale: 1, titleCard: true, cardEdge: 'right', cardStuds: 26 });
  assert.equal(right.height, base.height);                // height unchanged
  assert.equal(right.width, base.width + 26 * 6);         // card added to the right
  assert.deepEqual(right.cardRect, { x: base.width, y: 0, w: 26 * 6, h: base.height });

  assert.equal(base.cardRect, null); // no card by default
});

test('resolveColor: var() → palette hex, literals pass through, unknown → fallback', () => {
  assert.equal(resolveColor('var(--road)'), '#5a616b');
  assert.equal(resolveColor('var(--g-green)'), PALETTE['--g-green']);
  assert.equal(resolveColor('#abcdef'), '#abcdef');
  assert.equal(resolveColor('rgba(123,171,84,.34)'), 'rgba(123,171,84,.34)');
  assert.equal(resolveColor('var(--nope)'), '#949daa');
  assert.equal(resolveColor(null), '#949daa');
  assert.equal(resolveColor(undefined, '#000'), '#000');
});

test('catFill: category → concrete hex via catColor + the palette', () => {
  assert.equal(catFill('police'), '#2f7fe0');
  assert.equal(catFill('road'), '#5a616b');        // catColor maps road → var(--road)
  assert.equal(catFill('nonexistent'), '#4d7194'); // catColor default var(--t-city)
});

test('fitScale: small city keeps the requested scale, huge city is clamped down', () => {
  assert.equal(fitScale(BOX, 4), 4); // 960px << 8192px cap
  // a very large city at 4× would exceed the cap → drops to a smaller offered scale
  const big = { x: 0, y: 0, w: 700, h: 700 };
  const s = fitScale(big, 4, {}, 8192);
  assert.ok(s < 4, 'clamped below the requested 4×');
  assert.ok(EXPORT_SCALES.includes(s) || s < 1, 'lands on an offered scale or a sub-1× fit');
  // an absurd city clamps below 1×
  const huge = { x: 0, y: 0, w: 5000, h: 5000 };
  assert.ok(fitScale(huge, 4, {}, 8192) < 1);
});

// ---- drawing routines against a recording mock 2D context -------------------------------------
// A minimal CanvasRenderingContext2D stand-in that records the calls the export makes, so the
// drawing code can be exercised end-to-end (and any crash surfaces) with no real canvas.
function mockCtx() {
  const ops = [];
  const c = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', font: '',
    textAlign: '', textBaseline: '',
    fillRect: (...a) => ops.push({ op: 'fillRect', a, fillStyle: c.fillStyle }),
    strokeRect: () => ops.push({ op: 'strokeRect' }),
    fillText: (t, ...a) => ops.push({ op: 'fillText', text: t, a, fillStyle: c.fillStyle }),
    measureText: (t) => ({ width: String(t).length * 5 }),
    drawImage: (...a) => ops.push({ op: 'drawImage', a }),
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, arcTo: () => {}, fill: () => ops.push({ op: 'fill', fillStyle: c.fillStyle }),
    stroke: () => ops.push({ op: 'stroke', strokeStyle: c.strokeStyle }),
    clip: () => {}, setLineDash: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {},
    _ops: ops,
  };
  return c;
}

test('exportPaintKey stacks terrain < baseplate < building < note', () => {
  const terrain = { kind: 'terrain' };
  const base = { kind: 'baseplate', layer: 0 };
  const building = { kind: 'building', layer: 2, z: 2 };
  const note = { kind: 'note', z: 3 };
  const order = [note, building, terrain, base].sort((a, b) => exportPaintKey(a) - exportPaintKey(b));
  assert.deepEqual(order.map((t) => t.kind), ['terrain', 'baseplate', 'building', 'note']);
});

test('drawTile: a building with a loaded thumbnail draws the image + a readable label', () => {
  const ctx = mockCtx();
  const layout = computeLayout({ x: 0, y: 0, w: 16, h: 16 }, { scale: 4 }); // 64px tile, big enough to label
  const imgs = new Map([['u', { width: 100, height: 80 }]]);
  drawTile(ctx, { kind: 'building', img: 'u', x: 0, y: 0, w: 16, h: 16, category: 'city', name: 'Town Hall', layer: 2 }, layout, imgs);
  assert.equal(ctx._ops.filter((o) => o.op === 'drawImage').length, 1, 'thumbnail drawn once');
  assert.ok(ctx._ops.some((o) => o.op === 'fillText' && /Town Hall/.test(o.text)), 'label rendered');
});

test('drawTile: terrain is a flat fill only — no label, no image', () => {
  const ctx = mockCtx();
  const layout = computeLayout({ x: 0, y: 0, w: 32, h: 32 }, { scale: 2 });
  drawTile(ctx, { kind: 'terrain', color: 'var(--g-blue)', x: 0, y: 0, w: 32, h: 32, layer: -1 }, layout, new Map());
  assert.ok(ctx._ops.some((o) => o.op === 'fillRect' && o.fillStyle === '#4795cc'), 'water fill resolved to hex');
  assert.equal(ctx._ops.filter((o) => o.op === 'fillText').length, 0);
  assert.equal(ctx._ops.filter((o) => o.op === 'drawImage').length, 0);
});

test('drawScene: presentation uses a white ground and skips the grid; title card prints stats', () => {
  const tiles = [
    { kind: 'baseplate', x: 0, y: 0, w: 32, h: 32, layer: 0, color: 'var(--g-green)' },
    { kind: 'road', x: 0, y: 0, w: 32, h: 8, layer: 1, color: 'var(--road)' },
    { kind: 'building', x: 4, y: 12, w: 16, h: 16, layer: 2, category: 'city', name: 'Bank' },
  ];
  const box = { x: 0, y: 0, w: 32, h: 32 };

  const clean = mockCtx();
  const l1 = computeLayout(box, { scale: 1 });
  drawScene(clean, { tiles, layout: l1, box, presentation: true, titleCard: false });
  const GRID = 'rgba(15,26,43,.10)'; // the faint baseplate-grid stroke colour
  assert.equal(clean._ops[0].op, 'fillRect', 'background painted first');
  assert.equal(clean._ops[0].fillStyle, '#ffffff', 'presentation ground is white');
  assert.equal(clean._ops.filter((o) => o.op === 'stroke' && o.strokeStyle === GRID).length, 0,
    'no drafting grid in presentation mode');

  const drafting = mockCtx();
  drawScene(drafting, { tiles, layout: l1, box, presentation: false, titleCard: false });
  assert.equal(drafting._ops[0].fillStyle, '#f3f6fb', 'drafting ground tone');
  assert.ok(drafting._ops.some((o) => o.op === 'stroke' && o.strokeStyle === GRID), 'faint grid drawn');

  const carded = mockCtx();
  const lc = computeLayout(box, { scale: 1, titleCard: true, cardEdge: 'bottom' });
  drawScene(carded, {
    tiles, layout: lc, box, presentation: true, titleCard: true,
    stats: { setCount: 2, pieces: 640, w: 32, h: 32 }, name: 'My Town',
  });
  const texts = carded._ops.filter((o) => o.op === 'fillText').map((o) => o.text).join(' | ');
  assert.ok(/My Town/.test(texts), 'city name on the card');
  assert.ok(/2 sets/.test(texts) && /640 pieces/.test(texts), 'stats row on the card');
  assert.ok(/32 × 32 studs/.test(texts), 'footprint on the card');
});
