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
