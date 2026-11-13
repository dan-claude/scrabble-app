export default function AuthButton({ user, onSignIn, onProfile }) {
  if (user) {
    return (
      <button className="auth-user-chip" onClick={onProfile} title="View profile">
        {user.picture
          ? <img src={user.picture} alt="" className="auth-avatar-img" referrerPolicy="no-referrer" />
          : <span className="auth-avatar-initials">{user.name.charAt(0).toUpperCase()}</span>}
        <span className="auth-user-name">{user.name.split(' ')[0]}</span>
      </button>
    );
  }
  return (
    <button className="auth-signin-btn" onClick={onSignIn}>
      Sign in
    </button>
  );
}
