import { useEffect, useState } from 'react';
import { getProfile, logout as apiLogout, updateProfile } from '../api';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProfilePage({ userToken, smsEnabled, onBack, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState(null);

  useEffect(() => {
    getProfile(userToken)
      .then((d) => { setData(d); setPhoneInput(d.user.phone || ''); })
      .catch(() => setError('Failed to load profile.'));
  }, [userToken]);

  async function handleSavePhone(e) {
    e.preventDefault();
    setPhoneSaving(true);
    setPhoneMsg(null);
    try {
      await updateProfile(userToken, { phone: phoneInput.trim() || null });
      setPhoneMsg('Saved.');
    } catch {
      setPhoneMsg('Could not save. Please try again.');
    } finally {
      setPhoneSaving(false);
    }
  }

  async function handleRemovePhone() {
    setPhoneSaving(true);
    setPhoneMsg(null);
    try {
      await updateProfile(userToken, { phone: null });
      setPhoneInput('');
      setPhoneMsg('Phone number removed.');
    } catch {
      setPhoneMsg('Could not remove. Please try again.');
    } finally {
      setPhoneSaving(false);
    }
  }

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

      {smsEnabled && (
        <div className="profile-sms-section">
          <h3 className="profile-section-title">SMS notifications</h3>
          <p className="profile-sms-desc">Get a text message when it's your turn.</p>
          <form className="profile-sms-form" onSubmit={handleSavePhone}>
            <label className="profile-sms-label" htmlFor="sms-phone">Phone number</label>
            <div className="profile-sms-row">
              <input
                id="sms-phone"
                type="tel"
                className="profile-sms-input"
                placeholder="+1 555 000 0000"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                disabled={phoneSaving}
              />
              <button type="submit" className="profile-sms-save" disabled={phoneSaving}>
                Save
              </button>
              {phoneInput && (
                <button type="button" className="profile-sms-remove" onClick={handleRemovePhone} disabled={phoneSaving}>
                  Remove
                </button>
              )}
            </div>
            {phoneMsg && <p className="profile-sms-msg">{phoneMsg}</p>}
          </form>
          <p className="profile-sms-consent">
            By saving a phone number you agree to receive SMS messages from this app when it's your turn.
            To opt out at any time, reply <strong>STOP</strong> to any message.
          </p>
        </div>
      )}
    </div>
  );
}
