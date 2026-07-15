// Comprehensive QA capture: screenshots of every key state + a functional interaction pass that
// logs console/page errors and asserts core behaviours. Writes shots + report.json for review.
// Run: node tools/qa/audit.mjs [outDir]   (default tools/qa/shots)

import { mkdir, writeFile } from 'node:fs/promises';
import { startServer, launch, VIEWPORTS } from './lib.mjs';

const OUT = process.argv[2] || 'tools/qa/shots';
await mkdir(OUT, { recursive: true });

const srv = await startServer(8094);
const browser = await launch();
const report = { shots: [], checks: [], consoleErrors: [] };

function logCheck(name, ok, detail = '') { report.checks.push({ name, ok: !!ok, detail }); }

// Fresh page that records console errors + uncaught page errors into `errs`.
async function newPage(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.goto(`${srv.url}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#catalog-list .set', { timeout: 15000 });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}
async function shot(page, name) { const p = `${OUT}/${name}.png`; await page.screenshot({ path: p }); report.shots.push(name); }

try {
  // ---------- VISUAL STATES ----------
  {
    const { ctx, page, errs } = await newPage(VIEWPORTS.desktop);
    await shot(page, 'audit-desktop-empty');
    await page.click('#btn-sample'); await page.waitForTimeout(700);
    await shot(page, 'audit-desktop-sample');
    // dark mode
    await page.click('#btn-theme'); await page.waitForTimeout(400);
    await shot(page, 'audit-desktop-sample-dark');
    await page.click('#btn-theme'); await page.waitForTimeout(300);
    // guide modal
    await page.click('#btn-help'); await page.waitForTimeout(400);
    await shot(page, 'audit-desktop-guide');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // legacy on + grid view
    await page.click('#catalog-legacy'); await page.waitForTimeout(300);
    await page.click('#catalog-view button[data-view="grid"]'); await page.waitForTimeout(300);
    await shot(page, 'audit-desktop-gridview-legacy');
    logCheck('desktop flow raised no console/page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
    if (errs.length) report.consoleErrors.push(...errs.map((e) => `[desktop] ${e}`));
    await ctx.close();
  }

  // ---------- FUNCTIONAL PASS ----------
  {
    const { ctx, page, errs } = await newPage(VIEWPORTS.desktop);
    const count = () => page.locator('#grid-board .tile').count();
    // place via +
    await page.fill('#catalog-search', 'fire'); await page.waitForTimeout(400);
    await page.locator('#catalog-list .set .add').first().click(); await page.waitForTimeout(300);
    const n1 = await count(); logCheck('add button places a tile', n1 >= 1, `count=${n1}`);
    // select it, then Duplicate button
    await page.locator('#grid-board .tile').first().click(); await page.waitForTimeout(150);
    const dupDisabled = await page.locator('#btn-dup').isDisabled();
    logCheck('Duplicate button enables with a selection', !dupDisabled, `disabled=${dupDisabled}`);
    await page.click('#btn-dup'); await page.waitForTimeout(300);
    const n2 = await count(); logCheck('Duplicate button adds a copy', n2 === n1 + 1, `${n1}→${n2}`);
    // rotate + delete
    await page.click('#btn-rotate'); await page.waitForTimeout(150);
    await page.click('#btn-delete'); await page.waitForTimeout(200);
    // undo/redo
    await page.click('#btn-undo'); await page.waitForTimeout(150);
    await page.click('#btn-redo'); await page.waitForTimeout(150);
    // theme + toggles
    await page.click('#btn-theme'); await page.waitForTimeout(150);
    const isDark = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    logCheck('theme toggle sets data-theme=dark', isDark === 'dark', `data-theme=${isDark}`);
    await page.click('#btn-theme'); await page.click('#btn-cbsafe'); await page.click('#btn-snap'); await page.waitForTimeout(150);
    // tool modes
    for (const m of ['terrain', 'note', 'rect', 'select']) { await page.click(`#tool-mode button[data-mode="${m}"]`); await page.waitForTimeout(80); }
    // zoom + table
    await page.click('#zoom-ctrl button[data-zoom="in"]'); await page.click('#zoom-ctrl button[data-zoom="out"]');
    await page.click('#zoom-ctrl button[data-zoom="fit"]'); await page.waitForTimeout(150);
    await page.click('#grid-size button[data-gs="winc"]'); await page.click('#grid-size button[data-gs="wdec"]'); await page.waitForTimeout(150);
    // modals open/close without error
    for (const [btn, backdrop, name] of [
      ['#btn-templates', '#templates-backdrop', 'Templates'],
      ['#btn-png', '#png-backdrop', 'Export image'],
      ['#btn-check', '#check-backdrop', 'Check my city'],
      ['#btn-cities', '#cities-backdrop', 'My cities'],
      ['#btn-help', '#shortcuts-backdrop', 'Guide'],
    ]) {
      await page.click(btn); await page.waitForTimeout(250);
      const open = await page.locator(backdrop).evaluate((el) => !el.hidden).catch(() => false);
      logCheck(`${name} modal opens`, open, `open=${open}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    }
    // 3D preview open/close
    await page.click('#btn-iso'); await page.waitForTimeout(500);
    const isoOpen = await page.locator('#iso-overlay').evaluate((el) => !el.hidden).catch(() => false);
    logCheck('3D preview opens', isoOpen, `open=${isoOpen}`);
    await page.click('#iso-back').catch(() => {}); await page.waitForTimeout(200);
    logCheck('functional pass raised no console/page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
    if (errs.length) report.consoleErrors.push(...errs.map((e) => `[functional] ${e}`));
    await ctx.close();
  }

  // ---------- MOBILE ----------
  {
    const { ctx, page, errs } = await newPage(VIEWPORTS.mobile, true);
    await shot(page, 'audit-mobile-empty');
    await page.click('#m-catalog'); await page.waitForTimeout(500);
    await shot(page, 'audit-mobile-catalog');
    await page.click('[data-sheet-close]').catch(() => {}); await page.waitForTimeout(300);
    await page.click('#btn-sample'); await page.waitForTimeout(600);
    await shot(page, 'audit-mobile-sample');
    await page.click('#m-summary').catch(() => {}); await page.waitForTimeout(500);
    await shot(page, 'audit-mobile-summary');
    logCheck('mobile flow raised no console/page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
    if (errs.length) report.consoleErrors.push(...errs.map((e) => `[mobile] ${e}`));
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed · ${report.consoleErrors.length} console errors · ${report.shots.length} shots`);
console.log(`report → ${OUT}/report.json`);
process.exit(failed.length || report.consoleErrors.length ? 1 : 0);
