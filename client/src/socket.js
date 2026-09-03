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
