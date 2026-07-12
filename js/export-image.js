// PLAN-4: pure layout maths + a concrete colour palette for the high-resolution PNG export /
// presentation mode. The scene is rasterised from the placed[] model straight onto an offscreen
// <canvas> (see the drawScene glue in app.js) rather than by screenshotting the live DOM, so the
// output is crisp at any zoom. Everything here is pure — no DOM, no canvas at module scope — so the
// dimension/mapping maths import cleanly under `node --test` (which never touches a real canvas).

import { catColor } from './catalog.js';

// The three export magnifications offered in the dialog. 1× matches the on-screen PX; 2×/4× render
// the same scene onto a bigger canvas for print-sharp exports.
export const EXPORT_SCALES = [1, 2, 4];
export const STUD_PX = 6; // base device-pixels per stud at 1× (matches grid.js's PX so 1× is 1:1)

// Concrete hex for every CSS custom property a tile fill can reference. A canvas 2D context can't
// resolve `var(--x)` custom properties, so the export renders against this fixed table instead —
// deliberately the LIGHT, print-friendly :root palette from css/styles.css, regardless of the
// on-screen dark-mode toggle (an exported plan should read on white paper).
export const PALETTE = {
  '--g-green': '#7bab54', '--g-blue': '#4795cc', '--g-gray': '#949daa',
  '--g-sand': '#d6c288', '--g-white': '#e0e5ea',
  '--road': '#5a616b', '--track': '#8a7d68',
  '--t-police': '#2f7fe0', '--t-fire': '#e8463a', '--t-train': '#1f9d76',
  '--t-city': '#4d7194', '--t-modular': '#c9993c', '--t-road': '#7a869a',
  '--t-park': '#7ba838', '--t-space': '#7b5bd6',
  '--accent': '#ffcf33', '--accent-deep': '#e0a900', '--accent-ink': '#241905',
  '--ink': '#0f1a2b', '--ink-soft': '#57667e', '--ink-faint': '#5e6d84',
  '--panel': '#ffffff', '--sunk': '#eef2f8',
};

// Neutral fallback for an unknown var / null colour — the mid grey baseplate tone.
const FALLBACK = '#949daa';

// Resolve a tile's stored colour string to a concrete canvas fillStyle. Handles the four forms a
// tile can carry: a `var(--x)` reference (looked up in PALETTE), a literal hex, an rgb()/rgba()/
// hsl() string (canvas understands these verbatim — terrain zoning tints use them), or null.
export function resolveColor(color, fallback = FALLBACK) {
  if (!color || typeof color !== 'string') return fallback;
  const v = color.trim();
  const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m) return PALETTE[m[1]] || fallback;
  if (/^#|^rgb|^hsl/i.test(v)) return v;
  return fallback;
}

// Category → concrete hex, mirroring catalog.js's catColor() (which returns var() names) through the
// palette above. Used for the default tile tint when a tile carries no explicit colour.
export function catFill(category) { return resolveColor(catColor(category)); }

// Compute the full export layout from the city's content bounding box (studs) and the chosen
// options. Returns everything the canvas glue needs: the device-pixel canvas size, the stud→pixel
// transform (origin + pixels-per-stud), and — when a title card is requested — the card's pixel
// rect along the chosen edge. Pure: the same inputs always give the same numbers.
export function computeLayout(box, {
  scale = 1, padStuds = 4, titleCard = false, cardEdge = 'bottom', cardStuds = 26,
} = {}) {
  const ppu = STUD_PX * scale;            // device pixels per stud at this magnification
  const pad = Math.round(padStuds * ppu); // clear margin around the content on every side
  const contentW = Math.ceil(Math.max(0, box.w || 0)) * ppu;
  const contentH = Math.ceil(Math.max(0, box.h || 0)) * ppu;
  const baseW = pad * 2 + contentW;
  const baseH = pad * 2 + contentH;
  // The stud→pixel origin: a tile at the content's top-left (box.x, box.y) lands at the pad inset.
  const originX = pad - (box.x || 0) * ppu;
  const originY = pad - (box.y || 0) * ppu;

  const card = titleCard ? Math.round(cardStuds * ppu) : 0;
  let width = baseW, height = baseH, cardRect = null;
  if (card && cardEdge === 'right') {
    width = baseW + card;
    cardRect = { x: baseW, y: 0, w: card, h: baseH };
  } else if (card) { // 'bottom' (default)
    height = baseH + card;
    cardRect = { x: 0, y: baseH, w: baseW, h: card };
  }
  return { width, height, ppu, scale, pad, originX, originY, contentW, contentH, card, cardRect, cardEdge };
}

