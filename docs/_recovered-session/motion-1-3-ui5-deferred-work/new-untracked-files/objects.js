// Non-catalog canvas objects — terrain paint, sticky notes and custom MOC-blocking rectangles.
// These are modelled as ordinary tiles in placed[] (so they inherit save/undo/selection/move for
// free) but with their own `kind`, layer and paint order. Everything here is pure — no DOM, no
// fetch — so the tile-builders and rect maths are unit-testable in isolation.

// Kinds that aren't real catalog sets: they never carry a price, piece count or SKU, so the
// summary / buy-list / export maths skip them (see isCitySet). They still serialize + undo like
// any other tile because they live in placed[].
export const NON_SET_KINDS = new Set(['terrain', 'note', 'custom']);
export function isCitySet(t) { return !NON_SET_KINDS.has(t && t.kind); }

// Coarse grid the terrain brush snaps to (studs). Painting reasonably-sized rectangles — rather
// than a swarm of 1×1 cells — is what keeps a fully-landscaped city cheap to render/serialize.
export const CELL = 8;

// Terrain / zoning palette. The first four are literal ground materials; the last three are
// abstract zoning tints (semi-transparent so the drafting grid still reads through them). Kept in
// one place so the toolbar swatches and the tile fills can never drift apart.
export const TERRAIN_TYPES = [
  { key: 'grass', label: 'Grass', color: 'var(--g-green)' },
  { key: 'water', label: 'Water', color: 'var(--g-blue)' },
  { key: 'sand', label: 'Sand', color: 'var(--g-sand)' },
  { key: 'plaza', label: 'Plaza', color: 'var(--g-gray)' },
  { key: 'residential', label: 'Residential', color: 'rgba(123,171,84,.34)' },
  { key: 'commercial', label: 'Commercial', color: 'rgba(71,149,204,.34)' },
  { key: 'industrial', label: 'Industrial', color: 'rgba(214,163,60,.38)' },
];
export function terrainColor(type) {
  const e = TERRAIN_TYPES.find((t) => t.key === type);
  return e ? e.color : TERRAIN_TYPES[0].color;
}

// ---- tile factories ---------------------------------------------------------
// Each returns a flat tile object; the caller supplies the id (grid.js keeps the id counter).

// Terrain fill: paints FIRST, on a dedicated layer below the baseplates (layer -1), so empty
// space can read as intentional landscaping. Non-collidable (skipped by anyOverlaps).
export function makeTerrain({ id, x, y, w, h, type = 'grass' }) {
  return {
    id, set_num: 'terrain', name: 'Terrain', category: 'terrain', kind: 'terrain',
    x, y, w, h, rot: 0, approx: false, img: null,
    layer: -1, z: -1, color: terrainColor(type), terrain: type,
  };
}

// Sticky text label: sits above everything (layer 3), stores its own editable text.
export function makeNote({ id, x, y, w = 26, h = 16, text = 'Note' }) {
  return {
    id, set_num: 'note', name: 'Note', category: 'note', kind: 'note',
    x, y, w, h, rot: 0, approx: false, img: null,
    layer: 3, z: 3, color: null, text,
  };
}

// Custom footprint rectangle for a not-yet-chosen building / MOC. Lives on the building layer so
// it takes part in overlap warnings like a real set, but has no catalog price.
export function makeCustom({ id, x, y, w, h, label = 'MOC', color = null }) {
  return {
    id, set_num: 'custom', name: label || 'MOC', category: 'custom', kind: 'custom',
    x, y, w, h, rot: 0, approx: false, img: null,
    layer: 2, z: 2, color,
  };
}

// Normalise a dragged rectangle (two opposite corners, studs) into a clamped, grid-snapped
// {x, y, w, h} whose top-left is never negative and whose extent is at least `min`.
export function snapRect(x0, y0, x1, y1, step = 1, min = step) {
  const sx0 = Math.round(x0 / step) * step, sy0 = Math.round(y0 / step) * step;
  const sx1 = Math.round(x1 / step) * step, sy1 = Math.round(y1 / step) * step;
  // Clamp the top-left into the canvas first, then measure the extent from there — so a rect
  // dragged off the left/top edge shrinks against the boundary rather than sliding rightwards.
  const x = Math.max(0, Math.min(sx0, sx1)), y = Math.max(0, Math.min(sy0, sy1));
  const w = Math.max(min, Math.max(sx0, sx1) - x), h = Math.max(min, Math.max(sy0, sy1) - y);
  return { x, y, w, h };
}

// Do two axis-aligned rects {x,y,w,h} overlap? Edge-touching does NOT count (matches the SAT
// convention in geometry.js). Used by the terrain eraser to decide which fills a drag clears.
export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
