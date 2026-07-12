// Integration test for the MOTION-3 terrain layer + UI-5 notes / custom blocks, driven through the
// same minimal DOM mock the core grid test uses. Exercises creation, undo, selection exclusion and
// serialize round-trip via the public grid API (the pointer gestures just call these methods).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeCity, validateCity } from '../js/storage.js';

// ---- tiny DOM mock (same shape as grid.test.mjs) ----------------------------
function parseSel(sel) {
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const idm = sel.match(/\[data-id="([^"]+)"\]/);
  return { classes, dataId: idm ? idm[1] : null };
}
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this._classes = new Set();
    this.style = { setProperty() {} };
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this._listeners = {};
    this.tabIndex = 0;
  }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }
  get classList() {
    const s = this._classes;
    return {
      add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
      toggle: (c, on) => { const has = s.has(c); const want = on === undefined ? !has : on; want ? s.add(c) : s.delete(c); return want; },
    };
  }
  set innerHTML(html) {
    this.children = [];
    if (/class="tlabel"/.test(html)) { const l = new El('div'); l._classes.add('tlabel'); l.parent = this; this.children.push(l); }
    if (/class="empty-hint"/.test(html)) { const l = new El('div'); l._classes.add('empty-hint'); l.parent = this; this.children.push(l); }
  }
  insertAdjacentHTML(_pos, html) {
    const m = html.match(/class="([\w-]+)/);
    const el = new El('div'); if (m) el._classes.add(m[1]); el.parent = this; this.children.push(el);
  }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  _all() { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out; }
  _match(el, p) { return p.classes.every((c) => el._classes.has(c)) && (!p.dataId || el.dataset.id === p.dataId); }
  querySelector(sel) { const p = parseSel(sel); return this._all().find((el) => this._match(el, p)) || null; }
  querySelectorAll(sel) { const p = parseSel(sel); return this._all().filter((el) => this._match(el, p)); }
  closest(sel) { const p = parseSel(sel); let n = this; while (n) { if (this._match(n, p)) return n; n = n.parent; } return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: (Number(this.style.width?.replace('px', '')) || 0), height: (Number(this.style.height?.replace('px', '')) || 0) }; }
  setPointerCapture() {} focus() {}
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener() {}
}
globalThis.document = { createElement: (t) => new El(t) };
globalThis.window = { addEventListener() {} };

test('terrain / notes / custom blocks: create, undo, select-exclude, serialize', async () => {
  const { createGrid } = await import('../js/grid.js');
  const board = new El('div');
  const stage = new El('div'); stage.clientWidth = 800; stage.clientHeight = 600; stage.scrollTo = () => {};
  stage.appendChild(board); board.parent = stage;
  Object.defineProperty(board, 'parentElement', { get() { return stage; } });

  let edits = [], modes = [];
  const g = createGrid(board, { onRequestEdit: (t) => edits.push(t), onMode: (m) => modes.push(m) });

  // ---- mode switching ----
  assert.equal(g.getMode(), 'select');
  g.setMode('terrain');
  assert.equal(g.getMode(), 'terrain');
  assert.ok(modes.includes('terrain'));
  g.setTerrainType('water');
  assert.equal(g.getTerrainType(), 'water');
  g.setMode('select');

  // ---- terrain paint + erase ----
  const t1 = g.paintTerrain({ x: 0, y: 0, w: 32, h: 32 }, 'grass');
  const t2 = g.paintTerrain({ x: 32, y: 0, w: 32, h: 32 }, 'water');
  assert.equal(g.getPlaced().filter((p) => p.kind === 'terrain').length, 2);
  assert.equal(t2.color, 'var(--g-blue)');

  // erase only the tile the drag intersects
  const removed = g.eraseTerrain({ x: 33, y: 1, w: 4, h: 4 });
  assert.equal(removed, 1, 'one terrain fill erased');
  assert.equal(g.getPlaced().filter((p) => p.kind === 'terrain').length, 1);
  g.undo(); // erase is undoable
  assert.equal(g.getPlaced().filter((p) => p.kind === 'terrain').length, 2, 'undo restored the erased fill');

  // ---- notes ----
  const note = g.addNoteAt(10, 10, 'Fire station');
  assert.equal(note.kind, 'note');
  assert.equal(g.getSelection().length, 1, 'new note is selected');
  g.updateTile(note.id, { text: 'Police station' });
  assert.equal(g.getPlaced().find((p) => p.id === note.id).text, 'Police station');

  // ---- custom block ----
  const block = g.addCustomRect({ x: 64, y: 0, w: 16, h: 16 }, 'Tower');
  assert.equal(block.kind, 'custom');
  g.updateTile(block.id, { name: 'Skyscraper', w: 24, h: 40 });
  const b2 = g.getPlaced().find((p) => p.id === block.id);
  assert.equal(b2.name, 'Skyscraper');
  assert.deepEqual([b2.w, b2.h], [24, 40]);

  // ---- select-all excludes terrain, includes notes + custom ----
  g.selectAll();
  const selKinds = g.getPlaced().filter((p) => g.getSelection().includes(p.id)).map((p) => p.kind);
  assert.ok(!selKinds.includes('terrain'), 'terrain never joins a normal selection');
  assert.ok(selKinds.includes('note') && selKinds.includes('custom'), 'notes + blocks are selectable');

  // ---- serialize / validate round-trip ----
  const g2 = g.getGrid();
  const city = serializeCity({ name: 'T', units: 'studs', placed: g.getPlaced(), grid: { w: g2.w, h: g2.h } });
  const res = validateCity(city);
  assert.ok(res.ok, 'city with terrain/notes/custom validates');
  const kinds = res.city.placed.map((p) => p.kind).sort();
  assert.deepEqual([...new Set(kinds)].sort(), ['custom', 'note', 'terrain']);

  // reload into a fresh grid — everything round-trips
  const board2 = new El('div'); const stage2 = new El('div');
  stage2.clientWidth = 800; stage2.clientHeight = 600; stage2.scrollTo = () => {};
  stage2.appendChild(board2); board2.parent = stage2;
  Object.defineProperty(board2, 'parentElement', { get() { return stage2; } });
  const gr = createGrid(board2, {});
  gr.setPlaced(res.city.placed, res.city.grid);
  assert.equal(gr.getPlaced().filter((p) => p.kind === 'terrain').length, 2);
  assert.equal(gr.getPlaced().filter((p) => p.kind === 'note').length, 1);
  assert.equal(gr.getPlaced().filter((p) => p.kind === 'custom').length, 1);
});
