import { io } from 'socket.io-client';

export const socket = io({
  autoConnect: true,
});

export function call(event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => {
      if (res && res.ok) resolve(res);
      else reject(new Error(res?.error || 'Request failed.'));
    });
  });
}

const SESSION_KEY = 'scrabble_session';

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// Remembers the player's display name across visits/rooms, so a returning
// visitor (e.g. someone re-using a room invite link) doesn't have to retype
// it. Deliberately a real cookie rather than localStorage, as requested.
const NAME_COOKIE = 'scrabble_name';
const NAME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // ~1 year

export function saveName(name) {
  const value = encodeURIComponent(name);
  document.cookie = `${NAME_COOKIE}=${value}; max-age=${NAME_COOKIE_MAX_AGE}; path=/; samesite=lax`;
}

export function loadName() {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${NAME_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}
