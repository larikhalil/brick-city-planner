import { catColor } from './catalog.js';
import { anyOverlaps, bbox, snap, snapConnect } from './geometry.js';
import { esc } from './util.js';
import { schematicSVG } from './schematic.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text
const HANDLES = '<div class="rotate-handle" title="Drag to rotate"></div>' +
  '<div class="resize-handle" title="Drag to resize"></div>';

export function createGrid(board, { onChange = () => {} } = {}) {
  let placed = [];
  let selectedId = null;
  let seq = 1;
  let zoom = 1;
  const stage = board.parentElement;

  function addSet(set) {
    const id = 'p' + (seq++);
    placed.push({
      id, set_num: set.set_num, name: set.name, category: set.category, kind: set.kind || 'generic',
      x: 0, y: 0, w: set.footprint.w, h: set.footprint.h, rot: 0,
      approx: set.footprint.source !== 'curated', img: set.img || null,
      layer: set.layer ?? 2, color: set.color || null,
    });
    selectedId = id;
    render(); onChange();
  }

  function getPlaced() { return placed; }
  function setPlaced(arr) {
    placed = arr.map((p) => {
      const t = { ...p };
      if (t.layer == null) t.layer = t.ground ? 0 : 2; // back-compat with pre-layer saved cities
      if (t.kind == null) t.kind = t.ground ? 'baseplate' : 'generic';
      return t;
    });
    for (const p of placed) {
      const n = parseInt(String(p.id).replace(/^p/, ''), 10);
      if (Number.isFinite(n) && n >= seq) seq = n + 1;
    }
    selectedId = null;
    render();
    onChange();
  }

  function render() {
    if (!placed.length) {
      board.innerHTML = `<div class="empty-hint">Add sets from the catalog to start your city →</div>`;
      return;
    }
    const over = anyOverlaps(placed);
    board.innerHTML = '';
    // Paint by layer: baseplates (0) under roads/tracks (1) under buildings (2).
    const paintOrder = [...placed].sort((a, b) => (a.layer ?? 2) - (b.layer ?? 2));
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
    if (selectedId) board.querySelector(`.tile[data-id="${selectedId}"]`)?.focus({ preventScroll: true });
  }

  function tileEl(id) { return board.querySelector(`.tile[data-id="${id}"]`); }

  // Live overlap-highlight refresh without rebuilding the DOM (used during drag/resize).
  function refreshOverlaps() {
    const over = anyOverlaps(placed);
    for (const p of placed) tileEl(p.id)?.classList.toggle('warn', over.has(p.id));
  }

  // Toggle selection highlight + resize handle in place — no full rebuild, so tile
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
      else if (!isSel && hasHandles) el.querySelectorAll('.rotate-handle,.resize-handle').forEach((h) => h.remove());
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
    applyRot(t); refreshOverlaps(); onChange();
  }
  function deleteSelected() {
    if (!selectedId) return;
    placed = placed.filter((p) => p.id !== selectedId); selectedId = null; render(); onChange();
  }
  function resizeSelected(w, h) {
    const t = placed.find((p) => p.id === selectedId); if (!t) return;
    t.w = Math.max(1, w); t.h = Math.max(1, h); t.approx = true; render(); onChange();
  }

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
        onChange();
      }
      board.addEventListener('pointermove', rot);
      board.addEventListener('pointerup', rend);
      board.addEventListener('pointercancel', rend);
      ev.preventDefault();
      return;
    }
    if (ev.target.classList.contains('resize-handle')) {
      const t = placed.find((p) => p.id === selectedId);
      if (!t) return;
      const sx = ev.clientX, sy = ev.clientY, ow = t.w, oh = t.h;
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      function rmove(e) {
        if (e.pointerId !== ev.pointerId) return;
        // Rotate the screen delta into the tile's own axes so resize follows the corner.
        const r = -((t.rot || 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
        const dx = (e.clientX - sx) / PX / zoom, dy = (e.clientY - sy) / PX / zoom;
        t.w = Math.max(1, snap(ow + dx * co - dy * si));
        t.h = Math.max(1, snap(oh + dx * si + dy * co));
        t.approx = true;
        const el = tileEl(t.id);
        if (el) {
          el.style.width = t.w * PX + 'px';
          el.style.height = t.h * PX + 'px';
          const sizeSpan = el.querySelector('.tsub span:last-child');
          if (sizeSpan) sizeSpan.textContent = `${t.w}×${t.h}`;
          const tn = el.querySelector('.tn');
          if (tn && !tn.querySelector('span')) tn.insertAdjacentHTML('beforeend', ' <span style="opacity:.8;font-weight:400">≈</span>');
        }
        refreshOverlaps();
      }
      function rend(e) {
        if (e.pointerId !== ev.pointerId) return;
        board.removeEventListener('pointermove', rmove);
        board.removeEventListener('pointerup', rend);
        board.removeEventListener('pointercancel', rend);
        onChange();
      }
      board.addEventListener('pointermove', rmove);
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
      // Snap-to-connect: road/rail pieces click flush against other same-layer pieces.
      if (t.layer === 1) {
        const s = snapConnect(t, placed.filter((p) => p.id !== t.id && (p.layer ?? 2) === 1), 6);
        t.x = Math.max(0, s.x); t.y = Math.max(0, s.y);
      }
      const el = tileEl(t.id);
      if (el) { el.style.left = t.x * PX + 'px'; el.style.top = t.y * PX + 'px'; }
      refreshOverlaps();
    }
    function end(e) {
      if (e.pointerId !== ev.pointerId) return;
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', end);
      board.removeEventListener('pointercancel', end);
      onChange();
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
    if (step) { t.x = Math.max(0, t.x + step[0]); t.y = Math.max(0, t.y + step[1]); render(); onChange(); ev.preventDefault(); }
    else if (ev.key === 'Escape') select(null);
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); ev.preventDefault(); }
    else if (ev.key.toLowerCase() === 'r') { rotateSelected(); }
  });

  render();
  applyZoom();
  return {
    addSet, getPlaced, setPlaced, render, select,
    rotateSelected, deleteSelected, resizeSelected,
    setZoom, zoomBy, fit,
    _state: () => ({ placed, selectedId }),
  };
}
