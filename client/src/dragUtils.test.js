import { describe, it, expect } from 'vitest';
import { cellFromRect, pointInRect, BOARD_COLS, BOARD_ROWS, BOARD_PADDING_PX } from './dragUtils';

function makeRect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

// A 300×300 board at origin — easy to reason about manually.
// Grid area: 288×288 (300 - 2*6), each cell 288/15 = 19.2px
const BOARD_SIZE = 300;
const BASE_RECT = makeRect(0, 0, BOARD_SIZE, BOARD_SIZE);
const CELL_SIZE = (BOARD_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS; // 19.2

describe('cellFromRect — board at origin', () => {
  it('returns null outside the board', () => {
    expect(cellFromRect(BASE_RECT, -1, 150)).toBeNull();
    expect(cellFromRect(BASE_RECT, 150, -1)).toBeNull();
    expect(cellFromRect(BASE_RECT, 301, 150)).toBeNull();
    expect(cellFromRect(BASE_RECT, 150, 301)).toBeNull();
  });

  it('returns null inside padding (left edge)', () => {
    expect(cellFromRect(BASE_RECT, BOARD_PADDING_PX - 0.1, 150)).toBeNull();
  });

  it('returns null inside padding (top edge)', () => {
    expect(cellFromRect(BASE_RECT, 150, BOARD_PADDING_PX - 0.1)).toBeNull();
  });

  it('returns [0,0] for top-left cell center', () => {
    const cx = BOARD_PADDING_PX + CELL_SIZE * 0.5;
    const cy = BOARD_PADDING_PX + CELL_SIZE * 0.5;
    expect(cellFromRect(BASE_RECT, cx, cy)).toEqual([0, 0]);
  });

  it('returns [0,14] for top-right cell center', () => {
    const cx = BOARD_PADDING_PX + CELL_SIZE * 14.5;
    const cy = BOARD_PADDING_PX + CELL_SIZE * 0.5;
    expect(cellFromRect(BASE_RECT, cx, cy)).toEqual([0, 14]);
  });

  it('returns [14,0] for bottom-left cell center', () => {
    const cx = BOARD_PADDING_PX + CELL_SIZE * 0.5;
    const cy = BOARD_PADDING_PX + CELL_SIZE * 14.5;
    expect(cellFromRect(BASE_RECT, cx, cy)).toEqual([14, 0]);
  });

  it('returns [14,14] for bottom-right cell center', () => {
    const cx = BOARD_PADDING_PX + CELL_SIZE * 14.5;
    const cy = BOARD_PADDING_PX + CELL_SIZE * 14.5;
    expect(cellFromRect(BASE_RECT, cx, cy)).toEqual([14, 14]);
  });

  it('returns [7,7] for center cell', () => {
    const cx = BOARD_PADDING_PX + CELL_SIZE * 7.5;
    const cy = BOARD_PADDING_PX + CELL_SIZE * 7.5;
    expect(cellFromRect(BASE_RECT, cx, cy)).toEqual([7, 7]);
  });

  it('all 225 cells are reachable', () => {
    const seen = new Set();
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const cx = BOARD_PADDING_PX + CELL_SIZE * (col + 0.5);
        const cy = BOARD_PADDING_PX + CELL_SIZE * (row + 0.5);
        const result = cellFromRect(BASE_RECT, cx, cy);
        expect(result).not.toBeNull();
        seen.add(`${result[0]},${result[1]}`);
      }
    }
    expect(seen.size).toBe(225);
  });
});

describe('cellFromRect — board at offset position (simulates scrolled/offset layout)', () => {
  // Board at (100, 200) — typical mid-page position
  const OFFSET_RECT = makeRect(100, 200, BOARD_SIZE, BOARD_SIZE);
  const OFF_CELL_SIZE = (BOARD_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS;

  it('returns null for a point at board origin in screen space (not inside board)', () => {
    expect(cellFromRect(OFFSET_RECT, 0, 0)).toBeNull();
  });

  it('returns [0,0] for top-left cell with offset', () => {
    const cx = 100 + BOARD_PADDING_PX + OFF_CELL_SIZE * 0.5;
    const cy = 200 + BOARD_PADDING_PX + OFF_CELL_SIZE * 0.5;
    expect(cellFromRect(OFFSET_RECT, cx, cy)).toEqual([0, 0]);
  });

  it('returns [14,14] for bottom-right cell with offset', () => {
    const cx = 100 + BOARD_PADDING_PX + OFF_CELL_SIZE * 14.5;
    const cy = 200 + BOARD_PADDING_PX + OFF_CELL_SIZE * 14.5;
    expect(cellFromRect(OFFSET_RECT, cx, cy)).toEqual([14, 14]);
  });
});

describe('cellFromRect — zoomed board (larger visual rect, same cell count)', () => {
  // When pinch-zoomed 2x, getBoundingClientRect reports a larger rect
  // but clientX/Y are still in the same viewport space — the math should still work.
  const ZOOMED_SIZE = 600; // 2× zoom
  const ZOOMED_RECT = makeRect(50, 80, ZOOMED_SIZE, ZOOMED_SIZE);
  const Z_CELL_SIZE = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS;

  it('returns [0,0] for top-left cell when zoomed 2x', () => {
    const cx = 50 + BOARD_PADDING_PX + Z_CELL_SIZE * 0.5;
    const cy = 80 + BOARD_PADDING_PX + Z_CELL_SIZE * 0.5;
    expect(cellFromRect(ZOOMED_RECT, cx, cy)).toEqual([0, 0]);
  });

  it('returns [14,14] for bottom-right cell when zoomed 2x', () => {
    const cx = 50 + BOARD_PADDING_PX + Z_CELL_SIZE * 14.5;
    const cy = 80 + BOARD_PADDING_PX + Z_CELL_SIZE * 14.5;
    expect(cellFromRect(ZOOMED_RECT, cx, cy)).toEqual([14, 14]);
  });

  it('returns [7,7] for center cell when zoomed 2x', () => {
    const cx = 50 + BOARD_PADDING_PX + Z_CELL_SIZE * 7.5;
    const cy = 80 + BOARD_PADDING_PX + Z_CELL_SIZE * 7.5;
    expect(cellFromRect(ZOOMED_RECT, cx, cy)).toEqual([7, 7]);
  });

  it('all 225 cells are reachable when zoomed 2x', () => {
    const seen = new Set();
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const cx = 50 + BOARD_PADDING_PX + Z_CELL_SIZE * (col + 0.5);
        const cy = 80 + BOARD_PADDING_PX + Z_CELL_SIZE * (row + 0.5);
        const result = cellFromRect(ZOOMED_RECT, cx, cy);
        expect(result).not.toBeNull();
        seen.add(`${result[0]},${result[1]}`);
      }
    }
    expect(seen.size).toBe(225);
  });

  it('cell boundary falls at the right pixel when zoomed', () => {
    // The boundary between col 0 and col 1 should be at gridLeft + Z_CELL_SIZE
    const boundary = 50 + BOARD_PADDING_PX + Z_CELL_SIZE;
    expect(cellFromRect(ZOOMED_RECT, boundary - 0.01, 80 + BOARD_PADDING_PX + 1)?.[1]).toBe(0);
    expect(cellFromRect(ZOOMED_RECT, boundary + 0.01, 80 + BOARD_PADDING_PX + 1)?.[1]).toBe(1);
  });
});

