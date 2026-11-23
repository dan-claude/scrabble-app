import { useEffect, useRef, useState } from 'react';
import { clearSession, fetchState, getActiveGames, getMe, linkUser, loadSession, loadUserToken, saveSession, saveUserToken } from './api';
import AuthButton from './components/AuthButton';
import GameRoom from './components/GameRoom';
import Lobby from './components/Lobby';
import ProfilePage from './components/ProfilePage';
import ResumeGate from './components/ResumeGate';
import SignInModal from './components/SignInModal';
import './App.css';

const POLL_INTERVAL_MS = 1000;
// Survives the full-page OAuth redirect (used when the popup is blocked), so
// a turn-notification link still resumes the game after sign-in.
const PENDING_RESUME_KEY = 'pending_resume_room';

function loadPendingResume() {
  try { return sessionStorage.getItem(PENDING_RESUME_KEY); } catch { return null; }
}

function savePendingResume(code) {
  try {
    if (code) sessionStorage.setItem(PENDING_RESUME_KEY, code);
    else sessionStorage.removeItem(PENDING_RESUME_KEY);
  } catch {}
}


function smsNudgeKey(userId) {
  return `sms_nudge_dismissed_${userId}`;
}

function shouldShowSmsNudge(user) {
  if (!user || !user.smsEnabled) return false;
  if (!user.phone || user.phoneOptedOut) {
    try { return !localStorage.getItem(smsNudgeKey(user.id)); } catch { return false; }
  }
  return false;
}

