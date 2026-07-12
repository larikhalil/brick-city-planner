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

// PLAN-7: a baseplate snaps to a grid of ITS OWN footprint, independently per axis — so identical
// plates always tile without gaps or overlaps. A 48×32 plate steps by 48 in x and 32 in y, a 16×16
// plate by 16, and the classic 32×32 plate by 32 (unchanged). A degenerate 0-or-negative size falls
// back to one baseplate (BP) so we never divide by zero. Pure — unit-tested in isolation.
export function plateGridSnap(x, y, w, h) {
  const sx = w > 0 ? w : BP, sy = h > 0 ? h : BP;
  return { x: snap(x, sx), y: snap(y, sy) };
}
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

// PERF-1: viewport-culling predicate. `viewport` is the visible rect in STUDS ({x,y,w,h}); `margin`
// (studs) over-renders a buffer past every edge so a scroll doesn't pop tiles in at the seam. Returns
// true when the tile's rotated AABB touches or overlaps the margin-expanded viewport. A null/absent
// viewport means "can't measure the view" → never cull (render everything). Pure + edge-inclusive so
// a tile flush with the viewport edge still paints. Cull affects RENDER ONLY — never the model.
export function tileInViewport(tile, viewport, margin = 0) {
  if (!viewport) return true;
  const a = tileAABB(tile);
  const m = margin || 0;
  const left = viewport.x - m, top = viewport.y - m;
  const right = viewport.x + viewport.w + m, bottom = viewport.y + viewport.h + m;
  return a.maxX >= left && a.minX <= right && a.maxY >= top && a.minY <= bottom;
}

// PLAN-10: real LEGO curved track turns 1/16 of a circle — 22.5° per segment — regardless of its
// radius class (R40/R56/R72/R104 all nest concentrically at the same increment). The switch/point's
// diverging route leaves the through line at the standard ~16.5° LEGO branch angle.
export const CURVE_TURN = 22.5; // degrees a curve/switch tile snaps its rotation to
export const SWITCH_ANGLE = 16.5; // degrees the diverging route deflects from the through line

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
    // PLAN-11: a buffer stop / end-cap is a terminal piece — it exposes ONE coupling face (its
    // bottom edge, B) and deliberately has no far-side opening. Placed over a spur's open end its
    // single port mates that end, so a capped spur reads as complete rather than unfinished track.
    if (/buffer|stop|end.?cap/.test(n)) return [B];
    if (/curve/.test(n)) return /left/.test(n) ? [B, L] : [B, R];
    if (/cross|crossover|diamond/.test(n)) return [L, R, T, B];
    if (/switch|points/.test(n)) {
      // PLAN-10: a switch is the through route (B → T, collinear) PLUS a diverging exit that
      // leaves the top/heel end at SWITCH_ANGLE off the through line — right switches branch to
      // +x, left switches to -x. Exposing the diverging port here lets snapConnect auto-align a
      // downstream track piece onto the branch, not just the straight-through opening.
      const rad = (SWITCH_ANGLE * Math.PI) / 180, s = Math.sin(rad), c = Math.cos(rad);
      const side = /left/.test(n) ? -1 : 1;
      // The branch exits the far (heel) edge; over the tile's length it drifts sideways by h·tanθ.
      const off = Math.min(w / 2, h * Math.tan(rad));
      const D = { x: w / 2 + side * off, y: 0, dx: side * s, dy: -c };
      return [T, B, D];
    }
    return [L, R];
  }
  return [];
}

// PLAN-10: local-coord ports for a placed track/road TILE (thin tile-based wrapper around the
// internal localPorts, exported so the switch/curve geometry is unit-testable in isolation).
export function trackPorts(tile) {
  return localPorts(tile.kind, tile.name, tile.w, tile.h);
}

// PLAN-11: a placed tile's connection ports in WORLD coords (position + rotation applied). Thin
// exported wrapper over the internal worldPorts so the continuity/loop-closure validator can reuse
// the exact same port maths as snapConnect instead of re-deriving them.
export function tileWorldPorts(tile) {
  return worldPorts(tile);
}

// PLAN-10: the radius class of a curved-track piece ('R40'|'R56'|'R72'|'R104'), or null for any
// piece that has none (straights, crossings, roads, buildings…). Data-driven off the tile's tag.
export function radiusClass(tile) {
  return (tile && typeof tile.radius === 'string' && tile.radius) || null;
}

// PLAN-10: do two pieces about to be joined port-to-port carry DIFFERENT real radius classes? Only
// fires when BOTH sides have a class and they disagree — a radius-less piece (straight/crossing)
// never warns, so a curve meeting a straight is always fine.
export function radiusMismatch(a, b) {
  const ra = radiusClass(a), rb = radiusClass(b);
  return !!(ra && rb && ra !== rb);
}

