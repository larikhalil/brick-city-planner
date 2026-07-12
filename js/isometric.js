// PLAN-12: read-only 3D / isometric preview.
// Pure projection maths (world stud coords → iso screen coords), a per-kind extrusion-height table,
// painter's-order depth sort, scene-bounds + fit-to-view helpers, and the per-tile prism geometry —
// everything a caller needs to paint the city as extruded blocks. The maths carry NO DOM and NO
// canvas at module scope, so they import cleanly under `node --test`. The one drawing helper
// (drawIsoScene) only ever calls standard CanvasRenderingContext2D methods, exactly like the
// export-image.js drawScene, so it runs against a real canvas in the browser AND a mock ctx in tests.
//
// This is deliberately a PREVIEW, not a CAD engine: a single fixed 2:1 dimetric camera, tasteful
// block heights (not true LEGO scale), no editing. The 2D top-down board stays the primary view.

import { catFill, resolveColor } from './export-image.js';

// Extrusion height per tile kind, in studs of *visual* height (not true scale — a preview cue).
// Buildings stand tallest; vehicles/parks are low; roads, tracks, terrain, baseplates and notes lie
// flat on the ground (height 0 ⇒ drawn as a single ground diamond, no side walls). A catalog set with
// no specific kind ('generic') gets a mid building-ish height.
export const ISO_HEIGHT = {
  building: 14, generic: 8, custom: 9, vehicle: 3, park: 2,
  road: 0, track: 0, baseplate: 0, terrain: 0, note: 0,
};
const DEFAULT_HEIGHT = 6;

// Height (studs) a tile is extruded to. Layer-0 tiles (baseplates, hard-pinned to the ground) are
// always flat regardless of kind, so a mis-tagged ground tile can never poke up through the city.
export function blockHeight(tile) {
  if (!tile) return 0;
  if (tile.layer === 0) return 0;
  const h = ISO_HEIGHT[tile.kind];
  return h == null ? DEFAULT_HEIGHT : h;
}

// A tile that rises off the ground plane (has walls) vs. a flat ground tile.
export function isElevated(tile) { return blockHeight(tile) > 0; }

