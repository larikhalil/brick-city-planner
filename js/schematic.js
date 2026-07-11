// Generic schematic art per tile kind, drawn behind the label to fill the tile.
// Each kind function returns the INNER svg markup; schematicSVG() wraps it and,
// for square tiles, spins it by the tile's rotation so roads/curves can face any way.
// Returns '' for kinds with no schematic (baseplate uses its flat colour; generic
// sets fall back to the tinted box photo).

const W = 'stroke="rgba(255,255,255,.5)" stroke-width="2" fill="none"'; // road edge line
const Y = 'stroke="#f4c430" stroke-width="2.6" stroke-dasharray="9 7" fill="none"'; // lane dashes
const RAIL = 'fill="none" stroke="#2b2b30" stroke-width="3"';

function road(name, wide) {
  const n = (name || '').toLowerCase();
  if (/curve|curved/.test(n)) {
    // quarter-turn road: bottom edge → right edge
    return `<path d="M32 100 A68 68 0 0 1 100 32" ${W}/>` +
      `<path d="M68 100 A32 32 0 0 1 100 68" ${W}/>` +
      `<path d="M50 100 A50 50 0 0 1 100 50" ${Y}/>`;
  }
  const junction = /cross|junction|t-|t &|and t|crossroad/.test(n);
  if (wide) {
    return `<line x1="0" y1="9" x2="100" y2="9" ${W}/><line x1="0" y1="91" x2="100" y2="91" ${W}/>` +
      `<line x1="0" y1="50" x2="100" y2="50" ${Y}/>` +
      (junction ? `<line x1="50" y1="0" x2="50" y2="100" ${Y}/>` : '');
  }
  return `<line x1="9" y1="0" x2="9" y2="100" ${W}/><line x1="91" y1="0" x2="91" y2="100" ${W}/>` +
    `<line x1="50" y1="0" x2="50" y2="100" ${Y}/>` +
    (junction ? `<line x1="0" y1="50" x2="100" y2="50" ${Y}/>` : '');
}

function track(name, wide) {
  const n = (name || '').toLowerCase();
  if (/curve|curved/.test(n)) {
    let ties = '';
    for (const a of [195, 225, 255]) {
      const r = (a * Math.PI) / 180;
      const x1 = (100 + 38 * Math.cos(r)).toFixed(1), y1 = (100 + 38 * Math.sin(r)).toFixed(1);
      const x2 = (100 + 62 * Math.cos(r)).toFixed(1), y2 = (100 + 62 * Math.sin(r)).toFixed(1);
      ties += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4b4038" stroke-width="4"/>`;
    }
    return ties + `<path d="M38 100 A62 62 0 0 1 100 38" ${RAIL}/><path d="M62 100 A38 38 0 0 1 100 62" ${RAIL}/>`;
  }
  let s = '';
  if (wide) {
    for (let x = 5; x < 100; x += 11) s += `<rect x="${x}" y="12" width="4" height="76" fill="#4b4038"/>`;
    return s + '<rect x="0" y="33" width="100" height="4" fill="#2b2b30"/><rect x="0" y="63" width="100" height="4" fill="#2b2b30"/>';
  }
  for (let y = 5; y < 100; y += 11) s += `<rect x="12" y="${y}" width="76" height="4" fill="#4b4038"/>`;
  return s + '<rect x="33" y="0" width="4" height="100" fill="#2b2b30"/><rect x="63" y="0" width="4" height="100" fill="#2b2b30"/>';
}

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

export function schematicSVG(kind, e, name, rot = 0) {
  const wide = e.w >= e.h;
  let inner = '';
  switch (kind) {
    case 'road': inner = road(name, wide); break;
    case 'track': inner = track(name, wide); break;
    case 'building': inner = building(); break;
    case 'park': inner = park(); break;
    case 'vehicle': inner = vehicle(wide); break;
    default: return ''; // baseplate (flat colour) / generic (photo)
  }
  // Square tiles orient via the rotate button (rot 0/90/180/270); non-square tiles
  // reorient by swapping w/h (extent), so they must NOT double-rotate here.
  const spin = e.w === e.h && rot ? ` style="transform:rotate(${rot}deg)"` : '';
  return `<svg class="schem" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"${spin}>${inner}</svg>`;
}
