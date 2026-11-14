"""Google OAuth and user session management.

Env vars required for OAuth to work:
  GOOGLE_CLIENT_ID     — from Google Cloud Console
  GOOGLE_CLIENT_SECRET — from Google Cloud Console
  SECRET_KEY           — any long random string; keeps OAuth state cookies
                         tamper-proof. Generate with:
                           python3 -c "import secrets; print(secrets.token_hex(32))"
                         Without this set, it's re-generated on every restart,
                         so in-flight OAuth flows break across restarts (fine for
                         dev; set it in production).

If GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET are absent the /api/auth/google
route returns 503 rather than crashing the whole app.
"""

import os
import secrets
import time
import uuid

from authlib.integrations.flask_client import OAuth

_oauth = OAuth()

# In-memory sessions: token -> {user_id, expires_at}
# Not persisted - users re-authenticate after a server restart.
_sessions = {}
SESSION_TTL = 30 * 24 * 60 * 60  # 30 days


def init_app(app):
    if not app.config.get('SECRET_KEY'):
        app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
    _oauth.init_app(app)
    _oauth.register(
        name='google',
        client_id=os.environ.get('GOOGLE_CLIENT_ID', ''),
        client_secret=os.environ.get('GOOGLE_CLIENT_SECRET', ''),
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid email profile'},
    )


def google_client():
    return _oauth.google


def is_configured():
    return bool(os.environ.get('GOOGLE_CLIENT_ID') and os.environ.get('GOOGLE_CLIENT_SECRET'))


# ---------------------------------------------------------------------------
# Session management (in-memory)
# ---------------------------------------------------------------------------

def create_session(user_id):
    token = secrets.token_hex(32)
    _sessions[token] = {
        'user_id': user_id,
        'expires_at': time.time() + SESSION_TTL,
    }
    return token


def get_user_by_session(token, store):
    if not token:
        return None
    entry = _sessions.get(token)
    if not entry:
        return None
    if time.time() > entry['expires_at']:
        del _sessions[token]
        return None
    return store.get_user(entry['user_id'])


def delete_session(token):
    _sessions.pop(token, None)


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

def find_or_create_user(store, google_id, email, name, picture):
    user = store.find_user_by_google_id(google_id)
    if user:
        user['name'] = name
        user['picture'] = picture
        store.save_user(user['id'], user)
        return user
    user_id = str(uuid.uuid4())
    user = {
        'id': user_id,
        'googleId': google_id,
        'email': email,
        'name': name,
        'picture': picture,
        'createdAt': time.time(),
    }
    store.save_user(user_id, user)
    return user


# ---------------------------------------------------------------------------
# Profile stats
# ---------------------------------------------------------------------------

def compute_stats(user_id, finished_games):
    """Compute stats for a user by scanning the finished-games list."""
    games = []
    for g in finished_games:
        for p in g.get('players', []):
            if p.get('userId') == user_id:
                games.append({
                    'roomCode': g['roomCode'],
                    'finishedAt': g.get('finishedAt'),
                    'myScore': p['score'],
                    'won': g.get('winnerId') == p['id'],
                    'players': [
                        {
                            'name': pp['name'],
                            'score': pp['score'],
                            'isBot': pp.get('isBot', False),
                        }
                        for pp in g['players']
                    ],
                })
                break

    if not games:
        return {
            'gamesPlayed': 0,
            'wins': 0,
            'winRate': 0,
            'avgScore': 0,
            'bestScore': 0,
            'recentGames': [],
        }

    scores = [g['myScore'] for g in games]
    wins = sum(1 for g in games if g['won'])
    return {
        'gamesPlayed': len(games),
        'wins': wins,
        'winRate': round(wins / len(games) * 100),
        'avgScore': round(sum(scores) / len(scores)),
        'bestScore': max(scores),
        'recentGames': games[:20],
    }
