import { useEffect, useRef, useState } from 'react';
import { clearSession, fetchState, loadSession } from './api';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import './App.css';

const POLL_INTERVAL_MS = 1000;

function App() {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [rejoinFailed, setRejoinFailed] = useState(false);
  const [connected, setConnected] = useState(true);
  const pollTimerRef = useRef(null);

  // On first load, try to resume a saved session. There's no separate
  // "rejoin" call under polling - a saved token just has to be accepted by
  // the state endpoint, same as any other poll.
  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;
    fetchState(saved.roomCode, saved.token)
      .then((payload) => {
        setSession(saved);
        setState(payload);
      })
      .catch(() => {
        clearSession();
        setRejoinFailed(true);
      });
  }, []);

  // Poll for state on a fixed interval while in a room. A ~1s interval keeps
  // the game feeling responsive without the complexity of a persistent
  // connection (see API.md for the tradeoffs).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function poll() {
      try {
        const payload = await fetchState(session.roomCode, session.token);
        if (cancelled) return;
        setState(payload);
        setConnected(true);
      } catch {
        if (cancelled) return;
        setConnected(false);
      } finally {
        if (!cancelled) {
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollTimerRef.current);
    };
  }, [session]);

  function handleEntered(newSession, initialState) {
    setRejoinFailed(false);
    setSession(newSession);
    if (initialState) setState(initialState);
  }

  function handleLeave() {
    setSession(null);
    setState(null);
  }

  // Any successful action response (place/pass/exchange/start) carries the
  // fresh state - applying it immediately means you see your own move land
  // right away instead of waiting for the next poll tick.
  function handleStateUpdate(payload) {
    setState(payload);
  }

  if (!session || !state) {
    return (
      <div className="app-shell">
        {rejoinFailed && <p className="error center-text">Previous session expired.</p>}
        <Lobby onEntered={handleEntered} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!connected && <p className="error center-text">Reconnecting...</p>}
      <GameRoom
        state={state}
        session={session}
        onLeave={handleLeave}
        onStateUpdate={handleStateUpdate}
      />
    </div>
  );
}

export default App;
