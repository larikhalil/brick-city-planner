import { catColor } from './catalog.js';
import {
  anyOverlaps, overlapPairs, toRowCol, bbox, snap, snapConnectInfo, radiusMismatch,
  radiusClass, rotationStep, grownCanvas, clampedCanvas, BP,
  tilesInRect, alignTiles, distributeTiles, rotateGroup, isTileEditable, isLayerVisible, layerOf,
  tileInViewport,
} from './geometry.js';
import { esc } from './util.js';
import { schematicSVG } from './schematic.js';
import { makeTerrain, makeNote, makeCustom, snapRect, rectsIntersect, CELL } from './objects.js';
import { outlineClipPath } from './footprint-shapes.js';
import { scaleRefSVG } from './scale-ref.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text
const HANDLES = '<div class="rotate-handle" title="Drag to rotate"></div>';
// Round-1 feedback: notes + custom MOC blocks are drag-resizable (catalog sets stay fixed-size —
// their footprints are real; resize for sets was removed on purpose in f00ae43).
const SIZE_HANDLE = '<div class="size-handle" title="Drag to resize"></div>';
const handlesFor = (t) => HANDLES + ((t.kind === 'note' || t.kind === 'custom') ? SIZE_HANDLE : '');
const RESIZE_MIN = 4; // studs — matches the custom-rect tool's dragged minimum
const DEFAULT_W = 128, DEFAULT_H = 96; // studs — a 4×3 baseplate table to start
const HISTORY_MAX = 60; // undo depth (spec: at least 50 steps)
const PASTE_STEP = 8; // studs each paste/duplicate is nudged so copies don't hide the originals
const GHOST_MS = 240; // how long a delete's fading ghost sticks around (must match the CSS transition)
// PERF-1: studs of over-render past every viewport edge. render() paints only tiles whose AABB
// touches this margin-expanded viewport; the buffer lets you scroll/pan ~2 baseplates before a
// re-render is needed, so tiles never pop in at the seam. Cull is RENDER-ONLY, never touches placed[].
const CULL_MARGIN = 64;

