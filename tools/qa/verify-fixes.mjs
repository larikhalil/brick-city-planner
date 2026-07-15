// Behavioural regression checks for the Phase-A correctness fixes.
// Run: node tools/qa/verify-fixes.mjs   (exit 0 = all pass)

import { startServer, launch, openApp, loadSample, placeBySearch, tileCount, dragTile, tileSubTexts } from './lib.mjs';

const results = [];
function check(name, cond, detail = '') { results.push({ name, ok: !!cond, detail }); }

const srv = await startServer(8097);
const browser = await launch();
try {
  // ---- 1. Alt-drag must MOVE, never CLONE (the reported bug) --------------------
  {
    const { page } = await openApp(browser, { url: srv.url });
    await placeBySearch(page, 'fire');
    const n0 = await tileCount(page);
    check('a set is placed for the Alt test', n0 === 1, `count=${n0}`);

    const tile = page.locator('#grid-board .tile').first();
    const { before, after } = await dragTile(page, tile, 48, 0, { alt: true });
    const n1 = await tileCount(page);
    check('Alt-drag does NOT clone (count unchanged)', n1 === n0, `before=${n0} after=${n1}`);
    check('Alt-drag still moves the tile (bypass snap)', after && before && Math.abs(after.x - before.x) > 8,
      `dx=${after ? (after.x - before.x).toFixed(1) : 'n/a'}`);
  }

  // ---- 2. A plain drag must also not clone (baseline) ---------------------------
  {
    const { page } = await openApp(browser, { url: srv.url });
    await placeBySearch(page, 'fire');
    const n0 = await tileCount(page);
    const tile = page.locator('#grid-board .tile').first();
    await dragTile(page, tile, 32, 32, { alt: false });
    const n1 = await tileCount(page);
    check('Plain drag does NOT clone (count unchanged)', n1 === n0, `before=${n0} after=${n1}`);
  }

  // ---- 3. No internal "piece-*" slug leaks onto tile faces ----------------------
  {
    const { page } = await openApp(browser, { url: srv.url });
    await loadSample(page); // sample city has road pieces + a baseplate (synthetic set_nums)
    const subs = await tileSubTexts(page);
    const leaked = subs.filter((t) => /piece-/.test(t));
    check('no tile sub-line leaks a "piece-*" slug', leaked.length === 0,
      leaked.length ? `leaked: ${leaked.join(' | ')}` : `checked ${subs.length} tiles`);
  }
} finally {
  await browser.close();
  await srv.close();
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
