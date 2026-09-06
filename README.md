# Scrabble

A multiplayer Scrabble app. Python (Flask) server, React (Vite) client. The client polls
the server roughly once a second for state — see [Why polling, not WebSockets](#why-polling-not-websockets)
below.

See [API.md](API.md) for the full API reference (every endpoint, payload, and error).

## Features

- Rooms with a shareable 5-character code, 2–4 players
- Full standard Scrabble board (15x15, all bonus squares), tile bag, and letter values
- Server-side move validation: word placement, adjacency/connectivity, dictionary check
  (main word + all crossing words), scoring with letter/word bonuses, blank tiles,
  and the 50-point bingo bonus for using all 7 tiles in one turn
- Pass and tile-exchange actions, end-game detection (empty rack or stalemate) with
  standard rack-value scoring adjustment
- Reconnect support (refreshing the page resumes your seat via a token in localStorage)

## Project layout

```
server/   Flask backend, game engine, bundled dictionary
client/   React (Vite) frontend
```

## Running locally

Two terminals:

```bash
# terminal 1
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

```bash
# terminal 2
cd client
npm install
npm run dev
```

Open the client dev server (printed in terminal 2, typically `http://localhost:5173`).
The Vite dev server proxies `/api` to the backend on port 4000.

## Production build

```bash
npm --prefix client run build   # outputs client/dist
cd server && python app.py      # serves the API and client/dist together
```

Set `PORT` to change the listening port (default `4000`). See
[API.md](API.md#environment-variables) for all server environment variables.

This bundles the client into a static build and serves everything from one Flask
process — fine for playing with friends on a LAN. It is **not** the same as a
hardened production deployment; see below if you're running this somewhere beyond
that.

## Production deployment

Run it under gunicorn instead of `python app.py` directly:

```bash
gunicorn --worker-class gthread --threads 8 -w 1 -b 0.0.0.0:4000 app:app
```

**`-w 1` (a single worker) is required, not just a suggestion.** Game state (`rooms`
inside `RoomManager`) is plain in-process Python state — every worker process would have
its own independent copy, so a second worker would mean players could land on a room
that only half-exists from their point of view. `--threads 8` (or any number > 1) lets
that one worker handle many concurrent polling clients at once — plain REST requests
under a threaded worker, no async/greenlet library needed at all now that there's no
persistent connection to keep open. This project doesn't currently support scaling
horizontally across multiple worker processes or machines (that would need a shared
store for room state, e.g. Redis, to coordinate across workers — out of scope for now).

Put a real reverse proxy (nginx, Caddy, etc.) in front for TLS if this is reachable
from the open internet; gunicorn itself is only handling the app, not TLS termination.

## Persisting game state across restarts

By default, rooms live only in that one process's memory — a redeploy (a new process
replacing the old one, not just a graceful reload) drops every game in progress, same as
a crash would. Set `PERSISTENCE_BACKEND` to change that:

| `PERSISTENCE_BACKEND` | What it does |
|---|---|
| `none` (default) | Original behavior — no persistence, nothing written or read. |
| `file` | One JSON file per room under `PERSISTENCE_FILE_DIR` (default `server/data/rooms`). Simple, no extra infrastructure — but only useful if that directory's disk actually survives a redeploy, which is true on a plain VPS and generally **not** true on most PaaS platforms unless you've attached a persistent volume there. |
| `redis` | One JSON value per room in Redis, at the URL in `REDIS_URL` (default `redis://localhost:6379/0`). Works anywhere, including a PaaS with an ephemeral filesystem, since the state lives in Redis instead of your app's container — most of those platforms offer a Redis add-on. |

Either way, every room is saved after each action that changes it (join, start, place,
pass, exchange) and all saved rooms are reloaded the moment the process starts back up —
so a deploy just picks up exactly where the old process left off, including everyone's
racks, the bag, and the move log. See [API.md](API.md#environment-variables) for the
full env var list.

## Why polling, not WebSockets?

Earlier versions of this app used Flask-SocketIO (WebSocket, with long-polling
fallback) to push state updates to every player instantly. That's genuinely nicer for a
fast-paced real-time game, but Scrabble is turn-based and nobody's staring at the screen
waiting for a millisecond-level update — a ~1 second delay before you see an opponent's
move is unnoticeable in practice. Trading that imperceptible latency for a plain REST
API removes an entire layer of complexity: no persistent-connection async worker
(gevent/eventlet) in production, no separate reconnect/disconnect event handling, no
Socket.IO client library, and a presence model ("is this player still around?") that
falls out of request recency for free instead of needing explicit connect/disconnect
bookkeeping. See [API.md](API.md#presence) for how presence and room cleanup work under
polling.

## Notes

- Game state is in-memory only by default — restarting the server clears active games
  unless you've turned on persistence (see above).
- The dictionary is derived from an open English word list, filtered to alphabetic
  words up to 15 letters (~270k words), bundled at `server/words/dictionary.txt`.
