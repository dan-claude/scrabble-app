import hmac
import os
import threading
import time
from collections import defaultdict, deque
from functools import wraps
from pathlib import Path

from flask import Flask, redirect, request, send_from_directory, session as flask_session, url_for
from werkzeug.security import safe_join
from werkzeug.middleware.proxy_fix import ProxyFix

import auth
from game.dictionary import available_dictionaries, default_dictionary
from game.game import (
    BINGO_BONUS,
    CONNECTED_TIMEOUT_SECONDS,
    GameError,
    MAX_PLAYERS,
    MAX_RACK,
    MAX_SPECTATORS,
    MIN_PLAYERS,
)
from game.bot import BOT_NAME, find_best_move, make_bot_token
from notification_plugins import get_plugin, list_plugins, sanitize_setup, send_notification
from rooms import ABANDONED_ROOM_SECONDS, IDLE_ROOM_SECONDS, MAX_ROOMS, ROOM_CODE_LENGTH, RoomManager
from storage import build_store_from_env, describe_backend_from_env

BASE_DIR = Path(__file__).resolve().parent
CLIENT_DIST = BASE_DIR.parent / 'client' / 'dist'
ADMIN_UI_DIR = BASE_DIR / 'admin_ui'

PORT = int(os.environ.get('PORT', 4000))
FLASK_DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'

app = Flask(__name__, static_folder=None)
# Trust X-Forwarded-Proto/Host from a single reverse-proxy hop so that
# url_for(..., _external=True) generates https:// in production.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
auth.init_app(app)

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
    # safe_join refuses any path that escapes CLIENT_DIST (.. segments, absolute
    # paths, encoded slashes). Check it before testing existence so that an
    # out-of-bounds path gets the same index.html response as a missing file,
    # rather than a 404 that leaks whether the target exists on disk.
    target = safe_join(str(CLIENT_DIST), path) if path else None
    if target and os.path.isfile(target):
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


def _current_turn_player_id(game):
    return game.current_player.id if game.status == 'playing' and game.current_player else None


def _maybe_play_bot(game):
    """If the current player is a bot, schedule its move in a background thread
    after a short delay so it feels like a real opponent thinking."""
    if game.status != 'playing':
        return
    player = game.current_player
    if not player or not player.is_bot:
        return

    def _play():
        # Re-fetch the game in case it was reaped or the turn changed while
        # we were waiting (the timer fires 1s later on a background thread).
        g = rooms.get_room(game.room_code)
        if not g or g.status != 'playing':
            return
        if not g.current_player or not g.current_player.is_bot:
            return
        bot_id = g.current_player.id
        prev = _current_turn_player_id(g)
        try:
            move = find_best_move(g, difficulty=g.current_player.bot_difficulty)
            if move['action'] == 'place':
                g.place_tiles(bot_id, move['placements'])
            elif move['action'] == 'exchange':
                g.exchange_tiles(bot_id, move['letters'])
            else:
                g.pass_turn(bot_id)
            g.touch()
            rooms.persist(g)
            if g.status == 'finished':
                rooms.record_finished_game(g)
            _maybe_notify_turn(g, prev)
            _maybe_play_bot(g)  # chain: if next player is also a bot, schedule again
        except Exception:
            app.logger.exception('Bot move failed for room %s', game.room_code)

    threading.Timer(1.0, _play).start()


