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
  const all = pieces.concat(sets);
  return { sets: all, byNum: indexByNum(all) };
}
