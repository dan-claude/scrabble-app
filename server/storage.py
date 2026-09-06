"""Pluggable persistence for room state, so an in-progress game survives a
server restart/redeploy instead of vanishing with the process's memory.

Selected via the PERSISTENCE_BACKEND environment variable (see app.py):
  - "none"  (default) - no persistence; identical to the original in-memory-
             only behavior. Nothing is written or read.
  - "file"  - one JSON file per room on local disk. Simple, zero extra
             infrastructure; only useful if that disk survives a redeploy
             (true on a plain VPS, generally NOT true on most PaaS platforms
             unless you've attached a persistent volume).
  - "redis" - one JSON string per room in Redis, keyed by room code. Works
             on any host, including PaaS platforms with an ephemeral
             filesystem, as long as you point it at a Redis instance whose
             own storage does survive your app's redeploys.

Either backend just needs to support three operations - save one room,
delete one room, and load everything back at startup - so RoomManager only
ever talks to this narrow interface, never to a specific backend directly.
"""

import json
import os
from pathlib import Path


class NullStore:
    """The default: persistence turned off. save/delete are no-ops, and
    there's nothing to load, so the app starts exactly as it always has.
    Finished-game history is coupled to the same setting - with persistence
    off, no history is kept either, so there's no surprise file/connection
    created behind your back in the default (e.g. local dev) configuration."""

    def save_room(self, code, data):
        pass

    def delete_room(self, code):
        pass

    def load_all(self):
        return {}

    def append_finished_game(self, record):
        pass

    def list_finished_games(self, limit=100):
        return []


class FileStore:
    """One JSON file per room under `directory`, named `<code>.json`.

    Writes are atomic (write to a temp file, then os.replace over the real
    path) so a crash mid-write can't leave a half-written, unparseable file
    behind - worst case you lose only the update that was in flight, never
    corrupt a previously-good save.
    """

    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        # One append-only JSON-Lines file, kept alongside (not inside) the
        # per-room directory so it doesn't get mistaken for a room file.
        self._history_path = self.directory.parent / 'finished_games.jsonl'

    def _path(self, code):
        return self.directory / f'{code}.json'

    def save_room(self, code, data):
        path = self._path(code)
        tmp_path = path.with_suffix('.json.tmp')
        with open(tmp_path, 'w') as f:
            json.dump(data, f)
        os.replace(tmp_path, path)

    def delete_room(self, code):
        try:
            self._path(code).unlink()
        except FileNotFoundError:
            pass

    def load_all(self):
        rooms = {}
        for path in self.directory.glob('*.json'):
            try:
                with open(path) as f:
                    data = json.load(f)
            except (OSError, ValueError):
                continue  # skip a file that's missing or corrupt; don't crash startup over it
            rooms[data['room_code']] = data
        return rooms

    def append_finished_game(self, record):
        # A plain append is safe for concurrent writers here: each line is
        # far under PIPE_BUF, so POSIX guarantees the write() itself doesn't
        # interleave with another thread's, even without a separate lock.
        with open(self._history_path, 'a') as f:
            f.write(json.dumps(record) + '\n')

    def list_finished_games(self, limit=100):
        if not self._history_path.exists():
            return []
        games = []
        with open(self._history_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    games.append(json.loads(line))
                except ValueError:
                    continue  # skip a corrupt line rather than fail the whole read
        return games[-limit:][::-1]  # most recent first


class RedisStore:
    """One JSON string per room in Redis, under `key_prefix + room_code`,
    plus a single capped list holding finished-game history."""

    HISTORY_MAX_ENTRIES = 5000  # bound Redis memory use; a file has no such cap, disk is cheap

    def __init__(self, url, key_prefix='scrabble:room:', history_key='scrabble:history'):
        import redis  # imported lazily so NullStore/FileStore don't require it installed
        self.client = redis.Redis.from_url(url, decode_responses=True)
        self.key_prefix = key_prefix
        self.history_key = history_key

    def _key(self, code):
        return f'{self.key_prefix}{code}'

    def save_room(self, code, data):
        self.client.set(self._key(code), json.dumps(data))

    def delete_room(self, code):
        self.client.delete(self._key(code))

    def load_all(self):
        rooms = {}
        for key in self.client.scan_iter(match=f'{self.key_prefix}*'):
            raw = self.client.get(key)
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                continue  # skip a corrupt entry rather than crash startup over it
            rooms[data['room_code']] = data
        return rooms

    def append_finished_game(self, record):
        self.client.rpush(self.history_key, json.dumps(record))
        self.client.ltrim(self.history_key, -self.HISTORY_MAX_ENTRIES, -1)

    def list_finished_games(self, limit=100):
        raw_entries = self.client.lrange(self.history_key, -limit, -1)
        games = []
        for raw in raw_entries:
            try:
                games.append(json.loads(raw))
            except ValueError:
                continue
        return games[::-1]  # most recent first


def build_store_from_env(base_dir):
    """Construct the store selected by PERSISTENCE_BACKEND (default "none")."""
    backend = os.environ.get('PERSISTENCE_BACKEND', 'none').strip().lower()
    if backend == 'file':
        directory = os.environ.get('PERSISTENCE_FILE_DIR', str(Path(base_dir) / 'data' / 'rooms'))
        return FileStore(directory)
    if backend == 'redis':
        url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
        return RedisStore(url)
    return NullStore()
