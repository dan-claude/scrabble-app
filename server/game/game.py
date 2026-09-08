import random
import re
import time

from .board import BOARD_SIZE, CENTER, create_bonus_grid, create_empty_board
from .dictionary import is_valid_word
from .tiles import create_tile_bag, letter_value

MAX_RACK = 7
BINGO_BONUS = 50
MIN_PLAYERS = 2
MAX_PLAYERS = 4  # standard 100-tile Scrabble set gets thin past this
MAX_SPECTATORS = 20  # generous cap; just guards against unbounded growth from abuse
CONNECTED_TIMEOUT_SECONDS = 6  # no persistent connection under polling, so
# "connected" is just "has polled recently" (the client polls every ~1s)

_LETTER_RE = re.compile(r'^[A-Z]$')


class GameError(Exception):
    """Raised for any rule violation; the message is safe to show the player."""


class Player:
    __slots__ = ('id', 'name', 'rack', 'score', 'last_seen', 'notification_setup')
    is_spectator = False

    def __init__(self, token, name):
        self.id = token
        self.name = name
        self.rack = []
        self.score = 0
        self.last_seen = time.time()
        # {pluginId: {fieldKey: value}} - see notification_plugins/__init__.py.
        # Only ever written via sanitize_setup(), so every key/value here is
        # already known-safe by the time it lands on this object.
        self.notification_setup = {}

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'rack': list(self.rack),
            'score': self.score,
            'last_seen': self.last_seen,
            'notification_setup': dict(self.notification_setup),
        }

    @classmethod
    def from_dict(cls, data):
        player = cls(data['id'], data['name'])
        player.rack = list(data.get('rack', []))
        player.score = data.get('score', 0)
        player.last_seen = data.get('last_seen', time.time())
        player.notification_setup = dict(data.get('notification_setup', {}))
        return player


class Spectator:
    """Someone viewing a room they joined after it left the lobby - no rack,
    no score, no turn, just a read-only look at the same State object every
    active player gets (see Game.join / Game._add_spectator)."""

    __slots__ = ('id', 'name', 'last_seen')
    is_spectator = True

    def __init__(self, token, name):
        self.id = token
        self.name = name
        self.last_seen = time.time()

    def to_dict(self):
        return {'id': self.id, 'name': self.name, 'last_seen': self.last_seen}

    @classmethod
    def from_dict(cls, data):
        spectator = cls(data['id'], data['name'])
        spectator.last_seen = data.get('last_seen', time.time())
        return spectator


