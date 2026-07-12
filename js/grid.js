import { catColor } from './catalog.js';
import {
  anyOverlaps, overlapPairs, toRowCol, bbox, snap, snapConnect, grownCanvas, clampedCanvas, BP,
  tilesInRect, alignTiles, distributeTiles, rotateGroup, isTileEditable, isLayerVisible, layerOf,
} from './geometry.js';
import { esc } from './util.js';
import { schematicSVG } from './schematic.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text
const HANDLES = '<div class="rotate-handle" title="Drag to rotate"></div>';
const DEFAULT_W = 128, DEFAULT_H = 96; // studs — a 4×3 baseplate table to start
const HISTORY_MAX = 60; // undo depth (spec: at least 50 steps)
const PASTE_STEP = 8; // studs each paste/duplicate is nudged so copies don't hide the originals
const GHOST_MS = 240; // how long a delete's fading ghost sticks around (must match the CSS transition)

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
  onAnnounce = () => {},
  // QOL-10 / QOL-8 view + interaction prefs — supplied by app.js from localStorage/sessionStorage,
  // kept OUTSIDE placed[]/undo. layerVis/layerLocks are keyed by stacking layer (0/1/2…).
  layerVis: initLayerVis = null, layerLocks: initLayerLocks = null, kidMode: initKidMode = false,
} = {}) {
  let placed = [];
  let selection = new Set(); // ids of every selected tile
  let selectedId = null; // the primary/last selected — drives the rotate handle & focus
  let seq = 1;
  let groupSeq = 1;
  let zoom = 1;
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

  // Right/bottom edge of everything placed, in studs (0,0 when empty).
  function contentExtent() { const b = bbox(placed); return { right: b.x + b.w, bottom: b.y + b.h }; }

  function applySize() {
    board.style.width = gridW * PX + 'px';
    board.style.height = gridH * PX + 'px';
    onResize(gridW, gridH);
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
      approx: set.footprint.source !== 'curated', img: set.img || null,
      layer: set.layer ?? 2, z: set.layer ?? 2, color: set.color || null,
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

  function render() {
    if (!placed.length) {
      board.innerHTML = `<div class="empty-hint">Add sets from the catalog to start your city →</div>`;
      board.appendChild(grip);
      updateSelBox();
      return;
    }
    const over = anyOverlaps(placed);
    board.innerHTML = '';
    // Paint order: baseplates always at the bottom; everything else by its z (user-adjustable).
    const paintKey = (p) => (p.layer === 0 ? -1000 : (p.z ?? p.layer ?? 2));
    const paintOrder = [...placed].sort((a, b) => paintKey(a) - paintKey(b));
    const single = selection.size === 1;
    for (const t of paintOrder) {
      // QOL-10: a hidden layer isn't painted at all (its tiles stay in placed[] — still saved,
      // still snap/overlap-computed — just invisible + non-interactive until shown again).
      if (!visible(t)) continue;
      const layer = t.layer ?? 2;
      const lightGround = /--g-(white|sand)/.test(t.color || '');
      const isOver = over.has(t.id);
      const notEditable = !editable(t); // locked tile, locked layer, or a Kid-Mode-frozen piece
      const el = document.createElement('div');
      el.className = 'tile' + ((DARK_TXT.has(t.category) || lightGround) ? ' dark-txt' : '') +
        (layer < 2 ? ' flat' : '') +
        (isOver ? ' warn' : '') + (selection.has(t.id) ? ' selected' : '') +
        (t.locked ? ' locked' : '') + (notEditable ? ' noedit' : '');
      // Tile is sized to its own footprint and rotated about its centre.
      el.style.left = t.x * PX + 'px';
      el.style.top = t.y * PX + 'px';
      el.style.width = t.w * PX + 'px';
      el.style.height = t.h * PX + 'px';
      if (t.rot) el.style.transform = `rotate(${t.rot}deg)`;
      el.style.setProperty?.('--rot', (t.rot || 0) + 'deg'); // read by the pop-in keyframe (MOTION-6)
      // ACC-2c: colorblind-safe theme hook — CSS keys a texture overlay off [data-cat] when the
      // user has the colorblind-safe toggle on, so categories stay distinguishable without hue.
      el.dataset.cat = t.category || '';
      el.style.background = t.color || catColor(t.category);
      const schem = schematicSVG(t.kind || 'generic', { w: t.w, h: t.h }, t.name);
      if (t.img && !schem) { // generic sets keep the tinted box photo
        el.style.backgroundImage =
          `linear-gradient(${catColor(t.category)}cc, ${catColor(t.category)}cc), url("${t.img}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundBlendMode = 'multiply';
      }
      el.dataset.id = t.id;
      el.tabIndex = 0;
      // Labels counter-rotate so they stay upright on angled tiles.
      const counter = t.rot ? ` style="transform:rotate(${-t.rot}deg)"` : '';
      // ACC-2: overlap is never colour-only — the red outline (.tile.warn CSS) is joined by a
      // hazard-stripe texture (CSS ::before) AND this explicit ⚠ badge naming the state in text.
      const warnBadge = isOver ? '<span class="ov-flag" aria-hidden="true" title="Overlap">⚠</span>' : '';
      // QOL-8: a lock badge names the frozen state in text/icon (only for a per-tile lock — a whole
      // locked LAYER is signalled in the Layers menu instead, to avoid badging every ground tile).
      const lockBadge = t.locked ? '<span class="lock-flag" aria-hidden="true" title="Locked">🔒</span>' : '';
      el.innerHTML = schem + warnBadge + lockBadge + `<div class="tlabel"${counter}>` +
        `<div class="tn">${esc(t.name)}${t.approx ? ' <span style="opacity:.8;font-weight:400">≈</span>' : ''}</div>` +
        `<div class="tsub"><span>${esc(t.set_num.replace(/-\d+$/, ''))}</span><span>${t.w}×${t.h}</span></div></div>`;
      // QOL-8/10: only an editable tile gets the free-rotate handle — a locked, layer-locked or
      // Kid-Mode-frozen tile must not expose the one gesture that would otherwise bypass the lock.
      if (single && t.id === selectedId && editable(t)) el.insertAdjacentHTML('beforeend', HANDLES);
      board.appendChild(el);
    }
    board.appendChild(grip);
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
      const hasBadge = !!el.querySelector('.ov-flag');
      if (isOver && !hasBadge) el.insertAdjacentHTML('afterbegin', '<span class="ov-flag" aria-hidden="true" title="Overlap">⚠</span>');
      else if (!isOver && hasBadge) el.querySelectorAll('.ov-flag').forEach((b) => b.remove());
    }
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
      if (wantHandle && !hasHandles) el.insertAdjacentHTML('beforeend', HANDLES);
      else if (!wantHandle && hasHandles) el.querySelectorAll('.rotate-handle').forEach((h) => h.remove());
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
    const vis = placed.filter(visible);
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
    const lab = el.querySelector('.tlabel');
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

  function applyZoom() { board.style.transform = `scale(${zoom})`; board.style.transformOrigin = '0 0'; }
  function setZoom(z) { zoom = Math.min(2, Math.max(0.25, z)); applyZoom(); }
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
      const hits = tilesInRect(placed.filter(editable), { x, y, w, h });
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
        // Angle from centre to pointer; +90 so the top handle reads as 0°, snapped to 15°.
        const deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
        t.rot = (((Math.round(deg / 15) * 15) % 360) + 360) % 360;
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
      const probe = { ...primary, x: nx, y: ny };
      const s = snapConnect(probe, placed.filter((p) => !selection.has(p.id)), 6);
      nx = Math.max(0, s.x); ny = Math.max(0, s.y);
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
      if (dragMoved || altCopy) { growToFit(); finalize(altCopy ? 'Alt-drag copy' : 'Move'); }
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
    getSelection, selectAll, groupSelection, ungroup,
    // clipboard
    copySelection, paste, duplicate,
    // align / distribute
    alignSelection, distributeSelection,
    // QOL-8: per-tile lock + Kid Mode
    lockSelected, unlockSelected, toggleLockSelected, lockAllExceptSelected, selectionLockState,
    setKidMode, getKidMode,
    // QOL-10: per-layer show-hide + lock
    setLayerVisible, setLayerLocked, getLayerState,
    // history
    undo, redo, canUndo, canRedo, getHistory, jumpHistory,
    _state: () => ({ placed, selectedId, selection: [...selection] }),
  };
}
