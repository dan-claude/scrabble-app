import SignInOptions from './SignInOptions';

// Shown when someone opens a turn-notification link (?room=CODE&resume=1)
// on a device that can't put them straight back into their seat.
export default function ResumeGate({ roomCode, status, onSignIn, onGoToLobby }) {
  return (
    <div className="resume-gate">
      <div className="resume-gate-box">
        <h2 className="modal-title">Game in progress</h2>
        {status === 'loading' && (
          <p className="modal-sub">Finding your seat in game {roomCode}…</p>
        )}
        {status === 'signin' && (
          <>
            <p className="modal-sub">Sign in to get back to game {roomCode}.</p>
            <SignInOptions onSuccess={onSignIn} />
          </>
        )}
        {status === 'not-found' && (
          <p className="modal-sub">
            Game {roomCode} has ended, or you aren&rsquo;t a player in it on this account.
          </p>
        )}
        <button className="resume-gate-lobby" onClick={onGoToLobby}>Go to lobby</button>
      </div>
    </div>
  );
}