// The tile's four ground-plane corners in stud coords, as a ring [TL, TR, BR, BL], rotated about the
// tile centre exactly like the 2D board's CSS rotate() — so an angled building projects angled.
export function footprintCorners(tile) {
  const cx = tile.x + tile.w / 2, cy = tile.y + tile.h / 2;
  const r = ((tile.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const hw = tile.w / 2, hh = tile.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([dx, dy]) => [cx + dx * co - dy * si, cy + dx * si + dy * co]);
}

// Project a world point (sx, sy on the ground plane; sz = elevation, up) to screen pixels under a
// classic 2:1 dimetric camera. +sx runs right-and-down, +sy runs left-and-down (so the world reads
// as a diamond with its origin at the top), and +sz lifts the point straight up the screen.
//   unit  — horizontal pixels per stud along the projected ground axes
//   ratio — vertical foreshortening of the ground (0.5 gives the 2:1 iso look)
//   elev  — screen pixels per stud of block height
//   ox,oy — screen-pixel origin (pan / centring offset)
// Because both screen axes scale linearly with `unit` when `elev` scales with it too (see
// fitProjection), the whole scene zooms uniformly with `unit`.
export function isoProject(sx, sy, sz = 0, {
  unit = 1, ratio = 0.5, elev = 0, ox = 0, oy = 0,
} = {}) {
  return {
    x: ox + (sx - sy) * unit,
    y: oy + (sx + sy) * unit * ratio - sz * elev,
  };
}

// Painter's depth scalar: the sum of the tile's front-most (largest x+y) ground corner. Under this
// camera a larger x+y lands lower on screen = nearer the viewer, so tiles are painted low→high. Ties
// (identical footprints) fall through to the elevation tier + z + id in byIsoDepth below.
export function isoDepthKey(tile) {
  let max = -Infinity;
  for (const [x, y] of footprintCorners(tile)) { const s = x + y; if (s > max) max = s; }
  return max;
}

// Comparator that yields a correct back-to-front paint order for the extruded scene:
//   1. flat ground tiles (height 0) first, so terrain / baseplates / roads never sit ON TOP of the
//      buildings that rise from them (they are coplanar at z=0 and can't occlude anything with walls);
//   2. then by depth (front-most corner) so nearer blocks paint over farther ones;
//   3. then by z / id for a stable, deterministic order among coincident tiles.
export function byIsoDepth(a, b) {
  return (isElevated(a) - isElevated(b))
    || (isoDepthKey(a) - isoDepthKey(b))
    || ((a.z ?? 0) - (b.z ?? 0))
    || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
}

// A painter's-ordered copy of the tiles (never mutates the input array).
export function sortForIso(tiles) { return [...tiles].sort(byIsoDepth); }

// Projected screen bounds of the whole scene: every tile's base AND top corners, so a tall building
// near the top edge still fits. Returns the min/max screen box plus its w/h. Pure — feed it unit=1 &
// elev=elevRatio and the result scales linearly with the real `unit` (used by fitProjection).
export function isoSceneBounds(tiles, { unit = 1, ratio = 0.5, elev = 0 } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const opts = { unit, ratio, elev };
  for (const t of tiles) {
    const h = blockHeight(t);
    for (const [wx, wy] of footprintCorners(t)) {
      for (const wz of (h > 0 ? [0, h] : [0])) {
        const p = isoProject(wx, wy, wz, opts);
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Solve for a projection that fits the whole city into a width×height canvas with `pad` px of margin,
// centred. `elevRatio` ties block-height pixels to the ground unit so the scene zooms uniformly;
// `maxUnit` stops a tiny city from ballooning to fill a huge canvas. Pure → unit-testable.
export function fitProjection(tiles, {
  width, height, pad = 28, ratio = 0.5, elevRatio = 0.65, maxUnit = 22,
} = {}) {
  const base = isoSceneBounds(tiles, { unit: 1, ratio, elev: elevRatio });
  const bw = base.w || 1, bh = base.h || 1;
  const avail = { w: Math.max(1, width - pad * 2), h: Math.max(1, height - pad * 2) };
  let unit = Math.min(avail.w / bw, avail.h / bh);
  if (!Number.isFinite(unit) || unit <= 0) unit = 1;
  unit = Math.min(unit, maxUnit);
  const elev = unit * elevRatio;
  // Centre the (scaled) scene box inside the padded canvas.
  const ox = pad + (avail.w - bw * unit) / 2 - base.minX * unit;
  const oy = pad + (avail.h - bh * unit) / 2 - base.minY * unit;
  return { unit, elev, ratio, ox, oy };
}

// The drawable geometry of one tile as an extruded prism, in screen pixels under `proj`:
//   top    — the roof polygon [4 pts] (for a flat tile this is just its ground diamond)
//   sideA / sideB — the two wall polygons [4 pts] visible from this camera (empty for flat tiles)
//   height — the tile's stud height (0 ⇒ flat)
// The two visible walls are found generically (works at any rotation): the front-most base corner —
// the one that projects lowest on screen — always fronts exactly two edges; those are the walls the
// viewer sees. Everything else faces away and is never drawn.
export function isoTilePrism(tile, proj) {
  const ring = footprintCorners(tile);
  const h = blockHeight(tile);
  const base = ring.map(([x, y]) => isoProject(x, y, 0, proj));
  if (h <= 0) return { top: base, sideA: [], sideB: [], height: 0 };
  const top = ring.map(([x, y]) => isoProject(x, y, h, proj));
  // Front-most base corner = largest screen y.
  let f = 0;
  for (let i = 1; i < 4; i++) if (base[i].y > base[f].y) f = i;
  const prev = (f + 3) % 4, next = (f + 1) % 4;
  const wall = (a, b) => [base[a], base[b], top[b], top[a]];
  return { top, sideA: wall(f, prev), sideB: wall(f, next), height: h };
}

// Concrete canvas fill for a tile — mirrors export-image.js drawTile: an explicit tile colour wins,
// else the category tint. Terrain/notes carry their own literal colour.
export function tileIsoColor(tile) {
  if (tile.kind === 'terrain') return resolveColor(tile.color, '#7bab54');
  if (tile.kind === 'note') return '#ffe89a';
  return resolveColor(tile.color, catFill(tile.category));
}

// Darken (amt<0) or lighten (amt>0) a #rgb / #rrggbb colour toward black / white by |amt| (0..1).
// Non-hex inputs (rgb()/hsl()/named) are returned unchanged — only extruded blocks, which always
// resolve to hex, are ever shaded; flat translucent terrain keeps its literal colour.
export function shade(color, amt) {
  if (typeof color !== 'string') return color;
  let hex = color.trim();
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const t = amt < 0 ? 0 : 255, p = Math.min(1, Math.abs(amt));
  const ch = (i) => {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return Math.round(v + (t - v) * p).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

// ---- canvas drawing -----------------------------------------------------------------------------
// ctx-only (no DOM). The app.js glue owns the <canvas>, its size, the overlay lifecycle and DPR.

function poly(ctx, pts, fill, stroke) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

// Paint the whole city as an isometric block scene onto `ctx`. `proj` comes from fitProjection;
// `width`/`height` are the canvas pixel size; `bg` fills the backdrop; `dark` picks the wall/edge
// contrast for a light vs. dark board. Pure w.r.t. the DOM.
export function drawIsoScene(ctx, {
  tiles, proj, width, height, bg = '#eef2f8', dark = false,
}) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  const edge = dark ? 'rgba(0,0,0,.45)' : 'rgba(15,26,43,.28)';
  for (const t of sortForIso(tiles)) {
    const color = tileIsoColor(t);
    const prism = isoTilePrism(t, proj);
    if (prism.height > 0) {
      // Two walls at different shades give the block its lit/shadowed 3D read.
      poly(ctx, prism.sideA, shade(color, -0.34), edge);
      poly(ctx, prism.sideB, shade(color, -0.17), edge);
      poly(ctx, prism.top, color, edge);
    } else {
      // Flat ground tile: a single diamond. Terrain keeps its (possibly translucent) literal colour.
      poly(ctx, prism.top, color, t.kind === 'terrain' ? null : edge);
    }
  }
}
