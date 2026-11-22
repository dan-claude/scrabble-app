/**
 * Pure geometry helpers for drag-and-drop.
 *
 * Keeping this separate from the React component means the board-cell
 * hit-test logic can be unit-tested without a DOM or React renderer.
 *
 * Key design choice: all functions take explicit coordinates and rects
 * rather than querying the DOM.  getBoundingClientRect() and pointer-event
 * clientX/Y are always in the same coordinate space (both "relative to the
 * viewport"), so the math here is correct at any pinch-zoom level.
 */

export const BOARD_COLS = 15;
export const BOARD_ROWS = 15;
export const BOARD_PADDING_PX = 6; // must match .board { padding: 6px } in App.css

/**
 * Given a DOMRect for the .board element and a pointer position, return the
 * [row, col] of the cell under the pointer, or null if outside the grid.
 */
export function cellFromRect(boardRect, cx, cy) {
  const gridLeft = boardRect.left + BOARD_PADDING_PX;
  const gridTop  = boardRect.top  + BOARD_PADDING_PX;
  const gridW    = boardRect.width  - 2 * BOARD_PADDING_PX;
  const gridH    = boardRect.height - 2 * BOARD_PADDING_PX;

  if (cx < gridLeft || cx > gridLeft + gridW ||
      cy < gridTop  || cy > gridTop  + gridH) return null;

  const col = Math.min(BOARD_COLS - 1, Math.floor((cx - gridLeft) / (gridW / BOARD_COLS)));
  const row = Math.min(BOARD_ROWS - 1, Math.floor((cy - gridTop)  / (gridH / BOARD_ROWS)));
  return [row, col];
}

/**
 * Returns whether (cx, cy) is inside the given DOMRect.
 */
export function pointInRect(rect, cx, cy) {
  return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
}

// ---------------------------------------------------------------------------
// Coordinate normalisation for pinch-zoom on iOS
// ---------------------------------------------------------------------------

// On iOS 13-14, getBoundingClientRect() returns layout-viewport (CSS pixel)
// coordinates while PointerEvent.clientX/Y return visual-viewport coordinates.
// On iOS 15+ both use visual-viewport coordinates.
// We detect which space getBoundingClientRect() is in and convert accordingly.

let _bcrSpaceDetected = false;
let _bcrIsVisual = true; // safe default: assume modern behaviour

function _detectBcrSpace() {
  if (_bcrSpaceDetected) return;
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv || Math.abs(vv.scale - 1) < 0.01) return; // can't tell at scale=1
  _bcrSpaceDetected = true;
  const html = document.documentElement;
  const rect = html.getBoundingClientRect();
  // Visual mode: BCR width ≈ offsetWidth * scale.  Layout mode: BCR width ≈ offsetWidth.
  _bcrIsVisual = rect.width > html.offsetWidth * 1.3;
}

/**
 * Convert PointerEvent clientX/Y to the same coordinate space used by
 * getBoundingClientRect() on the current browser/iOS version.
 *
 * Returns [normalizedX, normalizedY].
 */
export function normalizeClientCoords(clientX, clientY) {
  _detectBcrSpace();
  if (_bcrIsVisual) return [clientX, clientY];
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv || Math.abs(vv.scale - 1) < 0.01) return [clientX, clientY];
  // BCR is in layout coords; convert visual clientX/Y → layout
  return [vv.offsetLeft + clientX / vv.scale, vv.offsetTop + clientY / vv.scale];
}

/** Allow tests to reset the cached detection (call before mocking visualViewport). */
export function _resetBcrSpaceCache() {
  _bcrSpaceDetected = false;
  _bcrIsVisual = true;
}

// ---------------------------------------------------------------------------
// Ghost positioning for pinch-zoomed iOS
// ---------------------------------------------------------------------------

/**
 * Convert PointerEvent clientX/Y to the coordinate space used by
 * `position: fixed` elements on iOS Safari.
 *
 * On iOS 15+, `position: fixed` is anchored to the visual viewport.
 * `clientX/Y` is measured from the layout viewport's top-left
 * (pageX - scrollX), so when the visual viewport has been panned
 * beyond the layout scroll (visualViewport.offsetTop > window.scrollY —
 * which happens when the user zooms in near the bottom of the page),
 * we subtract the extra pan so the fixed ghost lands on the finger.
 */
export function clientToFixed(clientX, clientY) {
  if (typeof window === 'undefined') return [clientX, clientY];
  const vv = window.visualViewport;
  if (!vv || Math.abs(vv.scale - 1) < 0.01) return [clientX, clientY];
  const panX = vv.offsetLeft - (window.scrollX || 0);
  const panY = vv.offsetTop  - (window.scrollY || 0);
  if (Math.abs(panX) < 0.5 && Math.abs(panY) < 0.5) return [clientX, clientY];
  return [clientX - panX, clientY - panY];
}
