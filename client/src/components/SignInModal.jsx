export default function SignInModal({ onClose }) {
  function handleGoogle() {
    window.location.href = '/api/auth/google';
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">Sign in</h2>
        <p className="modal-sub">Save your game history and stats</p>
        <button className="provider-btn" onClick={handleGoogle}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{flexShrink: 0}}>
            <path fill="#4285F4" d="M17.64 9.2a10.3 10.3 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26a5.4 5.4 0 0 1-8.05-2.84H.78v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.99 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.78a9 9 0 0 0 0 8.1l3.21-2.33z"/>
            <path fill="#EA4335" d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35L14.5 2.86A8.63 8.63 0 0 0 9 1 9 9 0 0 0 .78 4.95L3.99 7.28A5.37 5.37 0 0 1 9 3.58z"/>
          </svg>
          Continue with Google
        </button>
        <p className="modal-note">You can still play without signing in</p>
      </div>
    </div>
  );
}
