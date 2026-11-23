import SignInOptions from './SignInOptions';

export default function SignInModal({ onClose, onSuccess }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">Sign in</h2>
        <p className="modal-sub">Save your game history and stats</p>
        <SignInOptions onSuccess={onSuccess} />
        <p className="modal-note">You can still play without signing in</p>
      </div>
    </div>
  );
}
