const BONUS_LABELS = {
  TW: 'TRIPLE\nWORD',
  DW: 'DOUBLE\nWORD',
  TL: 'TRIPLE\nLETTER',
  DL: 'DOUBLE\nLETTER',
};

export default function Board({ board, bonusGrid, pendingByCell, onCellClick }) {
  return (
    <div className="board">
      {board.map((row, r) => (
        <div className="board-row" key={r}>
          {row.map((cell, c) => {
            const pending = pendingByCell.get(`${r},${c}`);
            const bonus = bonusGrid[r][c];
            const isCenter = r === 7 && c === 7;
            const filled = cell || pending;
            const classes = ['cell'];
            if (bonus) classes.push(`bonus-${bonus}`);
            if (isCenter && !bonus) classes.push('center');
            if (pending) classes.push('pending');
            if (cell) classes.push('filled');
            return (
              <button
                type="button"
                key={c}
                className={classes.join(' ')}
                onClick={() => onCellClick(r, c)}
              >
                {filled ? (
                  <span className="tile-face">
                    <span className="letter">{cell ? cell.letter : pending.letter}</span>
                    <span className="value">{tileValue(cell ? cell.letter : pending.letter, cell ? cell.isBlank : pending.isBlank)}</span>
                  </span>
                ) : (
                  <>
                    {isCenter && !bonus && <span className="star">★</span>}
                    {bonus && <span className="bonus-label">{BONUS_LABELS[bonus]}</span>}
                  </>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

function tileValue(letter, isBlank) {
  if (isBlank) return 0;
  return VALUES[letter] ?? 0;
}
