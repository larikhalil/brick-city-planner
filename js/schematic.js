// Generic schematic art per tile kind, drawn behind the label to fill the tile.
// Each kind function returns the INNER svg markup; schematicSVG() wraps it and,
// for square tiles, spins it by the tile's rotation so roads/curves can face any way.
// Returns '' for kinds with no schematic (baseplate uses its flat colour; generic
// sets fall back to the tinted box photo).

// Road/track surface palette. These asphalt/ballast greys read fine on the light canvas but wash
// out (look near-white, brightest thing on screen) against the dark canvas, so they're now CSS
// custom properties themed per mode in styles.css — the schematic SVG resolves them via inline
// `style="stop-color:var(--…)"` (see grad()). The yellow lane accent stays a fixed colour.
const ROAD_A = 'var(--road-a)', ROAD_B = 'var(--road-b)', ROAD_C = 'var(--road-c)'; // asphalt light→dark
const WALK = '#aeb3ba';                                            // sidewalk grey (fixed — thin edges, reads OK either theme)
const CURB = 'stroke="rgba(255,255,255,.4)" stroke-width="1.5" fill="none"';                     // kerb highlight
const LANE = 'stroke="#f4c430" stroke-width="3" stroke-dasharray="10 8" stroke-linecap="round" fill="none"'; // centre dashes
const BAL_A = 'var(--bal-a)', BAL_B = 'var(--bal-b)', BAL_C = 'var(--bal-c)';     // track ballast light→dark
const TIE = '#6d5a45', TIE_SH = 'rgba(0,0,0,.28)';                 // sleeper wood + its cast shadow
const RAILDK = '#33333a', RAILHI = '#7c7c86';                      // steel rail + top highlight

// A subtle light→dark grey gradient for asphalt / ballast fills, shading ACROSS the direction of
// travel for a faint rounded-surface feel. Each call mints a fresh gradient id: schematic SVGs are
// re-generated wholesale on every full render() and never mutated in place, so the id is unique in
// the live DOM and two tiles never share (or fight over) one definition.
let _uid = 0;
function grad(axis, a, b, c) {
  const id = 'g' + (_uid++);
  const coords = axis === 'x' ? 'x1="0" y1="0" x2="100" y2="0"' : 'x1="0" y1="0" x2="0" y2="100"';
  // stop-color set via `style` (not the attribute) so CSS custom properties like var(--road-a) resolve.
  const def = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" ${coords}>` +
    `<stop offset="0" style="stop-color:${a}"/><stop offset=".5" style="stop-color:${b}"/><stop offset="1" style="stop-color:${c}"/></linearGradient></defs>`;
  return { id, def };
}

// ---- roads ------------------------------------------------------------------
// Ports are unchanged from the old flat art: the roadway spans studs 8..92 across its width and
// reaches both travel edges, with the centre lane always on the 50-line so dashes line up tile-to-tile.
function roadStraight(wide) {
  const g = grad(wide ? 'y' : 'x', ROAD_A, ROAD_B, ROAD_C);
  if (wide) {
    return g.def +
      `<rect x="0" y="8" width="100" height="84" fill="url(#${g.id})"/>` +
      `<rect x="0" y="0" width="100" height="8" fill="${WALK}"/><rect x="0" y="92" width="100" height="8" fill="${WALK}"/>` +
      `<line x1="0" y1="8" x2="100" y2="8" ${CURB}/><line x1="0" y1="92" x2="100" y2="92" ${CURB}/>` +
      `<line x1="0" y1="50" x2="100" y2="50" ${LANE}/>`;
  }
  return g.def +
    `<rect x="8" y="0" width="84" height="100" fill="url(#${g.id})"/>` +
    `<rect x="0" y="0" width="8" height="100" fill="${WALK}"/><rect x="92" y="0" width="8" height="100" fill="${WALK}"/>` +
    `<line x1="8" y1="0" x2="8" y2="100" ${CURB}/><line x1="92" y1="0" x2="92" y2="100" ${CURB}/>` +
    `<line x1="50" y1="0" x2="50" y2="100" ${LANE}/>`;
}

