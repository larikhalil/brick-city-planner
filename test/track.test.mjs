// PLAN-10: real track-curve radius classes (R40/R56/R72/R104) + mismatch warning + switch geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  radiusClass, radiusMismatch, rotationStep, trackPorts, snapConnect, snapConnectInfo,
  SWITCH_ANGLE, CURVE_TURN,
} from '../js/geometry.js';

const pieces = JSON.parse(readFileSync(new URL('../data/pieces.json', import.meta.url)));
const byNum = new Map(pieces.map((p) => [p.set_num, p]));

// ---- data: radius tagging in pieces.json ----------------------------------------------------
test('every track curve/switch piece is tagged with a real radius class', () => {
  const curvesAndSwitches = pieces.filter((p) => p.kind === 'track' && /curve|switch/i.test(p.name));
  assert.ok(curvesAndSwitches.length >= 8, 'has curves + switches to tag');
  for (const p of curvesAndSwitches) {
    assert.match(p.radius || '', /^R(40|56|72|104)$/, `${p.set_num} carries a radius class`);
    assert.equal(p.turn, 22.5, `${p.set_num} turns the real 22.5° curve increment`);
  }
  // straights + crossings carry NO radius (they never warn against anything)
  assert.equal(radiusClass(byNum.get('piece-track-straight')), null);
  assert.equal(radiusClass(byNum.get('piece-track-cross')), null);
});

test('R56/R72/R104 curve variants exist for both left and right', () => {
  for (const r of ['r56', 'r72', 'r104']) {
    for (const side of ['left', 'right']) {
      const key = `piece-track-curve-${side}-${r}`;
      const p = byNum.get(key);
      assert.ok(p, `${key} present`);
      assert.equal(p.radius, 'R' + r.slice(1));
      assert.equal(p.kind, 'track');
      assert.match(p.name.toLowerCase(), /curve/);
    }
  }
  // the default (unsuffixed) curves are R40
  assert.equal(byNum.get('piece-track-curve-left').radius, 'R40');
  assert.equal(byNum.get('piece-track-curve-right').radius, 'R40');
});

test('switch pieces carry the R40 radius, 22.5° turn and the 16.5° branch angle', () => {
  for (const key of ['piece-track-switch-left', 'piece-track-switch-right']) {
    const p = byNum.get(key);
    assert.equal(p.radius, 'R40');
    assert.equal(p.turn, 22.5);
    assert.equal(p.switchAngle, 16.5);
  }
});

// ---- radiusClass / radiusMismatch predicate -------------------------------------------------
test('radiusClass returns the tag or null', () => {
  assert.equal(radiusClass({ radius: 'R56' }), 'R56');
  assert.equal(radiusClass({ radius: '' }), null);
  assert.equal(radiusClass({}), null);
  assert.equal(radiusClass(null), null);
});

test('radiusMismatch fires only when BOTH have a class and they differ', () => {
  const r40 = { radius: 'R40', name: 'A' }, r40b = { radius: 'R40', name: 'B' };
  const r56 = { radius: 'R56', name: 'C' }, straight = { name: 'S' };
  assert.equal(radiusMismatch(r40, r56), true, 'R40 vs R56 mismatches');
  assert.equal(radiusMismatch(r40, r40b), false, 'same class is fine');
  assert.equal(radiusMismatch(r40, straight), false, 'a radius-less straight never warns');
  assert.equal(radiusMismatch(straight, straight), false, 'two radius-less pieces never warn');
});

// ---- rotationStep -------------------------------------------------------------------------
test('rotationStep snaps track curves to their turn increment, everything else to 15°', () => {
  assert.equal(rotationStep({ kind: 'track', turn: 22.5 }), 22.5);
  assert.equal(rotationStep({ kind: 'track', turn: CURVE_TURN }), 22.5);
  assert.equal(rotationStep({ kind: 'track' }), 15, 'a straight track (no turn) keeps 15°');
  assert.equal(rotationStep({ kind: 'building' }), 15);
  assert.equal(rotationStep({}), 15);
  assert.equal(rotationStep({ kind: 'track', turn: 0 }), 15, 'a bogus 0 turn falls back to 15');
});

