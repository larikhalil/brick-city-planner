// End-to-end integration test of createGrid against a minimal DOM mock — exercises the
// selection / undo-redo / clipboard / group / align stack that the pure geometry tests can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- tiny DOM mock ----------------------------------------------------------
function parseSel(sel) {
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const idm = sel.match(/\[data-id="([^"]+)"\]/);
  return { classes, dataId: idm ? idm[1] : null };
}
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this._classes = new Set();
    this.style = {};
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
}
globalThis.document = { createElement: (t) => new El(t) };
globalThis.window = { addEventListener() {} };

// ---- drive it ---------------------------------------------------------------
test('createGrid: place, undo/redo, group, align, copy/paste, duplicate, delete', async () => {
const { createGrid } = await import('../js/grid.js');

const board = new El('div');
const stage = new El('div'); stage.clientWidth = 800; stage.clientHeight = 600; stage.scrollTo = () => {};
stage.appendChild(board);
board.parent = stage; // parentElement
Object.defineProperty(board, 'parentElement', { get() { return stage; } });

let changes = 0, hist = 0, sels = 0;
const g = createGrid(board, { onChange: () => changes++, onHistory: () => hist++, onSelect: () => sels++ });

const mkSet = (n, w, h, layer = 2) => ({ set_num: n, name: 'Set ' + n, category: 'city', kind: 'generic', footprint: { w, h, source: 'curated' }, layer, color: null });

// place three sets
g.addSet(mkSet('a', 16, 16));
g.addSet(mkSet('b', 16, 16));
g.addSet(mkSet('c', 16, 16));
assert.equal(g.getPlaced().length, 3, 'three placed');
assert.equal(g.getSelection().length, 1, 'last placed is selected');

// undo one placement
g.undo();
assert.equal(g.getPlaced().length, 2, 'undo removed a tile');
g.redo();
assert.equal(g.getPlaced().length, 3, 'redo restored it');

// select all + group
g.selectAll();
assert.equal(g.getSelection().length, 3, 'select-all picks everything');
g.groupSelection();
assert.ok(g.getPlaced().every((p) => p.groupId), 'all tiles grouped');
// clicking behaviour: selecting one selects the whole group
g.select(g.getPlaced()[0].id);
assert.equal(g.getSelection().length, 3, 'group selects as a unit');

// align left: all AABB minX equal
g.alignSelection('left');
const minXs = g.getPlaced().map((p) => p.x);
assert.ok(minXs.every((x) => x === minXs[0]), 'align-left lines up x');

// distribute needs 3 (already 3) — no throw
g.distributeSelection('h');

// copy / paste
g.select(g.getPlaced()[0].id); // whole group again
g.copySelection();
const before = g.getPlaced().length;
g.paste();
assert.equal(g.getPlaced().length, before + 3, 'paste added a copy of the group');
assert.equal(g.getSelection().length, 3, 'pasted tiles are selected');
// pasted group has a fresh groupId
const gids = new Set(g.getPlaced().map((p) => p.groupId));
assert.equal(gids.size, 2, 'paste made an independent group');

// duplicate
const n2 = g.getPlaced().length;
g.duplicate();
assert.equal(g.getPlaced().length, n2 + 3, 'duplicate added copies');

// rotate group (no throw) then ungroup
g.rotateSelected();
g.ungroup();
assert.ok(g.getSelection().every((id) => !g.getPlaced().find((p) => p.id === id).groupId), 'ungroup cleared groupId');

// delete selection
const n3 = g.getPlaced().length;
g.deleteSelected();
assert.equal(g.getPlaced().length, n3 - 3, 'delete removed the selection');

// history has depth and jump works
const h = g.getHistory();
assert.ok(h.entries.length > 5 && h.index === h.entries.length - 1, 'history recorded steps');
g.jumpHistory(1);
assert.ok(g.canRedo(), 'jump back enables redo');

// bringForward / sendBackward on a single tile
g.jumpHistory(h.entries.length - 1);
if (g.getPlaced().length) { g.select(g.getPlaced()[0].id); g.bringForward(); g.sendBackward(); }

assert.ok(changes > 0 && hist > 0 && sels > 0, 'callbacks fired');
});
