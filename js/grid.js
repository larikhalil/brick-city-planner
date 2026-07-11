import { catColor } from './catalog.js';
import { anyOverlaps, bbox, extent, snap } from './geometry.js';
import { esc } from './util.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text

export function createGrid(board, { onChange = () => {} } = {}) {
  let placed = [];
  let selectedId = null;
  let seq = 1;
  let zoom = 1;
  const stage = board.parentElement;

  function addSet(set) {
    const id = 'p' + (seq++);
    placed.push({
      id, set_num: set.set_num, name: set.name, category: set.category,
      x: 0, y: 0, w: set.footprint.w, h: set.footprint.h, rot: 0,
      approx: set.footprint.source !== 'curated', img: set.img || null,
      ground: !!set.ground, color: set.color || null,
    });
    selectedId = id;
    render(); onChange();
  }

  function getPlaced() { return placed; }
  function setPlaced(arr) {
    placed = arr.map((p) => ({ ...p }));
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
    // Paint ground tiles (baseplates) first so buildings render on top of them.
    const paintOrder = [...placed].sort((a, b) => (a.ground === b.ground ? 0 : a.ground ? -1 : 1));
    for (const t of paintOrder) {
      const e = extent(t);
      const lightGround = t.ground && /--g-(white|sand)/.test(t.color || '');
      const el = document.createElement('div');
      el.className = 'tile' + ((DARK_TXT.has(t.category) || lightGround) ? ' dark-txt' : '') +
        (t.ground ? ' ground' : '') +
        (over.has(t.id) ? ' warn' : '') + (t.id === selectedId ? ' selected' : '');
      el.style.left = t.x * PX + 'px';
      el.style.top = t.y * PX + 'px';
      el.style.width = e.w * PX + 'px';
      el.style.height = e.h * PX + 'px';
      el.style.background = t.color || catColor(t.category);
      if (t.img && !t.ground) {
        el.style.backgroundImage =
          `linear-gradient(${catColor(t.category)}cc, ${catColor(t.category)}cc), url("${t.img}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundBlendMode = 'multiply';
      }
      el.dataset.id = t.id;
      el.tabIndex = 0;
      el.innerHTML = `
        <div class="tn">${esc(t.name)}${t.approx ? ' <span style="opacity:.8;font-weight:400">≈</span>' : ''}</div>
        <div class="tsub"><span>${esc(t.set_num.replace(/-\d+$/, ''))}</span><span>${e.w}×${e.h}</span></div>`;
      if (t.id === selectedId) {
        const h = document.createElement('div');
        h.className = 'resize-handle';
        el.appendChild(h);
      }
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
      const handle = el.querySelector('.resize-handle');
      if (isSel && !handle) { const h = document.createElement('div'); h.className = 'resize-handle'; el.appendChild(h); }
      else if (!isSel && handle) handle.remove();
    }
    if (id) tileEl(id)?.focus({ preventScroll: true });
  }

  function rotateSelected() {
    const t = placed.find((p) => p.id === selectedId); if (!t) return;
    t.rot = (t.rot + 90) % 360; render(); onChange();
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
    if (ev.target.classList.contains('resize-handle')) {
      const t = placed.find((p) => p.id === selectedId);
      if (!t) return;
      const sx = ev.clientX, sy = ev.clientY, ow = t.w, oh = t.h;
      try { board.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      function rmove(e) {
        if (e.pointerId !== ev.pointerId) return;
        t.w = Math.max(1, snap(ow + (e.clientX - sx) / PX / zoom));
        t.h = Math.max(1, snap(oh + (e.clientY - sy) / PX / zoom));
        t.approx = true;
        const el = tileEl(t.id);
        if (el) {
          const en = extent(t);
          el.style.width = en.w * PX + 'px';
          el.style.height = en.h * PX + 'px';
          const sizeSpan = el.querySelector('.tsub span:last-child');
          if (sizeSpan) sizeSpan.textContent = `${en.w}×${en.h}`;
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
