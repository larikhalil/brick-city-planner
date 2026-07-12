// ACC-2c regression: categories that share a colour var (catColor()) must NOT also share an
// identical colorblind-safe pattern in css/styles.css — otherwise turning on the colorblind-safe
// toggle still leaves those categories 100% visually indistinguishable (see catalog.js CAT_VAR:
// arctic===police, harbor===airport===city, farm===park all resolve to the same var()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catColor } from '../js/catalog.js';

const CATEGORIES = [
  'police', 'fire', 'train', 'modular', 'city', 'park', 'space',
  'arctic', 'harbor', 'farm', 'airport',
];

// Pull each category's cbSafe declaration block straight out of the stylesheet: the selector
// list (to find which categories a block covers) plus its declaration body (the actual pattern).
function readCbSafePatterns() {
  const css = readFileSync(fileURLToPath(new URL('../css/styles.css', import.meta.url)), 'utf8');
  const blockRe = /(:root\[data-cbsafe="true"\][^{]*)\{([^}]*)\}/g;
  const byCategory = new Map();
  let m;
  while ((m = blockRe.exec(css))) {
    const [, selectors, body] = m;
    const cats = [...selectors.matchAll(/data-cat="([a-z]+)"/g)].map((x) => x[1]);
    for (const c of new Set(cats)) byCategory.set(c, (byCategory.get(c) || '') + body.trim());
  }
  return byCategory;
}

test('every colorblind-safe category has a declared pattern', () => {
  const patterns = readCbSafePatterns();
  for (const c of CATEGORIES) assert.ok(patterns.get(c), `missing cbSafe pattern for "${c}"`);
});

test('categories sharing catColor() never share an identical cbSafe pattern', () => {
  const patterns = readCbSafePatterns();
  const byColor = new Map();
  for (const c of CATEGORIES) {
    const color = catColor(c);
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(c);
  }
  for (const [color, cats] of byColor) {
    if (cats.length < 2) continue; // no collision to guard
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) {
        const a = cats[i], b = cats[j];
        assert.notEqual(
          patterns.get(a), patterns.get(b),
          `"${a}" and "${b}" share colour ${color} AND an identical cbSafe pattern`,
        );
      }
    }
  }
});
