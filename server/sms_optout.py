"""SMS opt-out table.

Keyed by normalised phone number (digits + leading +).  An entry is True
when the number has opted out.  Persisted to the same backend the rest of
the app uses (PERSISTENCE_BACKEND env var):

  - "redis" → Redis hash  scrabble:sms_optouts
  - "file"  → JSON file   <PERSISTENCE_FILE_DIR>/../sms_optouts.json
  - "none"  → in-memory only (data lost on restart; fine for local dev)
"""

import json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_optouts: dict[str, bool] = {}
_redis_client = None
_file_path: Path | None = None

_REDIS_HASH = 'scrabble:sms_optouts'


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def normalize(phone: str) -> str:
    """Strip formatting — keep digits and a leading +."""
    return re.sub(r'[^\d+]', '', phone.strip()).lstrip('+').replace('+', '', 999)


def normalize_e164(phone: str) -> str:
    """Keep + prefix if present, strip other non-digit chars."""
    cleaned = re.sub(r'[^\d+]', '', phone.strip())
    return cleaned


# ---------------------------------------------------------------------------
# Init (call once at startup)
# ---------------------------------------------------------------------------

def init(store):
    """Load the opt-out table using the same persistence backend as `store`."""
    global _redis_client, _file_path

    backend = os.environ.get('PERSISTENCE_BACKEND', 'none').strip().lower()

    if backend == 'redis':
        try:
            import redis as _redis_mod
            url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
            _redis_client = _redis_mod.Redis.from_url(url, decode_responses=True)
            _load_from_redis()
        except Exception:
            logger.exception('SMS opt-out: failed to connect to Redis; falling back to in-memory')

    elif backend == 'file':
        try:
            file_dir = os.environ.get(
                'PERSISTENCE_FILE_DIR',
                str(Path(os.path.dirname(__file__)) / 'data' / 'rooms'),
            )
            _file_path = Path(file_dir).parent / 'sms_optouts.json'
            _load_from_file()
        except Exception:
            logger.exception('SMS opt-out: failed to open file store; falling back to in-memory')

    else:
        logger.info('SMS opt-out: using in-memory store (data lost on restart)')


# ---------------------------------------------------------------------------
# Internal load / save
# ---------------------------------------------------------------------------

def _load_from_redis():
    global _optouts
    try:
        data = _redis_client.hgetall(_REDIS_HASH)
        _optouts = {k: v == '1' for k, v in data.items()}
        logger.info('SMS opt-out: loaded %d entries from Redis', len(_optouts))
    except Exception:
        logger.exception('SMS opt-out: failed to load from Redis')


def _load_from_file():
    global _optouts
    if _file_path and _file_path.exists():
        try:
            _optouts = json.loads(_file_path.read_text())
            logger.info('SMS opt-out: loaded %d entries from %s', len(_optouts), _file_path)
        except Exception:
            logger.exception('SMS opt-out: failed to load from file %s', _file_path)


def _save():
    if _redis_client:
        try:
            pipe = _redis_client.pipeline()
            pipe.delete(_REDIS_HASH)
            if _optouts:
                pipe.hset(_REDIS_HASH, mapping={k: '1' if v else '0' for k, v in _optouts.items()})
            pipe.execute()
        except Exception:
            logger.exception('SMS opt-out: failed to save to Redis')
    elif _file_path:
        try:
            _file_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = _file_path.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(_optouts))
            tmp.replace(_file_path)
        except Exception:
            logger.exception('SMS opt-out: failed to save to file %s', _file_path)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def is_opted_out(phone: str) -> bool:
    return bool(_optouts.get(normalize_e164(phone)))


def set_opted_out(phone: str, opted_out: bool):
    key = normalize_e164(phone)
    if opted_out:
        _optouts[key] = True
    else:
        _optouts.pop(key, None)
    _save()
    logger.info('SMS opt-out: %s → opted_out=%s', key, opted_out)


def get_all() -> list[dict]:
    """Return all tracked numbers with their opt-out status."""
    return [{'phone': phone, 'optedOut': opted_out} for phone, opted_out in sorted(_optouts.items())]
