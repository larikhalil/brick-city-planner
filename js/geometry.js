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

// Axis-aligned bounding box of a tile (centre-anchored), in studs.
function aabb(t) {
  const e = extent(t);
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  return { minX: cx - e.w / 2, maxX: cx + e.w / 2, minY: cy - e.h / 2, maxY: cy + e.h / 2 };
}

// Snap-to-connect: nudge a dragged tile so its edges sit flush with / aligned to a
// nearby tile from `others` (same-layer road/rail pieces). Returns adjusted {x, y}.
// Each axis snaps independently to the closest edge match within `threshold` studs.
export function snapConnect(t, others, threshold = 6) {
  const a = aabb(t);
  let dx = 0, dy = 0, bestX = threshold + 1e-6, bestY = threshold + 1e-6;
  for (const o of others) {
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

export function anyOverlaps(tiles) {
  const ids = new Set();
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      // Overlap warnings only fire within the same stacking layer (0 baseplate,
      // 1 road/track, 2 building). A building on a baseplate, or a car on a road,
      // is intended; two roads or two buildings overlapping still flag.
      if ((a.layer ?? 2) !== (b.layer ?? 2)) continue;
      if (overlaps(a, b)) { ids.add(a.id); ids.add(b.id); }
    }
  }
  return ids;
}