describe('cellFromRect — zoomed AND panned (board partially off-screen)', () => {
  // After pinch-zooming 2× and scrolling right/down, the board's left edge may
  // be off the left side of the viewport (negative left) and the top edge may
  // be above the viewport (negative top).  getBoundingClientRect() faithfully
  // reports those negative values; clientX/Y from the pointer event is still
  // measured from the viewport origin.  The math must still produce the right
  // cell.
  const ZOOMED_SIZE = 600; // 2× zoom

  it('returns correct cell after zoom + pan right (board left < 0)', () => {
    // Board panned so its left edge is 150px off the left of the viewport
    const rect = makeRect(-150, 0, ZOOMED_SIZE, ZOOMED_SIZE);
    const cellW = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS;

    // col 5 center should be at rect.left + padding + 5.5 * cellW
    const cx = -150 + BOARD_PADDING_PX + cellW * 5.5;
    const cy = BOARD_PADDING_PX + (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_ROWS * 2.5;
    expect(cellFromRect(rect, cx, cy)).toEqual([2, 5]);
  });

  it('returns correct cell after zoom + pan down (board top < 0)', () => {
    // Board panned so its top edge is 200px above the viewport
    const rect = makeRect(0, -200, ZOOMED_SIZE, ZOOMED_SIZE);
    const cellH = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_ROWS;

    // row 10 center is at rect.top + padding + 10.5 * cellH
    const cx = BOARD_PADDING_PX + (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS * 7.5;
    const cy = -200 + BOARD_PADDING_PX + cellH * 10.5;
    expect(cellFromRect(rect, cx, cy)).toEqual([10, 7]);
  });

  it('returns correct cell after zoom + pan in both directions', () => {
    // Realistic scenario: 2× zoom, board panned so only the middle portion is visible
    const rect = makeRect(-80, -120, ZOOMED_SIZE, ZOOMED_SIZE);
    const cellW = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS;
    const cellH = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_ROWS;

    // The star cell (center of the board) should always be [7,7]
    const cx = -80 + BOARD_PADDING_PX + cellW * 7.5;
    const cy = -120 + BOARD_PADDING_PX + cellH * 7.5;
    expect(cellFromRect(rect, cx, cy)).toEqual([7, 7]);
  });

  it('returns null when pointer is in the viewport but outside the (panned) board', () => {
    // Board panned so it starts at x=200; a pointer at x=100 is left of the board
    const rect = makeRect(200, 0, ZOOMED_SIZE, ZOOMED_SIZE);
    expect(cellFromRect(rect, 100, 300)).toBeNull();
  });

  it('all 225 cells reachable after zoom + pan', () => {
    const rect = makeRect(-80, -120, ZOOMED_SIZE, ZOOMED_SIZE);
    const cellW = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_COLS;
    const cellH = (ZOOMED_SIZE - 2 * BOARD_PADDING_PX) / BOARD_ROWS;
    const seen = new Set();
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const cx = -80 + BOARD_PADDING_PX + cellW * (col + 0.5);
        const cy = -120 + BOARD_PADDING_PX + cellH * (row + 0.5);
        const result = cellFromRect(rect, cx, cy);
        expect(result).not.toBeNull();
        seen.add(`${result[0]},${result[1]}`);
      }
    }
    expect(seen.size).toBe(225);
  });
});

describe('pointInRect', () => {
  const r = makeRect(10, 20, 100, 50);

  it('returns true for a point inside', () => {
    expect(pointInRect(r, 60, 45)).toBe(true);
  });

  it('returns true on the left edge', () => {
    expect(pointInRect(r, 10, 45)).toBe(true);
  });

  it('returns true on the right edge', () => {
    expect(pointInRect(r, 110, 45)).toBe(true);
  });

  it('returns false just outside left', () => {
    expect(pointInRect(r, 9.9, 45)).toBe(false);
  });

  it('returns false just outside top', () => {
    expect(pointInRect(r, 60, 19.9)).toBe(false);
  });

  it('returns false just outside bottom', () => {
    expect(pointInRect(r, 60, 70.1)).toBe(false);
  });
});
