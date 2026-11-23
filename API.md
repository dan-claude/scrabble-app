# API Reference

The server is a plain Flask app that speaks REST/JSON on one port (default `4000`).
There is no persistent connection of any kind — the client polls a state endpoint on a
timer (every ~1 second) and every action is a normal HTTP request. See the note in
[README.md](README.md) on why this project uses polling instead of WebSockets/Socket.IO.

Base URL in development: `http://localhost:4000` (the Vite dev server proxies `/api/*`
to it, so the browser only ever talks to `http://localhost:5173`).

## Conventions

- **Every response is JSON.** A successful request returns `200 OK` with a JSON body (the
  shape varies per endpoint, documented below). A failed request returns a non-2xx status
  with `{"error": "<human-readable message>"}` — safe to show directly to the player
  (e.g. `"It's not your turn."`, `"\"QX\" is not a valid word."`).
- **Status codes:** `400` for a rule violation or a malformed request (e.g. missing
  name), `401` for a missing/invalid/expired player token, `404` for a room that doesn't
  exist, `500` for an unexpected server error.
- **Authentication** is a bearer `token` string, handed out by `POST /api/rooms` and
  `POST /api/rooms/<code>/join`. There are no accounts or passwords — anyone who holds a
  room's code can join it, and anyone who holds a player's token can act as that player
  (the reference client stores it in `localStorage`). The token doubles as the session:
  there's no separate "rejoin" call, since polling `GET /state` with a saved token *is*
  resuming the session.
- **Where the token goes:** as a `token` query parameter on the one `GET` endpoint, and
  as a `token` field in the JSON body on every `POST` endpoint (mixed in with whatever
  other fields that action needs).
- All board coordinates are `[row, col]`, 0-indexed, `0 <= row, col <= 14`.
- Most action endpoints (join/start/place/pass/exchange) return the same shape as
  `GET /state` — the fresh, personalized state right after the action applies — so the
  client can update immediately without waiting for the next poll tick.

---

## Misc endpoints

### `GET /api/health`

Liveness check.

**Response** `200 OK`
```json
{ "ok": true }
```

### `GET /` and `GET /<path>`

Serves the built React client (`client/dist/`) for any path that isn't `/api/*`, falling
back to `index.html` for client-side routing. Only meaningful in production — see
[README.md](README.md). Not used in development (the Vite dev server serves the client
instead).

---

## Room / gameplay endpoints

### `POST /api/rooms`

Create a new room and join it as the host.

**Body**
```ts
{
  playerName: string;               // 1-20 chars after trimming; required
  notificationSetup?: {             // optional - see "Notification plugins" below
    [pluginId: string]: { [fieldKey: string]: string };
  };
  userToken?: string;               // optional - links this player to a signed-in account
  dictionary?: string;              // optional - word list to use; defaults to "sowpods". See GET /api/dictionaries
}
```

**Response** `200 OK` — a `State` object (see below) plus:
```ts
{ token: string }   // this player's bearer token — save it (with roomCode) to resume later
```
`roomCode` (inside the state object) is a 5-character code (uppercase letters/digits,
excludes ambiguous characters `I O 0 1`).

**Errors:** `400` `"Enter a name."` · `400` `"Too many rooms created from this
connection. Please wait a minute and try again."` (rate limit) · `400` `"Server is at
capacity right now — please try again in a bit."`

---

### `POST /api/rooms/<code>/join`

Join an existing room. What you become depends on the room's `status`:

- **`lobby`** — you join as a normal active player, same as anyone else who joined
  before the game started. Subject to the usual limits: room not full (`maxPlayers`),
  and your name not already taken (case-insensitive) by another player in the room.
- **`playing` or `finished`** — instead of being rejected, you join as a **spectator**:
  a read-only participant who gets the same polled `State` (board, scores, log, tile
  counts) but never a rack, is never dealt a turn, and cannot call `start`/`place`/
  `pass`/`exchange` (those return `403` for a spectator token). Spectator names are not
  checked for uniqueness against players or other spectators. Capped at 20 spectators per
  room (`"Too many spectators already watching this game (20 max)."`) purely as an abuse
  guard.

