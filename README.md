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

## Notes

- Game state is in-memory only (per server process) — restarting the server clears
  active games.
- The dictionary is derived from an open English word list, filtered to alphabetic
  words up to 15 letters (~270k words), bundled at `server/words/dictionary.txt`.
- The Python server uses Flask's built-in development server (via
  `flask_socketio.SocketIO.run`), which is fine for a game among friends but isn't a
  production WSGI server. For real deployment, run it behind `eventlet` or `gunicorn`
  with an eventlet/gevent worker.