function App() {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [rejoinFailed, setRejoinFailed] = useState(false);
  const [connected, setConnected] = useState(true);
  const [user, setUser] = useState(null);
  const [userToken, setUserToken] = useState(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSmsNudge, setShowSmsNudge] = useState(false);
  const [resume, setResume] = useState(null); // { code, status: 'loading'|'signin'|'not-found' }
  const pollTimerRef = useRef(null);

  // Load auth session and handle OAuth callback (?user_token=TOKEN).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('user_token');
    if (oauthToken) {
      window.history.replaceState({}, '', window.location.pathname);
      saveUserToken(oauthToken);
      setUserToken(oauthToken);
      getMe(oauthToken).then((data) => {
        setUser(data.user);
        setShowSmsNudge(shouldShowSmsNudge(data.user));
      }).catch(() => {});
    } else {
      const saved = loadUserToken();
      if (saved) {
        setUserToken(saved);
        getMe(saved).then((data) => {
          setUser(data.user);
          setShowSmsNudge(shouldShowSmsNudge(data.user));
        }).catch(() => {});
      }
    }
  }, []);

  function enterRoom(newSession, payload) {
    saveSession(newSession);
    savePendingResume(null);
    setResume(null);
    setSession(newSession);
    setState(payload);
  }

  async function resumeFromAccount(code, uToken) {
    setResume({ code, status: 'loading' });
    try {
      const data = await getActiveGames(uToken);
      const game = (data.games || []).find((g) => g.roomCode === code);
      if (!game) {
        savePendingResume(null);
        setResume({ code, status: 'not-found' });
        return;
      }
      const newSession = { roomCode: code, token: game.token };
      enterRoom(newSession, await fetchState(code, game.token));
    } catch {
      savePendingResume(null);
      setResume({ code, status: 'not-found' });
    }
  }

  async function startResume(code) {
    const saved = loadSession();
    if (saved?.roomCode === code) {
      try {
        enterRoom(saved, await fetchState(saved.roomCode, saved.token));
        return;
      } catch {}
    }
    const uToken = loadUserToken();
    if (uToken) {
      resumeFromAccount(code, uToken);
    } else {
      savePendingResume(code);
      setResume({ code, status: 'signin' });
    }
  }

  function goToLobbyFromResume() {
    savePendingResume(null);
    setResume(null);
  }

  // On first load, try to resume a saved room session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkRoom = params.get('room');
    const linkToken = params.get('rejoin_token');

    // Turn-notification links carry no secret: ?room=CODE&resume=1. The seat
    // is found via this device's saved session or the signed-in account.
    const resumeCode = linkRoom && params.get('resume')
      ? linkRoom.toUpperCase().slice(0, 5)
      : loadPendingResume();
    if (resumeCode) {
      if (linkRoom) window.history.replaceState({}, '', window.location.pathname);
      startResume(resumeCode);
      return;
    }

    if (linkRoom && linkToken) {
      window.history.replaceState({}, '', window.location.pathname);
      const session = { roomCode: linkRoom.toUpperCase().slice(0, 5), token: linkToken };
      fetchState(session.roomCode, session.token)
        .then((payload) => {
          saveSession(session);
          setSession(session);
          setState(payload);
        })
        .catch(() => setRejoinFailed(true));
      return;
    }

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
    setShowProfile(false);
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

  async function handleAuthSuccess(newUserToken) {
    saveUserToken(newUserToken);
    setUserToken(newUserToken);
    setShowSignIn(false);
    try {
      const data = await getMe(newUserToken);
      setUser(data.user);
      setShowSmsNudge(shouldShowSmsNudge(data.user));
      if (resume) {
        resumeFromAccount(resume.code, newUserToken);
        return;
      }
      // If we're currently in a room, stamp user_id on the existing player slot
      // so this game counts in their history even though they signed in mid-game.
      if (session) {
        linkUser(session.roomCode, session.token, newUserToken).catch(() => {});
      }
    } catch {}
  }

  function handleLogout() {
    setUser(null);
    setUserToken(null);
    saveUserToken(null);
    setShowProfile(false);
    setShowSmsNudge(false);
  }

  function dismissSmsNudge() {
    try { if (user) localStorage.setItem(smsNudgeKey(user.id), '1'); } catch {}
    setShowSmsNudge(false);
  }

  function openProfileForSms() {
    dismissSmsNudge();
    setShowProfile(true);
  }

  const header = (
    <div className="app-header">
      <span className="app-header-logo">Scrabble</span>
      <AuthButton
        user={user}
        onSignIn={() => setShowSignIn(true)}
        onProfile={() => setShowProfile(true)}
      />
    </div>
  );

  const smsNudge = showSmsNudge && (
    <div className="sms-nudge">
      <span className="sms-nudge-text">Get a text when it&rsquo;s your turn — set up SMS notifications in your profile.</span>
      <div className="sms-nudge-actions">
        <button className="sms-nudge-btn sms-nudge-btn--primary" onClick={openProfileForSms}>Set up</button>
        <button className="sms-nudge-btn sms-nudge-btn--ghost" onClick={dismissSmsNudge}>Not now</button>
      </div>
    </div>
  );

  if (showProfile) {
    return (
      <div className="app-shell">
        {header}
        <ProfilePage
          userToken={userToken}
          smsEnabled={user?.smsEnabled ?? false}
          onBack={() => setShowProfile(false)}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  if (resume && !session) {
    return (
      <div className="app-shell">
        {header}
        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} onSuccess={handleAuthSuccess} />}
        <ResumeGate
          roomCode={resume.code}
          status={resume.status}
          onSignIn={handleAuthSuccess}
          onGoToLobby={goToLobbyFromResume}
        />
      </div>
    );
  }

  if (!session || !state) {
    return (
      <div className="app-shell">
        {header}
        {smsNudge}
        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} onSuccess={handleAuthSuccess} />}
        {rejoinFailed && <p className="error center-text">Previous session expired.</p>}
        <Lobby onEntered={handleEntered} userToken={userToken} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {header}
      {smsNudge}
      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} onSuccess={handleAuthSuccess} />}
      {!connected && <p className="error center-text">Reconnecting...</p>}
      <GameRoom
        state={state}
        session={session}
        onLeave={handleLeave}
        onStateUpdate={handleStateUpdate}
        userToken={userToken}
      />
    </div>
  );
}

export default App;
