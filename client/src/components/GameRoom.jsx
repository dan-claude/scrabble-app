import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearSession,
  exchangeTiles as apiExchangeTiles,
  passTurn as apiPassTurn,
  placeTiles as apiPlaceTiles,
  startGame as apiStartGame,
} from '../api';
import Board from './Board';
import Rack from './Rack';
import ScoreBoard from './ScoreBoard';
import GameLog from './GameLog';

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `t${uidCounter}`;
}

// "Be notified when it is your turn" - persisted per-browser so the choice
// survives a reload. Actually enabling it also requires the browser to have
// granted Notification permission; see notificationsSupported/notifyEnabled
// below for how the two combine.
const NOTIFY_STORAGE_KEY = 'scrabble_notify_turn';

export default function GameRoom({ state, session, onLeave, onStateUpdate }) {
  const you = state.players.find((p) => p.id === state.youId);
  const isHost = state.hostId === state.youId;
  const isMyTurn = state.turnPlayerId === state.youId;
  const isSpectator = !!state.isSpectator;

  const [rackTiles, setRackTiles] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [pending, setPending] = useState([]); // { row, col, letter, isBlank, uid }
  const [exchangeMode, setExchangeMode] = useState(false);
  const [exchangeSelected, setExchangeSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [dragVisual, setDragVisual] = useState(null); // { letter, isBlank, x, y }
  const dragInfoRef = useRef(null);
  const justDraggedRef = useRef(false);

  // Turn notifications: only offered where the browser actually supports the
  // Notification API (excludes e.g. mobile Safari, which has none at all).
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [notifyPermission, setNotifyPermission] = useState(
    notificationsSupported ? Notification.permission : 'unsupported'
  );
  const [notifyEnabled, setNotifyEnabled] = useState(() => {
    if (!notificationsSupported) return false;
    // Only trust the saved preference if the browser still actually has
    // permission granted - it may have been revoked in site settings since.
    return Notification.permission === 'granted' && localStorage.getItem(NOTIFY_STORAGE_KEY) === '1';
  });
  const prevIsMyTurnRef = useRef(isMyTurn);

  useEffect(() => {
    const serverRack = you?.rack || [];
    const currentLetters = rackTiles.map((t) => t.letter).sort().join('');
    const serverLetters = serverRack.slice().sort().join('');
    if (currentLetters !== serverLetters) {
      setRackTiles(serverRack.map((letter) => ({ uid: nextUid(), letter })));
      setPending([]);
      setSelectedUid(null);
      setExchangeMode(false);
      setExchangeSelected([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you?.rack?.join(',')]);

  const pendingByCell = useMemo(() => {
    const map = new Map();
    for (const p of pending) map.set(`${p.row},${p.col}`, p);
    return map;
  }, [pending]);

  const availableRack = rackTiles.filter((t) => !pending.some((p) => p.uid === t.uid));

  function selectRackTile(uid) {
    if (justDraggedRef.current) return;
    if (exchangeMode) {
      setExchangeSelected((prev) =>
        prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]
      );
      return;
    }
    if (!isMyTurn || state.status !== 'playing') return;
    setSelectedUid((prev) => (prev === uid ? null : uid));
  }

  function placeRackTileAt(uid, row, col) {
    if (!isMyTurn || state.status !== 'playing') return false;
    if (state.board[row][col]) return false; // permanent tile, can't touch
    if (pendingByCell.has(`${row},${col}`)) return false;
    const tile = rackTiles.find((t) => t.uid === uid);
    if (!tile) return false;
    let letter = tile.letter;
    let isBlank = false;
    if (letter === '#') {
      const chosen = window.prompt('Choose a letter for the blank tile (A-Z):');
      if (!chosen || !/^[a-zA-Z]$/.test(chosen)) return false;
      letter = chosen.toUpperCase();
      isBlank = true;
    }
    setPending((prev) => [...prev, { row, col, letter, isBlank, uid }]);
    return true;
  }

  function clickCell(row, col) {
    if (justDraggedRef.current) return;
    if (!isMyTurn || state.status !== 'playing') return;
    const key = `${row},${col}`;
    if (state.board[row][col]) return; // permanent tile, can't touch
    const existingPending = pendingByCell.get(key);
    if (existingPending) {
      setPending((prev) => prev.filter((p) => p.uid !== existingPending.uid));
      return;
    }
    if (!selectedUid) return;
    placeRackTileAt(selectedUid, row, col);
    setSelectedUid(null);
  }

  // -- drag and drop -----------------------------------------------------
  // Built on Pointer Events (not the HTML5 drag-and-drop API), because native
  // HTML5 DnD is mouse-oriented and unreliable on touch devices. Pointer
  // Events unify mouse, touch, and pen, so this works the same way everywhere.
  // A short tap (no movement past the threshold) is left to the element's own
  // onClick, so keyboard/tap selection behaves exactly as before.

  const DRAG_THRESHOLD = 6; // px of movement before a tap becomes a drag

  function beginDrag(e, info) {
    if (!isMyTurn || state.status !== 'playing') return;
    if (info.source === 'rack' && exchangeMode) return; // let exchange taps work normally
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfoRef.current = {
      ...info,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  }

  function handleRackPointerDown(e, tile) {
    beginDrag(e, { source: 'rack', uid: tile.uid, letter: tile.letter, isBlank: false });
  }

  function handlePendingPointerDown(e, row, col, pendingTile) {
    beginDrag(e, {
      source: 'board',
      uid: pendingTile.uid,
      letter: pendingTile.letter,
      isBlank: pendingTile.isBlank,
      row,
      col,
    });
  }

  function handleDragPointerMove(e) {
    const d = dragInfoRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
    }
    setDragVisual({ letter: d.letter, isBlank: d.isBlank, x: e.clientX, y: e.clientY });
  }

  function handleDragPointerUp(e) {
    const d = dragInfoRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragInfoRef.current = null;
    setDragVisual(null);
    if (!d.moved) return; // plain tap - the element's own onClick already handles it

    // Suppress the click event the browser fires right after this pointerup,
    // so a real drag doesn't also register as a tap-select on the origin tile.
    justDraggedRef.current = true;
    requestAnimationFrame(() => { justDraggedRef.current = false; });

    const target = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = target?.closest('[data-cell-row]');
    const rackEl = target?.closest('[data-rack-dropzone]');

    if (cellEl) {
      const row = Number(cellEl.dataset.cellRow);
      const col = Number(cellEl.dataset.cellCol);
      if (state.board[row][col] || pendingByCell.has(`${row},${col}`)) return;
      if (d.source === 'rack') {
        placeRackTileAt(d.uid, row, col);
        setSelectedUid(null);
      } else {
        setPending((prev) => {
          const existing = prev.find((p) => p.uid === d.uid);
          if (!existing) return prev;
          return prev.filter((p) => p.uid !== d.uid).concat([{ ...existing, row, col }]);
        });
      }
    } else if (rackEl && d.source === 'board') {
      setPending((prev) => prev.filter((p) => p.uid !== d.uid));
    }
  }

  function handleDragPointerCancel(e) {
    const d = dragInfoRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragInfoRef.current = null;
    setDragVisual(null);
  }

  function recallAll() {
    setPending([]);
    setSelectedUid(null);
  }

  function shuffleRack() {
    setRackTiles((prev) => {
      const arr = prev.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
  }

  async function submitMove() {
    if (pending.length === 0) return;
    setBusy(true);
    setMessage('');
    try {
      const updated = await apiPlaceTiles(
        session.roomCode,
        session.token,
        pending.map(({ row, col, letter, isBlank }) => ({ row, col, letter, isBlank })),
      );
      onStateUpdate(updated);
      setPending([]);
      setSelectedUid(null);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function passTurn() {
    setBusy(true);
    setMessage('');
    try {
      const updated = await apiPassTurn(session.roomCode, session.token);
      onStateUpdate(updated);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmExchange() {
    if (exchangeSelected.length === 0) {
      setExchangeMode(false);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const letters = exchangeSelected.map((uid) => rackTiles.find((t) => t.uid === uid).letter);
      const updated = await apiExchangeTiles(session.roomCode, session.token, letters);
      onStateUpdate(updated);
      setExchangeMode(false);
      setExchangeSelected([]);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function startGame() {
    setBusy(true);
    setMessage('');
    try {
      const updated = await apiStartGame(session.roomCode, session.token);
      onStateUpdate(updated);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function leaveRoom() {
    clearSession();
    onLeave();
  }

  async function toggleTurnNotifications(e) {
    const wantOn = e.target.checked;
    if (!wantOn) {
      setNotifyEnabled(false);
      try { localStorage.setItem(NOTIFY_STORAGE_KEY, '0'); } catch { /* private mode etc - ignore */ }
      return;
    }
    if (Notification.permission === 'granted') {
      setNotifyEnabled(true);
      try { localStorage.setItem(NOTIFY_STORAGE_KEY, '1'); } catch { /* private mode etc - ignore */ }
      return;
    }
    // 'denied' resolves immediately with 'denied' again (no dialog) - the
    // permission hint below is what tells the player why nothing happened.
    const result = await Notification.requestPermission();
    setNotifyPermission(result);
    if (result === 'granted') {
      setNotifyEnabled(true);
      try { localStorage.setItem(NOTIFY_STORAGE_KEY, '1'); } catch { /* private mode etc - ignore */ }
    }
  }

  // Fire a browser notification the moment it becomes your turn, but only if
  // you're not already looking at the tab (document hidden) - otherwise the
  // in-page "Submit word / Pass" controls are notification enough. Compares
  // against the previous isMyTurn value so this fires once on the false->true
  // transition, not on every ~1s poll while it's already your turn, and not
  // just from toggling the checkbox on mid-turn.
  useEffect(() => {
    const wasMyTurn = prevIsMyTurnRef.current;
    prevIsMyTurnRef.current = isMyTurn;
    if (!notifyEnabled || !notificationsSupported) return;
    if (!isMyTurn || wasMyTurn) return;
    if (state.status !== 'playing' || isSpectator) return;
    if (document.visibilityState !== 'hidden') return;
    try {
      const notification = new Notification("It's your turn!", {
        body: `Room ${state.roomCode} — place your tiles or pass.`,
        icon: '/favicon.svg',
        tag: `scrabble-turn-${state.roomCode}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // A handful of browsers (notably Chrome on Android) don't support the
      // Notification constructor directly and require a service worker -
      // skip rather than break the player's actual turn over it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, notifyEnabled, state.status, isSpectator]);

  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt('Copy this invite link:', shareUrl);
    }
  }

  return (
    <div className="game-room">
      <header className="room-header">
        <div>
          <h2>Room {state.roomCode}</h2>
          <p className="muted">Bag: {state.bagCount} tiles left</p>
          {state.spectators.length > 0 && (
            <p className="muted">👀 {state.spectators.length} watching</p>
          )}
          {notificationsSupported && !isSpectator && (
            <label className="notify-toggle">
              <input
                type="checkbox"
                checked={notifyEnabled}
                onChange={toggleTurnNotifications}
              />
              🔔 Be notified when it is your turn
            </label>
          )}
          {notificationsSupported && !isSpectator && notifyPermission === 'denied' && (
            <p className="hint">
              Notifications are blocked for this site — enable them in your browser's
              site settings to turn this on.
            </p>
          )}
        </div>
        <button className="link-btn" onClick={leaveRoom}>Leave</button>
      </header>

      {state.status === 'lobby' && (
        <div className="waiting-room">
          <p>Waiting for players... ({state.players.length}/{state.maxPlayers})</p>
          <ul>
            {state.players.map((p) => (
              <li key={p.id}>{p.name}{p.id === state.hostId ? ' (host)' : ''}</li>
            ))}
          </ul>
          {isHost ? (
            <button onClick={startGame} disabled={busy || state.players.length < state.minPlayers}>
              Start game
            </button>
          ) : (
            <p className="muted">Waiting for host to start...</p>
          )}
          <div className="invite-link">
            <label>
              Invite link
              <div className="invite-link-row">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                />
                <button type="button" onClick={copyInviteLink}>
                  {linkCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </label>
            <p className="hint">
              Or share the room code <strong>{state.roomCode}</strong> directly.
            </p>
          </div>
        </div>
      )}

      {state.status !== 'lobby' && (
        <div className="game-layout">
          <div className="board-area">
            {isSpectator && (
              <p className="spectator-banner">
                👀 You joined after this game started — you're watching, not playing.
              </p>
            )}
            <Board
              board={state.board}
              bonusGrid={state.bonusGrid}
              pendingByCell={pendingByCell}
              onCellClick={clickCell}
              onPendingPointerDown={handlePendingPointerDown}
              onDragPointerMove={handleDragPointerMove}
              onDragPointerUp={handleDragPointerUp}
              onDragPointerCancel={handleDragPointerCancel}
            />
            {state.status === 'playing' && !isSpectator && (
              <>
                <Rack
                  tiles={availableRack}
                  selectedUid={selectedUid}
                  exchangeMode={exchangeMode}
                  exchangeSelected={exchangeSelected}
                  onSelect={selectRackTile}
                  onTilePointerDown={handleRackPointerDown}
                  onDragPointerMove={handleDragPointerMove}
                  onDragPointerUp={handleDragPointerUp}
                  onDragPointerCancel={handleDragPointerCancel}
                />
                <div className="controls">
                  {isMyTurn ? (
                    exchangeMode ? (
                      <>
                        <button onClick={confirmExchange} disabled={busy}>
                          Confirm exchange ({exchangeSelected.length})
                        </button>
                        <button onClick={() => { setExchangeMode(false); setExchangeSelected([]); }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={submitMove} disabled={busy || pending.length === 0}>
                          Submit word
                        </button>
                        <button onClick={recallAll} disabled={pending.length === 0}>
                          Recall
                        </button>
                        <button onClick={shuffleRack}>Shuffle</button>
                        <button onClick={() => setExchangeMode(true)} disabled={pending.length > 0}>
                          Exchange tiles
                        </button>
                        <button onClick={passTurn} disabled={busy}>Pass</button>
                      </>
                    )
                  ) : (
                    <p className="muted">
                      Waiting for {state.players.find((p) => p.id === state.turnPlayerId)?.name}...
                    </p>
                  )}
                  {message && <p className="error">{message}</p>}
                </div>
              </>
            )}
            {state.status === 'finished' && (
              <div className="game-over">
                <h3>Game over!</h3>
                <p>{state.players.find((p) => p.id === state.winnerId)?.name} wins!</p>
              </div>
            )}
          </div>
          <div className="side-panel">
            <ScoreBoard
              players={state.players}
              spectators={state.spectators}
              turnPlayerId={state.turnPlayerId}
              youId={state.youId}
              hostId={state.hostId}
              winnerId={state.winnerId}
            />
            <GameLog log={state.log} />
          </div>
        </div>
      )}

      {dragVisual && (
        <div className="drag-ghost" style={{ left: dragVisual.x, top: dragVisual.y }}>
          <span className="letter">{dragVisual.letter === '#' ? '' : dragVisual.letter}</span>
        </div>
      )}
    </div>
  );
}
