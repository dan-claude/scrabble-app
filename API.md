# API Reference

The server is a Flask app that speaks two protocols on the same port (default `4000`):

- A tiny **REST** surface for health checks and (in production) serving the built client.
- **Socket.IO** (over WebSocket, falling back to HTTP long-polling) for everything about
  rooms and gameplay. This is the real API — nearly every action is a Socket.IO event with
  an acknowledgement callback, plus one server-pushed event (`state`) that carries the
  entire game view.

Base URL in development: `http://localhost:4000` (the Vite dev server proxies both
`/api/*` and `/socket.io/*` to it, so the browser only ever talks to `http://localhost:5173`).

## Conventions

- **Every Socket.IO event listed under "Client → Server" is called with an acknowledgement
  callback** (`socket.emit(event, payload, callback)`), the way `socket.io-client` supports
  natively. The server always responds through that callback — there is no separate
  `error` broadcast event for these actions.
- **Ack response shape** is always one of:
  - `{"ok": true, ...extra fields}` — the fields vary per event, documented below.
  - `{"ok": false, "error": "<human-readable message>"}` — safe to show directly to the
    player (e.g. `"It's not your turn."`, `"\"QX\" is not a valid word."`).
- **Authentication** is a bearer `token` string, handed out by `room:create`/`room:join` and
  used to resume a seat via `room:rejoin`. There are no accounts or passwords — anyone who
  holds a room's code can join it, and anyone who holds a player's token can resume that
  player's seat (the reference client stores it in `localStorage`).
- All board coordinates are `[row, col]`, 0-indexed, `0 <= row, col <= 14`.

---

## REST endpoints

### `GET /api/health`

Liveness check.

**Response** `200 OK`
```json
{ "ok": true }
```

### `GET /` and `GET /<path>`

Serves the built React client (`client/dist/`) for any path that isn't `/api/*` or
`/socket.io/*`, falling back to `index.html` for client-side routing. Only meaningful in
production — see [README.md](README.md). Not used in development (the Vite dev server
serves the client instead).

---

## Socket.IO events — Client → Server

### `room:create`

Create a new room and join it as the host.

**Payload**
```ts
{ playerName: string }   // 1-20 chars after trimming; required
```

**Ack success**
```json
{ "ok": true, "roomCode": "T5HGZ", "token": "5f3a...e21" }
```
`roomCode` is a 5-character code (uppercase letters/digits, excludes ambiguous
characters `I O 0 1`). `token` is this player's bearer token — save it (with the room
code) to rejoin later.

**Ack errors:** `"Enter a name."`

**Side effects:** broadcasts a `state` event to the (single) player in the room.

---

### `room:join`

Join an existing room in its lobby.

**Payload**
```ts
{ playerName: string, roomCode: string }
```

**Ack success**
```json
{ "ok": true, "roomCode": "T5HGZ", "token": "9c1b...a04" }
```

**Ack errors:** `"Room not found."` · `"Enter a name."` · `"Game already in progress."` ·
`"Room is full (4 players max)."` · `"That name is already taken in this room."`
(name comparison is case-insensitive)

**Side effects:** broadcasts an updated `state` to every connected player in the room.

---

### `room:rejoin`

Resume a previously-issued seat (e.g. after a page reload) using a saved `token`.

**Payload**
```ts
{ roomCode: string, token: string }
```

**Ack success**
```json
{ "ok": true, "roomCode": "T5HGZ", "token": "9c1b...a04" }
```
(echoes back the same token; kept for symmetry with `room:create`/`room:join`)

