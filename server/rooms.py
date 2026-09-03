import secrets

from game.game import Game, GameError  # noqa: F401  (re-exported for convenience)

ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
ROOM_CODE_LENGTH = 5


def _generate_room_code():
    return ''.join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


class RoomManager:
    def __init__(self):
        self.rooms = {}  # room_code -> Game

    def create_room(self):
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
