// Wave 6 (mobile/touch): shared pointer helpers.
//
// HTML5 drag-and-drop never fires for touch on mobile browsers, so a finger needs a custom
// Pointer-Events drag path alongside the desktop mouse DnD. This tiny module holds the one pure
// decision that path turns on — "is this a coarse (finger/pen) pointer?" — factored out so it can
// be unit-tested without a DOM.

// Decide whether a pointer should use the touch/pen custom-drag path instead of the mouse HTML5
// drag-and-drop. A PointerEvent's `pointerType` is authoritative when present ('touch'/'pen' →
// coarse, 'mouse' → fine); for anything else (empty/unknown, older engines) we fall back to the
// `(pointer:coarse)` media-query result the caller passes in. Pure + synchronous on purpose.
export function isCoarsePointer(pointerType, coarseMedia = false) {
  if (pointerType === 'touch' || pointerType === 'pen') return true;
  if (pointerType === 'mouse') return false;
  return !!coarseMedia;
}

// Wave 6 (touch delete-safety): decide whether a delete press should ARM a tap-confirm instead of
// deleting outright. On a coarse (finger/pen) pointer the first press only arms — a second press
// within the window commits — so a stray tap can't nuke a piece (ACC-5). A mouse (fine pointer)
// always deletes immediately, so the desktop experience is byte-for-byte unchanged. Pure so the
// guard's branch is unit-testable without a DOM.
export function deleteNeedsConfirm(coarse, armed) {
  return !!coarse && !armed;
}