Either way, you get a `token` back and should poll `GET .../state` with it like any other
room member.

**Body**
```ts
{
  playerName: string;
  notificationSetup?: {             // optional - see "Notification plugins" below;
    [pluginId: string]: { [fieldKey: string]: string };  // ignored if you join as a spectator
  };
  userToken?: string;               // optional - links this player to a signed-in account
}
```

**Response** `200 OK` — a `State` object plus `{ token: string }`, same shape as
`POST /api/rooms`. Check `isSpectator` in the response to know which you became.

**Errors:** `404` `"Room not found."` · `400` `"Enter a name."` · `400` `"Room is full (4
players max)."` / `"That name is already taken in this room."` (lobby joins only) ·
`400` `"Too many spectators already watching this game (20 max)."` (spectator joins only)

---

### `GET /api/dictionaries`

List the word lists available on this server. Public and unauthenticated — needed before room creation. Any `.txt` file placed in `server/words/` is auto-discovered at startup.

**Response** `200 OK`
```ts
{
  dictionaries: string[];   // e.g. ["enable", "sowpods"]
  default: string;          // the default when none is specified — currently "sowpods"
}
```

---

### `GET /api/notification-plugins`

List the notification plugins currently loaded on the server (see [Notification
plugins](#notification-plugins) below). Public and unauthenticated on purpose — the join
page needs this before a player has any token at all.

**Response** `200 OK`
```ts
{
  plugins: Array<{
    id: string;
    name: string;
    description: string;
    trigger: "client" | "server";
    setupFields: Array<{ key: string; label: string; placeholder: string }>;
  }>;
}
```

---

### `POST /api/rooms/<code>/add-bot`

Add a bot player to a room that is still in the lobby. Host only.

**Body**
```ts
{
  token: string;
  difficulty?: "easy" | "hard";   // default "hard"
}
```

`"easy"` restricts the bot to words of 6 letters or fewer (common vocabulary).
`"hard"` lets it use the full dictionary.

**Response** `200 OK` — a `State` object.

**Errors:** `404` `"Room not found."` · `401`/`403` token errors · `403` `"Only the host can add bots."` · `400` `"Game already in progress."` · `400` `"Room is full (4 players max)."`

---

### `POST /api/rooms/<code>/remove-bot`

Remove a bot player from a room that is still in the lobby. Host only.

**Body**
```ts
{ token: string; botId: string }   // botId = the bot's PlayerView.id (public id)
```

**Response** `200 OK` — a `State` object.

**Errors:** `404` `"Room not found."` · `401`/`403` token errors · `403` `"Only the host can remove bots."` · `400` `"Cannot remove a player after the game has started."` · `400` `"Player not found."` · `400` `"Only bots can be removed this way."`

---

### `POST /api/rooms/<code>/remove-spectator`

Remove a spectator from the room. Host only.

**Body**
```ts
{ token: string; spectatorId: string }   // spectatorId = SpectatorView.id (public id)
```

**Response** `200 OK` — a `State` object.

**Errors:** `404` `"Room not found."` · `401`/`403` token errors · `403` `"Only the host can remove spectators."` · `400` `"Spectator not found."`

---

### `POST /api/rooms/<code>/notification-setup`

Update a player's notification setup after they've already joined — the only path
available to a player who reached the room via a remembered-name auto-rejoin (see
`Lobby.jsx`), which skips the join form (and its `notificationSetup` field above)
entirely.

**Body**
```ts
{
  token: string;
  notificationSetup: { [pluginId: string]: { [fieldKey: string]: string } };
}
```

**Response** `200 OK` — a `State` object, same as `GET .../state`.

**Errors:** `404` `"Room not found."` · `401` `"Missing token."` / `"Session not found;
please join again."` · `403` `"Spectators can't do that."` (spectators never have a turn,
so there's nothing to be notified about)

---

### `GET /api/rooms/<code>/state`

Poll the current state of a room. This is the only source of truth the client needs —
it is not diffed or paginated, always the full current state — and the client is
expected to call it on a fixed interval (the reference client uses **1000ms**) for as
long as it's showing that room.

**Query parameters**
```ts
token: string   // required
```

**Response** `200 OK` — a `State` object.

**Errors:** `404` `"Room not found."` · `401` `"Missing token."` · `401` `"Session not
found; please join again."` (token doesn't match any player *or spectator* in that room —
e.g. the room was reaped, or the token is stale/wrong)

Calling this with a valid token also counts as a "heartbeat" for that player or spectator
(see [Presence](#presence) below) — it's the only signal the server has that someone is
still there.

---

### `POST /api/rooms/<code>/start`

Deal racks and start the game. Host only.

**Body**
```ts
{ token: string }
```

**Response** `200 OK` — a `State` object.

**Errors:** `404` `"Room not found."` · `401` `"Missing token."` / `"Session not found;
please join again."` · `403` `"Spectators can't do that."` (a spectator's token was used) ·
`403` `"Only the host can start the game."` · `400` `"Game already started."` ·
`400` `"Need at least 2 players to start."`

---

### `POST /api/rooms/<code>/place`

Place tiles on the board to form a word (or extend one) and end the turn.

**Body**
```ts
{
  token: string;
  placements: Array<{
    row: number;        // 0-14
    col: number;        // 0-14
    letter: string;     // single uppercase letter A-Z — the letter this tile *displays*
    isBlank?: boolean;  // true if this is a blank tile standing in for `letter`
  }>;
}
```
All placements must land on currently-empty board squares, and together must lie in a
single row or a single column (or be a single tile). To use a blank tile, send the letter
you want it to represent and set `isBlank: true`; it will score 0 points regardless of the
letter chosen.

**Response** `200 OK` — a `State` object (with the updated board/score already applied).

**Errors** (non-exhaustive, all human-readable, all `400` unless noted):
`"It's not your turn."` · `"Game is not in progress."` · `"No tiles placed."` ·
`"Invalid placement."` · `"Placement out of bounds."` · `"Duplicate cell in placement."` ·
`"That square is already occupied."` · `"Invalid letter in placement."` ·
`"You don't have the tile for \"X\"."` · `"The first word must cover the center square."` ·
`"Tiles must be placed in a single row or column."` ·
`"Placed tiles must be contiguous (no gaps)."` ·
`"New tiles must connect to existing tiles on the board."` ·
`"That does not form a word."` · `"\"XYZ\" is not a valid word."` · plus the `401`/`403`
token errors shared by every action endpoint (a spectator's token gets `403`
`"Spectators can't do that."` from any of `start`/`place`/`pass`/`exchange`).

**Scoring rules applied server-side:**
- Letter/word bonus squares (`DL`/`TL`/`DW`/`TW`) apply only to *newly placed* tiles —
  a bonus square is "used up" the first time a tile lands on it.
- Every word formed by the move is scored: the main word (the full run of tiles in the
  placement's direction) plus one crossing word per newly-placed tile that has an adjacent
  letter perpendicular to the placement direction.
- Placing all 7 rack tiles in a single move adds a 50-point bingo bonus.
- If this empties the player's rack and the bag is also empty, the game ends immediately
  (see [Game end](#game-end)).

---

### `POST /api/rooms/<code>/pass`

Pass the current turn without playing.

**Body**
```ts
{ token: string }
```

**Response** `200 OK` — a `State` object.

**Errors:** `400` `"It's not your turn."` · `400` `"Game is not in progress."` · plus the
shared `401`/`403`/`404` errors.

If every player passes twice in a row (`consecutive passes >= players * 2`), the game
ends (see [Game end](#game-end)).

---

### `POST /api/rooms/<code>/exchange`

Discard some of your rack tiles back into the bag and draw replacements, ending your turn.

**Body**
```ts
{ token: string; letters: string[] }   // e.g. ["A", "Q", "#"] — use "#" for a blank tile
```

**Response** `200 OK` — a `State` object.

**Errors:** `400` `"It's not your turn."` · `400` `"Game is not in progress."` ·
`400` `"Select at least one tile to exchange."` · `400` `"The bag is empty; you cannot
exchange."` · `400` `"You don't have a \"X\" tile to exchange."` · plus the shared
`401`/`403`/`404` errors.

Returns the named tiles to the bag, shuffles it, draws replacements, advances the turn.
Counts toward the pass-based game-end threshold the same way a pass does.

---

## The `State` object

Every room/gameplay endpoint above returns this same shape (personalized per player):

```ts
{
  roomCode: string;
  dictionary: string;              // word list in use, e.g. "sowpods" or "enable"
  status: "lobby" | "playing" | "finished";
  minPlayers: number;                  // 2
  maxPlayers: number;                  // 4
  board: (BoardCell | null)[][];       // 15x15, board[row][col]
  bonusGrid: (BonusLabel | null)[][];  // 15x15, static for the whole game
  bagCount: number;                    // tiles remaining, undrawn
  turnPlayerId: string | null;         // a player's public id; null unless status=="playing"
  hostId: string;                      // public id of the player who created the room
  winnerId: string | null;             // public id; set once status=="finished"
  log: LogEntry[];                     // most recent 50 events, oldest first
  players: PlayerView[];
  isSpectator: boolean;                // true if youId belongs to a spectator, not a player
  spectators: SpectatorView[];
  youId: string;                       // public id of the player/spectator this response is for
  token?: string;                      // only present on POST /api/rooms and .../join
}

All ids in `State` (`PlayerView.id`, `SpectatorView.id`, `turnPlayerId`, `hostId`,
`winnerId`, `youId`) are **public ids**, safe to show to everyone in the room. They are
*not* the secret `token` used to authenticate requests, and the server never sends one
participant's token to another.

type BoardCell = { letter: string; isBlank: boolean };
type BonusLabel = "TW" | "DW" | "TL" | "DL";

type PlayerView = {
  id: string;
  name: string;
  score: number;
  rackCount: number;
  connected: boolean;       // see Presence below
  rack: string[] | null;    // only populated for the recipient's own entry; null for others
  isBot: boolean;
  botDifficulty: "easy" | "hard" | null;  // non-null only when isBot is true
};

type SpectatorView = {
  id: string;
  name: string;
  connected: boolean;       // see Presence below
};

type LogEntry = {
  type: "start" | "pass" | "exchange" | "move" | "end";
  playerName?: string;
  detail?: string;          // e.g. "WAG (+14)", "Passed.", "Exchanged 2 tile(s)."
  ts: number;                // epoch milliseconds
};
```

Rack letters (both `PlayerView.rack` and the tiles implied by `bagCount`) use uppercase
`A`–`Z`, plus `#` for a blank tile still in hand. Once a blank is placed, the board cell
shows the letter it was set to play as, with `isBlank: true`.

---

## Presence

There's no connect/disconnect event under polling — the server only knows a player is
"there" because their requests keep arriving. Each player (and each spectator) has a
`last_seen` timestamp, updated on every request that identifies them (join, a poll, or -
for players - any action). A player or spectator's `connected` field in `State` is simply
`(now - last_seen) < 6 seconds`. With the reference client polling every ~1s, a healthy
connection reads as `connected: true` continuously; a closed tab or a lost network flips
it to `false` within a few seconds, without the server needing to be told explicitly.

## Room cleanup

Two independent sweeps run every 30 seconds:

- **Abandoned-room reap:** if everyone in a room - players and spectators alike - has
  gone stale (no request in over 3 days — nobody is polling it any more), the room
  and its game state are deleted. This is the replacement for the old "everyone
  disconnected" cleanup, just based on polling recency instead of socket disconnect
  events. A spectator still polling keeps the room alive even if every player has gone
  stale.
- **Idle-room reap:** if a room has had no *game-affecting* action (join, start, place,
  pass, exchange) in over 3 days — even if someone's tab is still open and quietly
  polling it — it's deleted too. This bounds memory from a lone forgotten tab
  independently of the check above.

Merely polling `GET /state` counts toward the first sweep (keeps `last_seen` fresh) but
not the second (doesn't reset `last_activity`) — that's what lets a truly idle-but-open
room still eventually get reaped.

If either sweep reaps a room whose game was still `"playing"` (as opposed to a lobby
that never started, or a game that had already finished normally), a summary of it is
appended to the same permanent log [`GET /api/admin/games`](#get-apiadmingames) uses for
normally-finished games - with `endReason` set to `"abandoned"` or `"idle_timeout"` and
`winnerId: null` - so an in-progress game that got swept away still shows up there
instead of disappearing with no trace.

## Game end

Ends the round and finalizes scores in one of two ways:

1. **A player empties their rack while the bag is empty** (triggered inside
   `POST .../place`): every other player's score is reduced by the sum of their
   remaining rack tiles' point values, and the player who went out gains the total of
   all those deducted points.
2. **Stalemate** — every player passes (or exchanges) twice in a row: everyone's score is
   simply reduced by the value of the tiles left in their own rack, nobody gains anything.

Either way, `status` becomes `"finished"` and `winnerId` is set to whichever player ends
up with the highest score.

## Auth endpoints

Google OAuth sign-in. When `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not set,
`GET /api/auth/google` returns `503`. Once configured, sign-in links an optional user
account to a player's room session — game history is recorded per-user and queryable via
`GET /api/profile`. Playing without signing in is always allowed.

New env vars for OAuth (see [Environment variables](#environment-variables)):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SECRET_KEY`.

### `GET /api/auth/google`

Redirect the browser to Google's OAuth consent screen. Not an API endpoint — the client
navigates there via `window.location.href`.

**Redirects to** Google, then back to `/api/auth/google/callback`.

**Errors:** `503` if `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not set.

---

### `GET /api/auth/google/callback`

OAuth callback — called by Google after the user consents. Creates or updates the user
record, issues a user session token, and redirects to `/?user_token=<token>`. The client
saves the token to `localStorage` and removes it from the URL.

On error, redirects to `/?auth_error=1`.

---

### `GET /api/auth/me`

Return the signed-in user's basic profile.

**Headers:** `Authorization: Bearer <userToken>`

**Response** `200 OK`
```ts
{
  user: {
    id: string;
    name: string;
    email: string;
    picture: string;
    phone: string | null;        // registered SMS phone number
    phoneOptedOut: boolean;      // true if the number has opted out via STOP
    smsEnabled: boolean;         // true if TEXTBELT_KEY is configured on the server
  };
}
```

**Errors:** `401` if the token is missing, invalid, or expired.

---

### `POST /api/auth/logout`

Invalidate the current user session.

**Body** (or `Authorization` header): `{ userToken: string }` or `Authorization: Bearer <token>`

**Response** `200 OK`: `{}`

---

### `POST /api/rooms/<code>/link-user`

Retroactively stamp a user account onto an existing player slot — for players who sign in
while already in a room. After this call, the game will be counted in that user's history
when it finishes, even though the player joined before signing in.

**Body**
```ts
{
  token: string;      // the player's room bearer token
  userToken: string;  // the user's OAuth session token (Bearer token from sign-in)
}
```

**Response** `200 OK`: `{}`

**Errors:** `404` `"Room not found."` · `401` token errors · `400` `"Invalid user token."`

---

### `GET /api/auth/active-games`

Return a list of non-finished rooms where the signed-in user has a player slot. Intended
for the lobby "Resume a game" section — the returned `token` can be passed directly to
`GET /api/rooms/<code>/state` to rejoin.

**Headers:** `Authorization: Bearer <userToken>`

**Response** `200 OK`
```ts
{
  games: Array<{
    roomCode: string;
    status: "lobby" | "playing";
    token: string;           // the player's existing room bearer token
    players: Array<{ name: string; isBot: boolean }>;
  }>;
}
```

**Errors:** `401` if the user token is missing, invalid, or expired.

---

### `GET /api/profile`

Return the signed-in user's stats and game history. Stats are computed by scanning all
finished games where this user's id appears on a player entry.

**Headers:** `Authorization: Bearer <userToken>`

**Response** `200 OK`
```ts
{
  user: {
    id: string;
    name: string;
    email: string;
    picture: string;
    createdAt: number;     // epoch seconds
    phone: string | null;  // saved phone number, if any
    phoneOptedOut: boolean; // true if this number has replied STOP
  };
  stats: {
    gamesPlayed: number;
    wins: number;
    winRate: number;        // 0-100, integer
    avgScore: number;       // integer
    bestScore: number;
    recentGames: Array<{
      roomCode: string;
      finishedAt: number | null;
      myScore: number;
      won: boolean;
      players: Array<{ name: string; score: number; isBot: boolean }>;
    }>;                     // most recent 20
  };
}
```

**Errors:** `401` if the token is missing, invalid, or expired.

---

### `PATCH /api/profile`

Update the signed-in user's profile. Currently only `phone` is writable.

**Headers:** `Authorization: Bearer <userToken>`

**Body**
```json
{ "phone": "+15551234567" }   // or null / "" to remove
```

**Response** `200 OK`
```ts
{ phone: string | null; phoneOptedOut: boolean; }
```

When `phone` is new (not previously saved), an opt-in confirmation SMS is sent immediately.

Turn-notification texts link to `<PUBLIC_BASE_URL>/?room=CODE&resume=1`. The link carries
no token. The client resumes the seat from the device's saved session for that room, or
else from the signed-in account via `GET /api/auth/active-games`; if nobody is signed in
it shows a "Game in progress — sign in" page using the same sign-in options as everywhere
else in the app.
If the number is in the opt-out table the response includes `"error"` and no change is saved:
```ts
{ phone: string | null; phoneOptedOut: true; error: string; }
```

**Errors:** `401` unauthenticated; `400` phone too long (> 20 chars).

---

### `POST /api/sms/webhook`

Receives reply SMS from TextBelt when a player responds to a notification.
TextBelt posts JSON `{ fromNumber, text, textId }`.

Requests must carry TextBelt's signature headers: `X-textbelt-timestamp` (UNIX seconds)
and `X-textbelt-signature` (hex HMAC-SHA256 of the timestamp string followed by the raw
request body, keyed with `TEXTBELT_KEY`). Requests with a missing or wrong signature, or a
timestamp more than 15 minutes from the server clock, get `401 {"error": "Invalid signature."}`
and change nothing.

- `STOP` → marks the number as opted out in the persistent opt-out table; sends confirmation.
- `START` → clears the opt-out; sends re-subscribe confirmation.
- `HELP` → sends the help message.
- Anything else → logged and ignored.

Returns `200 {}` for any correctly signed request. Every event is logged to stdout
(visible in Railway logs).

No user authentication — this endpoint is called by TextBelt's servers and is
authenticated by the signature above.

---

## Admin API

A small set of routes under `/api/admin/*` for looking in on the server — not part of
the normal player-facing flow, and not linked from the client. Every route below requires
```
Authorization: Bearer <ADMIN_TOKEN>
```
where `ADMIN_TOKEN` is a secret you set yourself (see [Environment variables](#environment-variables)).
**If `ADMIN_TOKEN` isn't set, every route under `/api/admin/*` returns `404`** — same as a
route that doesn't exist at all — rather than being open by default. A request with no
`Authorization` header, a malformed one, or the wrong token gets that same `404` too
(never a `401`), so a prober can't even tell an admin API is present versus just hitting a
path that was never a route to begin with.

### `GET /admin`

A small static page (not part of the React client) that calls the routes below and
renders them as tables, with a delete button per room. Unlike everything else here it's
reachable with **no token at all** — a browser can't attach a custom header via plain
navigation, so the page has to load unauthenticated; you paste your `ADMIN_TOKEN` into a
field on the page itself, which it then attaches to every call it makes. See
[README.md](README.md#admin-api) for how to reach it in dev vs. production.

### `GET /api/admin/rooms`

List every room the server currently has in memory (playing, in the lobby, or finished
but not yet reaped).

**Response** `200 OK`
```ts
{
  rooms: Array<{
    roomCode: string;
    status: "lobby" | "playing" | "finished";
    hostId: string;
    winnerId: string | null;
    players: Array<{ name: string; score: number; connected: boolean }>;
    spectatorCount: number;
    createdAt: number;    // epoch seconds, when the room was created
    startedAt: number | null;
    finishedAt: number | null;
    lastActivity: number; // epoch seconds - see Room cleanup above
  }>;
}
```
No rack contents here on purpose — this is meant for a quick "what's going on right now"
glance, not per-player debugging.

### `GET /api/admin/rooms/<code>`

Full internal detail on one room — everything needed to fully reconstruct it, including
every player's actual rack (the same shape used internally for persistence; see
[Persisting game state across restarts](README.md#persisting-game-state-across-restarts)).
Handy for chasing down a specific "why did my move get rejected" report.

**Errors:** `404` if the room doesn't exist (or the token's wrong/missing - see above).

### `GET /api/admin/rooms/<code>/rejoin-links`

Return a per-player rejoin URL for every active player in the room. Each URL carries
the player's existing token (`?room=CODE&rejoin_token=TOKEN`), so opening it in a browser
restores their session directly — useful when a player has lost their `localStorage`
cookie (closed browser, cleared storage, different device).

**Response** `200 OK`
```ts
{
  roomCode: string;
  players: Array<{ name: string; rejoinUrl: string }>;
}
```

Spectators are excluded — they have no persistent game seat to return to.

**Errors:** `404` if the room doesn't exist or the admin token is wrong/missing.

### `DELETE /api/admin/rooms/<code>`

Force-remove a room immediately, instead of waiting for one of the two time-based reaps
to get to it - e.g. to clear something stuck or being abused. Also deletes it from
persistent storage if `PERSISTENCE_BACKEND` is configured.

**Response** `200 OK`: `{ "deleted": "ABCDE" }`

**Errors:** `404` if the room doesn't already exist.

### `GET /api/admin/games`

A permanent log of finished games, most recent first - independent of the rooms
themselves, which still get reaped normally once everyone leaves. Also includes games
that were still in progress when [one of the two time-based reaps](#room-cleanup) swept
their room away (`endReason: "abandoned" | "idle_timeout"`), so a game that never
reached a normal end still shows up here instead of just vanishing. **Only populated when
`PERSISTENCE_BACKEND` is `file` or `redis`** - with the default `none`, this always
returns an empty list, by the same reasoning as [Persisting game state across
restarts](README.md#persisting-game-state-across-restarts): no backend configured means
nothing is written down anywhere.

**Query parameters:** `limit` (default `100`)

**Response** `200 OK`
```ts
{
  games: Array<{
    roomCode: string;
    createdAt: number;
    startedAt: number;
    finishedAt: number;
    endReason: "went_out" | "stalemate" | "abandoned" | "idle_timeout";
    winnerId: string | null;      // null for "abandoned"/"idle_timeout" - the room was
                                   // reaped mid-game, before anyone won
    players: Array<{ id: string; name: string; score: number; userId: string | null; isBot: boolean }>;
    moveCount: number;
    passCount: number;
    exchangeCount: number;
  }>;
}
```

### `GET /api/admin/params`

Every setting that affects server behavior right now - both environment-variable-driven
config (e.g. `PERSISTENCE_BACKEND`) and fixed constants (e.g. `MAX_ROOMS`,
`ABANDONED_ROOM_SECONDS`) - for display on the admin page. `ADMIN_TOKEN` itself is never
included (this route is gated behind it). If `REDIS_URL` is shown, any embedded
credentials are redacted to `***:***` - only the host/port/db portion is real.

**Response** `200 OK`
```ts
{
  params: Array<{
    name: string;         // e.g. "ABANDONED_ROOM_SECONDS"
    value: string | number | boolean;
    source: string;       // "env: <VAR_NAME>" or "constant"
    description: string;
  }>;
}
```

### `GET /api/admin/sms-optouts`

The full SMS opt-out table — every phone number that has ever sent a STOP or START reply, with its current status. Only numbers that have interacted with the webhook appear here; numbers that received messages but never replied are absent.

**Response** `200 OK`
```ts
{
  numbers: Array<{
    phone: string;      // E.164-normalised phone number
    optedOut: boolean;  // true = STOP'd, false = active (START'd after a prior STOP)
  }>;
}
```

---

## Notification plugins

"Be notified when it's your turn" is implemented as a plugin system rather than a single
hardcoded feature, so a new notification channel can be added without touching the
route handlers above. Plugins live one per module under `server/notification_plugins/`
and are discovered automatically at server startup (`pkgutil.iter_modules` — see that
package's `__init__.py` for the exact contract). The only plugin shipped today is
`browser`, which wraps the client's own `Notification` API and needs nothing from the
server (no `send()`, no setup fields).

Each plugin module exports a `PLUGIN` dict:

```ts
{
  id: string;             // stable, unique - used as a dict key everywhere
  name: string;           // shown to players (join page / in-room panel) and on /admin
  description: string;    // shown to players and on /admin
  trigger: "client" | "server";
  setup_fields: Array<{ key: string; label?: string; placeholder?: string }>;
}
```

- **`trigger: "client"`** — the browser handles it locally (like `browser` does with the
  `Notification` API). The server only needs to list the plugin; it never sends anything
  for it.
- **`trigger: "server"`** — the plugin module also exports `send(setup, context)`, called
  once by the server whenever `turnPlayerId` changes to a player who has that plugin
  configured. `setup` is that player's saved values for the plugin's `setup_fields`;
  `context` is `{ roomCode, playerId, playerName }`. A `send()` that raises is caught and
  logged — a broken or unreachable channel never breaks gameplay.

Per-player setup data (whatever a plugin's `setup_fields` collect — e.g. a phone number)
is submitted via `notificationSetup` on `POST /api/rooms`, `POST /api/rooms/<code>/join`,
or `POST /api/rooms/<code>/notification-setup`, shaped `{ [pluginId]: { [fieldKey]:
value } }`. The server only ever keeps values for plugin ids and field keys it actually
knows about — everything else in that payload is silently dropped before it's stored.
This setup data is intentionally **not** echoed back in the `State` object; no shipped
plugin needs to read it back, and the join/in-room forms don't pre-fill it either.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP listen port |
| `FLASK_DEBUG` | `0` | `1` enables Flask's debug/reloader mode (dev only) |
| `PERSISTENCE_BACKEND` | `none` | `none` / `file` / `redis` — see [README.md](README.md#persisting-game-state-across-restarts) |
| `PERSISTENCE_FILE_DIR` | `server/data/rooms` | Only used when `PERSISTENCE_BACKEND=file` |
| `REDIS_URL` | `redis://localhost:6379/0` | Only used when `PERSISTENCE_BACKEND=redis` |
| `ADMIN_TOKEN` | *(unset)* | Enables `/api/admin/*` — see [Admin API](#admin-api). Generate one with `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `GOOGLE_CLIENT_ID` | *(unset)* | Google OAuth client ID — from Google Cloud Console. OAuth routes return `503` if unset. |
| `GOOGLE_CLIENT_SECRET` | *(unset)* | Google OAuth client secret — from Google Cloud Console. |
| `PUBLIC_BASE_URL` | *(unset)* | Public origin of the app, e.g. `https://yourapp.up.railway.app`. Used to build links in SMS and admin rejoin links (admin links carry the player's token). **Set this in production**: if unset, links are built from the request's Host / X-Forwarded-Host header, which a client can forge. |
| `SECRET_KEY` | *(random per restart)* | Signs Flask session cookies used by the OAuth state check. Set a stable value in production so in-flight logins survive restarts. Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"` |

## Known limitations

- State is in-memory by default; restarting the server drops all rooms and games in
  progress unless `PERSISTENCE_BACKEND` is set (see above).
- Polling means state updates lag by up to one poll interval (~1s in the reference
  client) instead of being pushed instantly — see [README.md](README.md) for why this
  tradeoff was made.
