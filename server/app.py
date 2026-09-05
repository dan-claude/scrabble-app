import os
import threading
import time
from collections import defaultdict, deque
from functools import wraps
from pathlib import Path

from flask import Flask, request, send_from_directory

from game.game import GameError
from rooms import RoomManager

BASE_DIR = Path(__file__).resolve().parent
CLIENT_DIST = BASE_DIR.parent / 'client' / 'dist'

PORT = int(os.environ.get('PORT', 4000))
FLASK_DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'

app = Flask(__name__, static_folder=None)

rooms = RoomManager()

# --- simple per-IP rate limit on room creation (defends against a single
# client flooding room creation to exhaust server memory) ---
ROOM_CREATE_LIMIT = 5
ROOM_CREATE_WINDOW_SECONDS = 60.0
_room_create_log = defaultdict(deque)  # ip -> deque[timestamps within the window]
_room_create_lock = threading.Lock()

# --- periodic sweep: reaps rooms nobody is polling any more (fast check,
# rooms.ABANDONED_ROOM_SECONDS) and rooms that have gone idle for a long time
# even if something is still technically polling them (slow check,
# rooms.IDLE_ROOM_SECONDS). See rooms.py for both thresholds. ---
SWEEP_INTERVAL_SECONDS = 30


class ApiError(Exception):
    """Raised for request-shape/auth problems; carries its own HTTP status.
    (GameError, from the game engine, is always a rule violation -> 400.)"""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Misc / static routes
# ---------------------------------------------------------------------------

@app.get('/api/health')
def health():
    return {'ok': True}


@app.get('/', defaults={'path': ''})
@app.get('/<path:path>')
def serve_client(path):
    """Serve the built React client (production only; see README)."""
    if path.startswith('api/'):
        return {'error': 'not found'}, 404
    target = CLIENT_DIST / path
    if path and target.is_file():
        return send_from_directory(CLIENT_DIST, path)
    return send_from_directory(CLIENT_DIST, 'index.html')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_room_create_rate_limit():
    ip = request.remote_addr or 'unknown'
    now = time.time()
    with _room_create_lock:
        recent = _room_create_log[ip]
        while recent and now - recent[0] > ROOM_CREATE_WINDOW_SECONDS:
            recent.popleft()
        if len(recent) >= ROOM_CREATE_LIMIT:
            raise GameError('Too many rooms created from this connection. Please wait a minute and try again.')
        recent.append(now)


def _sweep_rooms():
    abandoned = rooms.reap_abandoned_rooms()
    idle = rooms.reap_idle_rooms()
    if abandoned or idle:
        app.logger.info('Reaped %d abandoned and %d idle room(s).', abandoned, idle)
    threading.Timer(SWEEP_INTERVAL_SECONDS, _sweep_rooms).start()


def api_route(fn):
    """Wrap a REST view so GameError/ApiError become a JSON {error} response
    with the right status code instead of an uncaught exception."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            result = fn(*args, **kwargs) or {}
            return result, 200
        except GameError as err:
            return {'error': str(err)}, 400
        except ApiError as err:
            return {'error': str(err)}, err.status
        except Exception:
            app.logger.exception('Unhandled error in %s', fn.__name__)
            return {'error': 'Something went wrong.'}, 500
    return wrapper


def _get_room(code):
    game = rooms.get_room(code)
    if not game:
        raise ApiError('Room not found.', 404)
    return game


def _get_player(game, token):
    if not token:
        raise ApiError('Missing token.', 401)
    player = game.get_player(token)
    if not player:
        raise ApiError('Session not found; please join again.', 401)
    player.last_seen = time.time()
    return player


def _body():
    return request.get_json(silent=True) or {}


def _state_response(game, player):
    payload = game.state_for(player.id)
    payload['youId'] = player.id
    return payload


# ---------------------------------------------------------------------------
# Room / gameplay routes — see API.md for the full protocol reference
# ---------------------------------------------------------------------------

@app.post('/api/rooms')
@api_route
def create_room():
    _check_room_create_rate_limit()
    data = _body()
    name = (data.get('playerName') or '').strip()[:20]
    if not name:
        raise GameError('Enter a name.')
    game = rooms.create_room()
    token = os.urandom(16).hex()
    player = game.add_player(token, name)
    game.touch()
    result = _state_response(game, player)
    result['token'] = token
    return result


@app.post('/api/rooms/<code>/join')
@api_route
def join_room(code):
    game = _get_room(code)
    data = _body()
    name = (data.get('playerName') or '').strip()[:20]
    if not name:
        raise GameError('Enter a name.')
    token = os.urandom(16).hex()
    player = game.add_player(token, name)
    game.touch()
    result = _state_response(game, player)
    result['token'] = token
    return result


@app.get('/api/rooms/<code>/state')
@api_route
def room_state(code):
    game = _get_room(code)
    player = _get_player(game, request.args.get('token'))
    return _state_response(game, player)


@app.post('/api/rooms/<code>/start')
@api_route
def start_game(code):
    game = _get_room(code)
    player = _get_player(game, _body().get('token'))
    game.start()
    game.touch()
    return _state_response(game, player)


@app.post('/api/rooms/<code>/place')
@api_route
def place_tiles(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    game.place_tiles(player.id, data.get('placements'))
    game.touch()
    return _state_response(game, player)


@app.post('/api/rooms/<code>/pass')
@api_route
def pass_turn(code):
    game = _get_room(code)
    player = _get_player(game, _body().get('token'))
    game.pass_turn(player.id)
    game.touch()
    return _state_response(game, player)


@app.post('/api/rooms/<code>/exchange')
@api_route
def exchange_tiles(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    game.exchange_tiles(player.id, data.get('letters'))
    game.touch()
    return _state_response(game, player)


threading.Timer(SWEEP_INTERVAL_SECONDS, _sweep_rooms).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=FLASK_DEBUG, threaded=True)
