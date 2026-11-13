import { useEffect, useState } from 'react';
import { getProfile, logout as apiLogout } from '../api';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProfilePage({ userToken, onBack, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getProfile(userToken)
      .then(setData)
      .catch(() => setError('Failed to load profile.'));
  }, [userToken]);

  async function handleLogout() {
    await apiLogout(userToken).catch(() => {});
    onLogout();
  }

  if (error) return (
    <div className="profile-page">
      <button className="profile-back" onClick={onBack}>← Back</button>
      <p className="error">{error}</p>
    </div>
  );

  if (!data) return (
    <div className="profile-page">
      <p className="center-text">Loading…</p>
    </div>
  );

  const { user, stats } = data;

  return (
    <div className="profile-page">
      <div className="profile-header-row">
        <button className="profile-back" onClick={onBack}>← Back</button>
        <button className="profile-logout" onClick={handleLogout}>Sign out</button>
      </div>

      <div className="profile-identity">
        {user.picture
          ? <img src={user.picture} alt="" className="profile-avatar" referrerPolicy="no-referrer" />
          : <div className="profile-avatar profile-avatar-initials">{user.name.charAt(0).toUpperCase()}</div>}
        <div>
          <h2 className="profile-name">{user.name}</h2>
          <p className="profile-email">{user.email}</p>
        </div>
      </div>

      <div className="profile-stats-grid">
        <div className="profile-stat">
          <div className="profile-stat-label">Games played</div>
          <div className="profile-stat-value">{stats.gamesPlayed}</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-label">Win rate</div>
          <div className="profile-stat-value">{stats.winRate}%</div>
          <div className="profile-stat-sub">{stats.wins} wins</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-label">Avg score</div>
          <div className="profile-stat-value">{stats.avgScore}</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-label">Best score</div>
          <div className="profile-stat-value">{stats.bestScore}</div>
        </div>
      </div>

      {stats.recentGames.length === 0 ? (
        <p className="profile-empty">No games recorded yet. Play a game while signed in to see your history here.</p>
      ) : (
        <>
          <h3 className="profile-section-title">Recent games</h3>
          <table className="profile-game-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opponents</th>
                <th>Score</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentGames.map((g, i) => {
                const opponents = g.players
                  .filter(p => p.score !== g.myScore || g.players.filter(x => x.score === g.myScore).length > 1)
                  .map(p => p.isBot ? `🤖 ${p.name}` : p.name)
                  .join(', ') || '—';
                const scores = g.players.map(p => p.score).join(' / ');
                return (
                  <tr key={i}>
                    <td>{formatDate(g.finishedAt)}</td>
                    <td className="profile-opponents">{opponents}</td>
                    <td>{scores}</td>
                    <td>
                      <span className={`result-badge result-badge--${g.won ? 'win' : 'loss'}`}>
                        {g.won ? 'Win' : 'Loss'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
