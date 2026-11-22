import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cellFromRect, pointInRect, normalizeClientCoords, clientToFixed, _resetBcrSpaceCache, BOARD_COLS, BOARD_ROWS, BOARD_PADDING_PX } from './dragUtils';

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

// ---------------------------------------------------------------------------
// normalizeClientCoords
// ---------------------------------------------------------------------------

describe('normalizeClientCoords — no zoom (scale = 1)', () => {
  beforeEach(() => {
    _resetBcrSpaceCache();
    // Simulate no zoom
    Object.defineProperty(window, 'visualViewport', {
      value: { scale: 1, offsetLeft: 0, offsetTop: 0 },
      configurable: true,
    });
  });
  afterEach(() => {
    _resetBcrSpaceCache();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  it('passes coords through unchanged', () => {
    expect(normalizeClientCoords(150, 300)).toEqual([150, 300]);
  });
});

describe('normalizeClientCoords — iOS 15+ (BCR in visual coords)', () => {
  // On iOS 15+, getBoundingClientRect() returns visual-viewport coordinates,
  // which match PointerEvent.clientX/Y directly. No conversion is needed.
  beforeEach(() => {
    _resetBcrSpaceCache();
    Object.defineProperty(window, 'visualViewport', {
      value: { scale: 2, offsetLeft: 0, offsetTop: 400 },
      configurable: true,
    });
    // Simulate document.documentElement with BCR width = offsetWidth * scale (visual mode)
    const origGetBCR = document.documentElement.getBoundingClientRect.bind(document.documentElement);
    Object.defineProperty(document.documentElement, 'offsetWidth', { value: 390, configurable: true });
    document.documentElement.getBoundingClientRect = () => ({ width: 780, height: 1500 }); // 390 * 2
  });
  afterEach(() => {
    _resetBcrSpaceCache();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    document.documentElement.getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(document.documentElement, 'offsetWidth', { value: undefined, configurable: true });
  });

  it('passes coords through unchanged (both in visual space)', () => {
    expect(normalizeClientCoords(200, 150)).toEqual([200, 150]);
  });

  it('a touch at visual y=150 stays at y=150 (rack area, not board)', () => {
    expect(normalizeClientCoords(100, 150)).toEqual([100, 150]);
  });
});

describe('normalizeClientCoords — iOS 13-14 (BCR in layout coords)', () => {
  // On iOS 13-14, getBoundingClientRect() returns CSS-pixel (layout) coordinates
  // while PointerEvent.clientX/Y are in visual-viewport coordinates.
  // normalizeClientCoords must convert the pointer coords to layout space.
  //
  // Scenario: 2× zoom, visual viewport scrolled to show layout y=400+.
  // Board is at layout y=0–390. Rack is at layout y=410–460.
  // User's finger is on the rack at visual y=20 (= layout 400 + 20/2 = 410).
  // Without normalization: clientY=20 < board.bottom=390 → erroneously IN board.
  // With normalization: layoutY = 400 + 20/2 = 410 > board.bottom=390 → NOT in board. ✓
  beforeEach(() => {
    _resetBcrSpaceCache();
    Object.defineProperty(window, 'visualViewport', {
      value: { scale: 2, offsetLeft: 0, offsetTop: 400 },
      configurable: true,
    });
    // Simulate BCR returning layout coordinates: width ≈ offsetWidth (not scaled)
    Object.defineProperty(document.documentElement, 'offsetWidth', { value: 390, configurable: true });
    document.documentElement.getBoundingClientRect = () => ({ width: 390, height: 900 }); // layout, not scaled
  });
  afterEach(() => {
    _resetBcrSpaceCache();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    document.documentElement.getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(document.documentElement, 'offsetWidth', { value: undefined, configurable: true });
  });

  it('converts visual coords to layout coords', () => {
    // visual y=20 → layout y = offsetTop + 20/scale = 400 + 10 = 410
    const [nx, ny] = normalizeClientCoords(0, 20);
    expect(ny).toBeCloseTo(410);
  });

  it('a touch on rack (visual y=20) maps to layout y=410, not inside board (0–390)', () => {
    const boardRect = makeRect(0, 0, 390, 390); // layout coords
    const [nx, ny] = normalizeClientCoords(195, 20);
    // layout y=410 > board.bottom 390 → cellFromRect returns null (not on board)
    expect(cellFromRect(boardRect, nx, ny)).toBeNull();
  });

  it('a touch on board (visual y=0) maps to layout y=400, also not in board', () => {
    const boardRect = makeRect(0, 0, 390, 390);
    const [nx, ny] = normalizeClientCoords(195, 0);
    // layout y=400 > 390 → not in board
    expect(cellFromRect(boardRect, nx, ny)).toBeNull();
  });

  it('a touch in center of board in layout coords hits the board', () => {
    // Board at layout y=0–390; touch at layout y=195 is inside.
    // In visual coords: (195 - 400) * 2 = negative — above viewport, unreachable.
    // This just verifies the inverse: if we were ALREADY in layout space, board check works.
    const boardRect = makeRect(0, 0, 390, 390);
    expect(cellFromRect(boardRect, 195, 195)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clientToFixed
// ---------------------------------------------------------------------------

function mockViewport(scale, offsetLeft, offsetTop, scrollX = 0, scrollY = 0) {
  Object.defineProperty(window, 'visualViewport', {
    value: { scale, offsetLeft, offsetTop },
    configurable: true,
  });
  Object.defineProperty(window, 'scrollX', { value: scrollX, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
}

function resetViewport() {
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
}

describe('clientToFixed — no zoom', () => {
  afterEach(resetViewport);

  it('returns coords unchanged when scale = 1', () => {
    mockViewport(1, 0, 0);
    expect(clientToFixed(150, 300)).toEqual([150, 300]);
  });

  it('returns coords unchanged when visualViewport is unavailable', () => {
    Object.defineProperty(window, 'visualViewport', { value: null, configurable: true });
    expect(clientToFixed(150, 300)).toEqual([150, 300]);
  });
});

describe('clientToFixed — zoomed, no extra visual pan', () => {
  // offsetLeft === scrollX, offsetTop === scrollY → no correction needed.
  afterEach(resetViewport);

  it('returns coords unchanged when offsetTop equals scrollY', () => {
    mockViewport(2, 0, 300, 0, 300);
    expect(clientToFixed(100, 211)).toEqual([100, 211]);
  });

  it('returns coords unchanged when page is at top and no pan', () => {
    mockViewport(2, 0, 0, 0, 0);
    expect(clientToFixed(97, 211)).toEqual([97, 211]);
  });
});

describe('clientToFixed — zoomed with extra visual pan (the rack-on-second-line bug)', () => {
  // The user scrolled to the rack (scrollY = 300), then pinch-zoomed near the
  // bottom of the page. iOS clamped the visual viewport so offsetTop (400) > scrollY (300).
  // clientY is measured from the layout viewport top (pageY - scrollY).
  // position:fixed on iOS 15+ is measured from the visual viewport top.
  // The pan gap = offsetTop - scrollY = 100 must be subtracted.
  afterEach(resetViewport);

  it('subtracts vertical pan gap', () => {
    mockViewport(2, 0, 400, 0, 300); // pan gap = 100
    // Finger at layout y=561, clientY = 561 - 300 = 261.
    // Expected fixed y = 261 - 100 = 161 (from visual top).
    expect(clientToFixed(0, 261)).toEqual([0, 161]);
  });

  it('subtracts horizontal pan gap', () => {
    mockViewport(2, 80, 0, 50, 0); // horizontal pan gap = 30
    expect(clientToFixed(150, 0)).toEqual([120, 0]);
  });

  it('subtracts both axes', () => {
    mockViewport(2, 80, 400, 50, 300);
    expect(clientToFixed(150, 261)).toEqual([120, 161]);
  });

  it('ghost lands on finger: BCR top matches corrected clientY', () => {
    // Board BCR.top (visual coords): board_layout_y - offsetTop = 100 - 400 = -300
    // Finger at top of board: clientY (layout) = 100 - 300 = -200.
    // After clientToFixed: -200 - (400-300) = -300 = BCR.top ✓
    mockViewport(2, 0, 400, 0, 300);
    const boardLayoutTop = 100;
    const bcrTop = boardLayoutTop - 400; // -300 (visual coords, iOS 15+)
    const clientY = boardLayoutTop - 300; // -200 (layout minus scrollY)
    const [, fixedY] = clientToFixed(0, clientY);
    expect(fixedY).toBeCloseTo(bcrTop);
  });
});
