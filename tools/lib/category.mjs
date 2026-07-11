export function categoryFor(themeName = '', root = '', map = {}) {
  const key = themeName.toLowerCase();
  if (map[key]) return map[key];
  if (/police/.test(key)) return 'police';
  if (/fire/.test(key)) return 'fire';
  if (/train/.test(key)) return 'train';
  if (/modular/.test(key)) return 'modular';
  if (/space|mars|lunar/.test(key)) return 'space';
  if (/arctic/.test(key)) return 'arctic';
  if (/harbo|coast/.test(key)) return 'harbor';
  if (/farm/.test(key)) return 'farm';
  if (/airport/.test(key)) return 'airport';
  if (/park|garden/.test(key)) return 'park';
  if (root === 'Modular') return 'modular';
  return 'city';
}
