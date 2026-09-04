import { useEffect, useMemo, useState } from 'react';
import { call, clearSession } from '../socket';
import Board from './Board';
import Rack from './Rack';
import ScoreBoard from './ScoreBoard';
import GameLog from './GameLog';

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `t${uidCounter}`;
}

export default function GameRoom({ state, session, onLeave }) {
  const you = state.players.find((p) => p.id === state.youId);
  const isHost = state.hostId === state.youId;
  const isMyTurn = state.turnPlayerId === state.youId;

  const [rackTiles, setRackTiles] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [pending, setPending] = useState([]); // { row, col, letter, isBlank, uid }
  const [exchangeMode, setExchangeMode] = useState(false);
  const [exchangeSelected, setExchangeSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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

  function handleRackDragStart(e, uid) {
    if (!isMyTurn || state.status !== 'playing' || exchangeMode) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `rack:${uid}`);
  }

  function handlePendingDragStart(e, uid) {
    if (!isMyTurn || state.status !== 'playing') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `board:${uid}`);
  }

  function handleCellDrop(row, col, e) {
    e.preventDefault();
    if (!isMyTurn || state.status !== 'playing') return;
    const [source, uid] = (e.dataTransfer.getData('text/plain') || '').split(':');
    if (!source || !uid) return;
    if (state.board[row][col]) return;
    if (pendingByCell.has(`${row},${col}`)) return;
    if (source === 'rack') {
      placeRackTileAt(uid, row, col);
      setSelectedUid(null);
    } else if (source === 'board') {
      setPending((prev) => {
        const existing = prev.find((p) => p.uid === uid);
        if (!existing) return prev;
        return prev.filter((p) => p.uid !== uid).concat([{ ...existing, row, col }]);
      });
    }
  }

  function handleRackDrop(e) {
    e.preventDefault();
    const [source, uid] = (e.dataTransfer.getData('text/plain') || '').split(':');
    if (source === 'board' && uid) {
      setPending((prev) => prev.filter((p) => p.uid !== uid));
    }
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
      await call('game:place', {
        placements: pending.map(({ row, col, letter, isBlank }) => ({ row, col, letter, isBlank })),
      });
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
      await call('game:pass', {});
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
      await call('game:exchange', { letters });
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
      await call('game:start', {});
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
            <Board
              board={state.board}
              bonusGrid={state.bonusGrid}
              pendingByCell={pendingByCell}
              onCellClick={clickCell}
              onCellDrop={handleCellDrop}
              onPendingDragStart={handlePendingDragStart}
            />
            {state.status === 'playing' && (
              <>
                <Rack
                  tiles={availableRack}
                  selectedUid={selectedUid}
                  exchangeMode={exchangeMode}
                  exchangeSelected={exchangeSelected}
                  onSelect={selectRackTile}
                  onDragStart={handleRackDragStart}
                  onDropBack={handleRackDrop}
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
              turnPlayerId={state.turnPlayerId}
              youId={state.youId}
              hostId={state.hostId}
              winnerId={state.winnerId}
            />
            <GameLog log={state.log} />
          </div>
        </div>
      )}
    </div>
  );
}
