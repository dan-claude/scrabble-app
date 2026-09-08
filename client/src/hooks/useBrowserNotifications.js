import { useState } from 'react';

// "Be notified when it is your turn" - persisted per-browser so the choice
// survives a reload. Actually enabling it also requires the browser to have
// granted Notification permission; see `enabled` below for how the two
// combine. Call this hook exactly once per page (Lobby or GameRoom - App.jsx
// never renders both at once) and pass the returned object down as a prop
// into <NotificationSettings>, rather than having that component call the
// hook itself - two independent instances would drift out of sync with each
// other's toggling.
const STORAGE_KEY = 'scrabble_notify_turn';

export default function useBrowserNotifications() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState(
    supported ? Notification.permission : 'unsupported'
  );
  const [enabled, setEnabled] = useState(() => {
    if (!supported) return false;
    // Only trust the saved preference if the browser still actually has
    // permission granted - it may have been revoked in site settings since.
    return Notification.permission === 'granted' && localStorage.getItem(STORAGE_KEY) === '1';
  });

  async function toggle(e) {
    const wantOn = e.target.checked;
    if (!wantOn) {
      setEnabled(false);
      try { localStorage.setItem(STORAGE_KEY, '0'); } catch { /* private mode etc - ignore */ }
      return;
    }
    if (Notification.permission === 'granted') {
      setEnabled(true);
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode etc - ignore */ }
      return;
    }
    // 'denied' resolves immediately with 'denied' again (no dialog) - the
    // permission value below is what tells the player why nothing happened.
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      setEnabled(true);
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode etc - ignore */ }
    }
  }

  return { supported, enabled, permission, toggle };
}