function roadCross() {
  const g = grad('x', ROAD_A, ROAD_B, ROAD_C);
  const corner = (x, y) => `<rect x="${x}" y="${y}" width="8" height="8" rx="2" fill="${WALK}"/>`;
  return g.def +
    `<rect x="0" y="0" width="100" height="100" fill="url(#${g.id})"/>` +
    corner(0, 0) + corner(92, 0) + corner(0, 92) + corner(92, 92) +
    `<path d="M8 0 L8 8 L0 8" ${CURB}/><path d="M92 0 L92 8 L100 8" ${CURB}/>` +
    `<path d="M0 92 L8 92 L8 100" ${CURB}/><path d="M100 92 L92 92 L92 100" ${CURB}/>` +
    `<line x1="0" y1="50" x2="100" y2="50" ${LANE}/><line x1="50" y1="0" x2="50" y2="100" ${LANE}/>`;
}

// T-junction: a full through road plus a same-width spur meeting the far edge at centre, so a road
// tile butted against that edge connects cleanly (spur asphalt fills the same 8..92 band).
function roadTee(wide) {
  const g = grad(wide ? 'y' : 'x', ROAD_A, ROAD_B, ROAD_C);
  if (wide) {
    return g.def +
      `<rect x="0" y="8" width="100" height="84" fill="url(#${g.id})"/>` +   // through (L↔R)
      `<rect x="8" y="50" width="84" height="50" fill="url(#${g.id})"/>` +    // spur (↓)
      `<rect x="0" y="0" width="100" height="8" fill="${WALK}"/>` +           // far sidewalk (full)
      `<rect x="0" y="92" width="8" height="8" rx="2" fill="${WALK}"/><rect x="92" y="92" width="8" height="8" rx="2" fill="${WALK}"/>` +
      `<line x1="0" y1="8" x2="100" y2="8" ${CURB}/>` +
      `<line x1="0" y1="92" x2="8" y2="92" ${CURB}/><line x1="92" y1="92" x2="100" y2="92" ${CURB}/>` +
      `<line x1="8" y1="92" x2="8" y2="100" ${CURB}/><line x1="92" y1="92" x2="92" y2="100" ${CURB}/>` +
      `<line x1="0" y1="50" x2="100" y2="50" ${LANE}/><line x1="50" y1="50" x2="50" y2="100" ${LANE}/>`;
  }
  return g.def +
    `<rect x="8" y="0" width="84" height="100" fill="url(#${g.id})"/>` +      // through (↕)
    `<rect x="50" y="8" width="50" height="84" fill="url(#${g.id})"/>` +      // spur (→)
    `<rect x="0" y="0" width="8" height="100" fill="${WALK}"/>` +
    `<rect x="92" y="0" width="8" height="8" rx="2" fill="${WALK}"/><rect x="92" y="92" width="8" height="8" rx="2" fill="${WALK}"/>` +
    `<line x1="8" y1="0" x2="8" y2="100" ${CURB}/>` +
    `<line x1="92" y1="0" x2="92" y2="8" ${CURB}/><line x1="92" y1="92" x2="92" y2="100" ${CURB}/>` +
    `<line x1="92" y1="8" x2="100" y2="8" ${CURB}/><line x1="92" y1="92" x2="100" y2="92" ${CURB}/>` +
    `<line x1="50" y1="0" x2="50" y2="100" ${LANE}/><line x1="50" y1="50" x2="100" y2="50" ${LANE}/>`;
}

// Quarter-turn: an asphalt annulus (radii 8..92, centre lane on r=50) from the bottom edge to the
// right edge — or mirrored to the left. Arc kerbs give the rounded corners for free.
function roadCurve(left) {
  const g = grad('x', ROAD_A, ROAD_B, ROAD_C);
  if (left) {
    return g.def +
      `<path d="M100 100 A100 100 0 0 0 0 0 L0 8 A92 92 0 0 1 92 100 Z" fill="${WALK}"/>` +   // outer sidewalk
      `<path d="M8 100 A8 8 0 0 0 0 92 L0 100 Z" fill="${WALK}"/>` +                           // inner sidewalk (corner)
      `<path d="M92 100 A92 92 0 0 0 0 8 L0 92 A8 8 0 0 1 8 100 Z" fill="url(#${g.id})"/>` +    // asphalt
      `<path d="M92 100 A92 92 0 0 0 0 8" ${CURB}/><path d="M8 100 A8 8 0 0 0 0 92" ${CURB}/>` +
      `<path d="M50 100 A50 50 0 0 0 0 50" ${LANE}/>`;
  }
  return g.def +
    `<path d="M0 100 A100 100 0 0 1 100 0 L100 8 A92 92 0 0 0 8 100 Z" fill="${WALK}"/>` +
    `<path d="M92 100 A8 8 0 0 1 100 92 L100 100 Z" fill="${WALK}"/>` +
    `<path d="M8 100 A92 92 0 0 1 100 8 L100 92 A8 8 0 0 0 92 100 Z" fill="url(#${g.id})"/>` +
    `<path d="M8 100 A92 92 0 0 1 100 8" ${CURB}/><path d="M92 100 A8 8 0 0 1 100 92" ${CURB}/>` +
    `<path d="M50 100 A50 50 0 0 1 100 50" ${LANE}/>`;
}

