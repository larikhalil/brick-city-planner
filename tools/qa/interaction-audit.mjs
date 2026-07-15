// Interaction + stress audit: drives the REAL site with a realistic, long-named, retired-heavy city
// and programmatically flags what screenshots can't show — wrong cursors, text-selectable buttons,
// clipped badges/labels, and horizontal overflow. Run: node tools/qa/interaction-audit.mjs [outDir]

import { mkdir, writeFile } from 'node:fs/promises';
import { startServer, launch, VIEWPORTS } from './lib.mjs';

const OUT = process.argv[2] || 'tools/qa/shots';
await mkdir(OUT, { recursive: true });
const srv = await startServer(8088);
const browser = await launch();
const report = { viewports: {} };

// Build a demanding city: legacy ON (so retired sets are addable), then add several LONG-named and
// retired sets + some baseplates/roads, so the summary ownership list and catalog show real content.
async function buildStressCity(page) {
  await page.check('#catalog-legacy').catch(() => {});
  await page.waitForTimeout(300);
  const terms = ['assembly square', 'shell service', 'flowers', 'jazz club', 'fire station', 'roller coaster', 'downtown'];
  for (const t of terms) {
    await page.fill('#catalog-search', t); await page.waitForTimeout(250);
    const add = page.locator('#catalog-list .set .add').first();
    if (await add.count()) { await add.click().catch(() => {}); await page.waitForTimeout(150); }
  }
  // a few pieces via chips
  await page.fill('#catalog-search', ''); await page.waitForTimeout(150);
  await page.click('#catalog-chips .chip[data-cat="baseplate"]').catch(() => {});
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await page.locator('#catalog-list .set .add').nth(i).click().catch(() => {}); await page.waitForTimeout(120); }
  await page.click('#catalog-chips .chip[data-cat="all"]').catch(() => {});
  await page.waitForTimeout(200);
}

const AUDIT_FN = () => {
  const issues = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // 1) cursor + text-selectability on interactive elements
  const INTERACTIVE = 'button, .chip, a[href], [role="button"], .rail-item, a.buy, summary, select, input[type="checkbox"]';
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const txt = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28);
    if (cs.cursor === 'text' || cs.cursor === 'auto') issues.push({ type: 'cursor', sev: 'medium', detail: `${el.tagName}.${(el.className || '').toString().split(' ')[0]} cursor:${cs.cursor} — "${txt}"` });
    if (el.tagName === 'BUTTON' && cs.userSelect !== 'none' && cs.webkitUserSelect !== 'none') issues.push({ type: 'user-select', sev: 'low', detail: `button text-selectable — "${txt}"` });
  }
  // 2) badges / fixed labels that are clipped (these should NEVER truncate — unlike .on/.set-name which ellipsis on purpose)
  for (const el of document.querySelectorAll('.ret, .price, .fp, .oq, .badge, .count-pill, .oq, .wp i, .op i')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) issues.push({ type: 'clipped-badge', sev: 'high', detail: `${(el.className || '').toString().split(' ')[0]} "${el.textContent.trim().slice(0, 24)}" clipped ${el.scrollWidth}>${el.clientWidth}` });
  }
  // 3) horizontal overflow of key containers
  for (const sel of ['body', '.grid3', '#catalog-panel', '#summary-panel', '.own-list', '.wish-body', '.buys']) {
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2) issues.push({ type: 'overflow-x', sev: 'medium', detail: `${sel} content ${el.scrollWidth} > box ${el.clientWidth}` });
    }
  }
  // 4) any element whose text visibly overflows its box without ellipsis handling (unexpected clip).
  // Excludes the toolbars/catalog list — those are intentionally overflow:auto scroll containers.
  for (const el of document.querySelectorAll('.set-actions, .cacts, .cc-top, .cat-controls, .card-h, .brow, .setrow')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 2) issues.push({ type: 'row-overflow', sev: 'medium', detail: `${(el.className || '').toString().split(' ')[0]} row overflows ${el.scrollWidth}>${el.clientWidth}` });
  }
  return issues;
};

async function run(name, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.goto(`${srv.url}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#catalog-list .set', { timeout: 15000 });
  if (mobile) { await page.click('#m-catalog'); await page.waitForTimeout(300); }
  await buildStressCity(page);
  // hover a chip to capture cursor state in a screenshot too
  const issues = await page.evaluate(AUDIT_FN);
  report.viewports[name] = issues;
  // screenshots: catalog (a filtered set of long-named cards) + summary
  if (mobile) {
    await page.screenshot({ path: `${OUT}/ia-${name}-catalog.png` });
    await page.click('[data-sheet-close]').catch(() => {});
    await page.click('#m-summary').catch(() => {}); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/ia-${name}-summary.png` });
  } else {
    await page.screenshot({ path: `${OUT}/ia-${name}-full.png` });
  }
  await ctx.close();
}

try {
  await run('desktop', VIEWPORTS.desktop, false);
  await run('mobile', VIEWPORTS.mobile, true);
} finally {
  await browser.close();
  await srv.close();
}

await writeFile(`${OUT}/interaction-report.json`, JSON.stringify(report, null, 2));
let total = 0;
for (const [vp, issues] of Object.entries(report.viewports)) {
  console.log(`\n=== ${vp} — ${issues.length} issues ===`);
  for (const i of issues) { console.log(`  [${i.sev}] ${i.type}: ${i.detail}`); total++; }
}
console.log(`\nTOTAL: ${total} interaction/overflow issues`);
process.exit(total ? 1 : 0);
