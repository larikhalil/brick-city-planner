// PLAN-11 — track continuity / loop-closure validator + buffer stops.
//
// A pure analysis over the placed TRACK pieces: it takes each track tile's world ports (reusing the
// exact same port maths as snapConnect, via geometry.tileWorldPorts) and works out, for every port,
// whether it MATES exactly with a port on another piece — position within a small epsilon AND an
// opposite heading. From that it reports:
//   • gaps     — a port that LOOKS adjacent to another (near in space) but doesn't actually mate
//                (too far apart, or facing the wrong way): the real "unfinished / misaligned" error.
//   • openEnds — a dangling port with nothing near it: track that just stops in mid-air.
//   • bufferStops — an open end on a piece flagged as a buffer stop / end-cap: an INTENTIONAL
//                terminal (a spur), so it is NOT counted as an error or a loose end.
//   • components — connected runs of track (via mated ports); each is flagged `closed` when every
//                one of its ports mates (a complete loop with no gaps and no open ends).
// No DOM, no fetch — pure, so the whole thing is unit-testable in isolation and feeds the
// buildability checker (PLAN-3) next.

import { tileWorldPorts } from './geometry.js';

// Two ports MATE when their openings sit on top of each other (within EPS studs) AND point in
// opposite directions (headings roughly antiparallel). EPS is well under half a stud so a
// hand-placed piece that's genuinely joined still counts, but a 2-stud gap never sneaks through.
export const MATE_EPS = 0.4; // studs — max separation for two ports to count as joined
export const OPPOSITE_DOT = -0.9; // heading dot ≤ this ⇒ ports face each other
// A port "looks adjacent" to another (and so a failure to mate is a GAP, not just a loose end) when
// another port sits within this radius. Bigger than MATE_EPS so a small misalignment reads as a gap.
export const ADJACENT = 6; // studs

// Is this tile a track piece the validator should analyse?
export function isTrack(t) {
  return !!t && t.kind === 'track';
}

// Is this tile an intentional terminal (buffer stop / end-cap)? Either the model flag set by the
// end-cap catalog piece, or a name that reads as one — so a hand-built spur can be capped either way.
export function isBufferStop(t) {
  return !!t && (t.bufferStop === true || /buffer|stop|end.?cap/i.test(t.name || ''));
}

// Build the flat port list once: every track tile's world ports, tagged with their owning tile.
function collectPorts(tiles) {
  const ports = [];
  for (const t of tiles) {
    if (!isTrack(t)) continue;
    const wp = tileWorldPorts(t);
    wp.forEach((p, i) => ports.push({
      tile: t, tileId: t.id, index: i,
      x: p.x, y: p.y, dx: p.dx, dy: p.dy,
      mate: null, // the port object this one joins (filled in below)
    }));
  }
  return ports;
}

// Do two ports mate exactly? (position within EPS AND opposite heading)
function mates(a, b, eps = MATE_EPS) {
  if (a.tileId === b.tileId) return false; // a piece never mates itself
  const dot = a.dx * b.dx + a.dy * b.dy;
  if (dot > OPPOSITE_DOT) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

// Nearest OTHER-tile port to `p` that is itself still UNMATED, with its distance — used to tell a
// GAP (something is right there that should join but doesn't line up) apart from a plain OPEN END
// (nothing joinable anywhere near). A port already mated to a different piece is intentionally
// skipped: a genuine gap is TWO unmated openings that fail to meet, so a neighbour that has already
// found its own partner is not a gap candidate. Without this, a switch's diverging port — which sits
// only ~4.74 studs (h·tan16.5°) from its own through-route joint — would latch onto the through
// straight's already-mated port and be falsely reported as a gap on every connected switch.
function nearestOther(p, ports) {
  let best = null, bestD = Infinity;
  for (const q of ports) {
    if (q === p || q.tileId === p.tileId || q.mate) continue;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best ? { port: best, dist: bestD } : null;
}

// Union-find over tiles joined by mated ports → connected track runs (components).
function components(tiles, ports) {
  const parent = new Map();
  const find = (id) => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(id) !== r) { const nxt = parent.get(id); parent.set(id, r); id = nxt; }
    return r;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const t of tiles) if (isTrack(t)) parent.set(t.id, t.id);
  for (const p of ports) if (p.mate) union(p.tileId, p.mate.tileId);
  const groups = new Map();
  for (const t of tiles) {
    if (!isTrack(t)) continue;
    const r = find(t.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t.id);
  }
  return [...groups.values()];
}

// Main entry point. Given the placed tiles (any kinds — non-track are ignored), return the
// continuity report. `eps`/`adjacent` are overridable for tests but default to the module constants.
export function checkTrack(tiles, { eps = MATE_EPS, adjacent = ADJACENT } = {}) {
  const all = Array.isArray(tiles) ? tiles : [];
  const ports = collectPorts(all);

  // Pass 1 — mate every port that can be mated. Greedy nearest exact mate; symmetric so both ends
  // get linked. A port already mated is skipped so one opening can't claim two partners.
  for (const p of ports) {
    if (p.mate) continue;
    let pick = null, pickD = Infinity;
    for (const q of ports) {
      if (q.mate || q === p) continue;
      if (!mates(p, q, eps)) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < pickD) { pickD = d; pick = q; }
    }
    if (pick) { p.mate = pick; pick.mate = p; }
  }

  // Pass 2 — classify every UNMATED port as a buffer stop, a gap, or an open end.
  const gaps = [], openEnds = [], bufferStops = [];
  for (const p of ports) {
    if (p.mate) continue;
    const at = { tileId: p.tileId, name: p.tile.name, port: p.index, x: round4(p.x), y: round4(p.y) };
    if (isBufferStop(p.tile)) { bufferStops.push(at); continue; }
    const near = nearestOther(p, ports);
    if (near && near.dist <= adjacent) {
      // Something sits right next to this opening but they don't join — misaligned or wrong-facing.
      const dot = p.dx * near.port.dx + p.dy * near.port.dy;
      gaps.push({
        ...at,
        near: { tileId: near.port.tileId, port: near.port.index },
        dist: round4(near.dist),
        reason: dot > OPPOSITE_DOT ? 'not-facing' : 'too-far',
      });
    } else {
      openEnds.push(at);
    }
  }

  const comps = components(all, ports).map((tileIds) => {
    const own = ports.filter((p) => tileIds.includes(p.tileId));
    const mated = own.filter((p) => p.mate).length;
    // A closed loop: at least one join, and NObody in the run is loose (every port mated). A lone
    // buffer stop with a single unmated port therefore doesn't read as a closed loop.
    const closed = own.length > 0 && mated === own.length && tileIds.length >= 3;
    return { tileIds, portCount: own.length, matedCount: mated, closed };
  });

  return {
    ok: gaps.length === 0,            // continuity is sound (loops close, joints line up)
    complete: gaps.length === 0 && openEnds.length === 0, // …and nothing dangles either
    gaps, openEnds, bufferStops,
    components: comps,
    trackCount: ports.length ? new Set(ports.map((p) => p.tileId)).size : 0,
  };
}

const round4 = (v) => Math.round(v * 1e4) / 1e4 || 0;
