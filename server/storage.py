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
    there's nothing to load, so the app starts exactly as it always has."""

    def save_room(self, code, data):
        pass

    def delete_room(self, code):
        pass

    def load_all(self):
        return {}


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


class RedisStore:
    """One JSON string per room in Redis, under `key_prefix + room_code`."""

    def __init__(self, url, key_prefix='scrabble:room:'):
        import redis  # imported lazily so NullStore/FileStore don't require it installed
        self.client = redis.Redis.from_url(url, decode_responses=True)
        self.key_prefix = key_prefix

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