// requestAnimationFrame doesn't exist under `node --test`'s DOM mock — fall back to a timer so
// the motion helpers below never throw there (and just skip visibly, since nothing paints anyway).
const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
// Respect the OS-level motion preference; `matchMedia` is also absent under the test's DOM mock.
function prefersReducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export function createGrid(board, {
  onChange = () => {}, onResize = () => {}, onHistory = () => {}, onSelect = () => {},
  onAnnounce = () => {}, onMode = () => {}, onRequestEdit = () => {}, onWarn = () => {},
  // QOL-10 / QOL-8 view + interaction prefs — supplied by app.js from localStorage/sessionStorage,
  // kept OUTSIDE placed[]/undo. layerVis/layerLocks are keyed by stacking layer (0/1/2…).
  layerVis: initLayerVis = null, layerLocks: initLayerLocks = null, kidMode: initKidMode = false,
  // PLAN-8 scale-reference overlay prefs (localStorage-backed in app.js; view-only, not in the city).
  scaleRef: initScaleRef = false, scaleUnit: initScaleUnit = 'studs',
  // Round-1 feedback: magnetic snapping toggle (localStorage-backed in app.js). NOTE the name —
  // `snap` would shadow the geometry import above.
  snapEnabled: initSnapEnabled = true,
} = {}) {
  let placed = [];
  let selection = new Set(); // ids of every selected tile
  let selectedId = null; // the primary/last selected — drives the rotate handle & focus
  let seq = 1;
  let groupSeq = 1;
  let zoom = 1;
  // UI-5 / MOTION-3 interaction mode: 'select' (default drag/select) | 'terrain' (paint area
  // fills) | 'note' (drop a sticky label) | 'rect' (draw a custom footprint block). `terrainType`
  // is the active terrain paint (a TERRAIN_TYPES key) or 'erase'. Both are pure UI state — never
  // part of placed[]/undo — so they live here, not in the city model.
  let mode = 'select';
  let terrainType = 'grass';
  let snapEnabled = initSnapEnabled !== false; // 🧲 magnetic snapping (hold Alt while dragging to bypass)
  let gridW = DEFAULT_W, gridH = DEFAULT_H; // canvas size in studs (always whole baseplates)
  const stage = board.parentElement;
  // ACC-5 (touch): only one pointer may drive a board interaction at a time — a 2nd finger never
  // starts its own drag/rotate/resize (it belongs to a pinch/pan gesture instead). `gestureLock`
  // is raised by app.js while a two-finger pinch/pan owns the board, freezing any single-pointer
  // drag already in flight. Both are inert on desktop (mouse only ever emits one pointer).
  let activePointerId = null;
  let gestureLock = false;
  function setGestureLock(on) { gestureLock = !!on; }

  // ---- QOL-8 / QOL-10: lock + Kid Mode + per-layer show-hide/lock ------------------------------
  // Per-layer visibility + lock (view/interaction prefs, NOT saved with the city, NOT undoable).
  let layerVis = { ...(initLayerVis || {}) };
  let layerLocks = { ...(initLayerLocks || {}) };
  // Kid Mode: freeze everything already placed; only pieces placed during this Kid-Mode session
  // (their ids collected in kidNewIds) can still be moved/rotated/deleted. Both are session state.
  let kidMode = !!initKidMode;
  let kidNewIds = new Set();
  const editOpts = () => ({ layerLocks, layerVis, kidMode, kidNewIds });
  // Editable ⇔ movable/rotatable/deletable right now. tile.locked is part of the model; the rest
  // are live prefs. Used to exclude locked/hidden/frozen tiles from every mutating action.
  const editable = (t) => isTileEditable(t, editOpts());
  const visible = (t) => isLayerVisible(t, layerVis);
  // Terrain fills are paint, not pieces — they're never part of a normal selection (kept out of
  // select-all, marquee and group/align). They're edited only through the terrain tool.
  const isSelectable = (t) => t.kind !== 'terrain';
  const editableSelected = () => selectedTiles().filter(editable);
  // A tile placed while Kid Mode is on stays editable (the fresh pieces the kid is arranging).
  const noteNew = (t) => { if (kidMode) kidNewIds.add(t.id); };

  // Undo/redo: a stack of deep-copied city snapshots. histIndex points at the live one.
  let history = [];
  let histIndex = -1;
  let coalesceKey = null; // successive same-key commits (e.g. arrow-nudges) fold into one step
  // In-memory clipboard for copy/paste (deep copies, absolute coords) + cascade offset.
  let clipboard = null;
  let pasteCount = 0;

  // ---- ACC-4: overlap-detection announcements ----------------------------------
  // Tracks which overlapping PAIRS have already been announced (keyed 'idA|idB', lower id first)
  // so a still-standing overlap doesn't re-announce on every unrelated commit — only a genuinely
  // NEW overlap does. The baseline is resynced (silently) whenever `placed` is replaced wholesale
  // (load/undo/redo) so that a pre-existing overlap in a loaded/restored city never gets mistaken
  // for "new" on the next live edit.
  let lastOverlapKeys = new Set();
  const pairKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  function syncOverlapBaseline() {
    lastOverlapKeys = new Set(overlapPairs(placed).map(([a, b]) => pairKey(a, b)));
  }
  function checkOverlapAnnounce() {
    const pairs = overlapPairs(placed);
    const keys = new Set();
    let fresh = null;
    for (const [a, b] of pairs) {
      const k = pairKey(a, b);
      keys.add(k);
      if (!fresh && !lastOverlapKeys.has(k)) fresh = [a, b];
    }
    lastOverlapKeys = keys;
    if (fresh) onAnnounce(`Overlap detected between ${fresh[0].name} and ${fresh[1].name}.`);
  }

  // Bottom-right corner grip for dragging the canvas bigger/smaller (snaps to baseplates).
  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = 'Drag to add baseplates';
  let gripIntroShown = false; // one-time fade pulse the first time the board renders (UI-2)

  // ---- PLAN-8: realistic scale-reference overlay ----------------------------------------------
  // A faint, non-interactive SVG (minifig/car/door silhouettes + a 10/50/100-stud ruler) laid over
  // the board in stud coordinates, so it scales with zoom for free. Hidden by default; toggle +
  // unit come from app.js (persisted like the other view prefs). Lives in a wrapper appended after
  // grip on every render() — render() wipes board.innerHTML, so it must be re-added like the grip.
  let scaleRefOn = !!initScaleRef;
  let scaleUnit = initScaleUnit === 'cm' ? 'cm' : 'studs';
  const scaleOverlay = document.createElement('div');
  // aria-hidden lives on the inner <svg> (built in scale-ref.js); the wrapper is inert chrome.
  scaleOverlay.className = 'scale-ref-wrap';
  function buildScaleOverlay() {
    scaleOverlay.innerHTML = scaleRefOn ? scaleRefSVG({ gridW, gridH, unit: scaleUnit, px: PX }) : '';
  }
  // Re-attach (and refresh) the overlay after a render() has cleared the board.
  function reattachScaleOverlay() { if (scaleRefOn) { buildScaleOverlay(); board.appendChild(scaleOverlay); } }

  // Right/bottom edge of everything placed, in studs (0,0 when empty).
  function contentExtent() { const b = bbox(placed); return { right: b.x + b.w, bottom: b.y + b.h }; }

  function applySize() {
    board.style.width = gridW * PX + 'px';
    board.style.height = gridH * PX + 'px';
    onResize(gridW, gridH);
    if (scaleRefOn) buildScaleOverlay(); // keep the overlay's SVG box in step when the table grows
  }
  // Auto-expand so the canvas always contains the content plus a margin (never shrinks here).
  function growToFit() {
    const { right, bottom } = contentExtent();
    const g = grownCanvas(right, bottom, gridW, gridH);
    if (g.w !== gridW || g.h !== gridH) { gridW = g.w; gridH = g.h; applySize(); }
  }
  // Manual resize (stepper), in whole baseplates. Won't cut off placed content.
  function setGridPlates(pw, ph) {
    const { right, bottom } = contentExtent();
    const g = clampedCanvas(Math.round(pw) * BP, Math.round(ph) * BP, right, bottom);
    gridW = g.w; gridH = g.h; applySize(); finalize('Resize table');
  }
  function getGrid() { return { w: gridW, h: gridH, pw: gridW / BP, ph: gridH / BP }; }

  // ---- history ----------------------------------------------------------------
  function snapshot(label) {
    return {
      label, gridW, gridH,
      placed: placed.map((p) => ({ ...p })), // tiles are flat objects → shallow-per-tile is a deep copy
      sel: [...selection], primary: selectedId,
    };
  }
  // Push the current state onto the undo stack (dropping any redo tail). `key` lets a run
  // of like actions (arrow-nudges) collapse into a single reversible step.
  function commit(label, key = null) {
    if (key && key === coalesceKey && histIndex === history.length - 1 && histIndex > 0) {
      history[histIndex] = snapshot(label); // fold into the step already on top
    } else {
      history.length = histIndex + 1; // drop the redo branch
      history.push(snapshot(label));
      if (history.length > HISTORY_MAX) history.shift();
      histIndex = history.length - 1;
    }
    coalesceKey = key;
    onHistory();
  }
  // Wipe history down to a single baseline (used after load / new / import).
  function resetHistory() {
    history = [snapshot('Open')];
    histIndex = 0;
    coalesceKey = null;
    onHistory();
  }
  function restore(snap) {
    placed = snap.placed.map((p) => ({ ...p }));
    gridW = snap.gridW; gridH = snap.gridH;
    seq = 1; groupSeq = 1;
    for (const p of placed) bumpSeqs(p);
    selection = new Set((snap.sel || []).filter((id) => placed.some((p) => p.id === id)));
    selectedId = (snap.primary && selection.has(snap.primary)) ? snap.primary : (selection.size ? [...selection][selection.size - 1] : null);
    coalesceKey = null;
    syncOverlapBaseline(); // undo/redo never announces — just keeps the "is this new?" baseline honest
    render(); applySize(); onChange(); onHistory(); emitSelect();
  }
  function undo() { if (canUndo()) { histIndex -= 1; restore(history[histIndex]); } }
  function redo() { if (canRedo()) { histIndex += 1; restore(history[histIndex]); } }
  function canUndo() { return histIndex > 0; }
  function canRedo() { return histIndex < history.length - 1; }
  // Jump straight to any point in the visible history list.
  function jumpHistory(i) { if (i >= 0 && i < history.length && i !== histIndex) { histIndex = i; restore(history[histIndex]); } }
  function getHistory() { return { entries: history.map((h) => h.label), index: histIndex }; }

  // Commit a structural/positional mutation: refresh the app, then snapshot for undo.
  function finalize(label, key = null) { onChange(); checkOverlapAnnounce(); commit(label, key); }

  // Keep the id/group counters ahead of anything already placed.
  function bumpSeqs(p) {
    const n = parseInt(String(p.id).replace(/^p/, ''), 10);
    if (Number.isFinite(n) && n >= seq) seq = n + 1;
    const g = parseInt(String(p.groupId || '').replace(/^g/, ''), 10);
    if (Number.isFinite(g) && g >= groupSeq) groupSeq = g + 1;
  }

  function makeTile(set, x, y) {
    return {
      id: 'p' + (seq++), set_num: set.set_num, name: set.name, category: set.category, kind: set.kind || 'generic',
      x, y, w: set.footprint.w, h: set.footprint.h, rot: 0,
      approx: set.footprint.source === 'estimated', img: set.img || null,
      layer: set.layer ?? 2, z: set.layer ?? 2, color: set.color || null,
      // PLAN-10: carry a curved-track piece's real radius class + turn increment onto the placed
      // tile so mismatch-warning (radiusMismatch) and rotation snapping (rotationStep) are data-driven.
      radius: set.radius || null, turn: Number.isFinite(set.turn) ? set.turn : null,
      // PLAN-11: carry the buffer-stop / end-cap flag onto the placed tile so the track-continuity
      // validator treats this piece's open end as an intentional terminal, not unfinished track.
      bufferStop: set.bufferStop === true || undefined,
      locked: false, // QOL-8: per-tile lock flag — part of the model (serialised + undoable)
    };
  }
  // ACC-4: "Fire Station placed at row 3, column 5." — announced BEFORE finalize() so it queues
  // ahead of any overlap announcement finalize's own commit might trigger for the same drop.
  function announcePlacement(set, t) {
    const { row, col } = toRowCol(t.x, t.y);
    onAnnounce(`${set.name} placed at row ${row}, column ${col}.`);
  }
  function addSet(set) {
    const t = makeTile(set, 0, 0); placed.push(t); noteNew(t); selectOnly(t.id); render(); growToFit();
    announcePlacement(set, t);
    finalize('Add ' + set.set_num);
  }
  // Drop from the catalog at screen coordinates, centring the piece on the drop point.
  function addSetAt(set, clientX, clientY) {
    const rect = board.getBoundingClientRect();
    const x = Math.max(0, Math.round((clientX - rect.left) / zoom / PX - set.footprint.w / 2));
    const y = Math.max(0, Math.round((clientY - rect.top) / zoom / PX - set.footprint.h / 2));
    const t = makeTile(set, x, y); placed.push(t); noteNew(t); selectOnly(t.id); render(); growToFit();
    announcePlacement(set, t);
    finalize('Add ' + set.set_num);
  }

  function getPlaced() { return placed; }
  function setPlaced(arr, size) {
    seq = 1; groupSeq = 1;
    placed = arr.map((p) => {
      const t = { ...p };
      if (t.layer == null) t.layer = t.ground ? 0 : 2; // back-compat with pre-layer saved cities
      if (t.kind == null) t.kind = t.ground ? 'baseplate' : 'generic';
      if (t.z == null) t.z = t.layer ?? 2;
      return t;
    });
    for (const p of placed) bumpSeqs(p);
    selection.clear(); selectedId = null;
    clipboard = null; pasteCount = 0;
    kidNewIds = new Set(); // a freshly loaded city is the frozen layout in Kid Mode — nothing is "new"
    // Restore the saved table size if given, else reset to the default; growToFit then
    // guarantees the canvas is never smaller than the content it now holds.
    gridW = (size && Number.isFinite(size.w)) ? size.w : DEFAULT_W;
    gridH = (size && Number.isFinite(size.h)) ? size.h : DEFAULT_H;
    syncOverlapBaseline(); // loading a city with pre-existing overlaps must not "announce" them
    render();
    growToFit();
    applySize();
    onChange();
    resetHistory();
    emitSelect();
  }

  // Stamp the grip's one-time intro pulse (UI-2) — only ever once, the very first time the
  // board renders with something in it (re-appending the grip on every full render() must not
  // replay it, or it'd pulse on every add/delete).
  function markGripIntro() {
    if (gripIntroShown) return;
    gripIntroShown = true;
    grip.classList.add('intro');
    grip.addEventListener?.('animationend', () => grip.classList.remove('intro'), { once: true });
  }

  // ---- PERF-1: viewport culling ---------------------------------------------------------------
  // The margin-expanded region (studs) the last render() actually painted, or null when culling was
  // off (whole city painted). A scroll/zoom only forces a re-render once the visible view pokes past
  // this buffer — while it stays inside, the already-painted tiles cover it and we do nothing.
  let renderedRegion = null;
  let cullRaf = 0; // coalesces a burst of scroll events into one rAF-timed re-render check
  // The currently-visible board rect in STUDS, or null if the stage can't be measured (pre-layout or
  // the test DOM mock, where scroll/client dims are absent) — null means "don't cull, paint it all".
  function viewportStuds() {
    const cw = stage && stage.clientWidth, ch = stage && stage.clientHeight;
    if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) return null;
    const sx = Number(stage.scrollLeft) || 0, sy = Number(stage.scrollTop) || 0;
    return { x: sx / zoom / PX, y: sy / zoom / PX, w: cw / zoom / PX, h: ch / zoom / PX };
  }
  // Re-render only if the visible view is no longer fully inside the buffer painted last time.
  function refreshCull() {
    const vp = viewportStuds();
    if (!vp || !renderedRegion) return; // nothing measurable, or last render painted everything
    const inside = vp.x >= renderedRegion.x && vp.y >= renderedRegion.y
      && vp.x + vp.w <= renderedRegion.x + renderedRegion.w
      && vp.y + vp.h <= renderedRegion.y + renderedRegion.h;
    if (!inside) render();
  }
  stage.addEventListener('scroll', () => {
    if (cullRaf) return;
    cullRaf = raf(() => { cullRaf = 0; refreshCull(); });
  }, { passive: true });

  function render() {
    // PERF-1: measure the viewport once up front. `vp` null → paint every tile (no culling); else we
    // skip any tile whose AABB misses the CULL_MARGIN-expanded viewport and record that expanded
    // region so scroll/zoom knows when the painted buffer no longer covers the view.
    const vp = viewportStuds();
    renderedRegion = vp ? {
      x: vp.x - CULL_MARGIN, y: vp.y - CULL_MARGIN,
      w: vp.w + 2 * CULL_MARGIN, h: vp.h + 2 * CULL_MARGIN,
    } : null;
    if (!placed.length) {
      board.innerHTML = `<div class="empty-hint">Add sets from the catalog to start your city →</div>`;
      board.appendChild(grip);
      reattachScaleOverlay();
      updateSelBox();
      return;
    }
    const over = anyOverlaps(placed);
    board.innerHTML = '';
    // Paint order: terrain fills paint first (below the baseplates), baseplates next, then
    // everything by its z (user-adjustable), and sticky notes always on top.
    const paintKey = (p) => (
      p.kind === 'terrain' ? -2000 :
      p.kind === 'note' ? 9000 + (p.z ?? 3) :
      p.layer === 0 ? -1000 : (p.z ?? p.layer ?? 2));
    const paintOrder = [...placed].sort((a, b) => paintKey(a) - paintKey(b));
    const single = selection.size === 1;
    for (const t of paintOrder) {
      // QOL-10: a hidden layer isn't painted at all (its tiles stay in placed[] — still saved,
      // still snap/overlap-computed — just invisible + non-interactive until shown again).
      if (!visible(t)) continue;
      // PERF-1: skip tiles outside the visible viewport (+ margin) so a 300+-tile / many-baseplate
      // city only ever builds DOM for what's on screen. Cull is RENDER-ONLY — the tile stays in
      // placed[] (still selected/saved/overlap-computed) and repaints the moment it scrolls into view.
      if (vp && !tileInViewport(t, vp, CULL_MARGIN)) continue;
      const kind = t.kind || 'generic';
      const el = document.createElement('div');
      // Tile is sized to its own footprint and rotated about its centre.
      el.style.left = t.x * PX + 'px';
      el.style.top = t.y * PX + 'px';
      el.style.width = t.w * PX + 'px';
      el.style.height = t.h * PX + 'px';
      if (t.rot) el.style.transform = `rotate(${t.rot}deg)`;
      el.style.setProperty?.('--rot', (t.rot || 0) + 'deg'); // read by the pop-in keyframe (MOTION-6)
      el.dataset.id = t.id;
      // Labels counter-rotate so they stay upright on angled tiles.
      const counter = t.rot ? ` style="transform:rotate(${-t.rot}deg)"` : '';

      // ---- MOTION-3 / UI-5: non-catalog canvas objects render on their own paths ----
      if (kind === 'terrain') {
        // A flat colour fill — no label, no schematic, and pointer-transparent (CSS) so it never
        // blocks selecting the pieces above it. Painted/erased via the terrain tool, never dragged.
        el.className = 'tile terrain flat';
        el.style.background = t.color || 'var(--g-green)';
        board.appendChild(el);
        continue;
      }
      const notEditable = !editable(t); // locked tile, locked layer, or a Kid-Mode-frozen piece
      if (kind === 'note') {
        el.className = 'tile note' + (selection.has(t.id) ? ' selected' : '') + (notEditable ? ' noedit' : '');
        el.tabIndex = 0;
        el.innerHTML = `<div class="note-text"${counter}>${esc(t.text || '')}</div>`;
        if (single && t.id === selectedId && editable(t)) el.insertAdjacentHTML('beforeend', handlesFor(t));
        board.appendChild(el);
        continue;
      }
      if (kind === 'custom') {
        // ACC-2: overlap is never colour-only — the red outline (.tile.warn) is joined by a
        // hazard-stripe texture (CSS ::before) AND an explicit ⚠ badge naming the state in text.
        const isOver = over.has(t.id);
        const sizeCls = Math.min(t.w, t.h) < 8 ? ' tiny' : (Math.min(t.w, t.h) < 14 ? ' small' : ''); // item 5a
        el.className = 'tile custom' + sizeCls + (isOver ? ' warn' : '') + (selection.has(t.id) ? ' selected' : '') + (notEditable ? ' noedit' : '');
        el.title = `${t.name} — ${t.w}×${t.h}`;
        el.tabIndex = 0;
        el.dataset.cat = '';
        if (t.color) el.style.background = t.color;
        el.innerHTML = (isOver ? '<span class="ov-flag" aria-hidden="true" title="Overlap">⚠</span>' : '') +
          `<div class="tlabel"${counter}>` +
          `<div class="tn">${esc(t.name)}</div>` +
          `<div class="tsub"><span>MOC</span><span>${t.w}×${t.h}</span></div></div>`;
        if (single && t.id === selectedId && editable(t)) el.insertAdjacentHTML('beforeend', handlesFor(t));
        board.appendChild(el);
        continue;
      }

      // ---- normal catalog tiles ----
      const layer = t.layer ?? 2;
      const lightGround = /--g-(white|sand)/.test(t.color || '');
      const isOver = over.has(t.id);
      // Item 5a: small tiles drop their sub-line, tiny tiles show art only (CSS keys off these).
      // Stud-based (not screen px) — w/h only change through re-rendering paths, zoom never does.
      const minSide = Math.min(t.w, t.h);
      const sizeCls = minSide < 8 ? ' tiny' : (minSide < 14 ? ' small' : '');
      el.className = 'tile' + sizeCls + ((DARK_TXT.has(t.category) || lightGround) ? ' dark-txt' : '') +
        (layer < 2 ? ' flat' : '') +
        (isOver ? ' warn' : '') + (selection.has(t.id) ? ' selected' : '') +
        (t.locked ? ' locked' : '') + (notEditable ? ' noedit' : '');
      el.title = `${t.name} — ${t.w}×${t.h}`; // hidden labels stay reachable on hover
      // ACC-2c: colorblind-safe theme hook — CSS keys a texture overlay off [data-cat] when the
      // user has the colorblind-safe toggle on, so categories stay distinguishable without hue.
      el.dataset.cat = t.category || '';
      // MOTION-4: a handful of known corner/L-shaped modulars clip to their real (non-rectangular)
      // outline instead of the bounding-box rectangle, so corner buildings nestle at intersections.
      // The clip MUST live on an inner `.tile-shape` fill wrapper, never on `.tile` itself: a
      // clip-path on `.tile` would also cut away the rotate handle (a child positioned above the
      // tile), the ACC-3 focus ring and the selection/overlap outlines (all painted OUTSIDE the box
      // via outline/box-shadow, which clip-path clips too). So for a shaped set the background +
      // schematic + photo + facade paint into the clipped wrapper, while the handle, rings and label
      // stay on the unclipped tile. Every other set paints straight onto the tile, exactly as before.
      // Purely visual — collision/overlap still use the bounding box (see footprint-shapes.js).
      const clip = outlineClipPath(t.set_num);
      const fill = clip ? document.createElement('div') : el; // element that carries background + art
      if (clip) { fill.className = 'tile-shape'; fill.style.clipPath = clip; el.classList.add('shaped'); }
      fill.style.background = t.color || catColor(t.category);
      let schem = '';
      if (kind === 'building' && t.img) {
        // MOTION-1: buildings show the set's real thumbnail as the tile fill for a top-down feel,
        // tinted just enough by the category colour that the label stays readable — no schematic art
        // beneath it. A dark scrim under the label (.tile.photo CSS) keeps text legible on any photo.
        el.classList.add('photo'); // label scrim/text colour live on the tile (the label isn't wrapped)
        fill.style.backgroundImage =
          `linear-gradient(${catColor(t.category)}80, ${catColor(t.category)}80), url("${t.img}")`;
        fill.style.backgroundSize = 'cover';
        fill.style.backgroundPosition = 'center';
        fill.style.backgroundBlendMode = 'multiply';
      } else {
        schem = schematicSVG(kind, { w: t.w, h: t.h }, t.name);
        if (t.img && !schem) { // generic sets keep the tinted box photo
          fill.style.backgroundImage =
            `linear-gradient(${catColor(t.category)}cc, ${catColor(t.category)}cc), url("${t.img}")`;
          fill.style.backgroundSize = 'cover';
          fill.style.backgroundBlendMode = 'multiply';
        }
      }
      // MOTION-1: a front-edge "facade" cue on buildings, defaulting to the tile's bottom edge. It
      // lives in tile content (never counter-rotated like the label), so rotating the whole tile
      // turns the facade — letting users aim each building's front at a street. Purely visual.
      const facade = kind === 'building' ? '<div class="facade" aria-hidden="true"></div>' : '';
      el.tabIndex = 0;
      // ACC-2: overlap is never colour-only — the red outline (.tile.warn CSS) is joined by a
      // hazard-stripe texture (CSS ::before) AND this explicit ⚠ badge naming the state in text.
      const warnBadge = isOver ? '<span class="ov-flag" aria-hidden="true" title="Overlap">⚠</span>' : '';
      // QOL-8: a lock badge names the frozen state in text/icon (only for a per-tile lock — a whole
      // locked LAYER is signalled in the Layers menu instead, to avoid badging every ground tile).
      const lockBadge = t.locked ? '<span class="lock-flag" aria-hidden="true" title="Locked">🔒</span>' : '';
      // Item 5a: no '≈' on the tile face any more — the estimated-footprint state stays visible in
      // the catalog card, the summary count and the Check-my-city panel.
      const labelHTML = `<div class="tlabel"${counter}>` +
        `<div class="tn">${esc(t.name)}</div>` +
        `<div class="tsub"><span>${esc(t.set_num.replace(/-\d+$/, ''))}</span><span>${t.w}×${t.h}</span></div></div>`;
      if (clip) {
        // Shaped: the schematic + facade go INSIDE the clipped wrapper; badges + label stay on the
        // unclipped tile so they're never cut. The wrapper sits below the label via its z-index.
        fill.innerHTML = schem + facade;
        el.innerHTML = warnBadge + lockBadge + labelHTML;
        el.appendChild(fill);
      } else {
        el.innerHTML = schem + facade + warnBadge + lockBadge + labelHTML;
      }
      // QOL-8/10: only an editable tile gets the free-rotate handle — a locked, layer-locked or
      // Kid-Mode-frozen tile must not expose the one gesture that would otherwise bypass the lock.
      if (single && t.id === selectedId && editable(t)) el.insertAdjacentHTML('beforeend', handlesFor(t));
      board.appendChild(el);
    }
    board.appendChild(grip);
    reattachScaleOverlay();
    markGripIntro();
    updateSelBox();
    if (selectedId) board.querySelector(`.tile[data-id="${selectedId}"]`)?.focus({ preventScroll: true });
  }

  function tileEl(id) { return board.querySelector(`.tile[data-id="${id}"]`); }

  // Live overlap-highlight refresh without rebuilding the DOM (used during drag/rotate). Keeps
  // the ⚠ badge (ACC-2's non-colour signal) in sync too, in place — no full render().
  function refreshOverlaps() {
    const over = anyOverlaps(placed);
    for (const p of placed) {
      const el = tileEl(p.id);
      if (!el) continue;
      const isOver = over.has(p.id);
      el.classList.toggle('warn', isOver);
      if (p.kind === 'terrain' || p.kind === 'note') continue; // never warn, never get a badge
      const hasBadge = !!el.querySelector('.ov-flag');
      if (isOver && !hasBadge) el.insertAdjacentHTML('afterbegin', '<span class="ov-flag" aria-hidden="true" title="Overlap">⚠</span>');
      else if (!isOver && hasBadge) el.querySelectorAll('.ov-flag').forEach((b) => b.remove());
    }
  }

  // PLAN-10: HARD-WARN that two track pieces of MISMATCHED radius class were just snapped
  // port-to-port (e.g. an R40 curve joined to an R56 curve — geometry that won't actually close on
  // a real layout). Non-blocking: the snap stands. Fires a toast (onWarn) + an ARIA announcement
  // (onAnnounce) and briefly flashes the same overlap-style red outline + ⚠ badge on both tiles.
  const RADIUS_WARN_MS = 2000;
  function warnRadiusMismatch(a, b) {
    const ra = radiusClass(a), rb = radiusClass(b);
    if (!ra || !rb) return;
    const msg = `Radius mismatch: ${ra} ${a.name} won't line up with ${rb} ${b.name}.`;
    onWarn(msg);
    onAnnounce(msg);
    for (const id of [a.id, b.id]) {
      const el = tileEl(id);
      if (!el) continue;
      el.classList?.add('warn'); el.classList?.add('radius-warn'); // mock classList.add takes one arg
      if (!el.querySelector('.ov-flag')) el.insertAdjacentHTML('afterbegin', '<span class="ov-flag" aria-hidden="true" title="Radius mismatch">⚠</span>');
    }
    setTimeout(() => {
      const over = anyOverlaps(placed); // don't clear a genuine overlap flag that also applies
      for (const id of [a.id, b.id]) {
        const el = tileEl(id);
        if (!el || !el.classList?.contains('radius-warn')) continue;
        el.classList.remove('radius-warn');
        if (!over.has(id)) { el.classList.remove('warn'); el.querySelectorAll('.ov-flag').forEach((f) => f.remove?.()); }
      }
    }, RADIUS_WARN_MS);
  }

  // The combined bounding box of a 2+ selection, drawn as a dashed outline over the board.
  // A single selection needs no box (the tile's own outline reads fine).
  function updateSelBox() {
    let box = board.querySelector('.sel-box');
    const sel = placed.filter((p) => selection.has(p.id));
    if (sel.length >= 2) {
      const b = bbox(sel);
      if (!box) { box = document.createElement('div'); box.className = 'sel-box'; board.appendChild(box); }
      box.style.left = b.x * PX + 'px'; box.style.top = b.y * PX + 'px';
      box.style.width = b.w * PX + 'px'; box.style.height = b.h * PX + 'px';
    } else if (box) { box.remove(); }
  }
  function emitSelect() { onSelect([...selection], selectedId); }

  // Toggle selection highlight + rotate handle in place — no full rebuild, so tile
  // background images are never re-decoded (avoids the drag/selection flash).
  function refreshSelectionUI() {
    const single = selection.size === 1;
    for (const p of placed) {
      const el = tileEl(p.id);
      if (!el) continue;
      const isSel = selection.has(p.id);
      el.classList.toggle('selected', isSel);
      const wantHandle = isSel && single && p.id === selectedId && editable(p);
      const hasHandles = !!el.querySelector('.rotate-handle');
      if (wantHandle && !hasHandles) el.insertAdjacentHTML('beforeend', handlesFor(p));
      else if (!wantHandle && hasHandles) el.querySelectorAll('.rotate-handle,.size-handle').forEach((h) => h.remove());
    }
    updateSelBox();
    if (selectedId) tileEl(selectedId)?.focus({ preventScroll: true });
    emitSelect();
  }

  // All tiles sharing a groupId with the given tile (itself included). Ungrouped → just [id].
  function groupMembers(id) {
    const t = placed.find((p) => p.id === id);
    if (!t || !t.groupId) return id ? [id] : [];
    return placed.filter((p) => p.groupId === t.groupId).map((p) => p.id);
  }

  // Public select(id): replace the selection with just this tile (or its whole group).
  // select(null) clears everything. Kept single-arg for existing call sites.
  function select(id) {
    selection = new Set(id ? groupMembers(id) : []);
    selectedId = id && selection.has(id) ? id : (selection.size ? [...selection][0] : null);
    refreshSelectionUI();
  }
  function selectOnly(id) { select(id); } // internal alias for readability
  function selectIds(ids, primary) {
    selection = new Set(ids);
    selectedId = primary && selection.has(primary) ? primary : (selection.size ? [...selection][selection.size - 1] : null);
    refreshSelectionUI();
  }
  // Select-all only reaches tiles you can actually see — hidden layers stay out of the selection.
  function selectAll() {
    const vis = placed.filter((p) => visible(p) && isSelectable(p));
    selectIds(vis.map((p) => p.id), vis.length ? vis[vis.length - 1].id : null);
  }
  // Drop any now-hidden tiles from the selection (called when a layer is toggled off).
  function pruneSelectionToVisible() {
    let changed = false;
    for (const id of [...selection]) {
      const t = placed.find((p) => p.id === id);
      if (t && !visible(t)) { selection.delete(id); changed = true; }
    }
    if (changed) {
      selectedId = (selectedId && selection.has(selectedId)) ? selectedId : (selection.size ? [...selection][selection.size - 1] : null);
    }
    return changed;
  }
  // Shift/Ctrl-click: add or remove a tile (or its group) from the selection.
  function toggleSelect(id) {
    const members = groupMembers(id);
    const has = selection.has(id);
    for (const m of members) { if (has) selection.delete(m); else selection.add(m); }
    selectedId = has ? (selection.size ? [...selection][selection.size - 1] : null) : id;
    refreshSelectionUI();
  }
  function getSelection() { return [...selection]; }

  // PLAN-3: jump to a set of tiles from the buildability checker — select exactly those ids and
  // scroll the stage so their bounding box is centred in view (the "click an issue → zoom to it"
  // path). `scrollTo` is absent under the test DOM mock, so it's guarded. selectIds selects the
  // literal ids (no group expansion) so the panel highlights precisely the flagged piece(s).
  function focusIds(ids) {
    const list = placed.filter((p) => ids.includes(p.id));
    if (!list.length) return;
    selectIds(ids, ids[ids.length - 1]);
    const b = bbox(list);
    const cx = (b.x + b.w / 2) * PX * zoom, cy = (b.y + b.h / 2) * PX * zoom;
    try { stage.scrollTo(cx - stage.clientWidth / 2, cy - stage.clientHeight / 2); } catch { /* no scroll in test DOM */ }
    refreshCull(); // PERF-1: the jumped-to tiles may have been culled — repaint them now that they're in view
  }

  // Apply a tile's stored x/y to its DOM node in place (no rebuild).
  function applyTilePos(t) {
    const el = tileEl(t.id);
    if (el) { el.style.left = t.x * PX + 'px'; el.style.top = t.y * PX + 'px'; }
  }
  // Apply a rotation to a tile's DOM in place (transform + counter-rotated label) — no rebuild.
  function applyRot(t) {
    const el = tileEl(t.id);
    if (!el) return;
    el.style.transform = t.rot ? `rotate(${t.rot}deg)` : '';
    el.style.setProperty?.('--rot', (t.rot || 0) + 'deg');
    const lab = el.querySelector('.tlabel') || el.querySelector('.note-text');
    if (lab) lab.style.transform = t.rot ? `rotate(${-t.rot}deg)` : '';
  }

  function selectedTiles() { return placed.filter((p) => selection.has(p.id)); }

  // Rotate the editable selection by an arbitrary `delta` degrees (may be negative). Applies the
  // move to the DOM in place; does NOT announce or commit — the callers below layer that on so the
  // 90° snap and the fine keyboard/mouse rotations can word their announcement + undo-step
  // (coalescing) differently. Returns the rotated tiles, or null when the selection is locked/empty.
  function rotateSelectedBy(delta) {
    const sel = editableSelected(); // locked / layer-locked / Kid-Mode-frozen tiles don't rotate
    if (!sel.length) { if (selection.size) onAnnounce('Selection is locked.'); return null; }
    if (sel.length === 1) { // single tile: spin about its own centre, position unchanged
      const t = sel[0];
      t.rot = ((((t.rot || 0) + delta) % 360) + 360) % 360;
      applyRot(t);
    } else { // group: orbit each tile about the group centre (documented behaviour)
      const out = rotateGroup(sel, delta);
      const minX = Math.min(...out.map((o) => o.x)), minY = Math.min(...out.map((o) => o.y));
      const sx = minX < 0 ? -minX : 0, sy = minY < 0 ? -minY : 0; // nudge back inside the canvas
      const byId = new Map(out.map((o) => [o.id, o]));
      for (const t of sel) {
        const o = byId.get(t.id);
        t.x = o.x + sx; t.y = o.y + sy; t.rot = o.rot;
        applyTilePos(t); applyRot(t);
      }
    }
    refreshOverlaps(); updateSelBox(); growToFit();
    return sel;
  }
  // The toolbar / R-key path: a discrete 90° step, its own reversible undo step.
  function rotateSelected() {
    const sel = rotateSelectedBy(90);
    if (!sel) return;
    onAnnounce(sel.length === 1 ? `${sel[0].name} rotated 90 degrees.` : `Rotated ${sel.length} items 90 degrees.`);
    finalize('Rotate');
  }
  // ACC-1: the keyboard free-rotate path ([ ] = ±15°, Ctrl+[ Ctrl+] = ±1°) — reaches any angle
  // without the mouse rotate-node. A run of these folds into one undo step (coalesce key 'rotate'),
  // just like arrow-nudges do, so holding a key doesn't bury the history.
  function rotateSelectedFine(delta) {
    const sel = rotateSelectedBy(delta);
    if (!sel) return false;
    onAnnounce(sel.length === 1
      ? `${sel[0].name} rotated to ${sel[0].rot} degrees.`
      : `Rotated ${sel.length} items ${Math.abs(delta)} degrees.`);
    finalize('Rotate', 'rotate');
    return true;
  }
  // ACC-1: nudge the editable selection by (dx,dy) studs — the arrow-key path (±1 stud, or ±10
  // with Shift). A run of nudges coalesces into a single undo step. Returns false if nothing moved
  // (empty/locked selection). Exposed so the keyboard pipeline is unit-testable without a real DOM.
  function nudgeSelection(dx, dy) {
    const movable = editableSelected(); // arrow-nudge skips locked / layer-locked / frozen tiles
    if (!movable.length) return false;
    for (const t of movable) { t.x = Math.max(0, t.x + dx); t.y = Math.max(0, t.y + dy); applyTilePos(t); }
    refreshOverlaps(); updateSelBox(); growToFit(); finalize('Nudge', 'nudge');
    return true;
  }
  // Fade+scale-out "ghost" clones left behind by a delete (MOTION-6). Purely cosmetic and fully
  // decoupled from the real state change — deleteSelected() itself stays 100% synchronous (the
  // public API and tests depend on getPlaced() reflecting the deletion immediately).
  function spawnDeleteGhosts(doomed) {
    if (!doomed.length || prefersReducedMotion()) return;
    for (const d of doomed) {
      const ghost = document.createElement('div');
      ghost.className = 'tile-ghost' + (d.flat ? ' flat' : '');
      ghost.style.left = d.left + 'px'; ghost.style.top = d.top + 'px';
      ghost.style.width = d.w + 'px'; ghost.style.height = d.h + 'px';
      ghost.style.background = d.bg || '#8493a9';
      ghost.style.setProperty?.('--rot', d.rot + 'deg');
      board.appendChild(ghost);
      raf(() => ghost.classList?.add('out'));
      setTimeout(() => ghost.remove?.(), GHOST_MS);
    }
  }
  function deleteSelected() {
    if (!selection.size) return;
    const doomedTiles = editableSelected(); // locked / frozen tiles survive a delete
    if (!doomedTiles.length) { onAnnounce('Selection is locked.'); return; }
    const doomedSet = new Set(doomedTiles.map((t) => t.id));
    // Snapshot what the doomed tiles looked like on screen before they're gone.
    const doomed = doomedTiles.map((t) => ({
      left: t.x * PX, top: t.y * PX, w: t.w * PX, h: t.h * PX,
      rot: t.rot || 0, bg: t.color || catColor(t.category), flat: (t.layer ?? 2) < 2,
    }));
    const names = doomedTiles.map((t) => t.name);
    placed = placed.filter((p) => !doomedSet.has(p.id));
    selection.clear(); selectedId = null;
    render();
    onAnnounce(names.length === 1 ? `Deleted ${names[0]}.` : `Deleted ${names.length} items.`);
    finalize('Delete'); emitSelect();
    spawnDeleteGhosts(doomed);
  }
  // Move the selected tiles to the front/back of the stacking order. Baseplates stay pinned bottom.
  function moveZ(toFront) {
    const movable = editableSelected().filter((t) => t.layer !== 0);
    if (!movable.length) return;
    const zs = placed.filter((p) => p.layer !== 0).map((p) => p.z ?? p.layer ?? 2);
    const base = toFront ? Math.max(2, ...zs) + 1 : Math.min(1, ...zs) - 1;
    // Preserve relative order within the moved set as they all shift to front/back.
    movable.sort((a, b) => (a.z ?? 2) - (b.z ?? 2)).forEach((t, i) => { t.z = base + (toFront ? i : -i); });
    render(); finalize(toFront ? 'Bring forward' : 'Send backward');
  }
  const bringForward = () => moveZ(true);
  const sendBackward = () => moveZ(false);

  // ---- grouping ---------------------------------------------------------------
  function groupSelection() {
    if (selection.size < 2) return;
    const gid = 'g' + (groupSeq++);
    for (const t of selectedTiles()) t.groupId = gid;
    finalize('Group'); emitSelect();
  }
  function ungroup() {
    const gids = new Set(selectedTiles().map((t) => t.groupId).filter(Boolean));
    if (!gids.size) return;
    for (const t of placed) if (gids.has(t.groupId)) delete t.groupId;
    finalize('Ungroup'); emitSelect();
  }

  // ---- copy / paste / duplicate ----------------------------------------------
  function copySelection() {
    if (!selection.size) return false;
    clipboard = selectedTiles().map((t) => ({ ...t }));
    pasteCount = 0;
    return true;
  }
  // Spawn deep copies of `srcTiles` shifted by (dx,dy), remapping ids and group ids so the
  // copies form independent tiles/groups; select and return them.
  function spawnCopies(srcTiles, dx, dy) {
    const gmap = new Map();
    const copies = srcTiles.map((s) => {
      const t = { ...s, id: 'p' + (seq++), x: Math.max(0, s.x + dx), y: Math.max(0, s.y + dy), locked: false };
      if (s.groupId) { if (!gmap.has(s.groupId)) gmap.set(s.groupId, 'g' + (groupSeq++)); t.groupId = gmap.get(s.groupId); }
      return t;
    });
    for (const c of copies) { placed.push(c); noteNew(c); } // fresh copies are editable, incl. in Kid Mode
    selectIds(copies.map((c) => c.id), copies.length ? copies[copies.length - 1].id : null);
    return copies;
  }
  function paste() {
    if (!clipboard || !clipboard.length) return;
    const off = PASTE_STEP * (++pasteCount);
    spawnCopies(clipboard, off, off);
    render(); growToFit(); finalize('Paste'); emitSelect();
  }
  function duplicate() {
    if (!selection.size) return;
    spawnCopies(selectedTiles(), PASTE_STEP, PASTE_STEP);
    render(); growToFit(); finalize('Duplicate'); emitSelect();
  }

  // ---- align / distribute -----------------------------------------------------
  function applyPositions(list) {
    const byId = new Map(list.map((r) => [r.id, r]));
    for (const t of placed) { const r = byId.get(t.id); if (r) { t.x = r.x; t.y = r.y; applyTilePos(t); } }
  }
  function alignSelection(mode) {
    const sel = editableSelected(); // locked / frozen tiles hold their ground
    if (sel.length < 2) return;
    applyPositions(alignTiles(sel, mode));
    refreshOverlaps(); updateSelBox(); growToFit(); finalize('Align ' + mode);
  }
  function distributeSelection(axis) {
    const sel = editableSelected();
    if (sel.length < 3) return;
    applyPositions(distributeTiles(sel, axis));
    refreshOverlaps(); updateSelBox(); growToFit(); finalize('Distribute');
  }

  // ---- MOTION-3 / UI-5: interaction modes + non-catalog objects ---------------
  function setMode(m) {
    mode = (m === 'terrain' || m === 'note' || m === 'rect') ? m : 'select';
    // classList.remove in the DOM mock only takes one arg — clear the classes individually.
    board.classList?.remove('mode-terrain');
    board.classList?.remove('mode-note');
    board.classList?.remove('mode-rect');
    if (mode !== 'select') { board.classList?.add('mode-' + mode); select(null); }
    onMode(mode, terrainType);
  }
  function getMode() { return mode; }
  function setTerrainType(t) { terrainType = t; onMode(mode, terrainType); }
  function getTerrainType() { return terrainType; }

  // Add one terrain fill of `type` over the (already snapped) rect; returns the new tile.
  function paintTerrain(rect, type = terrainType) {
    const t = makeTerrain({ id: 'p' + (seq++), x: rect.x, y: rect.y, w: rect.w, h: rect.h, type });
    placed.push(t);
    render(); growToFit(); finalize('Paint terrain');
    return t;
  }
  // Remove every terrain fill whose box intersects `rect` (the eraser drag). Returns how many went.
  function eraseTerrain(rect) {
    const before = placed.length;
    placed = placed.filter((p) => !(p.kind === 'terrain' && rectsIntersect(p, rect)));
    const removed = before - placed.length;
    if (removed) { render(); finalize('Erase terrain'); }
    return removed;
  }
  // Drop a sticky note at (x,y); returns the new tile (selected, ready to edit).
  function addNoteAt(x, y, text = 'Note') {
    const t = makeNote({ id: 'p' + (seq++), x: Math.max(0, x), y: Math.max(0, y), text });
    placed.push(t); noteNew(t); selectOnly(t.id); render(); growToFit(); finalize('Add note');
    return t;
  }
  // Draw a custom footprint block over the (already snapped) rect; returns the new tile.
  function addCustomRect(rect, label = 'MOC') {
    const t = makeCustom({ id: 'p' + (seq++), x: rect.x, y: rect.y, w: rect.w, h: rect.h, label });
    placed.push(t); noteNew(t); selectOnly(t.id); render(); growToFit(); finalize('Add block');
    return t;
  }
  // Patch a note's text or a custom block's label/dimensions in place (an undoable edit).
  function updateTile(id, patch = {}) {
    const t = placed.find((p) => p.id === id);
    if (!t) return null;
    if (patch.text != null) t.text = String(patch.text);
    if (patch.name != null) t.name = String(patch.name);
    if (Number.isFinite(patch.w) && patch.w > 0) t.w = patch.w;
    if (Number.isFinite(patch.h) && patch.h > 0) t.h = patch.h;
    render(); growToFit(); finalize('Edit ' + (t.kind === 'note' ? 'note' : 'block'));
    return t;
  }

  // Shared drag for the terrain brush and the custom-rectangle tool: rubber-band a preview, then
  // on release paint / erase / create. A plain click (no drag) drops one default-sized object.
  function startAreaDrag(ev, purpose) {
    const origin = toStuds(ev.clientX, ev.clientY);
    const erasing = purpose === 'terrain' && terrainType === 'erase';
    const preview = document.createElement('div');
    preview.className = 'paint-preview' + (erasing ? ' erase' : (purpose === 'rect' ? ' rect' : ''));
    if (purpose === 'terrain' && !erasing) preview.style.background = makeTerrain({ type: terrainType }).color;
    board.appendChild(preview);
    let cur = origin, moved = false;
    const step = purpose === 'terrain' ? CELL : 1;
    const min = purpose === 'terrain' ? CELL : 4;
    activePointerId = ev.pointerId;
    try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    function draw() {
      const r = snapRect(origin.x, origin.y, cur.x, cur.y, step, min);
      preview.style.left = r.x * PX + 'px'; preview.style.top = r.y * PX + 'px';
      preview.style.width = r.w * PX + 'px'; preview.style.height = r.h * PX + 'px';
    }
    draw();
    function mv(e) {
      if (e.pointerId !== ev.pointerId) return;
      cur = toStuds(e.clientX, e.clientY);
      if (Math.abs(cur.x - origin.x) > 1 || Math.abs(cur.y - origin.y) > 1) moved = true;
      draw();
    }
    function up(e) {
      if (e.pointerId !== ev.pointerId) return;
      board.removeEventListener('pointermove', mv);
      board.removeEventListener('pointerup', up);
      board.removeEventListener('pointercancel', up);
      activePointerId = null;
      preview.remove();
      if (purpose === 'terrain') {
        const r = snapRect(origin.x, origin.y, cur.x, cur.y, CELL, CELL); // a click → one CELL cell
        erasing ? eraseTerrain(r) : paintTerrain(r, terrainType);
      } else { // custom rectangle — a click makes a default block
        const r = moved ? snapRect(origin.x, origin.y, cur.x, cur.y, 1, 8)
          : { x: Math.max(0, snap(origin.x)), y: Math.max(0, snap(origin.y)), w: 16, h: 16 };
        const t = addCustomRect(r);
        setMode('select');
        if (t) onRequestEdit(t);
      }
    }
    board.addEventListener('pointermove', mv);
    board.addEventListener('pointerup', up);
    board.addEventListener('pointercancel', up);
    ev.preventDefault();
  }

  // ---- QOL-8: per-tile lock (a model mutation → undoable + serialised) ---------------------------
  function setLocked(on) {
    const sel = selectedTiles();
    if (!sel.length) return;
    let changed = false;
    for (const t of sel) { if (!!t.locked !== on) { t.locked = on; changed = true; } }
    if (!changed) return;
    render(); // discrete click action — a full render is fine here (never per-pointermove)
    onAnnounce(on
      ? (sel.length === 1 ? `Locked ${sel[0].name}.` : `Locked ${sel.length} items.`)
      : (sel.length === 1 ? `Unlocked ${sel[0].name}.` : `Unlocked ${sel.length} items.`));
    finalize(on ? 'Lock' : 'Unlock'); emitSelect();
  }
  function lockSelected() { setLocked(true); }
  function unlockSelected() { setLocked(false); }
  // Toggle: any unlocked in the selection → lock them all; all already locked → unlock them all.
  function toggleLockSelected() {
    const sel = selectedTiles();
    if (!sel.length) return;
    setLocked(!sel.every((t) => t.locked));
  }
  // Freeze the whole city around the current selection: locks every other tile, unlocks the picks.
  function lockAllExceptSelected() {
    if (!placed.length) return;
    let changed = false;
    for (const t of placed) { const want = !selection.has(t.id); if (!!t.locked !== want) { t.locked = want; changed = true; } }
    if (!changed) return;
    render();
    onAnnounce('Locked everything except the selection.');
    finalize('Lock all but selection'); emitSelect();
  }
  // Selection lock state for the toolbar button: 'none' | 'unlocked' | 'locked' | 'mixed'.
  function selectionLockState() {
    const sel = selectedTiles();
    if (!sel.length) return 'none';
    const n = sel.filter((t) => t.locked).length;
    return n === 0 ? 'unlocked' : (n === sel.length ? 'locked' : 'mixed');
  }

  // ---- QOL-8: Kid Mode / freeze-layout (session pref, NOT saved with the city, NOT undoable) -----
  function setKidMode(on) {
    kidMode = !!on;
    kidNewIds = new Set(); // entering OR leaving resets which pieces count as "new this session"
    render(); emitSelect();
  }
  function getKidMode() { return kidMode; }

  // ---- QOL-10: per-layer show-hide + lock (view/interaction prefs, NOT saved, NOT undoable) ------
  function setLayerVisible(layer, on) {
    layerVis = { ...layerVis, [layer]: !!on };
    if (!on) pruneSelectionToVisible(); // a tile you just hid can't stay selected
    render(); emitSelect();
  }
  function setLayerLocked(layer, on) {
    layerLocks = { ...layerLocks, [layer]: !!on };
    render(); emitSelect();
  }
  function getLayerState() { return { vis: { ...layerVis }, locks: { ...layerLocks } }; }

  // PLAN-8: show/hide the scale-reference overlay + keep it on the current unit toggle.
  function setScaleRef(on) {
    scaleRefOn = !!on;
    if (scaleRefOn) reattachScaleOverlay(); else scaleOverlay.remove();
  }
  function setScaleUnit(u) { scaleUnit = u === 'cm' ? 'cm' : 'studs'; if (scaleRefOn) buildScaleOverlay(); }
  function getScaleRef() { return scaleRefOn; }

  // Round-1 feedback: 🧲 magnetic-snapping toggle (view/interaction pref, not in the city model).
  function setSnapEnabled(on) { snapEnabled = !!on; }
  function getSnapEnabled() { return snapEnabled; }

  function applyZoom() {
    board.style.transform = `scale(${zoom})`; board.style.transformOrigin = '0 0';
    // Item 9: fade per-stud grid detail as you zoom away (CSS keys off these; plate lines stay).
    board.classList?.toggle('zoom-mid', zoom < 0.75);
    board.classList?.toggle('zoom-far', zoom < 0.5);
  }
  function setZoom(z) {
    zoom = Math.min(2, Math.max(0.25, z)); applyZoom();
    refreshCull(); // PERF-1: zooming out enlarges the visible studs-area — reveal any newly-exposed tiles
  }
  function zoomBy(d) { setZoom(zoom + d); }
  function fit() {
    const b = bbox(placed);
    if (!b.w) { setZoom(1); return; }
    const pad = 40;
    const zx = (stage.clientWidth - pad) / (b.w * PX);
    const zy = (stage.clientHeight - pad) / (b.h * PX);
    setZoom(Math.min(2, Math.max(0.25, Math.min(zx, zy))));
    stage.scrollTo(b.x * PX * zoom - 20, b.y * PX * zoom - 20);
  }

  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  // Convert a pointer event to board-local stud coordinates (accounting for zoom).
  function toStuds(clientX, clientY) {
    const rect = board.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom / PX, y: (clientY - rect.top) / zoom / PX };
  }

  // Rubber-band box-select when the drag starts on empty canvas.
  function startMarquee(ev, additive) {
    const origin = toStuds(ev.clientX, ev.clientY);
    const base = additive ? new Set(selection) : new Set();
    const rectEl = document.createElement('div');
    rectEl.className = 'marquee';
    board.appendChild(rectEl);
    let moved = false;
    activePointerId = ev.pointerId;
    try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    function mv(e) {
      if (e.pointerId !== ev.pointerId || gestureLock) return;
      const p = toStuds(e.clientX, e.clientY);
      const x = Math.min(origin.x, p.x), y = Math.min(origin.y, p.y);
      const w = Math.abs(p.x - origin.x), h = Math.abs(p.y - origin.y);
      if (w > 1 || h > 1) moved = true;
      rectEl.style.left = x * PX + 'px'; rectEl.style.top = y * PX + 'px';
      rectEl.style.width = w * PX + 'px'; rectEl.style.height = h * PX + 'px';
      // Marquee only grabs tiles you can freely edit — locked, layer-locked, hidden and Kid-Mode-
      // frozen tiles are skipped so a rubber-band never sweeps up the scenery you're composing around.
      const hits = tilesInRect(placed.filter((t) => editable(t) && isSelectable(t)), { x, y, w, h });
      selection = new Set(base);
      for (const id of hits) for (const m of groupMembers(id)) selection.add(m);
      selectedId = selection.size ? [...selection][selection.size - 1] : null;
      // live highlight without a rebuild
      for (const t of placed) tileEl(t.id)?.classList.toggle('selected', selection.has(t.id));
      updateSelBox();
    }
    function up(e) {
      if (e.pointerId !== ev.pointerId) return;
      board.removeEventListener('pointermove', mv);
      board.removeEventListener('pointerup', up);
      board.removeEventListener('pointercancel', up);
      activePointerId = null;
      rectEl.remove();
      if (!moved && !additive) { select(null); return; } // a plain empty click clears
      refreshSelectionUI();
    }
    board.addEventListener('pointermove', mv);
    board.addEventListener('pointerup', up);
    board.addEventListener('pointercancel', up);
    ev.preventDefault();
  }

  board.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    // ACC-5 (touch): a 2-finger pinch/pan owns the board — don't start a single-pointer interaction;
    // and never let a 2nd concurrent finger begin its own drag while one is already in flight.
    if (gestureLock) return;
    if (activePointerId !== null && ev.pointerId !== activePointerId) return;
    if (ev.target === grip) { // drag the bottom-right corner to resize the table
      ev.preventDefault();
      const rect = board.getBoundingClientRect(); // top-left stays fixed while resizing SE corner
      const { right, bottom } = contentExtent();
      activePointerId = ev.pointerId;
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      function rsz(e) {
        if (e.pointerId !== ev.pointerId || gestureLock) return;
        const wStuds = (e.clientX - rect.left) / zoom / PX;
        const hStuds = (e.clientY - rect.top) / zoom / PX;
        const g = clampedCanvas(Math.round(wStuds), Math.round(hStuds), right, bottom);
        gridW = g.w; gridH = g.h; applySize();
      }
      function rszEnd(e) {
        if (e.pointerId !== ev.pointerId) return;
        board.removeEventListener('pointermove', rsz);
        board.removeEventListener('pointerup', rszEnd);
        board.removeEventListener('pointercancel', rszEnd);
        activePointerId = null;
        finalize('Resize table');
      }
      board.addEventListener('pointermove', rsz);
      board.addEventListener('pointerup', rszEnd);
      board.addEventListener('pointercancel', rszEnd);
      return;
    }
    if (ev.target.classList.contains('rotate-handle')) {
      const t = placed.find((p) => p.id === selectedId);
      if (!t) return;
      if (!editable(t)) return; // defensive: a stale handle on a locked/frozen tile must never rotate it
      const rect = tileEl(t.id).getBoundingClientRect(); // AABB — its centre is the tile centre
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      activePointerId = ev.pointerId;
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      // Suppress the elastic transform tween for the duration of the drag so rotation tracks the
      // pointer 1:1 (the tween is only wanted for discrete R-key/90° snaps, not this gesture).
      tileEl(t.id)?.classList.add('rotating');
      function rot(e) {
        if (e.pointerId !== ev.pointerId || gestureLock) return;
        // Angle from centre to pointer; +90 so the top handle reads as 0°. PLAN-10: snap to the
        // tile's real turn increment — 22.5° for curved/switch track, 15° for everything else — so
        // a chain of curves stays true to the LEGO circle.
        const deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
        const stepDeg = rotationStep(t);
        t.rot = (((Math.round(deg / stepDeg) * stepDeg) % 360) + 360) % 360;
        applyRot(t);
        refreshOverlaps();
      }
      function rend(e) {
        if (e.pointerId !== ev.pointerId) return;
        board.removeEventListener('pointermove', rot);
        board.removeEventListener('pointerup', rend);
        board.removeEventListener('pointercancel', rend);
        tileEl(t.id)?.classList.remove('rotating');
        activePointerId = null;
        growToFit();
        onAnnounce(`${t.name} rotated to ${t.rot} degrees.`); // free-rotate: absolute angle, not a fixed +90 step
        finalize('Rotate');
      }
      board.addEventListener('pointermove', rot);
      board.addEventListener('pointerup', rend);
      board.addEventListener('pointercancel', rend);
      ev.preventDefault();
      return;
    }
    // Round-1 feedback: bottom-right size grip on notes/custom blocks (handlesFor only injects it
    // for those kinds — catalog sets keep their real fixed footprints). Runs before the generic
    // tile-drag hit test below, since the grip is a child of .tile.
    if (ev.target.classList.contains('size-handle')) {
      const t = placed.find((p) => p.id === selectedId);
      if (!t) return;
      if (!editable(t)) return; // defensive: a stale grip on a locked/frozen tile must never resize it
      const sx = ev.clientX, sy = ev.clientY, ow = t.w, oh = t.h;
      activePointerId = ev.pointerId;
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      function rsMove(e) {
        if (e.pointerId !== ev.pointerId || gestureLock) return;
        // Rotate the screen delta into the tile's own axes so resize follows the corner.
        const r = -((t.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
        const dx = (e.clientX - sx) / PX / zoom, dy = (e.clientY - sy) / PX / zoom;
        t.w = Math.max(RESIZE_MIN, snap(ow + dx * co - dy * si));
        t.h = Math.max(RESIZE_MIN, snap(oh + dx * si + dy * co));
        const el = tileEl(t.id);
        if (el) {
          el.style.width = t.w * PX + 'px';
          el.style.height = t.h * PX + 'px';
          const sizeSpan = el.querySelector('.tsub span:last-child'); // custom blocks' live W×H readout
          if (sizeSpan) sizeSpan.textContent = `${t.w}×${t.h}`;
        }
        refreshOverlaps(); updateSelBox();
      }
      function rsEnd(e) {
        if (e.pointerId !== ev.pointerId) return;
        board.removeEventListener('pointermove', rsMove);
        board.removeEventListener('pointerup', rsEnd);
        board.removeEventListener('pointercancel', rsEnd);
        activePointerId = null;
        growToFit();
        onAnnounce(`${t.name} resized to ${t.w} by ${t.h} studs.`);
        finalize(t.kind === 'note' ? 'Resize note' : 'Resize block');
      }
      board.addEventListener('pointermove', rsMove);
      board.addEventListener('pointerup', rsEnd);
      board.addEventListener('pointercancel', rsEnd);
      ev.preventDefault();
      return;
    }
    // MOTION-3 / UI-5 tool modes take over the empty-canvas gesture (grip + rotate-handle above
    // still work in every mode). Terrain fills are pointer-transparent, so a press "on" one still
    // starts a fresh paint stroke rather than grabbing the fill.
    if (mode === 'terrain') { startAreaDrag(ev, 'terrain'); return; }
    if (mode === 'rect') { startAreaDrag(ev, 'rect'); return; }
    if (mode === 'note') {
      const p = toStuds(ev.clientX, ev.clientY);
      const t = addNoteAt(Math.max(0, snap(p.x)), Math.max(0, snap(p.y)));
      setMode('select');
      if (t) onRequestEdit(t);
      ev.preventDefault();
      return;
    }
    const hit = ev.target.closest('.tile');
    if (!hit) { startMarquee(ev, ev.shiftKey || ev.ctrlKey || ev.metaKey); return; }
    const id = hit.dataset.id;
    const tile = placed.find((p) => p.id === id);
    if (!tile) return;

    // Shift/Ctrl-click toggles this tile (or its group) in the selection — no drag.
    if (ev.shiftKey || ((ev.ctrlKey || ev.metaKey) && !ev.altKey)) { toggleSelect(id); ev.preventDefault(); return; }

    // Click on a tile that isn't part of the current selection → select just it (or its group).
    if (!selection.has(id)) selectOnly(id);
    else { selectedId = id; refreshSelectionUI(); } // clicking within a multi-selection keeps it, re-homes the primary

    // QOL-8/10: a locked, layer-locked or Kid-Mode-frozen tile still SELECTS on pointerdown (so it
    // can be unlocked from the toolbar) but never starts a drag.
    if (!editable(tile)) { ev.preventDefault(); return; }

    // Alt-drag leaves the originals behind and drags fresh copies. Only the editable members of the
    // selection actually move — locked tiles caught in the same selection stay put.
    let group = editableSelected();
    let altCopy = false;
    if (ev.altKey) { group = spawnCopies(group, 0, 0); render(); altCopy = true; }

    const primary = placed.find((p) => p.id === selectedId) || group[0];
    const startX = ev.clientX, startY = ev.clientY;
    const origins = group.map((t) => ({ t, ox: t.x, oy: t.y }));
    const pox = primary.x, poy = primary.y;
    let dragMoved = false;
    let mismatchNeighbour = null; // PLAN-10: the mismatched-radius neighbour the primary is snapped to
    activePointerId = ev.pointerId;
    try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    function move(e) {
      if (e.pointerId !== ev.pointerId || gestureLock) return;
      if (!dragMoved) for (const { t } of origins) tileEl(t.id)?.classList.add('dragging'); // drag-lift (MOTION-6)
      dragMoved = true;
      // Drive the whole selection off the primary tile: snap the primary, then shift the
      // rest by the same delta so the group keeps its shape.
      let nx = Math.max(0, snap(pox + (e.clientX - startX) / PX / zoom));
      let ny = Math.max(0, snap(poy + (e.clientY - startY) / PX / zoom));
      // Magnetic snap (round-1 feedback: tamed). Ports/plates keep the 6-stud pull; ordinary sets
      // magnetize only within 2 studs so they can rest on any stud. 🧲 off or Alt held = pure
      // 1-stud placement (skipping the call also saves the per-frame port scan).
      if (snapEnabled && !e.altKey) {
        const probe = { ...primary, x: nx, y: ny };
        const s = snapConnectInfo(probe, placed.filter((p) => !selection.has(p.id)), 6, 2);
        nx = Math.max(0, s.x); ny = Math.max(0, s.y);
        // PLAN-10: remember whether this port-to-port join is between mismatched radius classes, so
        // the drag-end can hard-warn. Non-blocking — the snap itself still happens.
        mismatchNeighbour = (s.connectedTo && radiusMismatch(primary, s.connectedTo)) ? s.connectedTo : null;
      } else {
        mismatchNeighbour = null; // bypassed frames must clear any stale port join (no ghost warns)
      }
      const dx = nx - pox, dy = ny - poy;
      for (const { t, ox, oy } of origins) {
        t.x = Math.max(0, ox + dx); t.y = Math.max(0, oy + dy);
        applyTilePos(t);
      }
      refreshOverlaps(); updateSelBox();
    }
    function end(e) {
      if (e.pointerId !== ev.pointerId) return;
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', end);
      board.removeEventListener('pointercancel', end);
      activePointerId = null;
      for (const { t } of origins) tileEl(t.id)?.classList.remove('dragging');
      // A plain click that selected without dragging isn't a mutation — don't spend a history step.
      if (dragMoved || altCopy) {
        growToFit(); finalize(altCopy ? 'Alt-drag copy' : 'Move');
        if (mismatchNeighbour) warnRadiusMismatch(primary, mismatchNeighbour); // PLAN-10 hard-warn
      }
    }
    board.addEventListener('pointermove', move);
    board.addEventListener('pointerup', end);
    board.addEventListener('pointercancel', end);
    ev.preventDefault();
  });

  board.addEventListener('keydown', (ev) => {
    if (!selection.size) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (step) {
      const mag = ev.shiftKey ? 10 : 1; // ACC-1: Shift+Arrow strides 10 studs, plain Arrow 1 stud
      nudgeSelection(step[0] * mag, step[1] * mag);
      ev.preventDefault();
    } else if (ev.key === 'Escape') select(null);
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); ev.preventDefault(); }
    else if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey && !ev.metaKey) { rotateSelected(); }
    else if (ev.key.toLowerCase() === 'l' && !ev.ctrlKey && !ev.metaKey) { toggleLockSelected(); ev.preventDefault(); } // QOL-8: lock/unlock
    // ACC-1: keyboard free-rotate. [ / ] rotate ±15°; Ctrl (or ⌘) + [ / ] fine-rotate ±1°, so any
    // arbitrary angle is reachable without the mouse rotate-node. Shift+[ / Shift+] arrive here too
    // as '{' / '}'. Guarded off Alt so no OS/browser combo is hijacked. R (90°) is unaffected above.
    else if ((ev.key === '[' || ev.key === '{' || ev.code === 'BracketLeft') && !ev.altKey) {
      rotateSelectedFine((ev.ctrlKey || ev.metaKey) ? -1 : -15); ev.preventDefault();
    } else if ((ev.key === ']' || ev.key === '}' || ev.code === 'BracketRight') && !ev.altKey) {
      rotateSelectedFine((ev.ctrlKey || ev.metaKey) ? 1 : 15); ev.preventDefault();
    }
  });

  // UI-5: double-click a note or a custom block to edit it (text, or label + dimensions). The
  // actual prompting is delegated to the host via onRequestEdit so grid.js stays DOM-only.
  board.addEventListener('dblclick', (ev) => {
    const hit = ev.target.closest?.('.tile');
    if (!hit) return;
    const t = placed.find((p) => p.id === hit.dataset.id);
    if (t && (t.kind === 'note' || t.kind === 'custom')) { selectOnly(t.id); onRequestEdit(t); }
  });

  // Editor-wide keyboard shortcuts (undo/redo/copy/paste/duplicate/group/select-all).
  // Ignored while typing in the catalog search or any input.
  window.addEventListener('keydown', (ev) => {
    const tgt = ev.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const k = ev.key.toLowerCase();
    // Only swallow the browser default when the app actually consumes the shortcut,
    // so native copy / select-all still work when nothing is selected/placed.
    if (k === 'z') { ev.shiftKey ? redo() : undo(); ev.preventDefault(); }
    else if (k === 'y') { redo(); ev.preventDefault(); }
    else if (k === 'c') { if (selection.size) { copySelection(); ev.preventDefault(); } }
    else if (k === 'v') { if (clipboard && clipboard.length) { paste(); ev.preventDefault(); } }
    else if (k === 'd') { if (selection.size) { duplicate(); ev.preventDefault(); } }
    else if (k === 'g') { if (selection.size) { ev.shiftKey ? ungroup() : groupSelection(); ev.preventDefault(); } }
    else if (k === 'a') { if (placed.length) { selectAll(); ev.preventDefault(); } }
  });

  render();
  applySize();
  applyZoom();
  resetHistory();
  return {
    addSet, addSetAt, getPlaced, setPlaced, render, select,
    rotateSelected, deleteSelected, bringForward, sendBackward,
    setGridPlates, getGrid,
    setZoom, zoomBy, fit,
    // selection + groups
    getSelection, selectAll, groupSelection, ungroup, focusIds,
    // clipboard
    copySelection, paste, duplicate,
    // align / distribute
    alignSelection, distributeSelection,
    // MOTION-3 / UI-5: tool modes + non-catalog canvas objects
    setMode, getMode, setTerrainType, getTerrainType,
    paintTerrain, eraseTerrain, addNoteAt, addCustomRect, updateTile,
    // QOL-8: per-tile lock + Kid Mode
    lockSelected, unlockSelected, toggleLockSelected, lockAllExceptSelected, selectionLockState,
    setKidMode, getKidMode,
    // QOL-10: per-layer show-hide + lock
    setLayerVisible, setLayerLocked, getLayerState,
    // PLAN-8: realistic scale-reference overlay
    setScaleRef, setScaleUnit, getScaleRef,
    // 🧲 magnetic snapping (round-1 feedback)
    setSnapEnabled, getSnapEnabled,
    // history
    undo, redo, canUndo, canRedo, getHistory, jumpHistory,
    _state: () => ({ placed, selectedId, selection: [...selection] }),
  };
}
