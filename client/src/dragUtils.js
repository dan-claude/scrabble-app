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
