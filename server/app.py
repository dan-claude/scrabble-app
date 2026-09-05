import os
import threading
import time
from collections import defaultdict, deque
from functools import wraps
from pathlib import Path

from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO

from game.game import GameError
from rooms import RoomManager

BASE_DIR = Path(__file__).resolve().parent
CLIENT_DIST = BASE_DIR.parent / 'client' / 'dist'

PORT = int(os.environ.get('PORT', 4000))
CLIENT_ORIGIN = os.environ.get('CLIENT_ORIGIN', 'http://localhost:5173')
FLASK_DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'

app = Flask(__name__, static_folder=None)
socketio = SocketIO(app, cors_allowed_origins=CLIENT_ORIGIN)

rooms = RoomManager()
# socket id (sid) -> {"room_code": str, "token": str}
socket_sessions = {}

# --- simple per-IP rate limit on room creation (defends against a single
# client flooding room:create to exhaust server memory) ---
ROOM_CREATE_LIMIT = 5
ROOM_CREATE_WINDOW_SECONDS = 60.0
_room_create_log = defaultdict(deque)  # ip -> deque[timestamps within the window]
_room_create_lock = threading.Lock()

# --- periodic sweep for rooms that have gone idle without ever formally
# disconnecting (laptop closed mid-game, a tab left open forever, etc.) ---
IDLE_SWEEP_INTERVAL_SECONDS = 30 * 60


# ---------------------------------------------------------------------------
# REST routes
# ---------------------------------------------------------------------------

@app.get('/api/health')
def health():
    return {'ok': True}


@app.get('/', defaults={'path': ''})
@app.get('/<path:path>')
def serve_client(path):
    """Serve the built React client (production only; see README)."""
    if path.startswith('api/') or path.startswith('socket.io'):
        return {'error': 'not found'}, 404
    target = CLIENT_DIST / path
    if path and target.is_file():
        return send_from_directory(CLIENT_DIST, path)
    return send_from_directory(CLIENT_DIST, 'index.html')


# ---------------------------------------------------------------------------
# Socket.IO plumbing
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


def _sweep_idle_rooms():
    removed = rooms.reap_idle_rooms()
    if removed:
        app.logger.info('Reaped %d idle room(s).', removed)
    threading.Timer(IDLE_SWEEP_INTERVAL_SECONDS, _sweep_idle_rooms).start()


def broadcast_state(game):
    """Push a personalized state snapshot to every connected player in the room."""
    game.touch()
    for player in game.players:
        if not player.connected:
            continue
        payload = game.state_for(player.id)
        payload['youId'] = player.id
        socketio.emit('state', payload, to=player.socket_id)


def handle_errors(fn):
    """Wrap a Socket.IO handler so GameError becomes an {ok:false, error} ack
    instead of an uncaught exception, matching the client's call() contract."""
    @wraps(fn)
    def wrapper(data=None):
        data = data or {}
        try:
            result = fn(data) or {}
            return {'ok': True, **result}
        except GameError as err:
            return {'ok': False, 'error': str(err)}
        except Exception:
            app.logger.exception('Unhandled error in socket handler %s', fn.__name__)
            return {'ok': False, 'error': 'Something went wrong.'}
    return wrapper


def _require_game(with_token=False):
    session = socket_sessions.get(request.sid)
    if not session:
        raise GameError('You are not in a room.')
    game = rooms.get_room(session['room_code'])
    if not game:
        raise GameError('Room not found.')
    if with_token:
        return game, session['token']
    return game


# ---------------------------------------------------------------------------
# Socket.IO event handlers — see API.md for the full protocol reference
# ---------------------------------------------------------------------------

@socketio.on('room:create')
@handle_errors
def on_room_create(data):
    _check_room_create_rate_limit()
    name = (data.get('playerName') or '').strip()[:20]
    if not name:
        raise GameError('Enter a name.')
    game = rooms.create_room()
    token = os.urandom(16).hex()
    game.add_player(token, request.sid, name)
    socket_sessions[request.sid] = {'room_code': game.room_code, 'token': token}
    broadcast_state(game)
    return {'roomCode': game.room_code, 'token': token}


@socketio.on('room:join')
@handle_errors
def on_room_join(data):
    game = rooms.get_room(data.get('roomCode'))
    if not game:
        raise GameError('Room not found.')
    name = (data.get('playerName') or '').strip()[:20]
    if not name:
        raise GameError('Enter a name.')
    token = os.urandom(16).hex()
    game.add_player(token, request.sid, name)
    socket_sessions[request.sid] = {'room_code': game.room_code, 'token': token}
    broadcast_state(game)
    return {'roomCode': game.room_code, 'token': token}


@socketio.on('room:rejoin')
@handle_errors
def on_room_rejoin(data):
    game = rooms.get_room(data.get('roomCode'))
    if not game:
        raise GameError('Room not found.')
    token = data.get('token')
    player = game.reconnect(token, request.sid)
    if not player:
        raise GameError('Session not found; please join again.')
    socket_sessions[request.sid] = {'room_code': game.room_code, 'token': token}
    broadcast_state(game)
    return {'roomCode': game.room_code, 'token': token}


@socketio.on('game:start')
@handle_errors
def on_game_start(_data):
    game = _require_game()
    game.start()
    broadcast_state(game)
    return {}


@socketio.on('game:place')
@handle_errors
def on_game_place(data):
    game, token = _require_game(with_token=True)
    game.place_tiles(token, data.get('placements'))
    broadcast_state(game)
    return {}


@socketio.on('game:pass')
@handle_errors
def on_game_pass(_data):
    game, token = _require_game(with_token=True)
    game.pass_turn(token)
    broadcast_state(game)
    return {}


@socketio.on('game:exchange')
@handle_errors
def on_game_exchange(data):
    game, token = _require_game(with_token=True)
    game.exchange_tiles(token, data.get('letters'))
    broadcast_state(game)
    return {}


@socketio.on('disconnect')
def on_disconnect():
    session = socket_sessions.pop(request.sid, None)
    if not session:
        return
    game = rooms.get_room(session['room_code'])
    if not game:
        return
    # Only mark the player offline if this socket is still their current
    # connection — a stale socket's disconnect must not clobber a newer
    # reconnection (e.g. the player reloaded and reconnected already).
    player = game.get_player(session['token'])
    if player and player.socket_id == request.sid:
        game.mark_disconnected(session['token'])
        broadcast_state(game)
    room_code = session['room_code']
    threading.Timer(5.0, lambda: rooms.remove_if_empty(room_code)).start()


threading.Timer(IDLE_SWEEP_INTERVAL_SECONDS, _sweep_idle_rooms).start()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=PORT, debug=FLASK_DEBUG, allow_unsafe_werkzeug=True)
