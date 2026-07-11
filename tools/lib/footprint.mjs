const BUCKETS = [
  [80, 8, 8], [200, 16, 8], [400, 16, 16], [800, 32, 16], [1500, 32, 32],
];

export function estimateFootprint({ num_parts = 0, category = 'other' } = {}) {
  let w = 48, h = 32; // default for >= 1500 pieces
  for (const [max, bw, bh] of BUCKETS) {
    if (num_parts < max) { w = bw; h = bh; break; }
  }
  if (category === 'train') { h = 8; w = Math.min(64, Math.max(24, w * 2)); }
  else if (category === 'road') { w = 32; h = 32; }
  return { w, h };
}

export function resolveFootprint(set, curated = {}) {
  const c = curated[set.num] || curated[set.set_num];
  if (c) return { w: c.w, h: c.h, source: 'curated' };
  const e = estimateFootprint(set);
  return { w: e.w, h: e.h, source: 'estimated' };
}
