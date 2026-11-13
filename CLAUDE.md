# Claude guidance for this project

## Always update API.md

Any change that adds, removes, or modifies an API endpoint — player-facing or admin —
must include an API.md update in the same commit. This includes new fields on existing
response shapes (e.g. adding a field to `PlayerView`).

## Commit and push directly to main

There are no pull requests on this project. Commit and push with:
```
git push origin HEAD:main
```

## Stack

- **Server:** Python / Flask (`server/`). No TypeScript. Game logic in `server/game/`.
  Notification plugin architecture in `server/notification_plugins/`.
- **Client:** React + Vite (`client/src/`). Plain JS/JSX, no TypeScript.
- **Persistence:** opt-in via `PERSISTENCE_BACKEND` env var (`none` / `file` / `redis`).
- **Architecture:** polling (not WebSockets) — the client hits `GET /api/rooms/<code>/state`
  every ~1s. Single gunicorn worker required (in-memory game state).

## Running locally

```bash
# terminal 1 — server
cd server && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python app.py

# terminal 2 — client
cd client && npm install && npm run dev
```

Client dev server proxies `/api` to the backend on port 4000.
In dev, the admin page is at `http://localhost:4000/admin` (not the Vite port).