def _maybe_notify_turn(game, previous_turn_player_id):
    """Fire any server-triggered notification plugins for whoever's turn it
    now is - but only when the turn actually just changed to them, so this is
    safe to call after every action that could advance the turn (including
    starting the game) without spamming a repeat notification on every call.
    Client-triggered plugins (e.g. the browser one) need nothing from here -
    the client already sees the new turnPlayerId in the State it gets back."""
    new_turn_player_id = _current_turn_player_id(game)
    if not new_turn_player_id or new_turn_player_id == previous_turn_player_id:
        return
    player = game.get_player(new_turn_player_id)
    if not player:
        return
    for plugin_id, setup in player.notification_setup.items():
        plugin = get_plugin(plugin_id)
        if plugin and plugin['trigger'] == 'server':
            send_notification(plugin_id, setup, {
                'roomCode': game.room_code,
                'playerId': player.id,
                'playerName': player.name,
            })


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
    dictionary = data.get('dictionary') or default_dictionary()
    if dictionary not in available_dictionaries():
        raise GameError(f'Unknown dictionary: {dictionary!r}')
    game = rooms.create_room(dictionary=dictionary)
    token = os.urandom(16).hex()
    player = game.add_player(token, name)
    player.notification_setup = sanitize_setup(data.get('notificationSetup'))
    user = auth.get_user_by_session(data.get('userToken'), rooms.store)
    if user:
        player.user_id = user['id']
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
    if not participant.is_spectator:
        participant.notification_setup = sanitize_setup(data.get('notificationSetup'))
        user = auth.get_user_by_session(data.get('userToken'), rooms.store)
        if user:
            participant.user_id = user['id']
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
    previous_turn_player_id = _current_turn_player_id(game)
    game.start()
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    _maybe_notify_turn(game, previous_turn_player_id)
    _maybe_play_bot(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/place')
@api_route
def place_tiles(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    previous_turn_player_id = _current_turn_player_id(game)
    game.place_tiles(player.id, data.get('placements'))
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    _maybe_notify_turn(game, previous_turn_player_id)
    _maybe_play_bot(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/pass')
@api_route
def pass_turn(code):
    game = _get_room(code)
    player = _get_player(game, _body().get('token'))
    previous_turn_player_id = _current_turn_player_id(game)
    game.pass_turn(player.id)
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    _maybe_notify_turn(game, previous_turn_player_id)
    _maybe_play_bot(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/exchange')
@api_route
def exchange_tiles(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    previous_turn_player_id = _current_turn_player_id(game)
    game.exchange_tiles(player.id, data.get('letters'))
    game.touch()
    rooms.persist(game)
    if game.status == 'finished':
        rooms.record_finished_game(game)
    _maybe_notify_turn(game, previous_turn_player_id)
    _maybe_play_bot(game)
    return _state_response(game, player)


@app.get('/api/dictionaries')
@api_route
def dictionaries():
    """List available word lists. Public and unauthenticated — needed before room creation."""
    return {
        'dictionaries': available_dictionaries(),
        'default': default_dictionary(),
    }


@app.get('/api/notification-plugins')
@api_route
def notification_plugins():
    """Public and unauthenticated on purpose: the join page needs this list
    before a player has any token at all, and the admin page reads the same
    endpoint rather than duplicating it behind ADMIN_TOKEN."""
    return {'plugins': list_plugins()}


@app.post('/api/rooms/<code>/add-bot')
@api_route
def add_bot(code):
    game = _get_room(code)
    player = _get_player(game, _body().get('token'))
    if player.id != game.host_id:
        raise ApiError('Only the host can add bots.', 403)
    difficulty = _body().get('difficulty', 'hard')
    game.add_bot(make_bot_token(), BOT_NAME, difficulty)
    game.touch()
    rooms.persist(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/remove-bot')
@api_route
def remove_bot(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    if player.id != game.host_id:
        raise ApiError('Only the host can remove bots.', 403)
    game.remove_bot(data.get('botId'))
    game.touch()
    rooms.persist(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/remove-spectator')
@api_route
def remove_spectator(code):
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    if player.id != game.host_id:
        raise ApiError('Only the host can remove spectators.', 403)
    game.remove_spectator(data.get('spectatorId'))
    rooms.persist(game)
    return _state_response(game, player)


@app.post('/api/rooms/<code>/notification-setup')
@api_route
def update_notification_setup(code):
    """Lets a player change their notification setup after joining - the
    join-page form only reaches players who fill it out there, and a
    remembered-name invite-link rejoin (see Lobby.jsx's auto-rejoin path)
    skips that form entirely, so this is the only way those players can ever
    reach it. Spectators are rejected the same way _get_player rejects them
    everywhere else - a spectator never gets a turn, so there's nothing to be
    notified about."""
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    player.notification_setup = sanitize_setup(data.get('notificationSetup'))
    rooms.persist(game)
    return _state_response(game, player)


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.get('/api/auth/google')
def google_login():
    if not auth.is_configured():
        return {'error': 'Google OAuth is not configured on this server.'}, 503
    flask_session['oauth_popup'] = request.args.get('popup') == '1'
    callback_url = url_for('google_callback', _external=True)
    return auth.google_client().authorize_redirect(callback_url)


@app.get('/api/auth/google/callback')
def google_callback():
    is_popup = flask_session.pop('oauth_popup', False)
    if not auth.is_configured():
        if is_popup:
            return _popup_error_response()
        return redirect('/?auth_error=not_configured')
    try:
        token = auth.google_client().authorize_access_token()
        info = token.get('userinfo') or {}
        user = auth.find_or_create_user(
            rooms.store,
            google_id=info.get('sub', ''),
            email=info.get('email', ''),
            name=info.get('name', info.get('email', 'Player')),
            picture=info.get('picture', ''),
        )
        user_token = auth.create_session(user['id'])
        if is_popup:
            return _popup_success_response(user_token)
        return redirect(f'/?user_token={user_token}')
    except Exception:
        app.logger.exception('OAuth callback failed')
        if is_popup:
            return _popup_error_response()
        return redirect('/?auth_error=1')


def _popup_success_response(user_token):
    origin = request.scheme + '://' + request.host
    html = (
        '<!doctype html><html><body><script>'
        f'window.opener&&window.opener.postMessage({{userToken:"{user_token}"}},"{origin}");'
        'window.close();'
        '</script></body></html>'
    )
    return html, 200, {'Content-Type': 'text/html'}


def _popup_error_response():
    origin = request.scheme + '://' + request.host
    html = (
        '<!doctype html><html><body><script>'
        f'window.opener&&window.opener.postMessage({{authError:true}},"{origin}");'
        'window.close();'
        '</script></body></html>'
    )
    return html, 200, {'Content-Type': 'text/html'}


@app.post('/api/rooms/<code>/link-user')
@api_route
def link_user(code):
    """Retroactively link a signed-in user to their existing player slot.
    Called after a mid-game OAuth login so the game still counts in their history."""
    game = _get_room(code)
    data = _body()
    player = _get_player(game, data.get('token'))
    user = auth.get_user_by_session(data.get('userToken'), rooms.store)
    if not user:
        raise ApiError('Not authenticated.', 401)
    player.user_id = user['id']
    rooms.persist(game)
    return {}


@app.get('/api/auth/active-games')
@api_route
def active_games():
    """Return all non-finished rooms where this user is an active player.
    Used by the lobby to offer one-click rejoin across browsers/devices."""
    token = request.headers.get('Authorization', '')[7:]
    user = auth.get_user_by_session(token, rooms.store)
    if not user:
        raise ApiError('Not authenticated.', 401)
    user_id = user['id']
    result = []
    for game in rooms.rooms.values():
        if game.status == 'finished':
            continue
        for p in game.players:
            if p.user_id == user_id:
                result.append({
                    'roomCode': game.room_code,
                    'status': game.status,
                    'token': p.id,
                    'players': [
                        {'name': pp.name, 'isBot': pp.is_bot}
                        for pp in game.players
                    ],
                })
                break
    return {'games': result}


@app.get('/api/auth/me')
@api_route
def auth_me():
    token = request.headers.get('Authorization', '')[7:]  # strip 'Bearer '
    user = auth.get_user_by_session(token, rooms.store)
    if not user:
        raise ApiError('Not authenticated.', 401)
    return {'user': {k: user[k] for k in ('id', 'name', 'email', 'picture')}}


@app.post('/api/auth/logout')
@api_route
def auth_logout():
    token = (_body().get('userToken') or
             request.headers.get('Authorization', '')[7:])
    auth.delete_session(token)
    return {}


@app.get('/api/profile')
@api_route
def profile():
    token = request.headers.get('Authorization', '')[7:]
    user = auth.get_user_by_session(token, rooms.store)
    if not user:
        raise ApiError('Not authenticated.', 401)
    all_games = rooms.list_finished_games(limit=10000)
    stats = auth.compute_stats(user['id'], all_games)
    return {
        'user': {k: user[k] for k in ('id', 'name', 'email', 'picture', 'createdAt')},
        'stats': stats,
    }


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


@app.get('/api/admin/rooms/<code>/rejoin-links')
@api_route
@require_admin
def admin_rejoin_links(code):
    """Return per-player rejoin URLs for a room. Each URL carries the player's
    existing token so the client can restore their session without a new join.
    Only meaningful for rooms whose players are still present (lobby or playing);
    spectators are excluded since they have no persistent game seat to return to."""
    game = _get_room(code)
    base = request.host_url.rstrip('/')
    players = [
        {
            'name': p.name,
            'rejoinUrl': f'{base}/?room={game.room_code}&rejoin_token={p.id}',
        }
        for p in game.players
    ]
    return {'roomCode': game.room_code, 'players': players}


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


def _admin_params():
    """Every setting that affects server behavior, for display on /admin -
    deliberately excludes ADMIN_TOKEN itself (this endpoint is gated behind
    it), and redacts any credentials embedded in REDIS_URL rather than
    omitting persistence config entirely."""
    backend_info = describe_backend_from_env(BASE_DIR)
    params = [
        {'name': 'PORT', 'value': PORT, 'source': 'env: PORT',
         'description': 'TCP port the server listens on.'},
        {'name': 'FLASK_DEBUG', 'value': FLASK_DEBUG, 'source': 'env: FLASK_DEBUG',
         'description': "Flask's debug/auto-reload mode."},
        {'name': 'PERSISTENCE_BACKEND', 'value': backend_info['PERSISTENCE_BACKEND'],
         'source': 'env: PERSISTENCE_BACKEND',
         'description': 'How room state survives a restart: none, file, or redis.'},
    ]
    if 'PERSISTENCE_FILE_DIR' in backend_info:
        params.append({
            'name': 'PERSISTENCE_FILE_DIR', 'value': backend_info['PERSISTENCE_FILE_DIR'],
            'source': 'env: PERSISTENCE_FILE_DIR',
            'description': 'Directory holding one JSON file per room (file backend only).',
        })
    if 'REDIS_URL' in backend_info:
        params.append({
            'name': 'REDIS_URL', 'value': backend_info['REDIS_URL'],
            'source': 'env: REDIS_URL',
            'description': 'Redis connection string (redis backend only). Credentials redacted.',
        })
    params += [
        {'name': 'ROOM_CREATE_LIMIT', 'value': ROOM_CREATE_LIMIT, 'source': 'constant',
         'description': 'Max rooms one IP address can create within the rate-limit window.'},
        {'name': 'ROOM_CREATE_WINDOW_SECONDS', 'value': ROOM_CREATE_WINDOW_SECONDS, 'source': 'constant',
         'description': 'Length of the room-creation rate-limit window, in seconds.'},
        {'name': 'SWEEP_INTERVAL_SECONDS', 'value': SWEEP_INTERVAL_SECONDS, 'source': 'constant',
         'description': 'How often the background reaper checks for abandoned/idle rooms, in seconds.'},
        {'name': 'ABANDONED_ROOM_SECONDS', 'value': ABANDONED_ROOM_SECONDS, 'source': 'constant',
         'description': 'A room is reaped once every participant has stopped polling it for this long, in seconds.'},
        {'name': 'IDLE_ROOM_SECONDS', 'value': IDLE_ROOM_SECONDS, 'source': 'constant',
         'description': 'A room is reaped after this long with no game-affecting action, in seconds.'},
        {'name': 'MAX_ROOMS', 'value': MAX_ROOMS, 'source': 'constant',
         'description': 'Hard cap on concurrent rooms, to bound memory use.'},
        {'name': 'ROOM_CODE_LENGTH', 'value': ROOM_CODE_LENGTH, 'source': 'constant',
         'description': 'Number of characters in a generated room code.'},
        {'name': 'MIN_PLAYERS', 'value': MIN_PLAYERS, 'source': 'constant',
         'description': 'Minimum players required to start a game.'},
        {'name': 'MAX_PLAYERS', 'value': MAX_PLAYERS, 'source': 'constant',
         'description': 'Maximum players allowed in one room.'},
        {'name': 'MAX_SPECTATORS', 'value': MAX_SPECTATORS, 'source': 'constant',
         'description': 'Maximum spectators allowed in one room.'},
        {'name': 'MAX_RACK', 'value': MAX_RACK, 'source': 'constant',
         'description': 'Tiles a player holds, and can place or exchange at once.'},
        {'name': 'BINGO_BONUS', 'value': BINGO_BONUS, 'source': 'constant',
         'description': 'Score bonus for using all rack tiles in a single move.'},
        {'name': 'CONNECTED_TIMEOUT_SECONDS', 'value': CONNECTED_TIMEOUT_SECONDS, 'source': 'constant',
         'description': 'Poll recency within which a player/spectator counts as "connected", in seconds.'},
    ]
    return {'params': params}


@app.get('/api/admin/params')
@api_route
@require_admin
def admin_params():
    return _admin_params()


threading.Timer(SWEEP_INTERVAL_SECONDS, _sweep_rooms).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=FLASK_DEBUG, threaded=True)