function road(name, wide) {
  const n = (name || '').toLowerCase();
  if (/curve|curved/.test(n)) return roadCurve(/left/.test(n));
  if (/cross/.test(n)) return roadCross();
  if (/junction|t-|t &|and t/.test(n)) return roadTee(wide); // T = full one way + a spur
  return roadStraight(wide);
}

// ---- tracks -----------------------------------------------------------------
// Two steel rails on the original 33/63 lines (ports unchanged), each with a thin top highlight
// for a bit of depth, over wood sleepers on a grey ballast bed.
function rails(dir) {
  if (dir === 'v') {
    return `<rect x="33" y="0" width="4" height="100" fill="${RAILDK}"/><rect x="33" y="0" width="1.4" height="100" fill="${RAILHI}"/>` +
      `<rect x="63" y="0" width="4" height="100" fill="${RAILDK}"/><rect x="63" y="0" width="1.4" height="100" fill="${RAILHI}"/>`;
  }
  return `<rect x="0" y="33" width="100" height="4" fill="${RAILDK}"/><rect x="0" y="33" width="100" height="1.4" fill="${RAILHI}"/>` +
    `<rect x="0" y="63" width="100" height="4" fill="${RAILDK}"/><rect x="0" y="63" width="100" height="1.4" fill="${RAILHI}"/>`;
}
function railArc(d) {
  return `<path d="${d}" fill="none" stroke="${RAILDK}" stroke-width="4"/><path d="${d}" fill="none" stroke="${RAILHI}" stroke-width="1.4"/>`;
}

function trackStraight(wide) {
  const g = grad(wide ? 'y' : 'x', BAL_A, BAL_B, BAL_C);
  let ties = '';
  if (wide) {
    for (let x = 4; x < 100; x += 11) ties += `<rect x="${x}" y="12" width="6" height="76" rx="1" fill="${TIE}"/><rect x="${(x + 6).toFixed(0)}" y="12" width="1.5" height="76" fill="${TIE_SH}"/>`;
    return g.def + `<rect x="0" y="6" width="100" height="88" fill="url(#${g.id})"/>` + ties + rails('h');
  }
  for (let y = 4; y < 100; y += 11) ties += `<rect x="12" y="${y}" width="76" height="6" rx="1" fill="${TIE}"/><rect x="12" y="${(y + 6).toFixed(0)}" width="76" height="1.5" fill="${TIE_SH}"/>`;
  return g.def + `<rect x="6" y="0" width="88" height="100" fill="url(#${g.id})"/>` + ties + rails('v');
}

function trackCurve(left) {
  const g = grad('x', BAL_A, BAL_B, BAL_C);
  let ties = '';
  for (const a of [188, 206, 224, 242, 260]) { // radial sleepers spanning the arc (centre at 100,100)
    const r = (a * Math.PI) / 180;
    let x1 = 100 + 30 * Math.cos(r), y1 = 100 + 30 * Math.sin(r);
    let x2 = 100 + 70 * Math.cos(r), y2 = 100 + 70 * Math.sin(r);
    if (left) { x1 = 100 - x1; x2 = 100 - x2; }
    ties += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${TIE}" stroke-width="5"/>`;
  }
  const ballast = left
    ? `<path d="M72 100 A72 72 0 0 0 0 28 L0 72 A28 28 0 0 1 28 100 Z" fill="url(#${g.id})"/>`
    : `<path d="M28 100 A72 72 0 0 1 100 28 L100 72 A28 28 0 0 0 72 100 Z" fill="url(#${g.id})"/>`;
  const rr = left
    ? railArc('M62 100 A62 62 0 0 0 0 38') + railArc('M38 100 A38 38 0 0 0 0 62')
    : railArc('M38 100 A62 62 0 0 1 100 38') + railArc('M62 100 A38 38 0 0 1 100 62');
  return g.def + ballast + ties + rr;
}

