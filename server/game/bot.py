"""
Greedy Scrabble bot. Finds the highest-scoring valid placement for the
current player by scanning every row and column for words that can be
formed from the bot's rack + letters already on the board.

Algorithm:
  1. Pre-filter the dictionary to words makeable from (rack + all board letters).
  2. For each candidate word, try every valid position in every row/column.
  3. Score valid placements using the game's own scoring helpers (read-only).
  4. Return the highest-scoring placement, or fall back to exchange/pass.
"""

import os
from collections import Counter

from .board import BOARD_SIZE, CENTER
from .dictionary import DICTIONARY
from .tiles import letter_value

BOT_NAME = 'Bot'


def make_bot_token():
    return 'bot_' + os.urandom(12).hex()


def find_best_move(game):
    """
    Return one of:
      {'action': 'place', 'placements': [...]}
      {'action': 'exchange', 'letters': [...]}
      {'action': 'pass'}
    """
    player = game.current_player
    rack = list(player.rack)
    is_first = game._is_board_empty()

    best_placements = None
    best_score = -1

    for placements, score in _all_valid_placements(game, rack, is_first):
        if score > best_score:
            best_score = score
            best_placements = placements

    if best_placements:
        return {'action': 'place', 'placements': best_placements}

    if game.bag:
        return {'action': 'exchange', 'letters': rack}

    return {'action': 'pass'}


# ---------------------------------------------------------------------------
# Placement search
# ---------------------------------------------------------------------------

def _all_valid_placements(game, rack, is_first):
    # Pre-filter dictionary: only words whose required letters are a subset of
    # (rack + every letter currently on the board). Blanks cover anything.
    board_letters = Counter(
        cell['letter']
        for row in game.board for cell in row if cell
    )
    rack_counter = Counter(rack)
    blank_count = rack_counter.get('#', 0)
    available = rack_counter + board_letters  # combined pool (over-approximation)

    candidates = []
    for word in DICTIONARY:
        if len(word) < 2 or len(word) > BOARD_SIZE:
            continue
        wc = Counter(word)
        deficit = 0
        for letter, count in wc.items():
            deficit += max(0, count - available.get(letter, 0))
        if deficit <= blank_count:
            candidates.append(word)

    for direction in ('h', 'v'):
        for line_idx in range(BOARD_SIZE):
            yield from _search_line(game, rack, candidates, line_idx, direction, is_first)


def _search_line(game, rack, candidates, line_idx, direction, is_first):
    if direction == 'h':
        fixed_on_line = {c: game.board[line_idx][c] for c in range(BOARD_SIZE) if game.board[line_idx][c]}
    else:
        fixed_on_line = {r: game.board[r][line_idx] for r in range(BOARD_SIZE) if game.board[r][line_idx]}

    # Anchor positions: empty squares adjacent to filled ones (or center for first move).
    anchors = set()
    if is_first:
        if line_idx == CENTER:
            anchors.add(CENTER)
    else:
        for pos in range(BOARD_SIZE):
            if pos in fixed_on_line:
                continue
            r, c = (line_idx, pos) if direction == 'h' else (pos, line_idx)
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < BOARD_SIZE and 0 <= nc < BOARD_SIZE and game.board[nr][nc]:
                    anchors.add(pos)
                    break

    if not anchors:
        return

    rack_counter = Counter(rack)
    blank_count = rack_counter.get('#', 0)

    for word in candidates:
        wlen = len(word)
        for start in range(BOARD_SIZE - wlen + 1):
            end = start + wlen - 1

            # Must cover at least one anchor.
            if not any(start <= a <= end for a in anchors):
                continue

            # Every fixed cell in this span must match the word.
            matches = True
            for pos, cell in fixed_on_line.items():
                if start <= pos <= end and word[pos - start] != cell['letter']:
                    matches = False
                    break
            if not matches:
                continue

            # Build the placements: only cells not already on the board.
            rack_copy = Counter(rack)
            placements = []
            blank_positions = set()
            ok = True
            for i, letter in enumerate(word):
                pos = start + i
                if pos in fixed_on_line:
                    continue  # already on board
                if rack_copy.get(letter, 0) > 0:
                    rack_copy[letter] -= 1
                    placements.append({'row': line_idx if direction == 'h' else pos,
                                       'col': pos if direction == 'h' else line_idx,
                                       'letter': letter, 'isBlank': False})
                elif rack_copy.get('#', 0) > 0:
                    rack_copy['#'] -= 1
                    blank_positions.add(i)
                    placements.append({'row': line_idx if direction == 'h' else pos,
                                       'col': pos if direction == 'h' else line_idx,
                                       'letter': letter, 'isBlank': True})
                else:
                    ok = False
                    break
            if not ok or not placements:
                continue

            score = _score_placement(game, placements, is_first)
            if score >= 0:
                yield placements, score


