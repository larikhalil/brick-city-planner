// PLAN-3 — "Check my city" buildability checker.
//
// A single pure pass over the placed[] model that finds concrete, actionable problems a builder
// would hit turning the plan into real bricks. No DOM, no fetch — it just takes the tiles and
// returns a typed, sorted list of issues, so every detector is unit-testable in isolation and the
// panel/glue in app.js stays thin. The issue kinds, mirroring the five things a plan can get wrong:
//   • floating   (error) — a physical piece with NO baseplate under it (a building/road on thin air).
//   • overhang   (warn)  — a piece only PARTLY over the ground: it hangs off a baseplate edge, so
//                          some of its studs have nothing to clutch. (a) supported-by-ground check.
//   • overlap    (error) — two same-layer pieces occupy the same space (reuses geometry.overlapPairs,
//                          the exact rule the live board warns on).
//   • estimated  (info)  — a set still showing an '≈' estimated footprint: verify its real size.
//   • track-gap  (warn)  — a rail port that looks joined but doesn't mate (reuses PLAN-11's checkTrack
//                          gap list) — misaligned or not-quite-touching track.
// Support (floating/overhang) is judged by SAMPLING the piece's footprint over the union of every
// baseplate: a point-in-plate test at a grid of interior points, rotation-aware, so an angled tile
// and mixed baseplate sizes are handled the same way the rest of the app treats them.

import { overlapPairs, tileAABB } from './geometry.js';
import { isPhysical } from './objects.js';
import { checkTrack } from './track-check.js';

// A baseplate is any ground-layer tile (layer 0) — the same "this is the ground" test snapConnect
// and the paint order use. It's what everything else must sit on to be buildable.
export function isBaseplate(t) {
  return !!t && (t.layer ?? 2) === 0;
}

// Does this tile need ground under it? Every physical piece that isn't itself the ground: roads,
// tracks, buildings, generic sets and custom MOC blocks (all layer ≥ 1). Terrain paint and sticky
// notes (excluded by isPhysical) are annotation, not bricks, so they never need support.
export function needsSupport(t) {
  return isPhysical(t) && (t.layer ?? 2) > 0;
}

// Max interior sample points per axis when measuring baseplate coverage — one per stud, capped so a
// very large custom piece stays cheap. Denser than this buys no accuracy for stud-grid placement.
const MAX_SAMPLES = 20;

// How much of a tile's footprint sits over baseplate? Samples a grid of interior points (stud
// centres, up to MAX_SAMPLES per axis) transformed into world space by the tile's position + centre
// rotation, and counts how many land inside ANY baseplate's box. Returns {inside, total}: total is
// the sample count, inside how many were over ground. Pure + rotation-aware.
export function coverage(tile, plates) {
  const boxes = plates.map(tileAABB);
  const nx = Math.max(1, Math.min(MAX_SAMPLES, Math.round(tile.w)));
  const ny = Math.max(1, Math.min(MAX_SAMPLES, Math.round(tile.h)));
  const cx = tile.x + tile.w / 2, cy = tile.y + tile.h / 2;
  const r = ((tile.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const eps = 1e-6;
  let inside = 0, total = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      // stud-centre sample in LOCAL coords (top-left origin), then rotate about the tile centre
      const lx = (i + 0.5) / nx * tile.w - tile.w / 2;
      const ly = (j + 0.5) / ny * tile.h - tile.h / 2;
      const px = cx + lx * co - ly * si, py = cy + lx * si + ly * co;
      total += 1;
      if (boxes.some((b) => px >= b.minX - eps && px <= b.maxX + eps && py >= b.minY - eps && py <= b.maxY + eps)) inside += 1;
    }
  }
  return { inside, total };
}

// Severity → sort rank (errors first, gentle info last) so the panel leads with what actually blocks
// a build. Kept as data so both the sort and the panel's per-severity counts read from one place.
const RANK = { error: 0, warn: 1, info: 2 };

const plural = (n, one, many = one + 's') => (n === 1 ? one : many);
const nameOf = (t) => (t && t.name) || 'a piece';