**Ack errors:** `"Room not found."` · `"Session not found; please join again."` (token
doesn't match any player in that room)

**Side effects:** marks the player connected again on their new socket and broadcasts
`state` to the room.

---

### `game:start`

Deal racks and start the game. Any player can call it (the client only shows the button
to the host, but the server does not enforce that — see note in
[Known limitations](#known-limitations)).

**Payload:** none required (`{}`)

**Ack success:** `{ "ok": true }`

**Ack errors:** `"You are not in a room."` · `"Room not found."` · `"Game already started."` ·
`"Need at least 2 players to start."`

**Side effects:** deals 7 tiles to each player, sets `status` to `"playing"`, broadcasts
`state`.

---

### `game:place`

Place tiles on the board to form a word (or extend one) and end the turn.

**Payload**
```ts
{
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

**Ack success:** `{ "ok": true }` (the resulting board/score is delivered via the next
`state` broadcast, not in the ack)

**Ack errors** (non-exhaustive, all human-readable):
`"It's not your turn."` · `"Game is not in progress."` · `"No tiles placed."` ·
`"Invalid placement."` · `"Placement out of bounds."` · `"Duplicate cell in placement."` ·
`"That square is already occupied."` · `"Invalid letter in placement."` ·
`"You don't have the tile for \"X\"."` · `"The first word must cover the center square."` ·
`"Tiles must be placed in a single row or column."` ·
`"Placed tiles must be contiguous (no gaps)."` ·
`"New tiles must connect to existing tiles on the board."` ·
`"That does not form a word."` · `"\"XYZ\" is not a valid word."`

**Scoring rules applied server-side:**
- Letter/word bonus squares (`DL`/`TL`/`DW`/`TW`) apply only to *newly placed* tiles —
  a bonus square is "used up" the first time a tile lands on it.
- Every word formed by the move is scored: the main word (the full run of tiles in the
  placement's direction) plus one crossing word per newly-placed tile that has an adjacent
  letter perpendicular to the placement direction.
- Placing all 7 rack tiles in a single move adds a 50-point bingo bonus.
- If this empties the player's rack and the bag is also empty, the game ends immediately
  (see [Game end](#game-end)).

**Side effects:** updates the board and the mover's score, refills their rack from the bag,
advances the turn, broadcasts `state`.

---

### `game:pass`

Pass the current turn without playing.

**Payload:** none required (`{}`)

**Ack success:** `{ "ok": true }`

**Ack errors:** `"It's not your turn."` · `"Game is not in progress."`

**Side effects:** advances the turn, broadcasts `state`. If every player passes twice in a
row (`consecutive passes >= players * 2`), the game ends (see [Game end](#game-end)).

---

### `game:exchange`

Discard some of your rack tiles back into the bag and draw replacements, ending your turn.

**Payload**
```ts
{ letters: string[] }   // e.g. ["A", "Q", "#"] — use "#" for a blank tile
```

**Ack success:** `{ "ok": true }`

**Ack errors:** `"It's not your turn."` · `"Game is not in progress."` ·
`"Select at least one tile to exchange."` · `"The bag is empty; you cannot exchange."` ·
`"You don't have a \"X\" tile to exchange."`

**Side effects:** returns the named tiles to the bag, shuffles it, draws replacements,
advances the turn, broadcasts `state`. Counts toward the pass-based game-end threshold
the same way a pass does.

---

## Socket.IO events — Server → Client

### `state`

Pushed to **every connected player in a room** (individually, so each copy is
personalized) after any action changes the room. This is the only source of truth the
client needs — it is not diffed or paginated, always the full current state.

```ts
{
  roomCode: string;
  status: "lobby" | "playing" | "finished";
  board: (BoardCell | null)[][];       // 15x15, board[row][col]
  bonusGrid: (BonusLabel | null)[][];  // 15x15, static for the whole game
  bagCount: number;                    // tiles remaining, undrawn
  turnPlayerId: string | null;         // a player id (token); null unless status=="playing"
  hostId: string;                      // id of the player who created the room
  winnerId: string | null;             // set once status=="finished"
  log: LogEntry[];                     // most recent 50 events, oldest first
  players: PlayerView[];
  youId: string;                       // which player this particular copy is for
}

type BoardCell = { letter: string; isBlank: boolean };
type BonusLabel = "TW" | "DW" | "TL" | "DL";

type PlayerView = {
  id: string;
  name: string;
  score: number;
  rackCount: number;
  connected: boolean;
  rack: string[] | null;   // only populated for the recipient's own entry; null for others
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

## Connection lifecycle

- On `disconnect`, a player is marked `connected: false` and a `state` update is
  broadcast to the room's remaining connected players — their tiles and score stay
  intact, they just show as offline.
- If **every** player in a room is disconnected, the room (and its game state) is deleted
  5 seconds later. A room that empties out during the lobby phase is cleaned up the same
  way.
- To resume after a disconnect (e.g. a page reload), the client calls `room:rejoin` with
  the saved `roomCode`/`token`; this attaches the new socket to the existing player and
  the game continues exactly where it left off — no new tiles are dealt.

## Game end

Ends the round and finalizes scores in one of two ways:

1. **A player empties their rack while the bag is empty** (triggered inside `game:place`):
   every other player's score is reduced by the sum of their remaining rack tiles' point
   values, and the player who went out gains the total of all those deducted points.
2. **Stalemate** — every player passes (or exchanges) twice in a row: everyone's score is
   simply reduced by the value of the tiles left in their own rack, nobody gains anything.

Either way, `status` becomes `"finished"` and `winnerId` is set to whichever player ends
up with the highest score.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP/Socket.IO listen port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for Socket.IO |
| `FLASK_DEBUG` | `0` | `1` enables Flask's debug/reloader mode (dev only) |

## Known limitations

- `game:start` does not check that the caller is the host — the reference client only
  shows the "Start game" button to the host, but any player in the lobby could call it
  directly. Not a concern for a casual game among friends holding the same room code.
- State is entirely in-memory; restarting the server drops all rooms and games in progress.
