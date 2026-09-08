import secrets
import time

from game.game import Game, GameError  # noqa: F401  (re-exported for convenience)
from storage import NullStore

ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
ROOM_CODE_LENGTH = 5
MAX_ROOMS = 1000  # hard cap on concurrent rooms, so a creation flood can't exhaust memory
IDLE_ROOM_SECONDS = 6 * 60 * 60  # reap rooms with no game activity for this long
ABANDONED_ROOM_SECONDS = 120  # reap rooms nobody has polled in this long (everyone left)


def _generate_room_code():
    return ''.join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


class RoomManager:
    def __init__(self, store=None):
        self.rooms = {}  # room_code -> Game
        self.store = store or NullStore()

    def load_from_store(self):
        """Reconstruct every room the store has on disk/in Redis. Call this
        once at startup, before serving any requests, so a redeploy resumes
        games in progress instead of losing them with the old process."""
        restored = 0
        for code, data in self.store.load_all().items():
            try:
                self.rooms[code] = Game.from_dict(data)
                restored += 1
            except Exception:
                continue  # skip a room that fails to reconstruct rather than crash startup
        return restored

    def create_room(self):
        if len(self.rooms) >= MAX_ROOMS:
            raise GameError('Server is at capacity right now — please try again in a bit.')
        code = _generate_room_code()
        while code in self.rooms:
            code = _generate_room_code()
        game = Game(code)
        self.rooms[code] = game
        return game

    def get_room(self, code):
        return self.rooms.get((code or '').upper())

    def persist(self, game):
        """Save a room's full state after a mutating action. A no-op unless
        a real store (file/redis) was configured - see storage.py."""
        self.store.save_room(game.room_code, game.to_dict())

    def delete_room(self, code):
        """Force-remove a room right now (the admin API's manual override,
        as opposed to the two time-based reaps below)."""
        self.rooms.pop(code, None)
        self.store.delete_room(code)

    def record_finished_game(self, game):
        """Append a small permanent summary once a game ends - independent
        of the room itself, which still gets reaped like any other room once
        everyone leaves. A no-op unless persistence is configured (see
        storage.py: history is coupled to PERSISTENCE_BACKEND)."""
        self.store.append_finished_game({
            'roomCode': game.room_code,
            'createdAt': game.created_at,
            'startedAt': game.started_at,
            'finishedAt': game.finished_at,
            'endReason': game.end_reason,
            'winnerId': game.winner_id,
            'players': [
                {'id': p.id, 'name': p.name, 'score': p.score}
                for p in game.players
            ],
            'moveCount': sum(1 for e in game.log if e.get('type') == 'move'),
            'passCount': sum(1 for e in game.log if e.get('type') == 'pass'),
            'exchangeCount': sum(1 for e in game.log if e.get('type') == 'exchange'),
        })

    def list_finished_games(self, limit=100):
        return self.store.list_finished_games(limit)

    def reap_abandoned_rooms(self, max_stale_seconds=ABANDONED_ROOM_SECONDS):
        """Remove rooms where everyone - players and spectators alike - has
        stopped polling for state (tab closed, browser killed, etc). There's no
        disconnect event under polling, so this is the only signal that
        everyone has actually left. Spectators count here too, so a room with
        no active players left but someone still watching the final state
        isn't pulled out from under them."""
        now = time.time()
        def is_stale(game):
            participants = [*game.players, *game.spectators]
            if not participants:
                return True
            return all(now - p.last_seen > max_stale_seconds for p in participants)
        stale = [code for code, game in self.rooms.items() if is_stale(game)]
        for code in stale:
            del self.rooms[code]
            self.store.delete_room(code)
        return len(stale)

    def reap_idle_rooms(self, max_idle_seconds=IDLE_ROOM_SECONDS):
        """Remove rooms with no *game* activity for a long time, even if
        someone is still technically polling them (a tab left open forever
        with nobody actually playing). Bounds memory growth independent of
        #reap_abandoned_rooms, which only looks at polling recency."""
        now = time.time()
        stale = [
            code for code, game in self.rooms.items()
            if now - game.last_activity > max_idle_seconds
        ]
        for code in stale:
            del self.rooms[code]
            self.store.delete_room(code)
        return len(stale)
