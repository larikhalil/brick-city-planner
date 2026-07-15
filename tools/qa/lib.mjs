// Durable QA harness for Brick City Planner.
//
// Drives the REAL site in a real browser (system Chrome via Playwright's `channel:'chrome'`,
// so no bundled-browser download is needed). Used by:
//   - tools/qa/shot.mjs        — scenario screenshots (desktop + laptop + mobile)
//   - tools/qa/verify-fixes.mjs — behavioural regression checks (Alt bypass, id-leak, …)
//   - Phase-D QA agents        — import these helpers and script their own scenarios
//
// Placement note: desktop catalog→grid placement uses HTML5 drag-and-drop, which Playwright
// cannot fire natively. Every catalog row also has a "＋" (.add) button that places via the
// SAME onAdd() path — that is the deterministic way to put a piece on the grid from a test.
// Moving/dragging a PLACED tile uses pointer events, which page.mouse drives faithfully.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // repo root

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1180, height: 800 },
  mobile: { width: 390, height: 844 },
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

// Minimal static file server rooted at the repo (no python dependency).
export function startServer(port = 8099) {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/' || p.endsWith('/')) p += 'index.html';
      const abs = normalize(join(ROOT, p));
      if (!abs.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const info = await stat(abs).catch(() => null);
      if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }
      const body = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[extname(abs)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

export function launch() {
  return chromium.launch({ channel: 'chrome' });
}

// Open the app in a fresh context. Clears storage so every run starts from the first-run state.
export async function openApp(browser, { viewport = VIEWPORTS.desktop, mobile = false, url } = {}) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.goto(`${url}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#catalog-list .set', { timeout: 15000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}

// ---- interaction helpers ----------------------------------------------------

export async function loadSample(page) {
  await page.click('#btn-sample');
  await page.waitForTimeout(600);
}

// Place the Nth catalog row (0-based) via its ＋ button. Returns nothing.
export async function placeNth(page, n = 0) {
  const add = page.locator('#catalog-list .set .add').nth(n);
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await page.waitForTimeout(250);
}

// Search then place the first result. `query` matches the search box.
export async function placeBySearch(page, query) {
  await page.fill('#catalog-search', query);
  await page.waitForTimeout(400);
  await placeNth(page, 0);
}

export function tileCount(page) {
  return page.locator('#grid-board .tile').count();
}

// Pointer-drag a placed tile by (dx,dy) screen px, optionally holding Alt (bypass snap).
// Returns {before,after} bounding boxes of the dragged element.
export async function dragTile(page, tileLocator, dx, dy, { alt = false } = {}) {
  const box = await tileLocator.boundingBox();
  if (!box) throw new Error('tile has no bounding box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (alt) await page.keyboard.down('Alt');
  // several intermediate moves so pointermove handlers run like a real drag
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + (dx * i) / 6, cy + (dy * i) / 6);
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await page.waitForTimeout(250);
  const after = await tileLocator.boundingBox();
  return { before: box, after };
}

// Read the visible sub-line text of every placed tile (used to assert no slug leaks).
export function tileSubTexts(page) {
  return page.locator('#grid-board .tile .tsub').allInnerTexts();
}
