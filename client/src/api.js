async function apiRequest(method, path, { token, body } = {}) {
  const url = new URL(path, window.location.origin);
  const opts = { method };
  if (method === 'GET') {
    if (token) url.searchParams.set('token', token);
  } else {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ ...(body || {}), ...(token ? { token } : {}) });
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no/invalid JSON body - fall through with data=null
  }
  if (!res.ok) {
    throw new Error(data?.error || 'Request failed.');
  }
  return data;
}

export function createRoom(playerName) {
  return apiRequest('POST', '/api/rooms', { body: { playerName } });
}

export function joinRoom(roomCode, playerName) {
  return apiRequest('POST', `/api/rooms/${roomCode}/join`, { body: { playerName } });
}

export function fetchState(roomCode, token) {
  return apiRequest('GET', `/api/rooms/${roomCode}/state`, { token });
}

export function startGame(roomCode, token) {
  return apiRequest('POST', `/api/rooms/${roomCode}/start`, { token });
}

export function placeTiles(roomCode, token, placements) {
  return apiRequest('POST', `/api/rooms/${roomCode}/place`, { token, body: { placements } });
}

export function passTurn(roomCode, token) {
  return apiRequest('POST', `/api/rooms/${roomCode}/pass`, { token });
}

export function exchangeTiles(roomCode, token, letters) {
  return apiRequest('POST', `/api/rooms/${roomCode}/exchange`, { token, body: { letters } });
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
