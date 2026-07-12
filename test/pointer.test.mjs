// Wave 6 (mobile/touch): the one pure decision the finger-drag path turns on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCoarsePointer, deleteNeedsConfirm } from '../js/pointer.js';

test('touch and pen pointers are always coarse (get the custom drag path)', () => {
  assert.equal(isCoarsePointer('touch'), true);
  assert.equal(isCoarsePointer('pen'), true);
  // The media-query fallback is irrelevant when pointerType is authoritative.
  assert.equal(isCoarsePointer('touch', false), true);
  assert.equal(isCoarsePointer('pen', false), true);
});

test('a mouse is never coarse (keeps the desktop HTML5 drag-and-drop)', () => {
  assert.equal(isCoarsePointer('mouse'), false);
  assert.equal(isCoarsePointer('mouse', true), false); // even on a coarse-capable device
});

test('unknown/empty pointerType falls back to the (pointer:coarse) media match', () => {
  assert.equal(isCoarsePointer('', true), true);
  assert.equal(isCoarsePointer('', false), false);
  assert.equal(isCoarsePointer(undefined, true), true);
  assert.equal(isCoarsePointer(undefined, false), false);
  assert.equal(isCoarsePointer(undefined), false); // media arg omitted → defaults to false
  assert.equal(isCoarsePointer('unknown', true), true);
});

test('touch delete arms a confirm on the first press, commits on the second', () => {
  assert.equal(deleteNeedsConfirm(true, false), true);  // finger, not yet armed → arm (don't delete)
  assert.equal(deleteNeedsConfirm(true, true), false);  // finger, armed → the confirming tap deletes
});

test('a mouse delete never needs confirming (desktop deletes immediately)', () => {
  assert.equal(deleteNeedsConfirm(false, false), false);
  assert.equal(deleteNeedsConfirm(false, true), false);
  assert.equal(deleteNeedsConfirm(undefined, false), false); // no pointer info → treat as immediate
});
