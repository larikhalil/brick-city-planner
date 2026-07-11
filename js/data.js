export function indexByNum(sets) {
  const m = new Map();
  for (const s of sets) m.set(s.set_num, s);
  return m;
}

export async function loadCatalog(url = 'data/sets.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
  const sets = await res.json();
  return { sets, byNum: indexByNum(sets) };
}