function trackCross() {
  const g = grad('x', BAL_A, BAL_B, BAL_C);
  let ties = '';
  for (const y of [8, 20, 80, 92]) ties += `<rect x="16" y="${y}" width="68" height="5" rx="1" fill="${TIE}"/>`;
  for (const x of [8, 20, 80, 92]) ties += `<rect x="${x}" y="16" width="5" height="68" rx="1" fill="${TIE}"/>`;
  return g.def + `<rect x="0" y="0" width="100" height="100" fill="url(#${g.id})"/>` + ties +
    rails('v') + rails('h') +
    `<rect x="43" y="43" width="14" height="14" transform="rotate(45 50 50)" fill="${RAILDK}"/>`; // crossing frog
}

function trackSwitch(name) {
  const left = /left/.test(name);
  const g = grad('x', BAL_A, BAL_B, BAL_C);
  let ties = '';
  for (let y = 5; y < 100; y += 11) ties += `<rect x="10" y="${y}" width="70" height="5" rx="1" fill="${TIE}"/>`;
  const branchD = left ? 'M37 46 Q8 56 0 86' : 'M63 46 Q92 56 100 86';
  return g.def + `<rect x="4" y="0" width="92" height="100" fill="url(#${g.id})"/>` + ties + rails('v') + railArc(branchD);
}

function track(name, wide) {
  const n = (name || '').toLowerCase();
  if (/curve|curved/.test(n)) return trackCurve(/left/.test(n));
  if (/cross|crossover|diamond/.test(n)) return trackCross();
  if (/switch|points/.test(n)) return trackSwitch(n);
  return trackStraight(wide);
}

// ---- buildings / parks / vehicles (unchanged flat schematics) ---------------
function building() {
  return '<rect x="0" y="0" width="100" height="24" fill="rgba(0,0,0,.24)"/>' +
    '<g fill="rgba(255,255,255,.8)"><rect x="13" y="40" width="13" height="13"/><rect x="43" y="40" width="13" height="13"/>' +
    '<rect x="73" y="40" width="13" height="13"/><rect x="13" y="66" width="13" height="13"/><rect x="73" y="66" width="13" height="13"/></g>' +
    '<rect x="42" y="66" width="16" height="24" fill="rgba(0,0,0,.34)"/>';
}

function park() {
  return '<path d="M0 62 q50 -20 100 0 V100 H0 Z" fill="rgba(255,255,255,.12)"/>' +
    '<g><circle cx="26" cy="35" r="14" fill="#3f7d2e"/><rect x="24" y="45" width="4" height="12" fill="#6b4a2b"/>' +
    '<circle cx="66" cy="49" r="17" fill="#357026"/><rect x="64" y="63" width="4" height="15" fill="#6b4a2b"/>' +
    '<circle cx="80" cy="26" r="10" fill="#4a8a34"/></g>';
}

function vehicle(wide) {
  return wide
    ? '<rect x="14" y="28" width="72" height="44" rx="12" fill="rgba(0,0,0,.28)"/><rect x="24" y="35" width="22" height="30" rx="4" fill="rgba(255,255,255,.82)"/>'
    : '<rect x="28" y="14" width="44" height="72" rx="12" fill="rgba(0,0,0,.28)"/><rect x="35" y="24" width="30" height="22" rx="4" fill="rgba(255,255,255,.82)"/>';
}

export function schematicSVG(kind, e, name) {
  const wide = e.w >= e.h; // orient by the piece's own footprint; the whole tile rotates via CSS
  let inner = '';
  switch (kind) {
    case 'road': inner = road(name, wide); break;
    case 'track': inner = track(name, wide); break;
    case 'building': inner = building(); break;
    case 'park': inner = park(); break;
    case 'vehicle': inner = vehicle(wide); break;
    // pack decor piece (plant / lamp / prop): a simple centred stud-dot so a 1x1 element still
    // reads as SOMETHING when its part photo is missing (photos normally cover it)
    case 'decor': inner = '<circle cx="50" cy="50" r="26" fill="rgba(255,255,255,.75)"/><circle cx="50" cy="50" r="12" fill="rgba(0,0,0,.25)"/>'; break;
    default: return ''; // baseplate (flat colour) / generic (photo)
  }
  return `<svg class="schem" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
}