// ---- switch port geometry -----------------------------------------------------------------
test('a switch exposes a through route PLUS a diverging port at the 16.5° branch angle', () => {
  const rad = (SWITCH_ANGLE * Math.PI) / 180;
  for (const side of ['Right', 'Left']) {
    const ports = trackPorts({ kind: 'track', name: `Track — Switch (${side})`, w: 16, h: 16 });
    assert.equal(ports.length, 3, `${side} switch has entry + through + diverge`);
    const [T, B, D] = ports;
    // through route: T (up) and B (down) are collinear along the tile's spine
    assert.deepEqual([T.dx, T.dy], [0, -1], 'through-exit points straight up');
    assert.deepEqual([B.dx, B.dy], [0, 1], 'entry points straight down');
    assert.equal(T.x, B.x, 'through route is collinear (same x)');
    // diverging route leaves at exactly SWITCH_ANGLE from the through (up) direction…
    const angle = (Math.acos(-D.dy) * 180) / Math.PI; // -D.dy = D·(up)
    assert.ok(Math.abs(angle - SWITCH_ANGLE) < 1e-6, `${side} branch deflects 16.5°`);
    assert.ok(Math.abs(D.dx - Math.sin(rad)) < 1e-9 || Math.abs(D.dx + Math.sin(rad)) < 1e-9);
    // …toward +x for a right switch, -x for a left switch
    if (side === 'Right') { assert.ok(D.dx > 0, 'right switch branches to the right'); assert.ok(D.x > T.x); }
    else { assert.ok(D.dx < 0, 'left switch branches to the left'); assert.ok(D.x < T.x); }
  }
});

test('a plain straight track still exposes just its two end ports', () => {
  const ports = trackPorts({ kind: 'track', name: 'Track — Straight', w: 16, h: 16 });
  assert.equal(ports.length, 2);
});

// ---- snapConnectInfo reports the joined neighbour (feeds the mismatch warning) ---------------
test('snapConnectInfo names the port-connected neighbour; snapConnect stays {x,y}', () => {
  // an R40 right curve at the origin; its right opening faces +x
  const r40 = { id: 'b', x: 0, y: 0, w: 16, h: 16, rot: 0, kind: 'track', name: 'Track — Curve (Right) R40', radius: 'R40', layer: 1 };
  // an R56 left curve dropped just past that opening — its left opening faces back toward it
  const r56 = { id: 'a', x: 19, y: 1, w: 16, h: 16, rot: 0, kind: 'track', name: 'Track — Curve (Left) R56', radius: 'R56', layer: 1 };
  const info = snapConnectInfo(r56, [r40], 8);
  assert.equal(info.connectedTo, r40, 'the curve snapped to its port neighbour');
  assert.equal(radiusMismatch(r56, info.connectedTo), true, 'joining R56 to R40 is a mismatch');

  // the thin wrapper still returns ONLY {x, y} (no behavioural change for existing callers)
  const plain = snapConnect(r56, [r40], 8);
  assert.deepEqual(Object.keys(plain).sort(), ['x', 'y']);

  // two SAME-radius curves join without a mismatch
  const r56b = { ...r40, id: 'c', radius: 'R56', name: 'Track — Curve (Right) R56' };
  const info2 = snapConnectInfo(r56, [r56b], 8);
  assert.equal(info2.connectedTo, r56b);
  assert.equal(radiusMismatch(r56, info2.connectedTo), false, 'R56 to R56 is fine');
});

test('a baseplate/edge-align snap reports connectedTo:null (no port join)', () => {
  const bp = { id: 'bp', x: 35, y: 30, w: 32, h: 32, rot: 0, kind: 'baseplate', layer: 0 };
  assert.equal(snapConnectInfo(bp, [], 6).connectedTo, null);
});
