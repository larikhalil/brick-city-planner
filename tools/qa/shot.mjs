// Scenario screenshots across viewports. Run: node tools/qa/shot.mjs [outDir]
// Produces <outDir>/<scenario>-<viewport>.png for the standard review scenarios.

import { mkdir } from 'node:fs/promises';
import { startServer, launch, openApp, loadSample, VIEWPORTS } from './lib.mjs';

const OUT = process.argv[2] || 'tools/qa/shots';
await mkdir(OUT, { recursive: true });

const SCENARIOS = [
  { name: 'empty', setup: async () => {} },
  { name: 'sample', setup: async (p) => loadSample(p) },
];
// Which viewports each scenario runs in.
const MATRIX = [
  { vp: 'desktop', mobile: false },
  { vp: 'laptop', mobile: false },
  { vp: 'mobile', mobile: true },
];

const srv = await startServer(8096);
const browser = await launch();
try {
  for (const { vp, mobile } of MATRIX) {
    for (const sc of SCENARIOS) {
      const { ctx, page } = await openApp(browser, { url: srv.url, viewport: VIEWPORTS[vp], mobile });
      await sc.setup(page);
      await page.waitForTimeout(500);
      const path = `${OUT}/${sc.name}-${vp}.png`;
      await page.screenshot({ path });
      console.log('shot', path);
      // On mobile, also capture the catalog bottom-sheet open.
      if (mobile && sc.name === 'empty') {
        await page.click('#m-catalog');
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/catalog-${vp}.png` });
        console.log('shot', `${OUT}/catalog-${vp}.png`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log('done');
