export function extent(tile) {
  const swap = tile.rot === 90 || tile.rot === 270;
  return { w: swap ? tile.h : tile.w, h: swap ? tile.w : tile.h };
}

export function overlaps(a, b) {
  const ea = extent(a), eb = extent(b);
  return a.x < b.x + eb.w && a.x + ea.w > b.x &&
         a.y < b.y + eb.h && a.y + ea.h > b.y;
}

export function bbox(tiles) {
  if (!tiles.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const e = extent(t);
    minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + e.w); maxY = Math.max(maxY, t.y + e.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function snap(value, step = 1) {
  return Math.round(value / step) * step;
}

export function anyOverlaps(tiles) {
  const ids = new Set();
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      // A set resting on a baseplate is intended, not an overlap: skip pairs where
      // exactly one tile is ground. Two buildings, or two baseplates, still flag.
      if (!!a.ground !== !!b.ground) continue;
      if (overlaps(a, b)) { ids.add(a.id); ids.add(b.id); }
    }
  }
  return ids;
}
