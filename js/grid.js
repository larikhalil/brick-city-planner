import { catColor } from './catalog.js';
import { anyOverlaps, bbox, snap, snapConnect, grownCanvas, clampedCanvas, BP } from './geometry.js';
import { esc } from './util.js';
import { schematicSVG } from './schematic.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text
const HANDLES = '<div class="rotate-handle" title="Drag to rotate"></div>';
const DEFAULT_W = 128, DEFAULT_H = 96; // studs — a 4×3 baseplate table to start

export function createGrid(board, { onChange = () => {}, onResize = () => {} } = {}) {
  let placed = [];
  let selectedId = null;
  let seq = 1;
  let zoom = 1;
  let gridW = DEFAULT_W, gridH = DEFAULT_H; // canvas size in studs (always whole baseplates)
  const stage = board.parentElement;

  // Bottom-right corner grip for dragging the canvas bigger/smaller (snaps to baseplates).
  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = 'Drag to resize the table';

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
    gridW = g.w; gridH = g.h; applySize(); onChange();
  }
  function getGrid() { return { w: gridW, h: gridH, pw: gridW / BP, ph: gridH / BP }; }

  function makeTile(set, x, y) {
    return {
      id: 'p' + (seq++), set_num: set.set_num, name: set.name, category: set.category, kind: set.kind || 'generic',
      x, y, w: set.footprint.w, h: set.footprint.h, rot: 0,
      approx: set.footprint.source !== 'curated', img: set.img || null,
      layer: set.layer ?? 2, z: set.layer ?? 2, color: set.color || null,
    };
  }
  function addSet(set) { const t = makeTile(set, 0, 0); placed.push(t); selectedId = t.id; render(); growToFit(); onChange(); }
  // Drop from the catalog at screen coordinates, centring the piece on the drop point.
  function addSetAt(set, clientX, clientY) {
    const rect = board.getBoundingClientRect();
    const x = Math.max(0, Math.round((clientX - rect.left) / zoom / PX - set.footprint.w / 2));
    const y = Math.max(0, Math.round((clientY - rect.top) / zoom / PX - set.footprint.h / 2));
    const t = makeTile(set, x, y); placed.push(t); selectedId = t.id; render(); growToFit(); onChange();
  }

  function getPlaced() { return placed; }
  function setPlaced(arr, size) {
    placed = arr.map((p) => {
      const t = { ...p };
      if (t.layer == null) t.layer = t.ground ? 0 : 2; // back-compat with pre-layer saved cities
      if (t.kind == null) t.kind = t.ground ? 'baseplate' : 'generic';
      if (t.z == null) t.z = t.layer ?? 2;
      return t;
    });
    for (const p of placed) {
      const n = parseInt(String(p.id).replace(/^p/, ''), 10);
      if (Number.isFinite(n) && n >= seq) seq = n + 1;
    }
    selectedId = null;
    // Restore the saved table size if given, else reset to the default; growToFit then
    // guarantees the canvas is never smaller than the content it now holds.
    gridW = (size && Number.isFinite(size.w)) ? size.w : DEFAULT_W;
    gridH = (size && Number.isFinite(size.h)) ? size.h : DEFAULT_H;
    render();
    growToFit();
    applySize();
    onChange();
  }

  function render() {
    if (!placed.length) {
      board.innerHTML = `<div class="empty-hint">Add sets from the catalog to start your city →</div>`;
      board.appendChild(grip);
      return;
    }
    const over = anyOverlaps(placed);
    board.innerHTML = '';
    // Paint order: baseplates always at the bottom; everything else by its z (user-adjustable).
    const paintKey = (p) => (p.layer === 0 ? -1000 : (p.z ?? p.layer ?? 2));
    const paintOrder = [...placed].sort((a, b) => paintKey(a) - paintKey(b));
    for (const t of paintOrder) {
      const layer = t.layer ?? 2;
      const lightGround = /--g-(white|sand)/.test(t.color || '');
      const el = document.createElement('div');
      el.className = 'tile' + ((DARK_TXT.has(t.category) || lightGround) ? ' dark-txt' : '') +
        (layer < 2 ? ' flat' : '') +
        (over.has(t.id) ? ' warn' : '') + (t.id === selectedId ? ' selected' : '');
      // Tile is sized to its own footprint and rotated about its centre.
      el.style.left = t.x * PX + 'px';
      el.style.top = t.y * PX + 'px';
      el.style.width = t.w * PX + 'px';
      el.style.height = t.h * PX + 'px';
      if (t.rot) el.style.transform = `rotate(${t.rot}deg)`;
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
      el.innerHTML = schem + `<div class="tlabel"${counter}>` +
        `<div class="tn">${esc(t.name)}${t.approx ? ' <span style="opacity:.8;font-weight:400">≈</span>' : ''}</div>` +
        `<div class="tsub"><span>${esc(t.set_num.replace(/-\d+$/, ''))}</span><span>${t.w}×${t.h}</span></div></div>`;
      if (t.id === selectedId) el.insertAdjacentHTML('beforeend', HANDLES);
      board.appendChild(el);
    }
    board.appendChild(grip);
    if (selectedId) board.querySelector(`.tile[data-id="${selectedId}"]`)?.focus({ preventScroll: true });
  }

  function tileEl(id) { return board.querySelector(`.tile[data-id="${id}"]`); }

  // Live overlap-highlight refresh without rebuilding the DOM (used during drag/rotate).
  function refreshOverlaps() {
    const over = anyOverlaps(placed);
    for (const p of placed) tileEl(p.id)?.classList.toggle('warn', over.has(p.id));
  }

  // Toggle selection highlight + rotate handle in place — no full rebuild, so tile
  // background images are never re-decoded (avoids the drag/selection flash).
  function select(id) {
    selectedId = id;
    for (const p of placed) {
      const el = tileEl(p.id);
      if (!el) continue;
      const isSel = p.id === id;
      el.classList.toggle('selected', isSel);
      const hasHandles = !!el.querySelector('.rotate-handle');
      if (isSel && !hasHandles) el.insertAdjacentHTML('beforeend', HANDLES);
      else if (!isSel && hasHandles) el.querySelectorAll('.rotate-handle').forEach((h) => h.remove());
    }
    if (id) tileEl(id)?.focus({ preventScroll: true });
  }

  // Apply a rotation to a tile's DOM in place (transform + counter-rotated label) — no rebuild.
  function applyRot(t) {
    const el = tileEl(t.id);
    if (!el) return;
    el.style.transform = t.rot ? `rotate(${t.rot}deg)` : '';
    const lab = el.querySelector('.tlabel');
    if (lab) lab.style.transform = t.rot ? `rotate(${-t.rot}deg)` : '';
  }

  function rotateSelected() {
    const t = placed.find((p) => p.id === selectedId); if (!t) return;
    t.rot = ((t.rot || 0) + 90) % 360;
    applyRot(t); refreshOverlaps(); growToFit(); onChange();
  }
  function deleteSelected() {
    if (!selectedId) return;
    placed = placed.filter((p) => p.id !== selectedId); selectedId = null; render(); onChange();
  }
  // Move the selected tile to the front/back of the stacking order. Baseplates stay pinned bottom.
  function moveZ(toFront) {
    const t = placed.find((p) => p.id === selectedId);
    if (!t || t.layer === 0) return;
    const zs = placed.filter((p) => p.layer !== 0).map((p) => p.z ?? p.layer ?? 2);
    t.z = toFront ? Math.max(2, ...zs) + 1 : Math.min(1, ...zs) - 1;
    render(); onChange();
  }
  const bringForward = () => moveZ(true);
  const sendBackward = () => moveZ(false);
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

  board.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (ev.target === grip) { // drag the bottom-right corner to resize the table
      ev.preventDefault();
      const rect = board.getBoundingClientRect(); // top-left stays fixed while resizing SE corner
      const { right, bottom } = contentExtent();
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      function rsz(e) {
        if (e.pointerId !== ev.pointerId) return;
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
        onChange();
      }
      board.addEventListener('pointermove', rsz);
      board.addEventListener('pointerup', rszEnd);
      board.addEventListener('pointercancel', rszEnd);
      return;
    }
    if (ev.target.classList.contains('rotate-handle')) {
      const t = placed.find((p) => p.id === selectedId);
      if (!t) return;
      const rect = tileEl(t.id).getBoundingClientRect(); // AABB — its centre is the tile centre
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      function rot(e) {
        if (e.pointerId !== ev.pointerId) return;
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
        growToFit(); onChange();
      }
      board.addEventListener('pointermove', rot);
      board.addEventListener('pointerup', rend);
      board.addEventListener('pointercancel', rend);
      ev.preventDefault();
      return;
    }
    const hit = ev.target.closest('.tile');
    if (!hit) { select(null); return; }
    const id = hit.dataset.id;
    select(id);
    const t = placed.find((p) => p.id === id);
    if (!t) return;
    const startX = ev.clientX, startY = ev.clientY, ox = t.x, oy = t.y;
    try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    function move(e) {
      if (e.pointerId !== ev.pointerId) return;
      t.x = Math.max(0, snap(ox + (e.clientX - startX) / PX / zoom));
      t.y = Math.max(0, snap(oy + (e.clientY - startY) / PX / zoom));
      // Snap-to-connect: ports for road/rail, 32-grid for baseplates, edge-align for the rest.
      const s = snapConnect(t, placed.filter((p) => p.id !== t.id), 6);
      t.x = Math.max(0, s.x); t.y = Math.max(0, s.y);
      const el = tileEl(t.id);
      if (el) { el.style.left = t.x * PX + 'px'; el.style.top = t.y * PX + 'px'; }
      refreshOverlaps();
    }
    function end(e) {
      if (e.pointerId !== ev.pointerId) return;
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', end);
      board.removeEventListener('pointercancel', end);
      growToFit(); onChange();
    }
    board.addEventListener('pointermove', move);
    board.addEventListener('pointerup', end);
    board.addEventListener('pointercancel', end);
    ev.preventDefault();
  });

  board.addEventListener('keydown', (ev) => {
    if (!selectedId) return;
    const t = placed.find((p) => p.id === selectedId);
    if (!t) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (step) { t.x = Math.max(0, t.x + step[0]); t.y = Math.max(0, t.y + step[1]); render(); growToFit(); onChange(); ev.preventDefault(); }
    else if (ev.key === 'Escape') select(null);
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); ev.preventDefault(); }
    else if (ev.key.toLowerCase() === 'r') { rotateSelected(); }
  });

  render();
  applySize();
  applyZoom();
  return {
    addSet, addSetAt, getPlaced, setPlaced, render, select,
    rotateSelected, deleteSelected, bringForward, sendBackward,
    setGridPlates, getGrid,
    setZoom, zoomBy, fit,
    _state: () => ({ placed, selectedId }),
  };
}
