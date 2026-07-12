// A tile is { x, y, w, h, rot } in studs; rot is degrees (0–359), rotation about
// the tile's centre. x,y is the top-left of the un-rotated w×h box.

// Axis-aligned bounding box (in studs) of the tile after rotation.
export function extent(tile) {
  const rot = (((tile.rot || 0) % 360) + 360) % 360;
  if (rot === 0 || rot === 180) return { w: tile.w, h: tile.h };
  if (rot === 90 || rot === 270) return { w: tile.h, h: tile.w };
  const r = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { w: tile.w * c + tile.h * s, h: tile.w * s + tile.h * c };
}

// The four corners of the tile as an oriented box (studs), centre-rotated.
function corners(t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  const r = ((t.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const hw = t.w / 2, hh = t.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([dx, dy]) => [cx + dx * co - dy * si, cy + dx * si + dy * co]);
}

function project(pts, ax) {
  let mn = Infinity, mx = -Infinity;
  for (const [x, y] of pts) { const p = x * ax[0] + y * ax[1]; if (p < mn) mn = p; if (p > mx) mx = p; }
  return [mn, mx];
}

// Separating-axis test on the two oriented boxes. Edge-touching counts as NOT
// overlapping (so pieces laid edge-to-edge don't warn), for any rotation.
export function overlaps(a, b) {
  const A = corners(a), B = corners(b);
  const EPS = 1e-6;
  for (const box of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = box[i], [x2, y2] = box[(i + 1) % 4];
      const ax = [-(y2 - y1), x2 - x1]; // outward edge normal
      const [amin, amax] = project(A, ax), [bmin, bmax] = project(B, ax);
      if (amin >= bmax - EPS || bmin >= amax - EPS) return false; // a gap on this axis
    }
  }
  return true;
}

