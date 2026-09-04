import { useEffect, useState } from 'react';
import { call, saveSession } from '../socket';

export default function Lobby({ onEntered }) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('create');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invited = params.get('room');
    if (invited) {
      setMode('join');
      setRoomCode(invited.toUpperCase().slice(0, 5));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const event = mode === 'create' ? 'room:create' : 'room:join';
      const payload = mode === 'create'
        ? { playerName: name }
        : { playerName: name, roomCode: roomCode.trim().toUpperCase() };
      const res = await call(event, payload);
      const session = { roomCode: res.roomCode, token: res.token };
      saveSession(session);
      onEntered(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <h1>Scrabble</h1>
      <div className="lobby-tabs">
        <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
          New game
        </button>
        <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
          Join game
        </button>
      </div>
      <form onSubmit={submit} className="lobby-form">
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="e.g. Alex"
            required
          />
        </label>
        {mode === 'join' && (
          <label>
            Room code
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={5}
              placeholder="ABCDE"
              required
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'create' ? 'Create room' : 'Join room'}
        </button>
      </form>
      <p className="hint">Create a room, then send friends the invite link (2–4 players).</p>
    </div>
  );
}