// Main entry point. `placed` is the whole city (any kinds — non-physical are ignored where they
// should be). `trackReport` lets a caller pass an already-computed checkTrack() result to avoid
// recomputing; omitted, it's derived here. Returns { ok, issues, counts } where issues is sorted
// most-severe-first and each carries { type, severity, ids, message } — ids drive click-to-select.
export function checkCity(placed, { trackReport = null } = {}) {
  const tiles = Array.isArray(placed) ? placed : [];
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const issues = [];

  // ---- (a)+(c) ground support -----------------------------------------------------------------
  const plates = tiles.filter(isBaseplate);
  const supportSeekers = tiles.filter(needsSupport);
  if (!plates.length) {
    // No ground at all: rather than flag every piece separately, surface one actionable issue —
    // "add a baseplate" — selecting all the unsupported pieces at once.
    if (supportSeekers.length) {
      issues.push({
        type: 'floating', severity: 'error', ids: supportSeekers.map((t) => t.id),
        message: `${supportSeekers.length} ${plural(supportSeekers.length, 'piece has', 'pieces have')} no baseplate beneath ${plural(supportSeekers.length, 'it', 'them')} — add a baseplate as a foundation.`,
      });
    }
  } else {
    for (const t of supportSeekers) {
      const { inside, total } = coverage(t, plates);
      if (inside === 0) {
        issues.push({
          type: 'floating', severity: 'error', ids: [t.id],
          message: `“${nameOf(t)}” is floating — no baseplate underneath it.`,
        });
      } else if (inside < total) {
        const pct = Math.round((1 - inside / total) * 100);
        issues.push({
          type: 'overhang', severity: 'warn', ids: [t.id],
          message: `“${nameOf(t)}” hangs off the baseplate edge (about ${pct}% unsupported).`,
        });
      }
    }
  }

  // ---- (b) same-layer overlaps ----------------------------------------------------------------
  for (const [a, b] of overlapPairs(tiles)) {
    issues.push({
      type: 'overlap', severity: 'error', ids: [a.id, b.id],
      message: `“${nameOf(a)}” overlaps “${nameOf(b)}” on the same layer.`,
    });
  }

  // ---- (d) estimated '≈' footprints -----------------------------------------------------------
  // Only real catalog sets carry `approx` (terrain/notes/custom always set it false), so this is
  // exactly the set of pieces whose footprint is a guess worth double-checking.
  for (const t of tiles) {
    if (!t.approx) continue;
    issues.push({
      type: 'estimated', severity: 'info', ids: [t.id],
      message: `“${nameOf(t)}” uses an estimated (≈) footprint — confirm its real size.`,
    });
  }

  // ---- (e) track port gaps (PLAN-11) ----------------------------------------------------------
  // Reuse the continuity validator's `gaps` — ports that look adjacent but don't mate. Each real
  // gap shows up twice (once from each side); dedupe on the unordered tile pair so the panel lists
  // one issue per physical gap.
  const tr = trackReport || checkTrack(tiles);
  const seenGap = new Set();
  for (const g of tr.gaps || []) {
    const other = g.near && g.near.tileId;
    const key = other != null ? [g.tileId, other].map(String).sort().join('|') + '|' + g.reason : `${g.tileId}|${g.port}`;
    if (seenGap.has(key)) continue;
    seenGap.add(key);
    const a = byId.get(g.tileId), b = other != null ? byId.get(other) : null;
    const ids = [g.tileId, other].filter((id) => id != null);
    const message = g.reason === 'not-facing'
      ? `Misaligned track: “${nameOf(a)}” and “${nameOf(b)}” sit next to each other but face the wrong way.`
      : `Track gap: “${nameOf(a)}” and “${nameOf(b)}” don't quite meet (${g.dist} studs apart).`;
    issues.push({ type: 'track-gap', severity: 'warn', ids, message });
  }

  // Stable sort by severity so errors lead, then warnings, then info — order within a rank is the
  // detection order above (support → overlap → estimated → track).
  issues.sort((p, q) => RANK[p.severity] - RANK[q.severity]);

  const counts = { error: 0, warn: 0, info: 0 };
  for (const it of issues) counts[it.severity] += 1;

  return { ok: issues.length === 0, issues, counts };
}
