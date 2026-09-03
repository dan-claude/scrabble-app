BOARD_SIZE = 15
CENTER = 7

# Standard Scrabble premium square coordinates (0-indexed).
TRIPLE_WORD = [
    (0, 0), (0, 7), (0, 14),
    (7, 0), (7, 14),
    (14, 0), (14, 7), (14, 14),
]

DOUBLE_WORD = [
    (1, 1), (2, 2), (3, 3), (4, 4),
    (1, 13), (2, 12), (3, 11), (4, 10),
    (13, 1), (12, 2), (11, 3), (10, 4),
    (13, 13), (12, 12), (11, 11), (10, 10),
    (7, 7),
]

TRIPLE_LETTER = [
    (1, 5), (1, 9),
    (5, 1), (5, 5), (5, 9), (5, 13),
    (9, 1), (9, 5), (9, 9), (9, 13),
    (13, 5), (13, 9),
]

DOUBLE_LETTER = [
    (0, 3), (0, 11),
    (2, 6), (2, 8),
    (3, 0), (3, 7), (3, 14),
    (6, 2), (6, 6), (6, 8), (6, 12),
    (7, 3), (7, 11),
    (8, 2), (8, 6), (8, 8), (8, 12),
    (11, 0), (11, 7), (11, 14),
    (12, 6), (12, 8),
    (14, 3), (14, 11),
]


def create_bonus_grid():
    grid = [[None] * BOARD_SIZE for _ in range(BOARD_SIZE)]
    for coords, label in (
        (TRIPLE_WORD, 'TW'),
        (DOUBLE_WORD, 'DW'),
        (TRIPLE_LETTER, 'TL'),
        (DOUBLE_LETTER, 'DL'),
    ):
        for r, c in coords:
            grid[r][c] = label
    return grid


def create_empty_board():
    return [[None] * BOARD_SIZE for _ in range(BOARD_SIZE)]
