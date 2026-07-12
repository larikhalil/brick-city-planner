const KEY = 'bcp.cities';
const CUR = 'bcp.current';

export function serializeCity({ name, units = 'studs', placed = [], grid = null }) {
  return {
    app: 'brick-city-planner', version: 1, name, units, placed,
    ...(grid ? { grid } : {}),
    updated: new Date().toISOString(),
  };
}

export function validateCity(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid file.' };
  if (obj.app !== 'brick-city-planner') return { ok: false, error: 'Not a Brick City Planner file.' };
  if (obj.version !== 1) return { ok: false, error: `Unsupported version: ${obj.version}.` };
  if (!Array.isArray(obj.placed)) return { ok: false, error: 'Missing placed sets.' };
  for (const p of obj.placed) {
    if (typeof p.set_num !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        !Number.isFinite(p.w) || !Number.isFinite(p.h)) {
      return { ok: false, error: 'A placed set is malformed.' };
    }
  }
  return { ok: true, city: obj };
}

export function exportCityJson(city) {
  return JSON.stringify(city, null, 2);
}

export function importCityJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'File is not valid JSON.' }; }
  return validateCity(obj);
}

function store() { return globalThis.localStorage; }

export function loadCities() {
  try { return JSON.parse(store().getItem(KEY)) || {}; } catch { return {}; }
}
export function saveCity(city) {
  const all = loadCities();
  all[city.name] = city;
  try {
    store().setItem(KEY, JSON.stringify(all));
    store().setItem(CUR, city.name);
  } catch (e) { console.warn('Save failed (storage full?):', e.message); }
}
export function loadCity(name) { return loadCities()[name] || null; }
export function currentCityName() { return store().getItem(CUR); }
export function deleteCity(name) {
  const all = loadCities();
  delete all[name];
  store().setItem(KEY, JSON.stringify(all));
}
// Rename a saved city slot in place. Only moves the "last opened" pointer along with it when
// that pointer was already aimed at `oldName` — renaming some OTHER saved city must not steal
// focus away from whatever the user currently has open. Returns false if `oldName` isn't saved.
export function renameCity(oldName, newName) {
  const all = loadCities();
  if (!all[oldName] || oldName === newName) return false;
  const wasCurrent = currentCityName() === oldName;
  const city = { ...all[oldName], name: newName };
  delete all[oldName];
  all[newName] = city;
  try {
    store().setItem(KEY, JSON.stringify(all));
    if (wasCurrent) store().setItem(CUR, newName);
  } catch (e) { console.warn('Rename failed (storage full?):', e.message); return false; }
  return true;
}