# ---------------------------------------------------------------------------
# Non-mutating scoring / validation
# ---------------------------------------------------------------------------

def _score_placement(game, placements, is_first):
    """Score a placement without mutating the game. Returns -1 if invalid."""
    placement_map = {(p['row'], p['col']): p for p in placements}

    def overlay(r, c):
        placed = placement_map.get((r, c))
        if placed:
            return {'letter': placed['letter'], 'isBlank': placed['isBlank'], 'isNew': True}
        existing = game.board[r][c]
        if existing:
            return {**existing, 'isNew': False}
        return None

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
        return -1

    # Gather main word.
    if orientation == 'horizontal':
        row = next(iter(rows))
        sorted_cols = sorted(cols)
        start, end = sorted_cols[0], sorted_cols[-1]
        for c in range(start, end + 1):
            if not overlay(row, c):
                return -1  # gap
        while start > 0 and overlay(row, start - 1):
            start -= 1
        while end < BOARD_SIZE - 1 and overlay(row, end + 1):
            end += 1
        main_cells = [(row, c) for c in range(start, end + 1)]
    elif orientation == 'vertical':
        col = next(iter(cols))
        sorted_rows = sorted(rows)
        start, end = sorted_rows[0], sorted_rows[-1]
        for r in range(start, end + 1):
            if not overlay(r, col):
                return -1
        while start > 0 and overlay(start - 1, col):
            start -= 1
        while end < BOARD_SIZE - 1 and overlay(end + 1, col):
            end += 1
        main_cells = [(r, col) for r in range(start, end + 1)]
    else:
        pr, pc = placements[0]['row'], placements[0]['col']
        h_cells = _extend_line(pr, pc, 'horizontal', overlay)
        v_cells = _extend_line(pr, pc, 'vertical', overlay)
        main_cells = h_cells if len(h_cells) >= len(v_cells) else v_cells
        orientation = 'horizontal' if len(h_cells) >= len(v_cells) else 'vertical'

    if is_first:
        if not any(r == CENTER and c == CENTER for r, c in main_cells):
            return -1

    if not is_first:
        touches = any(
            any(
                0 <= r + dr < BOARD_SIZE and 0 <= c + dc < BOARD_SIZE and game.board[r + dr][c + dc]
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))
            )
            for r, c in [(p['row'], p['col']) for p in placements]
        )
        if not touches and len(main_cells) == len(placements):
            return -1

    # Gather and validate all words formed.
    words = []
    if len(main_cells) > 1:
        w = _build_word(main_cells, overlay)
        if not _is_valid_word(w['text']):
            return -1
        words.append(w)

    cross_orientation = 'vertical' if orientation == 'horizontal' else 'horizontal'
    for p in placements:
        cross_cells = _extend_line(p['row'], p['col'], cross_orientation, overlay)
        if len(cross_cells) > 1:
            w = _build_word(cross_cells, overlay)
            if not _is_valid_word(w['text']):
                return -1
            words.append(w)

    if not words:
        return -1

    total = sum(_score_word(game.bonus_grid, w) for w in words)
    if len(placements) == 7:  # bingo
        from .game import BINGO_BONUS
        total += BINGO_BONUS
    return total


def _extend_line(row, col, orientation, overlay):
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


def _build_word(cells, overlay):
    tiles = [overlay(r, c) for r, c in cells]
    return {'text': ''.join(t['letter'] for t in tiles), 'cells': cells, 'tiles': tiles}


def _score_word(bonus_grid, word):
    word_multiplier = 1
    total = 0
    for (r, c), tile in zip(word['cells'], word['tiles']):
        base = 0 if tile['isBlank'] else letter_value(tile['letter'])
        if tile['isNew']:
            bonus = bonus_grid[r][c]
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


def _is_valid_word(word):
    return word in DICTIONARY
