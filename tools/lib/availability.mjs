// Round-1 feedback (items 2a/2b): is a set still sold new by LEGO? Curated lists first
// (tools/availability.json, web-researched), then the year rule: LEGO City sets typically retail
// for ~18-24 months, so anything released >= availableFromYear counts as available and anything
// older counts as retired. Pure — unit-tested in test/availability.test.mjs.

export function resolveRetired(num, year, avail) {
  if (!avail) return false;
  const n = String(num);
  if (avail.availableSet ? avail.availableSet.has(n) : (avail.available || []).includes(n)) return false;
  if (avail.retiredSet ? avail.retiredSet.has(n) : (avail.retired || []).includes(n)) return true;
  const y = Number(year);
  if (!Number.isFinite(y)) return true; // undated pieces default to retired only when a rule exists
  return y < (avail.availableFromYear || 0);
}

// Pre-index the curated lists into Sets for O(1) lookups across 1700+ records.
export function indexAvailability(avail) {
  return {
    ...avail,
    availableSet: new Set(avail.available || []),
    retiredSet: new Set(avail.retired || []),
  };
}
