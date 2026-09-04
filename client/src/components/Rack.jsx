const VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '#': 0,
};

export default function Rack({ tiles, selectedUid, exchangeSelected, exchangeMode, onSelect, onDragStart, onDropBack }) {
  return (
    <div className="rack" onDragOver={(e) => e.preventDefault()} onDrop={onDropBack}>
      {tiles.map((t) => {
        const isSelected = t.uid === selectedUid;
        const isExchangeSelected = exchangeSelected?.includes(t.uid);
        const classes = ['rack-tile'];
        if (isSelected) classes.push('selected');
        if (isExchangeSelected) classes.push('exchange-selected');
        return (
          <button
            type="button"
            key={t.uid}
            className={classes.join(' ')}
            onClick={() => onSelect(t.uid)}
            draggable
            onDragStart={(e) => onDragStart(e, t.uid)}
          >
            <span className="letter">{t.letter === '#' ? '' : t.letter}</span>
            <span className="value">{VALUES[t.letter]}</span>
          </button>
        );
      })}
      {tiles.length === 0 && <p className="rack-empty">Rack empty</p>}
      {exchangeMode && <p className="rack-hint">Click tiles to mark for exchange, then confirm.</p>}
    </div>
  );
}
