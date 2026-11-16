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

export function getDictionaries() {
  return apiRequest('GET', '/api/dictionaries');
}

export function createRoom(playerName, notificationSetup, userToken, dictionary) {
  return apiRequest('POST', '/api/rooms', { body: { playerName, notificationSetup, userToken, dictionary } });
}

export function joinRoom(roomCode, playerName, notificationSetup, userToken) {
  return apiRequest('POST', `/api/rooms/${roomCode}/join`, { body: { playerName, notificationSetup, userToken } });
}

export function getNotificationPlugins() {
  return apiRequest('GET', '/api/notification-plugins');
}

export function updateNotificationSetup(roomCode, token, notificationSetup) {
  return apiRequest('POST', `/api/rooms/${roomCode}/notification-setup`, {
    token,
    body: { notificationSetup },
  });
}

export function fetchState(roomCode, token) {
  return apiRequest('GET', `/api/rooms/${roomCode}/state`, { token });
}

export function startGame(roomCode, token) {
  return apiRequest('POST', `/api/rooms/${roomCode}/start`, { token });
}

export function addBot(roomCode, token, difficulty) {
  return apiRequest('POST', `/api/rooms/${roomCode}/add-bot`, { token, body: { difficulty } });
}

export function removeBot(roomCode, token, botId) {
  return apiRequest('POST', `/api/rooms/${roomCode}/remove-bot`, { token, body: { botId } });
}

export function removeSpectator(roomCode, token, spectatorId) {
  return apiRequest('POST', `/api/rooms/${roomCode}/remove-spectator`, { token, body: { spectatorId } });
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

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

function authHeaders(userToken) {
  return userToken ? { Authorization: `Bearer ${userToken}` } : {};
}

async function authRequest(method, path, userToken, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...authHeaders(userToken) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || 'Request failed.');
  return data;
}

export function getMe(userToken) {
  return authRequest('GET', '/api/auth/me', userToken);
}

export function logout(userToken) {
  return authRequest('POST', '/api/auth/logout', userToken);
}

export function getProfile(userToken) {
  return authRequest('GET', '/api/profile', userToken);
}

export function getActiveGames(userToken) {
  return authRequest('GET', '/api/auth/active-games', userToken);
}

export function linkUser(roomCode, roomToken, userToken) {
  return apiRequest('POST', `/api/rooms/${roomCode}/link-user`, {
    body: { token: roomToken, userToken },
  });
}

const USER_TOKEN_KEY = 'scrabble_user_token';

export function saveUserToken(token) {
  if (token) {
    localStorage.setItem(USER_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(USER_TOKEN_KEY);
  }
}

export function loadUserToken() {
  try { return localStorage.getItem(USER_TOKEN_KEY) || null; } catch { return null; }
}

// ---------------------------------------------------------------------------

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
