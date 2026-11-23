/**
 * Client-side score preview for pending tile placements.
 * Mirrors the server's place_tiles scoring logic (game.py) exactly.
 */

const LETTER_VALUES = {
  A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4, I:1, J:8,
  K:5, L:1, M:3, N:1, O:1, P:3, Q:10, R:1, S:1, T:1,
  U:1, V:4, W:4, X:8, Y:4, Z:10, '#':0,
};

const BOARD_SIZE = 15;
const BINGO_COUNT = 7;
const BINGO_BONUS = 50;

function extendLine(row, col, orientation, overlay) {
  if (orientation === 'horizontal') {
    let start = col, end = col;
    while (start > 0 && overlay(row, start - 1)) start--;
    while (end < BOARD_SIZE - 1 && overlay(row, end + 1)) end++;
    return Array.from({ length: end - start + 1 }, (_, i) => [row, start + i]);
  }
  let start = row, end = row;
  while (start > 0 && overlay(start - 1, col)) start--;
  while (end < BOARD_SIZE - 1 && overlay(end + 1, col)) end++;
  return Array.from({ length: end - start + 1 }, (_, i) => [start + i, col]);
}

function scoreWord(cells, overlay, bonusGrid) {
  let wordMult = 1;
  let total = 0;
  for (const [r, c] of cells) {
    const tile = overlay(r, c);
    const base = tile.isBlank ? 0 : (LETTER_VALUES[tile.letter] || 0);
    if (tile.isNew) {
      const bonus = bonusGrid[r][c];
      if (bonus === 'DL') total += base * 2;
      else if (bonus === 'TL') total += base * 3;
      else total += base;
      if (bonus === 'DW') wordMult *= 2;
      else if (bonus === 'TW') wordMult *= 3;
    } else {
      total += base;
    }
  }
  return total * wordMult;
}

/**
 * Compute a score preview for `placements` against the current `board` and `bonusGrid`.
 * Returns null when the placement can't yet form words (e.g. gaps, out of line, isolated).
 * Does not validate words against the dictionary — just scores what would form.
 *
 * @param {Array} board       15×15 array of {letter, isBlank}|null
 * @param {Array} bonusGrid   15×15 array of bonus strings ('DL','TL','DW','TW','')
 * @param {Array} placements  [{row, col, letter, isBlank}]
 * @returns {{total: number, words: [{text: string, score: number}], isBingo: boolean}|null}
 */
export function computeScorePreview(board, bonusGrid, placements) {
  if (!placements.length || !board || !bonusGrid) return null;

  const pendingMap = new Map(
    placements.map(p => [`${p.row},${p.col}`, { letter: p.letter, isBlank: Boolean(p.isBlank), isNew: true }])
  );

  const overlay = (r, c) => {
    const pending = pendingMap.get(`${r},${c}`);
    if (pending) return pending;
    const cell = board[r]?.[c];
    return cell ? { letter: cell.letter, isBlank: Boolean(cell.isBlank), isNew: false } : null;
  };

  const rowSet = new Set(placements.map(p => p.row));
  const colSet = new Set(placements.map(p => p.col));

  let orientation;
  if (placements.length === 1) {
    orientation = 'single';
  } else if (rowSet.size === 1) {
    orientation = 'horizontal';
  } else if (colSet.size === 1) {
    orientation = 'vertical';
  } else {
    return null;
  }

  let mainCells;

  if (orientation === 'horizontal') {
    const row = placements[0].row;
    const sorted = placements.map(p => p.col).sort((a, b) => a - b);
    let start = sorted[0], end = sorted[sorted.length - 1];
    for (let c = start; c <= end; c++) { if (!overlay(row, c)) return null; }
    while (start > 0 && overlay(row, start - 1)) start--;
    while (end < BOARD_SIZE - 1 && overlay(row, end + 1)) end++;
    mainCells = Array.from({ length: end - start + 1 }, (_, i) => [row, start + i]);
  } else if (orientation === 'vertical') {
    const col = placements[0].col;
    const sorted = placements.map(p => p.row).sort((a, b) => a - b);
    let start = sorted[0], end = sorted[sorted.length - 1];
    for (let r = start; r <= end; r++) { if (!overlay(r, col)) return null; }
    while (start > 0 && overlay(start - 1, col)) start--;
    while (end < BOARD_SIZE - 1 && overlay(end + 1, col)) end++;
    mainCells = Array.from({ length: end - start + 1 }, (_, i) => [start + i, col]);
  } else {
    const { row, col } = placements[0];
    const hCells = extendLine(row, col, 'horizontal', overlay);
    const vCells = extendLine(row, col, 'vertical', overlay);
    if (hCells.length > 1) {
      mainCells = hCells;
      orientation = 'horizontal';
    } else if (vCells.length > 1) {
      mainCells = vCells;
      orientation = 'vertical';
    } else {
      return null;
    }
  }

  const words = [];

  if (mainCells.length > 1) {
    const text = mainCells.map(([r, c]) => overlay(r, c).letter).join('');
    words.push({ text, score: scoreWord(mainCells, overlay, bonusGrid) });
  }

  const crossOrientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
  for (const p of placements) {
    const crossCells = extendLine(p.row, p.col, crossOrientation, overlay);
    if (crossCells.length > 1) {
      const text = crossCells.map(([r, c]) => overlay(r, c).letter).join('');
      words.push({ text, score: scoreWord(crossCells, overlay, bonusGrid) });
    }
  }

  if (!words.length) return null;

  const isBingo = placements.length === BINGO_COUNT;
  const total = words.reduce((s, w) => s + w.score, 0) + (isBingo ? BINGO_BONUS : 0);

  return { total, words, isBingo };
}
