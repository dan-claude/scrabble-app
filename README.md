# Scrabble

A real-time multiplayer Scrabble app. Python (Flask + Flask-SocketIO) server, React
(Vite) client.

See [API.md](API.md) for the full API reference (REST endpoints and every Socket.IO
event, payload, and error).

## Features

- Rooms with a shareable 5-character code, 2–4 players
- Full standard Scrabble board (15x15, all bonus squares), tile bag, and letter values
- Server-side move validation: word placement, adjacency/connectivity, dictionary check
  (main word + all crossing words), scoring with letter/word bonuses, blank tiles,
  and the 50-point bingo bonus for using all 7 tiles in one turn
- Pass and tile-exchange actions, end-game detection (empty rack or stalemate) with
  standard rack-value scoring adjustment
- Reconnect support (refreshing the page rejoins your seat via a token in localStorage)

## Project layout

```
server/   Flask + Flask-SocketIO backend, game engine, bundled dictionary
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
The Vite dev server proxies `/socket.io` and `/api` to the backend on port 4000.

## Production build

```bash
npm --prefix client run build   # outputs client/dist
cd server && python app.py      # serves the API, sockets, and client/dist together
```

Set `PORT` to change the listening port (default `4000`). See
[API.md](API.md#environment-variables) for all server environment variables.

This bundles the client into a static build and serves everything from one Flask
process — fine for playing with friends on a LAN. It is **not** the same as a
hardened production deployment; see below if you're running this somewhere beyond
that.

## Production deployment

`requirements.txt` includes `gevent` and `gunicorn`. As long as `gevent` is
installed, `python app.py` itself already upgrades automatically: `app.py`
monkey-patches gevent as the very first thing it does, which makes
Flask-SocketIO pick gevent's async server instead of Flask's single-threaded
development server, with no other changes needed. (`eventlet` would be the
other classic choice here, but gunicorn dropped its eventlet worker in 26.0 and
eventlet itself is no longer actively maintained, so this project uses gevent.)

For a real deployment, run it under gunicorn with the gevent worker instead of
`python app.py` directly:

```bash
gunicorn -k gevent -w 1 -b 0.0.0.0:4000 app:app
```

**`-w 1` (a single worker) is required, not just a suggestion.** Game state
(`rooms`, `socket_sessions`) is plain in-process Python state — every worker
process would have its own independent copy, so a second worker would mean
players could land on a room that only half-exists from their point of view.
A single gevent worker still comfortably handles many concurrent games via
greenlets; this project doesn't currently support scaling horizontally across
multiple worker processes or machines (that would need a shared store for room
state and a Socket.IO message queue, e.g. Redis, to coordinate broadcasts across
workers — out of scope for now).

Put a real reverse proxy (nginx, Caddy, etc.) in front for TLS if this is reachable
from the open internet; gunicorn itself is only handling the app, not TLS termination.

## Notes

- Game state is in-memory only (per server process) — restarting the server clears
  active games.
- The dictionary is derived from an open English word list, filtered to alphabetic
  words up to 15 letters (~270k words), bundled at `server/words/dictionary.txt`.
- Without `gevent` installed, the server falls back to Flask's built-in
  development server, which is fine for a game among friends but isn't meant
  for untrusted/production traffic on its own — see "Production deployment"
  above.
