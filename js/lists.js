// Pure helper for small localStorage-backed lists (currently just the recently-placed rail).
// No DOM, no fetch — fully unit-testable.

// Move `id` to the front of `arr`, de-duplicated, capped at `max` entries. Returns a NEW array
// (never mutates `arr`) so callers can just reassign: `recent = pushRecent(recent, num)`.
export function pushRecent(arr, id, max = 8) {
  const next = [id, ...arr.filter((x) => x !== id)];
  return next.slice(0, max);
}
