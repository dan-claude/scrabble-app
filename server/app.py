import hmac
import os
import threading
import time
from collections import defaultdict, deque
from functools import wraps
from pathlib import Path

from flask import Flask, request, send_from_directory

from game.game import GameError
from rooms import RoomManager
from storage import build_store_from_env

BASE_DIR = Path(__file__).resolve().parent
CLIENT_DIST = BASE_DIR.parent / 'client' / 'dist'
ADMIN_UI_DIR = BASE_DIR / 'admin_ui'

PORT = int(os.environ.get('PORT', 4000))
FLASK_DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'

app = Flask(__name__, static_folder=None)

# See storage.py: PERSISTENCE_BACKEND=none (default)/file/redis controls
# whether rooms survive a server restart, and PERSISTENCE_FILE_DIR/REDIS_URL
# configure the chosen backend.
rooms = RoomManager(build_store_from_env(BASE_DIR))
_restored = rooms.load_from_store()
if _restored:
    app.logger.info('Restored %d room(s) from persistent storage.', _restored)

# --- simple per-IP rate limit on room creation (defends against a single
# client flooding room creation to exhaust server memory) ---
ROOM_CREATE_LIMIT = 5
ROOM_CREATE_WINDOW_SECONDS = 60.0
_room_create_log = defaultdict(deque)  # ip -> deque[timestamps within the window]
_room_create_lock = threading.Lock()

# --- admin API auth: a single shared secret, unrelated to player tokens
# (those are handed out to anyone who asks, by design - they must never
# double as admin credentials). Unset by default, which disables every
# /api/admin/* route rather than leaving them open. Generate one with:
#   python3 -c "import secrets; print(secrets.token_hex(32))"
ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN', '')

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
    if player:
        player.last_seen = time.time()
        return player
    if game.get_spectator(token):
        raise ApiError("Spectators can't do that.", 403)
    raise ApiError('Session not found; please join again.', 401)


def _get_participant(game, token):
    """Like _get_player, but also accepts a spectator's token - for routes
    (state polling, and the response to /join itself) that any room member,
    playing or just watching, needs to work."""
    if not token:
        raise ApiError('Missing token.', 401)
    participant = game.get_participant(token)
    if not participant:
        raise ApiError('Session not found; please join again.', 401)
    participant.last_seen = time.time()
    return participant


def require_admin(fn):
    """Gate a route behind ADMIN_TOKEN. Every failure - not configured,
    missing header, wrong token - returns the same 404 as a route that
    doesn't exist, rather than a 401, so an unauthenticated prober can't
    even tell an admin API is present."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        provided = auth[7:] if auth.startswith('Bearer ') else ''
        if not ADMIN_TOKEN or not provided or not hmac.compare_digest(provided, ADMIN_TOKEN):
            raise ApiError('Not found.', 404)
        return fn(*args, **kwargs)
    return wrapper


def _body():
    return request.get_json(silent=True) or {}


def _state_response(game, participant):
    payload = game.state_for(participant.id)
    payload['youId'] = participant.id
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
    rooms.persist(game)
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
    # A game still in its lobby gets a real player; one that's already playing
    # (or already finished) gets a read-only spectator instead of a flat
    # rejection - see Game.join.
    participant = game.join(token, name)
    game.touch()
    rooms.persist(game)
    result = _state_response(game, participant)
    result['token'] = token
    return result


@app.get('/api/rooms/<code>/state')
@api_route
def room_state(code):
    game = _get_room(code)
    participant = _get_participant(game, request.args.get('token'))
    return _state_response(game, participant)


@app.post('/api/rooms/<code>/start')
@api_route
def start_game(code):
    game = _get_room(code)
    player = _get_player(game, _body().get('token'))
    game.start()
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/place')
@api_route
def place_tiles(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    game.place_tiles(player.id, data.get('placements'))
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/pass')
@api_route
def pass_turn(code):
    game = _get_room(code)
    player = _get_player(game, _body().get('token'))
    game.pass_turn(player.id)
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/exchange')
@api_route
def exchange_tiles(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    game.exchange_tiles(player.id, data.get('letters'))
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    return _state_response(game, player)


# ---------------------------------------------------------------------------
# Admin routes - see API.md#admin-api. All gated by require_admin (ADMIN_TOKEN),
# EXCEPT the page below - it's static HTML/JS with no secrets baked in and no
# way to attach an Authorization header via plain browser navigation, so it
# has to be reachable unauthenticated; every actual admin action it takes
# still goes through the protected /api/admin/* routes with whatever token
# you type into it.
# ---------------------------------------------------------------------------

@app.get('/admin')
def admin_ui():
    return send_from_directory(ADMIN_UI_DIR, 'index.html')


def _admin_room_summary(game):
    state = game.state_for(None)  # for_player_id=None -> nobody's rack is revealed
    return {
        'roomCode': state['roomCode'],
        'status': state['status'],
        'hostId': state['hostId'],
        'winnerId': state['winnerId'],
        'players': [
            {'name': p['name'], 'score': p['score'], 'connected': p['connected']}
            for p in state['players']
        ],
        'spectatorCount': len(state['spectators']),
        'createdAt': game.created_at,
        'startedAt': game.started_at,
        'finishedAt': game.finished_at,
        'lastActivity': game.last_activity,
    }


@app.get('/api/admin/rooms')
@api_route
@require_admin
def admin_list_rooms():
    return {'rooms': [_admin_room_summary(g) for g in rooms.rooms.values()]}


@app.get('/api/admin/rooms/<code>')
@api_route
@require_admin
def admin_room_detail(code):
    game = _get_room(code)
    return game.to_dict()


@app.delete('/api/admin/rooms/<code>')
@api_route
@require_admin
def admin_delete_room(code):
    _get_room(code)  # raises 404 if it doesn't exist
    rooms.delete_room(code.upper())
    return {'deleted': code.upper()}


@app.get('/api/admin/games')
@api_route
@require_admin
def admin_list_finished_games():
    limit = request.args.get('limit', type=int) or 100
    return {'games': rooms.list_finished_games(limit)}


threading.Timer(SWEEP_INTERVAL_SECONDS, _sweep_rooms).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=FLASK_DEBUG, threaded=True)
