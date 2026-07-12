import { baseNum } from './pricing.js';

export function indexByNum(sets) {
  const m = new Map();
  for (const s of sets) m.set(s.set_num, s);
  return m;
}

export async function loadCatalog(url = 'data/sets.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
  const sets = await res.json();
  // Generic road/track variant pieces are listed first, before the real sets.
  let pieces = [];
  try {
    const pr = await fetch('data/pieces.json');
    if (pr.ok) pieces = await pr.json();
  } catch { /* pieces are optional */ }
  // Real USD MSRPs for a partial seed of well-known sets (the bulk catalog has no prices).
  let prices = {};
  try {
    const pj = await fetch('data/prices.json');
    if (pj.ok) prices = await pj.json();
  } catch { /* prices are optional */ }
  // Round-1 feedback 3b: bundle-pack contents (element id, name, colour, qty, plan size) keyed by
  // bare pack number — drives the Spare-parts panel and whole-pack buy math. Optional by design:
  // a stale cache without the file degrades to per-item behaviour.
  let packs = {};
  try {
    const pk = await fetch('data/packs.json');
    if (pk.ok) packs = await pk.json();
  } catch { /* packs are optional */ }
  const all = pieces.concat(sets);
  // Attach a known real price to each set when we have one (keyed by bare set number).
  for (const s of all) { const p = prices[baseNum(s.set_num)]; if (Number.isFinite(p)) s.price = p; }
  return { sets: all, byNum: indexByNum(all), prices, packs };
}
