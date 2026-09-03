# Scrabble

A real-time multiplayer Scrabble app. Node/Express + Socket.IO server, React (Vite) client.

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
server/   Express + Socket.IO backend, game engine, bundled dictionary
client/   React (Vite) frontend
```

## Running locally

Two terminals:

```bash
# terminal 1
cd server
npm install
npm run dev
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
npm --prefix server run start   # serves the API, sockets, and client/dist together
```

Set `PORT` to change the listening port (default `4000`).

## Notes

- Game state is in-memory only (per server process) — restarting the server clears
  active games.
- The dictionary is derived from an open English word list, filtered to alphabetic
  words up to 15 letters (~270k words), bundled at `server/words/dictionary.txt`.
