import secrets
import time

from game.game import Game, GameError  # noqa: F401  (re-exported for convenience)

ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
ROOM_CODE_LENGTH = 5
MAX_ROOMS = 1000  # hard cap on concurrent rooms, so a creation flood can't exhaust memory
IDLE_ROOM_SECONDS = 6 * 60 * 60  # reap rooms idle this long, even if a socket never disconnected


def _generate_room_code():
    return ''.join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


class RoomManager:
    def __init__(self):
        self.rooms = {}  # room_code -> Game

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

    def remove_if_empty(self, code):
        game = self.rooms.get(code)
        if game and all(not p.connected for p in game.players):
            del self.rooms[code]

    def reap_idle_rooms(self, max_idle_seconds=IDLE_ROOM_SECONDS):
        """Remove rooms with no activity for a long time, even if every socket
        in them technically never disconnected (laptop closed mid-game, a tab
        left open forever, etc). Bounds memory growth independent of #remove_if_empty."""
        now = time.time()
        stale = [
            code for code, game in self.rooms.items()
            if now - game.last_activity > max_idle_seconds
        ]
        for code in stale:
            del self.rooms[code]
        return len(stale)
