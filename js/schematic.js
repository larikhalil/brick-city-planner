// Generic schematic art per tile kind, drawn behind the label to fill the tile.
// Returns an SVG string, or '' for kinds with no schematic (baseplate uses its
// flat colour; generic sets fall back to the tinted box photo).

function wrap(inner) {
  return `<svg class="schem" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
}

function road(name, wide) {
  const n = (name || '').toLowerCase();
  const junction = /cross|junction|t-|t &|and t|crossroad/.test(n);
  const edge = 'stroke="rgba(255,255,255,.5)" stroke-width="2"';
  const dash = 'stroke="#f4c430" stroke-width="2.6" stroke-dasharray="9 7"';
  let s = '';
  if (wide) {
    s += `<line x1="0" y1="9" x2="100" y2="9" ${edge}/><line x1="0" y1="91" x2="100" y2="91" ${edge}/>`;
    s += `<line x1="0" y1="50" x2="100" y2="50" ${dash}/>`;
    if (junction) s += `<line x1="50" y1="0" x2="50" y2="100" ${dash}/>`;
  } else {
    s += `<line x1="9" y1="0" x2="9" y2="100" ${edge}/><line x1="91" y1="0" x2="91" y2="100" ${edge}/>`;
    s += `<line x1="50" y1="0" x2="50" y2="100" ${dash}/>`;
    if (junction) s += `<line x1="0" y1="50" x2="100" y2="50" ${dash}/>`;
  }
  return wrap(s);
}

function track(wide) {
  let s = '';
  if (wide) {
    for (let x = 5; x < 100; x += 11) s += `<rect x="${x}" y="12" width="4" height="76" fill="#4b4038"/>`;
    s += '<rect x="0" y="33" width="100" height="4" fill="#2b2b30"/><rect x="0" y="63" width="100" height="4" fill="#2b2b30"/>';
  } else {
    for (let y = 5; y < 100; y += 11) s += `<rect x="12" y="${y}" width="76" height="4" fill="#4b4038"/>`;
    s += '<rect x="33" y="0" width="4" height="100" fill="#2b2b30"/><rect x="63" y="0" width="4" height="100" fill="#2b2b30"/>';
  }
  return wrap(s);
}

function building() {
  return wrap(
    '<rect x="0" y="0" width="100" height="24" fill="rgba(0,0,0,.24)"/>' +
    '<g fill="rgba(255,255,255,.8)"><rect x="13" y="40" width="13" height="13"/><rect x="43" y="40" width="13" height="13"/>' +
    '<rect x="73" y="40" width="13" height="13"/><rect x="13" y="66" width="13" height="13"/><rect x="73" y="66" width="13" height="13"/></g>' +
    '<rect x="42" y="66" width="16" height="24" fill="rgba(0,0,0,.34)"/>'
  );
}

function park() {
  return wrap(
    '<path d="M0 62 q50 -20 100 0 V100 H0 Z" fill="rgba(255,255,255,.12)"/>' +
    '<g><circle cx="26" cy="35" r="14" fill="#3f7d2e"/><rect x="24" y="45" width="4" height="12" fill="#6b4a2b"/>' +
    '<circle cx="66" cy="49" r="17" fill="#357026"/><rect x="64" y="63" width="4" height="15" fill="#6b4a2b"/>' +
    '<circle cx="80" cy="26" r="10" fill="#4a8a34"/></g>'
  );
}

function vehicle(wide) {
  const b = wide
    ? '<rect x="14" y="28" width="72" height="44" rx="12" fill="rgba(0,0,0,.28)"/><rect x="24" y="35" width="22" height="30" rx="4" fill="rgba(255,255,255,.82)"/>'
    : '<rect x="28" y="14" width="44" height="72" rx="12" fill="rgba(0,0,0,.28)"/><rect x="35" y="24" width="30" height="22" rx="4" fill="rgba(255,255,255,.82)"/>';
  return wrap(b);
}

export function schematicSVG(kind, e, name) {
  const wide = e.w >= e.h;
  switch (kind) {
    case 'road': return road(name, wide);
    case 'track': return track(wide);
    case 'building': return building();
    case 'park': return park();
    case 'vehicle': return vehicle(wide);
    default: return ''; // baseplate (flat colour) / generic (photo) — no schematic
  }
}
