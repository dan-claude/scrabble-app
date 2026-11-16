from pathlib import Path

_WORDS_DIR = Path(__file__).resolve().parent.parent / 'words'
_DEFAULT = 'sowpods'

# Lazily loaded: { name -> frozenset of words }
_loaded = {}


def available_dictionaries():
    """Return sorted list of dictionary names (stems of .txt files in words/)."""
    return sorted(p.stem for p in _WORDS_DIR.glob('*.txt'))


def _load(name):
    if name not in _loaded:
        path = _WORDS_DIR / f'{name}.txt'
        if not path.exists():
            raise ValueError(f'Unknown dictionary: {name!r}')
        with path.open('r', encoding='utf-8') as f:
            words = frozenset(line.strip().upper() for line in f if line.strip())
        _loaded[name] = words
        print(f'[dictionary] loaded {len(words)} words from {name}.txt')
    return _loaded[name]


def is_valid_word(word, dictionary=_DEFAULT):
    return word.upper() in _load(dictionary)


def default_dictionary():
    return _DEFAULT