// Bounding box of all tiles' rotated extents (centre-anchored).
export function bbox(tiles) {
  if (!tiles.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const e = extent(t);
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    minX = Math.min(minX, cx - e.w / 2); minY = Math.min(minY, cy - e.h / 2);
    maxX = Math.max(maxX, cx + e.w / 2); maxY = Math.max(maxY, cy + e.h / 2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function snap(value, step = 1) {
  return Math.round(value / step) * step;
}

export const BP = 32; // studs per baseplate — the canvas always sizes in whole baseplates
const ceilPlate = (studs) => Math.ceil(Math.max(0, studs) / BP) * BP;

// Auto-grow: the smallest whole-baseplate canvas that keeps `margin` studs clear past the
// content's right/bottom edge. Expand-only — never returns smaller than the current size.
export function grownCanvas(right, bottom, curW, curH, margin = 16) {
  return {
    w: Math.max(curW, ceilPlate(right + margin)),
    h: Math.max(curH, ceilPlate(bottom + margin)),
  };
}

// Manual resize: snap a requested canvas (studs) to whole baseplates, never smaller than the
// content already placed (so a piece can't be cut off) nor below one plate, capped at `maxStuds`.
export function clampedCanvas(reqW, reqH, right, bottom, maxStuds = 1024) {
  const one = (req, content) => Math.min(maxStuds, Math.max(BP, ceilPlate(content), ceilPlate(req)));
  return { w: one(reqW, right), h: one(reqH, bottom) };
}

// Axis-aligned bounding box of a tile (centre-anchored), in studs. Exported for
// marquee-select, align/distribute and group maths — accounts for rotation.
export function tileAABB(t) {
  const e = extent(t);
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  return { minX: cx - e.w / 2, maxX: cx + e.w / 2, minY: cy - e.h / 2, maxY: cy + e.h / 2 };
}
const aabb = tileAABB; // internal alias kept for the snap maths below

// Connection ports of a road/rail piece in LOCAL coords (before rotation): a point on an
// opening edge with an outward unit direction. Matched port-to-port so pieces join
// opening-to-opening at any angle.
function localPorts(kind, name, w, h) {
  const n = (name || '').toLowerCase();
  const L = { x: 0, y: h / 2, dx: -1, dy: 0 }, R = { x: w, y: h / 2, dx: 1, dy: 0 };
  const T = { x: w / 2, y: 0, dx: 0, dy: -1 }, B = { x: w / 2, y: h, dx: 0, dy: 1 };
  if (kind === 'road') {
    if (/curve/.test(n)) return /left/.test(n) ? [B, L] : [B, R];
    if (/cross/.test(n)) return [L, R, T, B];
    if (/junction|t-|t &|and t/.test(n)) return [L, R, B];
    return [L, R];
  }
  if (kind === 'track') {
    if (/curve/.test(n)) return /left/.test(n) ? [B, L] : [B, R];
    if (/cross|crossover|diamond/.test(n)) return [L, R, T, B];
    if (/switch|points/.test(n)) return [T, B];
    return [L, R];
  }
  return [];
}

// Ports transformed to world coords by the tile's position + rotation.
function worldPorts(t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  const r = ((t.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  return localPorts(t.kind, t.name, t.w, t.h).map((p) => {
    const ox = p.x - t.w / 2, oy = p.y - t.h / 2;
    return { x: cx + ox * co - oy * si, y: cy + ox * si + oy * co, dx: p.dx * co - p.dy * si, dy: p.dx * si + p.dy * co };
  });
}

// Snap-to-connect: first join the closest pair of FACING ports (rotation-aware); if no
// facing port is near, fall back to snapping AABB edges flush/aligned. Returns {x, y}.
export function snapConnect(t, others, threshold = 6) {
  const aPorts = worldPorts(t);
  if (aPorts.length) {
    let dx = 0, dy = 0, best = threshold + 1e-6, found = false;
    for (const o of others) {
      for (const bp of worldPorts(o)) {
        for (const ap of aPorts) {
          if (ap.dx * bp.dx + ap.dy * bp.dy > -0.6) continue; // ports must face each other
          const d = Math.hypot(ap.x - bp.x, ap.y - bp.y);
          if (d < best) { best = d; dx = bp.x - ap.x; dy = bp.y - ap.y; found = true; }
        }
      }
    }
    // round to 4dp to shed floating-point noise from rotation (keeps genuine fractions);
    // `|| 0` normalises -0 → 0.
    if (found) return { x: Math.round((t.x + dx) * 1e4) / 1e4 || 0, y: Math.round((t.y + dy) * 1e4) / 1e4 || 0 };
  }
  // Baseplates snap to the 32-stud baseplate grid so the ground tiles cleanly.
  if ((t.layer ?? 2) === 0) return { x: snap(t.x, 32), y: snap(t.y, 32) };
  // Everything else edge-snaps to same-layer neighbours and to baseplates (the ground).
  const layer = t.layer ?? 2;
  const rel = others.filter((o) => { const l = o.layer ?? 2; return l === layer || l === 0; });
  const a = aabb(t);
  let dx = 0, dy = 0, bestX = threshold + 1e-6, bestY = threshold + 1e-6;
  for (const o of rel) {
    const b = aabb(o);
    const yNear = a.minY < b.maxY + threshold && a.maxY > b.minY - threshold;
    const xNear = a.minX < b.maxX + threshold && a.maxX > b.minX - threshold;
    if (yNear) {
      for (const [ae, be] of [[a.maxX, b.minX], [a.minX, b.maxX], [a.minX, b.minX], [a.maxX, b.maxX]]) {
        const d = Math.abs(ae - be);
        if (d < bestX) { bestX = d; dx = be - ae; }
      }
    }
    if (xNear) {
      for (const [ae, be] of [[a.maxY, b.minY], [a.minY, b.maxY], [a.minY, b.minY], [a.maxY, b.maxY]]) {
        const d = Math.abs(ae - be);
        if (d < bestY) { bestY = d; dy = be - ae; }
      }
    }
  }
  return { x: t.x + dx, y: t.y + dy };
}

// Overlapping tile PAIRS (same layer/kind rules as anyOverlaps below) — kept as the actual tile
// objects, not just ids, so a caller can name the offending pieces (ACC-4 announcements need
// "Overlap detected between X and Y", not just a set of ids).
export function overlapPairs(tiles) {
  const pairs = [];
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      // Terrain fills and sticky notes are landscaping/annotation, not physical footprints —
      // they never warn (against each other or anything else). Custom MOC rectangles DO warn,
      // like the buildings they stand in for (they sit on the same layer 2).
      if (a.kind === 'terrain' || a.kind === 'note' || b.kind === 'terrain' || b.kind === 'note') continue;
      // Overlap warnings only fire within the same stacking layer (0 baseplate,
      // 1 road/track, 2 building). A building on a baseplate, or a car on a road,
      // is intended; two roads or two buildings overlapping still flag.
      if ((a.layer ?? 2) !== (b.layer ?? 2)) continue;
      if (overlaps(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

export function anyOverlaps(tiles) {
  const ids = new Set();
  for (const [a, b] of overlapPairs(tiles)) { ids.add(a.id); ids.add(b.id); }
  return ids;
}

// Stud coordinates → a friendly 1-indexed row/column pair, on the same coarse 8-stud cell the
// terrain brush snaps to (objects.js CELL) — used only for accessibility announcements (ACC-4),
// e.g. "placed at row 3, column 5", so screen-reader users get a spatial reference without colour.
export function toRowCol(x, y, cell = 8) {
  return { row: Math.floor(y / cell) + 1, col: Math.floor(x / cell) + 1 };
}

// Shed floating-point noise from rotation while keeping genuine fractions; -0 → 0.
const round4 = (v) => Math.round(v * 1e4) / 1e4 || 0;

// Ids of every tile whose rotated AABB intersects the rect {x,y,w,h} (studs) — the
// rubber-band marquee hit-test. Edge-touching counts as a hit (loose, forgiving box-select).
export function tilesInRect(tiles, rect) {
  const rx2 = rect.x + rect.w, ry2 = rect.y + rect.h;
  const ids = [];
  for (const t of tiles) {
    const a = tileAABB(t);
    if (a.minX <= rx2 && a.maxX >= rect.x && a.minY <= ry2 && a.maxY >= rect.y) ids.push(t.id);
  }
  return ids;
}

// Align a set of tiles on one edge/centre of their shared bounding box. Operates on
// each tile's rotated AABB so angled pieces line up by their true visual extent. Only
// the relevant axis moves; returns [{id, x, y}] with the new un-rotated top-lefts.
export function alignTiles(tiles, mode) {
  if (tiles.length < 2) return tiles.map((t) => ({ id: t.id, x: t.x, y: t.y }));
  const bs = tiles.map((t) => ({ t, a: tileAABB(t) }));
  const minX = Math.min(...bs.map((b) => b.a.minX)), maxX = Math.max(...bs.map((b) => b.a.maxX));
  const minY = Math.min(...bs.map((b) => b.a.minY)), maxY = Math.max(...bs.map((b) => b.a.maxY));
  const gcx = (minX + maxX) / 2, gcy = (minY + maxY) / 2;
  return bs.map(({ t, a }) => {
    let x = t.x, y = t.y;
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2; // tile centre is rotation-invariant
    if (mode === 'left') x = t.x + (minX - a.minX);
    else if (mode === 'right') x = t.x + (maxX - a.maxX);
    else if (mode === 'centerH') x = t.x + (gcx - cx);
    else if (mode === 'top') y = t.y + (minY - a.minY);
    else if (mode === 'bottom') y = t.y + (maxY - a.maxY);
    else if (mode === 'centerV') y = t.y + (gcy - cy);
    return { id: t.id, x: round4(Math.max(0, x)), y: round4(Math.max(0, y)) };
  });
}

// Evenly space 3+ tiles along an axis by their centres, keeping the two extremes fixed.
// axis: 'h' (horizontal) or 'v' (vertical). Returns [{id, x, y}].
export function distributeTiles(tiles, axis) {
  if (tiles.length < 3) return tiles.map((t) => ({ id: t.id, x: t.x, y: t.y }));
  const centre = (t) => (axis === 'v' ? t.y + t.h / 2 : t.x + t.w / 2);
  const sorted = [...tiles].sort((p, q) => centre(p) - centre(q));
  const first = centre(sorted[0]), last = centre(sorted[sorted.length - 1]), n = sorted.length - 1;
  const out = new Map();
  sorted.forEach((t, i) => {
    const delta = (first + (last - first) * (i / n)) - centre(t);
    out.set(t.id, axis === 'v'
      ? { id: t.id, x: t.x, y: round4(Math.max(0, t.y + delta)) }
      : { id: t.id, x: round4(Math.max(0, t.x + delta)), y: t.y });
  });
  return tiles.map((t) => out.get(t.id));
}

// Rotate a whole group of tiles by `deg` about the group's bounding-box centre: each
// tile's centre orbits the pivot and its own rotation advances by deg. Returns
// [{id, x, y, rot}] (un-rotated top-lefts); the caller clamps back into the canvas.
export function rotateGroup(tiles, deg) {
  if (!tiles.length) return [];
  const b = bbox(tiles), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  return tiles.map((t) => {
    const dx = (t.x + t.w / 2) - cx, dy = (t.y + t.h / 2) - cy;
    const ncx = cx + dx * co - dy * si, ncy = cy + dx * si + dy * co;
    const rot = ((Math.round((t.rot || 0) + deg) % 360) + 360) % 360;
    return { id: t.id, x: round4(ncx - t.w / 2), y: round4(ncy - t.h / 2), rot };
  });
}
