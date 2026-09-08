import { useEffect, useState } from 'react';
import { createRoom, joinRoom, loadName, saveName, saveSession } from '../api';
import useBrowserNotifications from '../hooks/useBrowserNotifications';
import NotificationSettings from './NotificationSettings';

export default function Lobby({ onEntered }) {
  const [name, setName] = useState(() => loadName());
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('create');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoJoinName, setAutoJoinName] = useState(null); // non-null while silently rejoining via a remembered name

  // One hook instance for the whole page (see the hook's own comment for
  // why), passed down into <NotificationSettings>. A returning player who
  // auto-rejoins via a remembered name (below) skips this form entirely, so
  // the same setup UI is also offered from inside the room (GameRoom.jsx).
  const browserNotify = useBrowserNotifications();
  const [notifyValues, setNotifyValues] = useState({});

  function handleNotifyFieldChange(pluginId, key, value) {
    setNotifyValues((prev) => ({
      ...prev,
      [pluginId]: { ...(prev[pluginId] || {}), [key]: value },
    }));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invited = params.get('room');
    if (!invited) return;
    const code = invited.toUpperCase().slice(0, 5);
    setMode('join');
    setRoomCode(code);
    window.history.replaceState({}, '', window.location.pathname);

    // Visited this app before (a name cookie is set)? Use it straight away
    // instead of asking again. First time here, we still ask for a name below.
    const rememberedName = loadName();
    if (!rememberedName) return;
    setAutoJoinName(rememberedName);
    joinRoom(code, rememberedName)
      .then((state) => {
        const session = { roomCode: state.roomCode, token: state.token };
        saveSession(session);
        onEntered(session, state);
      })
      .catch((err) => {
        // e.g. that name is already taken in the room, or the room is gone -
        // fall back to the normal form, prefilled, so they can adjust and retry.
        setAutoJoinName(null);
        setName(rememberedName);
        setError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const state = mode === 'create'
        ? await createRoom(name, notifyValues)
        : await joinRoom(roomCode.trim().toUpperCase(), name, notifyValues);
      const session = { roomCode: state.roomCode, token: state.token };
      saveSession(session);
      saveName(name.trim());
      onEntered(session, state);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (autoJoinName) {
    return (
      <div className="lobby">
        <h1>Scrabble</h1>
        <p className="hint">Joining as {autoJoinName}...</p>
      </div>
    );
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
        <NotificationSettings
          browserNotify={browserNotify}
          values={notifyValues}
          onChange={handleNotifyFieldChange}
        />
      </form>
      <p className="hint">
        Create a room, then send friends the invite link (2–4 players). We'll
        remember your name in this browser so an invite link skips straight to
        joining next time.
      </p>
    </div>
  );
}