// Map a tile's stud rect to a device-pixel rect on the export canvas (its un-rotated top-left box;
// the caller rotates about the centre for rot ≠ 0, exactly like the on-screen tile transform).
export function tileRect(tile, layout) {
  return {
    x: layout.originX + tile.x * layout.ppu,
    y: layout.originY + tile.y * layout.ppu,
    w: tile.w * layout.ppu,
    h: tile.h * layout.ppu,
  };
}

// Pick the largest offered scale ≤ `requested` whose canvas stays within `maxPx` on its longest
// edge (browsers cap canvas dimensions, and huge 4× exports of a big city would blow memory). If
// even 1× overflows, drop to a sub-1 fractional scale that just fits. `opts` must match the ones
// passed to computeLayout so the estimate is honest.
export function fitScale(box, requested, opts = {}, maxPx = 8192) {
  for (const s of EXPORT_SCALES.filter((c) => c <= requested).sort((a, b) => b - a)) {
    const l = computeLayout(box, { ...opts, scale: s });
    if (Math.max(l.width, l.height) <= maxPx) return s;
  }
  const l1 = computeLayout(box, { ...opts, scale: 1 });
  const s = maxPx / Math.max(1, l1.width, l1.height);
  return Math.max(0.1, Math.floor(s * 100) / 100);
}

// ---- canvas drawing ----------------------------------------------------------
// These take a 2D context and only ever call standard CanvasRenderingContext2D methods (never touch
// the DOM), so they run against a real canvas in the browser AND against a recording mock context
// under `node --test`. The app.js glue owns the actual <canvas>, image preloading and download.

