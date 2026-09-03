export default function ScoreBoard({ players, turnPlayerId, youId, hostId, winnerId }) {
  return (
    <div className="scoreboard">
      <h3>Players</h3>
      <ul>
        {players.map((p) => (
          <li key={p.id} className={p.id === turnPlayerId ? 'turn' : ''}>
            <span className="name">
              {p.name}
              {p.id === youId ? ' (you)' : ''}
              {p.id === hostId ? ' 👑' : ''}
              {!p.connected ? ' — offline' : ''}
              {p.id === winnerId ? ' 🏆' : ''}
            </span>
            <span className="score">{p.score}</span>
            <span className="rack-count">{p.rackCount} tiles</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
