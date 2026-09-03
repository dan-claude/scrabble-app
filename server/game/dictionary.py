from pathlib import Path

_DICT_PATH = Path(__file__).resolve().parent.parent / 'words' / 'dictionary.txt'

with _DICT_PATH.open('r', encoding='utf-8') as _f:
    DICTIONARY = {line.strip() for line in _f if line.strip()}


def is_valid_word(word):
    return word.upper() in DICTIONARY


print(f'[dictionary] loaded {len(DICTIONARY)} words')
