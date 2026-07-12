// MOTION-4: optional non-rectangular footprints for known corner / L-shaped official sets.
// A handful of famous modulars (Assembly Square, Downtown Diner, …) aren't the plain rectangle
// their bounding box implies — they have a chamfered or notched corner that lets two of them
// nestle around a street intersection. This module keeps a tiny per-set override map of outline
// polygons and turns them into a CSS clip-path so those tiles render their REAL footprint instead
// of the bounding-box rectangle. Pure data + string maths — no DOM, no fetch, fully unit-testable.
//
// SCOPE / DOCUMENTED LIMITATION: this is a purely VISUAL clip. Collision / overlap detection
// (geometry.js overlaps / overlapPairs) still uses the axis-aligned bounding box, so a piece tucked
// into a shaped tile's cut corner can still register as an overlap. That's intentional — the
// bounding box stays the single source of truth for the "does it fit?" question, and only the
// paint is refined here. The common rectangular path is untouched: a set with no override returns
// null / '' and renders exactly as before.

import { baseNum } from './pricing.js';

// Outline polygons in NORMALISED fractional coordinates ([fx, fy], each 0..1 of the tile's w×h
// box, origin top-left, +y downward — matching the board's pixel space). The clip rotates with the
// tile (clip-path is applied in the element's own box before the CSS rotate transform), so the cut
// corner turns with the piece and users can aim it at any street.

// A 45°-chamfered corner (the top-right corner sliced off) — the classic corner-modular silhouette
// (e.g. Assembly Square's corner bank). Wound clockwise from the top-left.
const CORNER_CUT = [[0, 0], [0.7, 0], [1, 0.3], [1, 1], [0, 1]];

// A right-angle L — the top-right block removed, so the piece reads as two wings meeting at a
// corner (e.g. a corner garage forecourt). Wound clockwise from the top-left.
const ELL = [[0, 0], [0.6, 0], [0.6, 0.45], [1, 0.45], [1, 1], [0, 1]];

// Per-set outline overrides, keyed by BARE set number (the "-1" variant suffix is stripped on
// lookup, so '10255' and '10255-1' share one entry). Only genuinely corner/L-shaped official sets
// belong here — everything else stays a rectangle. Values are outline polygons (see above); an
// inline array is equally valid if a set needs a one-off shape.
export const OUTLINE_OVERRIDES = {
  10255: CORNER_CUT, // Assembly Square — chamfered corner bank
  10260: CORNER_CUT, // Downtown Diner — diagonal corner diner
  10297: CORNER_CUT, // Boutique Hotel — angled corner facade
  10264: ELL,        // Corner Garage — L-shaped forecourt
};

// The normalised outline polygon for a set, or null for the common rectangular case. Accepts a
// full set number ('10255-1') or a bare one ('10255'); anything without an override → null.
export function outlinePoints(setNum) {
  return OUTLINE_OVERRIDES[baseNum(setNum)] || null;
}

// Trim floating-point noise from the percent conversion while keeping genuine fractions.
const pct = (f) => Math.round(f * 1e4) / 100;

// A CSS clip-path polygon() clipping a tile to its real footprint, or '' for a plain rectangle
// (so the caller leaves rectangular tiles completely untouched). Percent units track the tile's
// own w×h box, so the same outline fits any size the set is placed at.
export function outlineClipPath(setNum) {
  const pts = outlinePoints(setNum);
  if (!pts) return '';
  return 'polygon(' + pts.map(([x, y]) => `${pct(x)}% ${pct(y)}%`).join(', ') + ')';
}