class Game:
    def __init__(self, room_code):
        self.room_code = room_code
        self.status = 'lobby'  # lobby | playing | finished
        self.board = create_empty_board()
        self.bonus_grid = create_bonus_grid()
        self.bag = create_tile_bag()
        self.players = []  # list[Player]
        self.spectators = []  # list[Spectator] - joined after lobby, read-only
        self.turn_index = 0
        self.consecutive_passes = 0
        self.log = []
        self.host_id = None
        self.winner_id = None
        self.last_activity = time.time()
        self.created_at = time.time()
        self.started_at = None    # set when start() is called
        self.finished_at = None   # set when the game ends
        self.end_reason = None    # 'went_out' | 'stalemate', set when the game ends

    # -- membership -----------------------------------------------------

    def add_player(self, token, name):
        if self.status != 'lobby':
            raise GameError('Game already in progress.')
        if len(self.players) >= MAX_PLAYERS:
            raise GameError(f'Room is full ({MAX_PLAYERS} players max).')
        if any(p.name.lower() == name.lower() for p in self.players):
            raise GameError('That name is already taken in this room.')
        player = Player(token, name)
        self.players.append(player)
        if not self.host_id:
            self.host_id = token
        return player

    def join(self, token, name):
        """Join a room: as an active player while it's still in the lobby, or as
        a read-only spectator once the game has started (or already finished) -
        see API.md#post-apiroomscodejoin."""
        if self.status == 'lobby':
            return self.add_player(token, name)
        return self._add_spectator(token, name)

    def _add_spectator(self, token, name):
        if len(self.spectators) >= MAX_SPECTATORS:
            raise GameError(f'Too many spectators already watching this game ({MAX_SPECTATORS} max).')
        spectator = Spectator(token, name)
        self.spectators.append(spectator)
        return spectator

    def get_player(self, token):
        return next((p for p in self.players if p.id == token), None)

    def get_spectator(self, token):
        return next((s for s in self.spectators if s.id == token), None)

    def get_participant(self, token):
        """Either kind of person in this room, active player or spectator -
        for routes (state polling) that don't need to tell them apart."""
        return self.get_player(token) or self.get_spectator(token)

    def touch(self):
        """Record activity so the idle-room reaper doesn't reclaim this room."""
        self.last_activity = time.time()

    @property
    def current_player(self):
        return self.players[self.turn_index] if self.players else None

    # -- lifecycle --------------------------------------------------------

    def start(self):
        if self.status != 'lobby':
            raise GameError('Game already started.')
        if len(self.players) < MIN_PLAYERS:
            raise GameError(f'Need at least {MIN_PLAYERS} players to start.')
        for player in self.players:
            self._fill_rack(player)
        self.status = 'playing'
        self.turn_index = 0
        self.started_at = time.time()
        self._add_log(type='start', detail='Game started.')

    def _fill_rack(self, player):
        while len(player.rack) < MAX_RACK and self.bag:
            player.rack.append(self.bag.pop())

    def _add_log(self, **entry):
        entry['ts'] = int(time.time() * 1000)
        self.log.append(entry)
        if len(self.log) > 200:
            self.log.pop(0)

    def _advance_turn(self):
        if not self.players:
            return
        self.turn_index = (self.turn_index + 1) % len(self.players)

    def _assert_turn(self, player_id):
        if self.status != 'playing':
            raise GameError('Game is not in progress.')
        player = self.get_player(player_id)
        if not player:
            raise GameError('You are not in this game.')
        if self.current_player.id != player_id:
            raise GameError("It's not your turn.")
        return player

    # -- turn actions -----------------------------------------------------

    def pass_turn(self, player_id):
        player = self._assert_turn(player_id)
        self.consecutive_passes += 1
        self._add_log(type='pass', playerName=player.name, detail='Passed.')
        self._advance_turn()
        self._maybe_end_by_stall()
        return self._public_state()

    def exchange_tiles(self, player_id, letters):
        player = self._assert_turn(player_id)
        if not isinstance(letters, list) or not letters:
            raise GameError('Select at least one tile to exchange.')
        if len(letters) > MAX_RACK:
            raise GameError(f'Cannot exchange more than {MAX_RACK} tiles at once.')
        if not self.bag:
            raise GameError('The bag is empty; you cannot exchange.')
        rack_copy = list(player.rack)
        for letter in letters:
            if letter not in rack_copy:
                raise GameError(f'You don\'t have a "{letter}" tile to exchange.')
            rack_copy.remove(letter)
        for letter in letters:
            player.rack.remove(letter)
            self.bag.append(letter)
        random.shuffle(self.bag)
        self._fill_rack(player)
        self.consecutive_passes += 1
        self._add_log(
            type='exchange', playerName=player.name,
            detail=f'Exchanged {len(letters)} tile(s).',
        )
        self._advance_turn()
        self._maybe_end_by_stall()
        return self._public_state()

    def _maybe_end_by_stall(self):
        if self.status != 'playing':
            return
        threshold = len(self.players) * 2
        if self.consecutive_passes >= threshold:
            self._finish_game(went_out_player_id=None)

    def place_tiles(self, player_id, placements):
        player = self._assert_turn(player_id)
        if not isinstance(placements, list) or not placements:
            raise GameError('No tiles placed.')
        if len(placements) > MAX_RACK:
            raise GameError(f'Cannot place more than {MAX_RACK} tiles in one move.')

        # Normalize & validate bounds / no overlap with existing tiles / no duplicate cells.
        seen = set()
        for p in placements:
            if not isinstance(p, dict):
                raise GameError('Invalid placement.')
            row, col = p.get('row'), p.get('col')
            if not isinstance(row, int) or not isinstance(col, int) or isinstance(row, bool) or isinstance(col, bool):
                raise GameError('Invalid placement.')
            if row < 0 or row >= BOARD_SIZE or col < 0 or col >= BOARD_SIZE:
                raise GameError('Placement out of bounds.')
            key = (row, col)
            if key in seen:
                raise GameError('Duplicate cell in placement.')
            seen.add(key)
            if self.board[row][col]:
                raise GameError('That square is already occupied.')
            letter = p.get('letter')
            if not letter or not isinstance(letter, str) or not _LETTER_RE.match(letter):
                raise GameError('Invalid letter in placement.')

        # Verify rack contains the required tiles.
        rack_copy = list(player.rack)
        for p in placements:
            needed = '#' if p.get('isBlank') else p['letter']
            if needed not in rack_copy:
                raise GameError(f'You don\'t have the tile for "{p["letter"]}".')
            rack_copy.remove(needed)

        is_first_move = self._is_board_empty()

        # Determine orientation.
        rows = {p['row'] for p in placements}
        cols = {p['col'] for p in placements}
        if len(placements) == 1:
            orientation = 'single'
        elif len(rows) == 1:
            orientation = 'horizontal'
        elif len(cols) == 1:
            orientation = 'vertical'
        else:
            raise GameError('Tiles must be placed in a single row or column.')

        placement_map = {(p['row'], p['col']): p for p in placements}

        def overlay(r, c):
            placed = placement_map.get((r, c))
            if placed:
                return {'letter': placed['letter'], 'isBlank': bool(placed.get('isBlank')), 'isNew': True}
            existing = self.board[r][c]
            if existing:
                return {**existing, 'isNew': False}
            return None

        if is_first_move:
            covers_center = any(p['row'] == CENTER and p['col'] == CENTER for p in placements)
            if not covers_center:
                raise GameError('The first word must cover the center square.')

        # Check contiguity (no gaps) along the main line, and gather main word span.
        if orientation == 'horizontal':
            row = next(iter(rows))
            cols_sorted = sorted(p['col'] for p in placements)
            start, end = cols_sorted[0], cols_sorted[-1]
            for c in range(start, end + 1):
                if not overlay(row, c):
                    raise GameError('Placed tiles must be contiguous (no gaps).')
            while start > 0 and overlay(row, start - 1):
                start -= 1
            while end < BOARD_SIZE - 1 and overlay(row, end + 1):
                end += 1
            main_word_cells = [(row, c) for c in range(start, end + 1)]
        elif orientation == 'vertical':
            col = next(iter(cols))
            rows_sorted = sorted(p['row'] for p in placements)
            start, end = rows_sorted[0], rows_sorted[-1]
            for r in range(start, end + 1):
                if not overlay(r, col):
                    raise GameError('Placed tiles must be contiguous (no gaps).')
            while start > 0 and overlay(start - 1, col):
                start -= 1
            while end < BOARD_SIZE - 1 and overlay(end + 1, col):
                end += 1
            main_word_cells = [(r, col) for r in range(start, end + 1)]
        else:
            # Single tile: try both directions; prefer whichever forms a multi-letter word,
            # otherwise treat as horizontal for word-extraction purposes.
            pr, pc = placements[0]['row'], placements[0]['col']
            h_cells = self._extend_line(pr, pc, 'horizontal', overlay)
            v_cells = self._extend_line(pr, pc, 'vertical', overlay)
            if len(h_cells) == 1 and len(v_cells) == 1:
                main_word_cells = h_cells
            elif len(h_cells) > 1:
                main_word_cells = h_cells
            else:
                main_word_cells = v_cells

        # Connectivity: must touch an existing tile unless first move.
        if not is_first_move:
            touches_existing = any(self._has_adjacent_existing(p['row'], p['col']) for p in placements)
            part_of_longer_word = len(main_word_cells) > len(placements)
            if not touches_existing and not part_of_longer_word:
                raise GameError('New tiles must connect to existing tiles on the board.')

        # Gather all words formed (main + any perpendicular words through newly placed tiles).
        words = []
        if len(main_word_cells) > 1:
            words.append(self._build_word(main_word_cells, overlay))

        for p in placements:
            if orientation == 'horizontal':
                cross_orientation = 'vertical'
            elif orientation == 'vertical':
                cross_orientation = 'horizontal'
            else:
                cross_orientation = (
                    'vertical' if main_word_cells[0][0] == main_word_cells[-1][0] else 'horizontal'
                )
            cross_cells = self._extend_line(p['row'], p['col'], cross_orientation, overlay)
            if len(cross_cells) > 1:
                words.append(self._build_word(cross_cells, overlay))

        if not words:
            raise GameError('That does not form a word.')

        # Validate every formed word against the dictionary.
        for w in words:
            if not is_valid_word(w['text']):
                raise GameError(f'"{w["text"]}" is not a valid word.')

        # Score the move.
        total_score = sum(self._score_word(w) for w in words)
        if len(placements) == MAX_RACK:
            total_score += BINGO_BONUS

        # Commit: place tiles on board.
        for p in placements:
            self.board[p['row']][p['col']] = {'letter': p['letter'], 'isBlank': bool(p.get('isBlank'))}
        # Remove used tiles from rack.
        for p in placements:
            needed = '#' if p.get('isBlank') else p['letter']
            player.rack.remove(needed)
        self._fill_rack(player)

        player.score += total_score
        self.consecutive_passes = 0
        self._add_log(
            type='move',
            playerName=player.name,
            detail=f'{", ".join(w["text"] for w in words)} (+{total_score})',
        )

        if not self.bag and not player.rack:
            self._finish_game(went_out_player_id=player.id)
        else:
            self._advance_turn()

        return self._public_state()

    # -- word-geometry helpers ---------------------------------------------

    def _extend_line(self, row, col, orientation, overlay):
        if orientation == 'horizontal':
            start = end = col
            while start > 0 and overlay(row, start - 1):
                start -= 1
            while end < BOARD_SIZE - 1 and overlay(row, end + 1):
                end += 1
            return [(row, c) for c in range(start, end + 1)]
        start = end = row
        while start > 0 and overlay(start - 1, col):
            start -= 1
        while end < BOARD_SIZE - 1 and overlay(end + 1, col):
            end += 1
        return [(r, col) for r in range(start, end + 1)]

    def _has_adjacent_existing(self, row, col):
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            r, c = row + dr, col + dc
            if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE and self.board[r][c]:
                return True
        return False

    def _build_word(self, cells, overlay):
        tiles = [overlay(r, c) for r, c in cells]
        return {
            'text': ''.join(t['letter'] for t in tiles),
            'cells': cells,
            'tiles': tiles,
        }

    def _score_word(self, word):
        word_multiplier = 1
        total = 0
        for (r, c), tile in zip(word['cells'], word['tiles']):
            base = 0 if tile['isBlank'] else letter_value(tile['letter'])
            if tile['isNew']:
                bonus = self.bonus_grid[r][c]
                if bonus == 'DL':
                    total += base * 2
                elif bonus == 'TL':
                    total += base * 3
                else:
                    total += base
                if bonus == 'DW':
                    word_multiplier *= 2
                elif bonus == 'TW':
                    word_multiplier *= 3
            else:
                total += base
        return total * word_multiplier

    def _is_board_empty(self):
        return all(cell is None for row in self.board for cell in row)

    def _finish_game(self, went_out_player_id):
        self.status = 'finished'
        self.finished_at = time.time()
        self.end_reason = 'went_out' if went_out_player_id else 'stalemate'
        leftover_total = 0
        for p in self.players:
            rack_value = sum(letter_value(l) for l in p.rack)
            if p.id == went_out_player_id:
                continue
            p.score -= rack_value
            leftover_total += rack_value
        if went_out_player_id:
            winner = self.get_player(went_out_player_id)
            if winner:
                winner.score += leftover_total
        best = max(self.players, key=lambda p: p.score, default=None)
        self.winner_id = best.id if best else None
        self._add_log(type='end', detail='Game over.')

    # -- serialization ------------------------------------------------------

    def _public_state(self, for_player_id=None):
        now = time.time()
        return {
            'roomCode': self.room_code,
            'status': self.status,
            'minPlayers': MIN_PLAYERS,
            'maxPlayers': MAX_PLAYERS,
            'board': self.board,
            'bonusGrid': self.bonus_grid,
            'bagCount': len(self.bag),
            'turnPlayerId': (
                self.current_player.id if self.status == 'playing' and self.current_player else None
            ),
            'hostId': self.host_id,
            'winnerId': self.winner_id,
            'log': self.log[-50:],
            'players': [
                {
                    'id': p.id,
                    'name': p.name,
                    'score': p.score,
                    'rackCount': len(p.rack),
                    'connected': (now - p.last_seen) < CONNECTED_TIMEOUT_SECONDS,
                    'rack': p.rack if p.id == for_player_id else None,
                }
                for p in self.players
            ],
            # A join after the lobby doesn't create a Player at all (see join()),
            # so "is this response for a spectator" has to be answered by checking
            # the spectator list rather than a flag on a PlayerView.
            'isSpectator': any(s.id == for_player_id for s in self.spectators),
            'spectators': [
                {
                    'id': s.id,
                    'name': s.name,
                    'connected': (now - s.last_seen) < CONNECTED_TIMEOUT_SECONDS,
                }
                for s in self.spectators
            ],
        }

    def state_for(self, player_id):
        return self._public_state(player_id)

    # -- persistence ---------------------------------------------------
    # Captures everything needed to fully reconstruct the game (unlike
    # _public_state, which deliberately hides each player's rack from
    # everyone but themselves). bonus_grid isn't included - it's derived
    # deterministically from BOARD_SIZE, so from_dict just regenerates it
    # via the normal constructor instead of persisting a redundant copy.

    def to_dict(self):
        return {
            'room_code': self.room_code,
            'status': self.status,
            'board': self.board,
            'bag': list(self.bag),
            'players': [p.to_dict() for p in self.players],
            'spectators': [s.to_dict() for s in self.spectators],
            'turn_index': self.turn_index,
            'consecutive_passes': self.consecutive_passes,
            'log': self.log,
            'host_id': self.host_id,
            'winner_id': self.winner_id,
            'last_activity': self.last_activity,
            'created_at': self.created_at,
            'started_at': self.started_at,
            'finished_at': self.finished_at,
            'end_reason': self.end_reason,
        }

    @classmethod
    def from_dict(cls, data):
        game = cls(data['room_code'])
        game.status = data.get('status', 'lobby')
        game.board = data.get('board', game.board)
        game.bag = list(data.get('bag', game.bag))
        game.players = [Player.from_dict(p) for p in data.get('players', [])]
        game.spectators = [Spectator.from_dict(s) for s in data.get('spectators', [])]
        game.turn_index = data.get('turn_index', 0)
        game.consecutive_passes = data.get('consecutive_passes', 0)
        game.log = data.get('log', [])
        game.host_id = data.get('host_id')
        game.winner_id = data.get('winner_id')
        game.last_activity = data.get('last_activity', time.time())
        game.created_at = data.get('created_at', game.created_at)
        game.started_at = data.get('started_at')
        game.finished_at = data.get('finished_at')
        game.end_reason = data.get('end_reason')
        return game
