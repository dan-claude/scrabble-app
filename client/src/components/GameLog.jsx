export default function GameLog({ log }) {
  return (
    <div className="game-log">
      <h3>Log</h3>
      <ul>
        {log.slice().reverse().map((entry, i) => (
          <li key={i}>
            {entry.playerName && <strong>{entry.playerName}: </strong>}
            {entry.detail}
          </li>
        ))}
        {log.length === 0 && <li className="muted">No moves yet.</li>}
      </ul>
    </div>
  );
}