// PLAN-10: the rotation snap increment (degrees) for a tile. Curved/switch track snaps to its real
// turn increment (22.5°) so a chain of curves stays on the LEGO circle; everything else keeps the
// generic 15° free-rotate step.
export function rotationStep(tile) {
  if (tile && tile.kind === 'track' && Number.isFinite(tile.turn) && tile.turn > 0) return tile.turn;
  return 15;
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
// Thin wrapper over snapConnectInfo — kept returning ONLY {x, y} so every existing caller/test
// that deep-equals the result is unaffected.
export function snapConnect(t, others, threshold = 6, edgeThreshold = threshold) {
  const s = snapConnectInfo(t, others, threshold, edgeThreshold);
  return { x: s.x, y: s.y };
}

// PLAN-10: the same snap maths as snapConnect, but also reports `connectedTo` — the neighbour tile
// whose port was joined (or null for a baseplate-grid / edge-align fallback). grid.js uses that to
// hard-warn when two mismatched-radius track pieces are snapped port-to-port.
// `edgeThreshold` gates ONLY the generic everything-else edge magnetism at the bottom — road/track
// port joining and baseplate tiling keep the stronger `threshold` pull, while ordinary sets can be
// given a much weaker magnet so they can start on any stud (round-1 feedback).
export function snapConnectInfo(t, others, threshold = 6, edgeThreshold = threshold) {
  const aPorts = worldPorts(t);
  if (aPorts.length) {
    let dx = 0, dy = 0, best = threshold + 1e-6, found = false, connectedTo = null;
    for (const o of others) {
      for (const bp of worldPorts(o)) {
        for (const ap of aPorts) {
          if (ap.dx * bp.dx + ap.dy * bp.dy > -0.6) continue; // ports must face each other
          const d = Math.hypot(ap.x - bp.x, ap.y - bp.y);
          if (d < best) { best = d; dx = bp.x - ap.x; dy = bp.y - ap.y; found = true; connectedTo = o; }
        }
      }
    }
    // round to 4dp to shed floating-point noise from rotation (keeps genuine fractions);
    // `|| 0` normalises -0 → 0.
    if (found) return { x: Math.round((t.x + dx) * 1e4) / 1e4 || 0, y: Math.round((t.y + dy) * 1e4) / 1e4 || 0, connectedTo };
  }
  // Baseplates: first butt flush against any nearby baseplate edge (so mixed sizes — 48×48 next to
  // 16×16 — tile without gaps), then fall back per-axis to the plate's OWN-size grid when no plate
  // is close on that axis. The classic lone-32×32 path still lands on the 32-stud grid.
  if ((t.layer ?? 2) === 0) {
    const plates = others.filter((o) => (o.layer ?? 2) === 0);
    const a = aabb(t);
    let dx = 0, dy = 0, bestX = threshold + 1e-6, bestY = threshold + 1e-6;
    for (const o of plates) {
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
    const g = plateGridSnap(t.x, t.y, t.w, t.h);
    return {
      x: bestX <= threshold ? round4(t.x + dx) : g.x,
      y: bestY <= threshold ? round4(t.y + dy) : g.y,
      connectedTo: null,
    };
  }
  // Everything else edge-snaps to same-layer neighbours and to baseplates (the ground) —
  // within `edgeThreshold` only, so the magnet helps flush placement without forbidding
  // in-between positions.
  const layer = t.layer ?? 2;
  const rel = others.filter((o) => { const l = o.layer ?? 2; return l === layer || l === 0; });
  const a = aabb(t);
  let dx = 0, dy = 0, bestX = edgeThreshold + 1e-6, bestY = edgeThreshold + 1e-6;
  for (const o of rel) {
    const b = aabb(o);
    const yNear = a.minY < b.maxY + edgeThreshold && a.maxY > b.minY - edgeThreshold;
    const xNear = a.minX < b.maxX + edgeThreshold && a.maxX > b.minX - edgeThreshold;
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
  return { x: t.x + dx, y: t.y + dy, connectedTo: null };
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
      // like the buildings they stand in for (they sit on the same layer 2). Pack decor pieces
      // (a 1x1 plant, a street lamp) are meant to nestle beside/into builds — no overlap noise.
      if (a.kind === 'terrain' || a.kind === 'note' || b.kind === 'terrain' || b.kind === 'note') continue;
      if (a.kind === 'decor' || b.kind === 'decor') continue;
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

// Stud coordinates → a friendly 1-indexed row/column pair (default 8-stud cell) — used only for
// accessibility announcements (ACC-4), e.g. "placed at row 3, column 5", so screen-reader users
// get a spatial reference without colour.
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

// ---- QOL-8 / QOL-10: per-tile lock + per-layer show-hide/lock + Kid Mode -------------------
// Pure predicates deciding whether a tile is *editable* (draggable / rotatable / deletable /
// nudgeable / alignable) or *visible*, given the current view/interaction prefs. Only `tile.locked`
// is part of the saved city model (serialised + undoable); `layerLocks`, `layerVis`, `kidMode`
// and `kidNewIds` are session/localStorage prefs kept OUT of the undo history.
export function layerOf(tile) { return tile.layer ?? 2; }

// A tile is visible unless its stacking layer has been explicitly hidden.
export function isLayerVisible(tile, layerVis) {
  if (!layerVis) return true;
  return layerVis[layerOf(tile)] !== false;
}

// Editable ⇔ (a) not individually locked, (b) its layer isn't locked, (c) its layer isn't hidden,
// and (d) — in Kid Mode — it was placed during THIS Kid-Mode session (only new pieces move; the
// frozen layout can't). `kidNewIds` may be any object exposing `.has(id)` (a Set), or null when Kid
// Mode is off. `opts` all default to the "no restrictions" case so a bare isTileEditable(t) is true
// for a normal, unlocked tile.
export function isTileEditable(tile, { layerLocks = null, layerVis = null, kidMode = false, kidNewIds = null } = {}) {
  if (tile.locked) return false;
  const layer = layerOf(tile);
  if (layerLocks && layerLocks[layer]) return false;
  if (layerVis && layerVis[layer] === false) return false;
  if (kidMode && !(kidNewIds && kidNewIds.has(tile.id))) return false;
  return true;
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
