// Round-1 feedback (item 4): derive real footprints from a set's INVENTORY instead of guessing
// from piece count. The physical anchors, in order of trust:
//   • baseplates in the set (part category 1, "Baseplate W x H [Raised/Road/…]") — the set stands
//     on them, so their joined size IS the footprint;
//   • modern 16x16 road plates (part 69958) — same logic;
//   • train/vehicle base plates ("Train Base 6 x 28", "Vehicle Base 4 x 12") — the chassis length
//     plus small overhangs bounds the vehicle's plan size;
//   • large ordinary plates (min side ≥ 8, max side ≥ 16) — a floor MINIMUM only (they could be
//     roofs/storeys, so they only ever RAISE a too-small estimate, never define the whole print).
// Pure functions, no fs/fetch — unit-tested in test/derive.test.mjs.

// Parse one inventory-part row (already joined with its parts.csv record) into footprint signals.
// `sig` is mutated (caller owns one per set).
export function collectSignal(sig, { partNum, partName, partCatId, quantity }) {
  const name = partName || '';
  const qty = Number(quantity) || 0;
  if (!qty) return;
  if (Number(partCatId) === 1) { // Baseplates (Duplo/Modulex live in other categories)
    const m = name.match(/Baseplate(?: Raised| Road)? (\d+) x (\d+)/i);
    if (m) sig.baseplates.push([Number(m[1]), Number(m[2]), qty]);
    return;
  }
  if (partNum === '69958' || String(partNum).startsWith('69958')) { // modern 16x16 road plate
    sig.roadPlates += qty;
    return;
  }
  let m = name.match(/^Train Base (\d+) x (\d+)/i);
  if (m && !/Duplo/i.test(name)) { sig.trainBases.push([Number(m[1]), Number(m[2]), qty]); return; }
  m = name.match(/^Vehicle Base (\d+) x (\d+)/i);
  if (m && !/Duplo/i.test(name)) { sig.vehicleBases.push([Number(m[1]), Number(m[2]), qty]); return; }
  m = name.match(/^Plate(?: Special)? (\d+) x (\d+)/i);
  if (m) {
    const w = Number(m[1]), h = Number(m[2]);
    if (Math.min(w, h) >= 8 && Math.max(w, h) >= 16) sig.largePlates.push([w, h, qty]);
  }
}

export function emptySignal() {
  return { baseplates: [], roadPlates: 0, trainBases: [], vehicleBases: [], largePlates: [] };
}

// Join a list of [w, h, qty] plates into one rectangle: equal-height plates butt side by side
// (32x32 + 16x32 → 48x32), equal-width plates stack, anything messier falls back to the bounding
// rectangle of an area-preserving row. Orientation is normalised so h <= w.
export function joinPlates(list) {
  const flat = [];
  for (const [w, h, qty] of list) for (let i = 0; i < qty; i++) flat.push([Math.max(w, h), Math.min(w, h)]);
  if (!flat.length) return null;
  const landscape = ({ w, h }) => ({ w: Math.max(w, h), h: Math.min(w, h) }); // orientation-free
  if (flat.length === 1) return landscape({ w: flat[0][0], h: flat[0][1] });
  // try: all same height → sum widths; all same width → sum heights
  const sameH = flat.every(([, h]) => h === flat[0][1]);
  if (sameH) return landscape({ w: flat.reduce((s, [w]) => s + w, 0), h: flat[0][1] });
  const sameW = flat.every(([w]) => w === flat[0][0]);
  if (sameW) return landscape({ w: flat[0][0], h: flat.reduce((s, [, h]) => s + h, 0) });
  // mixed sizes: area-preserving rectangle no narrower than the widest plate
  const area = flat.reduce((s, [w, h]) => s + w * h, 0);
  const maxW = Math.max(...flat.map(([w]) => w));
  return landscape({ w: maxW, h: Math.max(Math.min(...flat.map(([, h]) => h)), Math.ceil(area / maxW)) });
}

const clamp = (v) => Math.max(1, Math.min(128, Math.round(v)));

// Derive a footprint from the signals, or return null when the inventory says nothing useful.
// `kind` steers the vehicle/train heuristics (their bases bound the build; buildings need plates).
export function deriveFootprint(sig, { kind = 'generic' } = {}) {
  if (!sig) return null;
  // 1. Baseplates are the ground truth for anything built on them.
  if (sig.baseplates.length) {
    const j = joinPlates(sig.baseplates);
    if (j) return { w: clamp(j.w), h: clamp(j.h) };
  }
  // 2. Modern road plates (16x16 each) — tile them 2-wide beyond 2 plates.
  if (sig.roadPlates) {
    const n = sig.roadPlates;
    const cols = n <= 2 ? n : Math.ceil(n / 2);
    return { w: clamp(cols * 16), h: clamp((n <= 2 ? 1 : 2) * 16) };
  }
  // 3. Train bases: units couple end to end — width is the base width (+buffer overhang),
  //    length sums the bases plus ~4 studs of couplings/overhang each.
  if (sig.trainBases.length) {
    let len = 0, wid = 6;
    for (const [w, l, qty] of sig.trainBases) { len += (l + 4) * qty; wid = Math.max(wid, w); }
    return { w: clamp(len), h: clamp(wid) };
  }
  // 4. Vehicle bases: each base is one vehicle (chassis + bumpers ≈ +4 long, +2 wide);
  //    multiple vehicles park side by side.
  if (sig.vehicleBases.length && (kind === 'vehicle' || kind === 'generic')) {
    let across = 0, len = 0;
    for (const [w, l, qty] of sig.vehicleBases) {
      across += (w + 2) * qty + (qty - 1); // a stud of air between parked vehicles
      len = Math.max(len, l + 4);
    }
    return { w: clamp(len), h: clamp(across) };
  }
  return null;
}

// The largest single plate in the inventory sets a floor: the build stands on AT LEAST this.
// Returns null when there is no large plate.
export function plateFloor(sig) {
  if (!sig || !sig.largePlates.length) return null;
  let best = null, bestArea = 0;
  for (const [w, h] of sig.largePlates) {
    if (w * h > bestArea) { bestArea = w * h; best = { w: Math.max(w, h), h: Math.min(w, h) }; }
  }
  return best;
}
