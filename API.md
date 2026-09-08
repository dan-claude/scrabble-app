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
{ playerName: string }   // 1-20 chars after trimming; required
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
{ playerName: string }
```

**Response** `200 OK` — a `State` object plus `{ token: string }`, same shape as
`POST /api/rooms`. Check `isSpectator` in the response to know which you became.

**Errors:** `404` `"Room not found."` · `400` `"Enter a name."` · `400` `"Room is full (4
players max)."` / `"That name is already taken in this room."` (lobby joins only) ·
`400` `"Too many spectators already watching this game (20 max)."` (spectator joins only)

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

Deal racks and start the game. Any player can call it (the client only shows the button
to the host, but the server does not enforce that — see note in
[Known limitations](#known-limitations)).

**Body**
```ts
{ token: string }
```

**Response** `200 OK` — a `State` object.

**Errors:** `404` `"Room not found."` · `401` `"Missing token."` / `"Session not found;
please join again."` · `403` `"Spectators can't do that."` (a spectator's token was used) ·
`400` `"Game already started."` · `400` `"Need at least 2 players to start."`

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
  status: "lobby" | "playing" | "finished";
  minPlayers: number;                  // 2
  maxPlayers: number;                  // 4
  board: (BoardCell | null)[][];       // 15x15, board[row][col]
  bonusGrid: (BonusLabel | null)[][];  // 15x15, static for the whole game
  bagCount: number;                    // tiles remaining, undrawn
  turnPlayerId: string | null;         // a player id (token); null unless status=="playing"
  hostId: string;                      // id of the player who created the room
  winnerId: string | null;             // set once status=="finished"
  log: LogEntry[];                     // most recent 50 events, oldest first
  players: PlayerView[];
  isSpectator: boolean;                // true if youId belongs to a spectator, not a player
  spectators: SpectatorView[];
  youId: string;                       // which player/spectator this particular response is for
  token?: string;                      // only present on POST /api/rooms and .../join
}

type BoardCell = { letter: string; isBlank: boolean };
type BonusLabel = "TW" | "DW" | "TL" | "DL";

type PlayerView = {
  id: string;
  name: string;
  score: number;
  rackCount: number;
  connected: boolean;       // see Presence below
  rack: string[] | null;    // only populated for the recipient's own entry; null for others
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
  gone stale (no request in over 120 seconds — nobody is polling it any more), the room
  and its game state are deleted. This is the replacement for the old "everyone
  disconnected" cleanup, just based on polling recency instead of socket disconnect
  events. A spectator still polling keeps the room alive even if every player has gone
  stale.
- **Idle-room reap:** if a room has had no *game-affecting* action (join, start, place,
  pass, exchange) in over 6 hours — even if someone's tab is still open and quietly
  polling it — it's deleted too. This bounds memory from a lone forgotten tab
  independently of the check above.

Merely polling `GET /state` counts toward the first sweep (keeps `last_seen` fresh) but
not the second (doesn't reset `last_activity`) — that's what lets a truly idle-but-open
room still eventually get reaped.

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

### `DELETE /api/admin/rooms/<code>`

Force-remove a room immediately, instead of waiting for one of the two time-based reaps
to get to it - e.g. to clear something stuck or being abused. Also deletes it from
persistent storage if `PERSISTENCE_BACKEND` is configured.

**Response** `200 OK`: `{ "deleted": "ABCDE" }`

**Errors:** `404` if the room doesn't already exist.

### `GET /api/admin/games`

A permanent log of finished games, most recent first - independent of the rooms
themselves, which still get reaped normally once everyone leaves. **Only populated when
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
    endReason: "went_out" | "stalemate";
    winnerId: string;
    players: Array<{ id: string; name: string; score: number }>; // final scores
    moveCount: number;
    passCount: number;
    exchangeCount: number;
  }>;
}
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP listen port |
| `FLASK_DEBUG` | `0` | `1` enables Flask's debug/reloader mode (dev only) |
| `PERSISTENCE_BACKEND` | `none` | `none` / `file` / `redis` — see [README.md](README.md#persisting-game-state-across-restarts) |
| `PERSISTENCE_FILE_DIR` | `server/data/rooms` | Only used when `PERSISTENCE_BACKEND=file` |
| `REDIS_URL` | `redis://localhost:6379/0` | Only used when `PERSISTENCE_BACKEND=redis` |
| `ADMIN_TOKEN` | *(unset)* | Enables `/api/admin/*` — see [Admin API](#admin-api). Generate one with `python3 -c "import secrets; print(secrets.token_hex(32))"` |

## Known limitations

- `POST .../start` does not check that the caller is the host — the reference client
  only shows the "Start game" button to the host, but any player in the lobby could call
  it directly. Not a concern for a casual game among friends holding the same room code.
- State is in-memory by default; restarting the server drops all rooms and games in
  progress unless `PERSISTENCE_BACKEND` is set (see above).
- Polling means state updates lag by up to one poll interval (~1s in the reference
  client) instead of being pushed instantly — see [README.md](README.md) for why this
  tradeoff was made.
