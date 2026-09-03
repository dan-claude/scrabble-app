import { useEffect, useState } from 'react';
import { socket, call, loadSession, clearSession } from './socket';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import './App.css';

function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [rejoinFailed, setRejoinFailed] = useState(false);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      const saved = loadSession();
      if (saved) {
        call('room:rejoin', saved)
          .then(() => setSession(saved))
          .catch(() => {
            clearSession();
            setRejoinFailed(true);
          });
      }
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onState(payload) {
      setState(payload);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
    };
  }, []);

  function handleEntered(newSession) {
    setRejoinFailed(false);
    setSession(newSession);
  }

  function handleLeave() {
    setSession(null);
    setState(null);
  }

  if (!connected) {
    return <div className="status-screen">Connecting to server...</div>;
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
      <GameRoom state={state} session={session} onLeave={handleLeave} />
    </div>
  );
}

export default App;