// Export paint order — mirrors grid.js's render() so the PNG stacks tiles like the board: terrain
// below the baseplates, baseplates next, everything else by z, sticky notes always on top.
export function exportPaintKey(p) {
  return p.kind === 'terrain' ? -2000
    : p.kind === 'note' ? 9000 + (p.z ?? 3)
      : (p.layer === 0 ? -1000 : (p.z ?? p.layer ?? 2));
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A centred single-line tile label, only when the tile is big enough to read; a dark scrim keeps
// text legible over a photo fill. Truncated with an ellipsis to the tile width.
function drawLabel(ctx, r, text, color, ppu, scrim) {
  if (!text || r.w < 34 || r.h < 20) return;
  const fs = Math.max(7, Math.min(r.h * 0.3, ppu * 1.8, 15));
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let label = String(text);
  const max = r.w - 6;
  while (label.length > 1 && ctx.measureText(label).width > max) label = label.slice(0, -1);
  if (label !== String(text) && label.length > 1) label = label.slice(0, -1) + '…';
  if (scrim) {
    const tw = Math.min(max, ctx.measureText(label).width + 8);
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    roundRectPath(ctx, r.x + (r.w - tw) / 2, r.y + r.h / 2 - fs * 0.75, tw, fs * 1.5, fs * 0.4); ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

// Faint baseplate grid (every 32 studs) under the tiles — the app skips this in presentation mode.
function drawGrid(ctx, layout, box) {
  const { ppu, originX, originY, scale } = layout;
  ctx.save();
  ctx.strokeStyle = 'rgba(15,26,43,.10)';
  ctx.lineWidth = Math.max(1, scale);
  const x0 = Math.floor(box.x / 32) * 32, x1 = Math.ceil((box.x + box.w) / 32) * 32;
  const y0 = Math.floor(box.y / 32) * 32, y1 = Math.ceil((box.y + box.h) / 32) * 32;
  for (let sx = x0; sx <= x1; sx += 32) {
    const px = originX + sx * ppu;
    ctx.beginPath(); ctx.moveTo(px, originY + y0 * ppu); ctx.lineTo(px, originY + y1 * ppu); ctx.stroke();
  }
  for (let sy = y0; sy <= y1; sy += 32) {
    const py = originY + sy * ppu;
    ctx.beginPath(); ctx.moveTo(originX + x0 * ppu, py); ctx.lineTo(originX + x1 * ppu, py); ctx.stroke();
  }
  ctx.restore();
}

// Draw one tile. Rotation is applied about the tile centre, exactly like the on-screen CSS
// rotate() transform, so angled roads/buildings export the way they look. `imgs` maps a thumbnail
// URL → a decoded image for the MOTION-1 building photo fill (empty map ⇒ tinted boxes).
export function drawTile(ctx, t, layout, imgs = new Map()) {
  const r = tileRect(t, layout);
  const s = layout.scale, ppu = layout.ppu;
  ctx.save();
  if (t.rot) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.translate(cx, cy); ctx.rotate((t.rot * Math.PI) / 180); ctx.translate(-cx, -cy);
  }
  const kind = t.kind || 'generic';
  const fill = resolveColor(t.color, catFill(t.category));

  if (kind === 'terrain') { // flat landscaping/zoning fill, no label
    ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.restore(); return;
  }
  if (kind === 'note') { // yellow sticky + its text
    ctx.fillStyle = '#ffe89a'; roundRectPath(ctx, r.x, r.y, r.w, r.h, 2 * s); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = s; ctx.stroke();
    drawLabel(ctx, r, t.text || '', '#3a2e05', ppu, false);
    ctx.restore(); return;
  }

  ctx.fillStyle = fill;
  if (t.layer === 0) ctx.fillRect(r.x, r.y, r.w, r.h); // baseplate — flush, no radius
  else { roundRectPath(ctx, r.x, r.y, r.w, r.h, 2 * s); ctx.fill(); }

  const wide = t.w >= t.h;
  if (kind === 'road') { // asphalt fill + a dashed yellow centre lane down the travel axis
    ctx.save();
    ctx.strokeStyle = '#f4c430'; ctx.lineWidth = Math.max(1.5, 1.5 * s);
    ctx.setLineDash([6 * s, 5 * s]); ctx.lineCap = 'round';
    ctx.beginPath();
    if (wide) { ctx.moveTo(r.x + 3 * s, r.y + r.h / 2); ctx.lineTo(r.x + r.w - 3 * s, r.y + r.h / 2); }
    else { ctx.moveTo(r.x + r.w / 2, r.y + 3 * s); ctx.lineTo(r.x + r.w / 2, r.y + r.h - 3 * s); }
    ctx.stroke(); ctx.restore();
  } else if (kind === 'track') { // ballast fill + wooden ties across + two steel rails along
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = Math.max(1, 1.2 * s);
    const span = wide ? r.w : r.h, step = Math.max(6 * s, span / 8);
    for (let d = step / 2; d < span; d += step) {
      ctx.beginPath();
      if (wide) { ctx.moveTo(r.x + d, r.y + r.h * 0.18); ctx.lineTo(r.x + d, r.y + r.h * 0.82); }
      else { ctx.moveTo(r.x + r.w * 0.18, r.y + d); ctx.lineTo(r.x + r.w * 0.82, r.y + d); }
      ctx.stroke();
    }
    ctx.strokeStyle = '#33333a'; ctx.lineWidth = Math.max(1, 1.4 * s);
    for (const f of [0.34, 0.66]) {
      ctx.beginPath();
      if (wide) { ctx.moveTo(r.x, r.y + r.h * f); ctx.lineTo(r.x + r.w, r.y + r.h * f); }
      else { ctx.moveTo(r.x + r.w * f, r.y); ctx.lineTo(r.x + r.w * f, r.y + r.h); }
      ctx.stroke();
    }
    ctx.restore();
  } else if (kind === 'building') {
    const img = t.img && imgs.get(t.img);
    if (img) { // MOTION-1: the real thumbnail as a top-down cover fill, gently category-tinted
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 2 * s); ctx.clip();
      const cover = Math.max(r.w / img.width, r.h / img.height);
      const sw = r.w / cover, sh = r.h / cover;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
      ctx.fillStyle = catFill(t.category) + '55'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    const fb = Math.max(2 * s, r.h * 0.12); // MOTION-1 south-edge facade cue (turns with the tile)
    ctx.fillStyle = '#e0a900';
    ctx.fillRect(r.x + 3 * s, r.y + r.h - fb, r.w - 6 * s, Math.max(1.5 * s, fb * 0.5));
    drawLabel(ctx, r, t.name, img ? '#fff' : '#0f1a2b', ppu, !!img);
  } else if (kind === 'park') {
    ctx.fillStyle = '#3f7d2e';
    for (const [fx, fy, fr] of [[0.28, 0.4, 0.16], [0.62, 0.55, 0.2], [0.78, 0.28, 0.12]]) {
      ctx.beginPath(); ctx.arc(r.x + r.w * fx, r.y + r.h * fy, Math.min(r.w, r.h) * fr, 0, Math.PI * 2); ctx.fill();
    }
    drawLabel(ctx, r, t.name, '#12351f', ppu, false);
  } else { // custom (MOC) / vehicle / generic — a labelled tinted box
    drawLabel(ctx, r, t.name || (kind === 'custom' ? 'MOC' : ''), '#0f1a2b', ppu, false);
  }
  ctx.restore();
}

// The optional title card along one edge: city name + a stats row (sets / pieces / footprint) and a
// small "Brick City Planner" watermark, drawn on the light palette so it prints cleanly.
function drawCard(ctx, layout, stats, name) {
  const c = layout.cardRect; if (!c) return;
  const s = layout.scale, pad = 12 * s;
  ctx.save();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.fillStyle = '#e0a900'; // accent band along the card's inner edge
  if (layout.cardEdge === 'right') ctx.fillRect(c.x, c.y, 4 * s, c.h);
  else ctx.fillRect(c.x, c.y, c.w, 4 * s);

  const x = c.x + pad;
  let y = c.y + pad + 4 * s;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#0f1a2b';
  ctx.font = `700 ${Math.round(16 * s)}px system-ui, sans-serif`;
  ctx.fillText(name || 'Untitled city', x, y);
  y += Math.round(22 * s);
  ctx.fillStyle = '#57667e';
  ctx.font = `600 ${Math.round(12 * s)}px system-ui, sans-serif`;
  const pieces = stats.pieces ? `${stats.pieces.toLocaleString()} pieces` : '0 pieces';
  ctx.fillText(`${stats.setCount} set${stats.setCount === 1 ? '' : 's'}  ·  ${pieces}`, x, y);
  y += Math.round(17 * s);
  ctx.fillText(`Footprint ${stats.w} × ${stats.h} studs  ·  ${Math.round(stats.w * 0.8)} × ${Math.round(stats.h * 0.8)} cm`, x, y);

  ctx.fillStyle = '#5e6d84';
  ctx.font = `600 ${Math.round(10 * s)}px system-ui, sans-serif`;
  ctx.fillText('🧱 Brick City Planner', x, c.y + c.h - pad - 8 * s);
  ctx.restore();
}

// Render the whole scene onto `ctx`: background, optional grid, every tile in paint order, and the
// optional title card. Pure with respect to the DOM — the caller sizes the canvas and supplies
// preloaded building images + the precomputed stats.
export function drawScene(ctx, {
  tiles, layout, box, imgs = new Map(), presentation = false, titleCard = false, stats = null, name = '',
}) {
  ctx.fillStyle = presentation ? '#ffffff' : '#f3f6fb'; // clean white vs. the drafting board tone
  ctx.fillRect(0, 0, layout.width, layout.height);
  if (!presentation) drawGrid(ctx, layout, box);
  for (const t of [...tiles].sort((a, b) => exportPaintKey(a) - exportPaintKey(b))) drawTile(ctx, t, layout, imgs);
  if (titleCard && layout.cardRect) drawCard(ctx, layout, stats || { setCount: 0, pieces: 0, w: 0, h: 0 }, name);
}
