"""Tests for Flask API endpoints."""
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app as app_module


@pytest.fixture
def client():
    app_module.app.config['TESTING'] = True
    with app_module.app.test_client() as c:
        yield c


def _create(client, name='Alice', dictionary=None):
    body = {'playerName': name}
    if dictionary:
        body['dictionary'] = dictionary
    r = client.post('/api/rooms', json=body)
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _join(client, code, name):
    r = client.post(f'/api/rooms/{code}/join', json={'playerName': name})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _state(client, code, token):
    r = client.get(f'/api/rooms/{code}/state?token={token}')
    assert r.status_code == 200, r.get_json()
    return r.get_json()


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------

def test_health(client):
    r = client.get('/api/health')
    assert r.status_code == 200
    assert r.get_json() == {'ok': True}


# ---------------------------------------------------------------------------
# dictionaries endpoint
# ---------------------------------------------------------------------------

def test_dictionaries_lists_all(client):
    r = client.get('/api/dictionaries')
    assert r.status_code == 200
    data = r.get_json()
    assert 'enable' in data['dictionaries']
    assert 'sowpods' in data['dictionaries']
    assert 'twl06' in data['dictionaries']
    assert data['default'] == 'sowpods'


# ---------------------------------------------------------------------------
# room creation
# ---------------------------------------------------------------------------

def test_create_room_returns_token_and_code(client):
    data = _create(client)
    assert 'token' in data
    assert len(data['roomCode']) == 5

def test_create_room_default_dictionary(client):
    data = _create(client)
    assert data['dictionary'] == 'sowpods'

def test_create_room_choose_dictionary(client):
    data = _create(client, dictionary='enable')
    assert data['dictionary'] == 'enable'

def test_create_room_invalid_dictionary(client):
    r = client.post('/api/rooms', json={'playerName': 'Alice', 'dictionary': 'fake_dict'})
    assert r.status_code == 400

def test_create_room_no_name(client):
    r = client.post('/api/rooms', json={'playerName': ''})
    assert r.status_code == 400

def test_create_room_host_is_first_player(client):
    data = _create(client)
    assert data['players'][0]['name'] == 'Alice'
    assert data['hostId'] == data['players'][0]['id']


# ---------------------------------------------------------------------------
# join
# ---------------------------------------------------------------------------

def test_join_room(client):
    created = _create(client)
    code = created['roomCode']
    joined = _join(client, code, 'Bob')
    assert len(joined['players']) == 2

def test_join_duplicate_name_rejected(client):
    created = _create(client, 'Alice')
    code = created['roomCode']
    r = client.post(f'/api/rooms/{code}/join', json={'playerName': 'Alice'})
    assert r.status_code == 400

def test_join_nonexistent_room(client):
    r = client.post('/api/rooms/ZZZZZ/join', json={'playerName': 'Bob'})
    assert r.status_code == 404

def test_join_after_start_becomes_spectator(client):
    created = _create(client)
    code, host_token = created['roomCode'], created['token']
    _join(client, code, 'Bob')
    client.post(f'/api/rooms/{code}/start', json={'token': host_token})
    r = client.post(f'/api/rooms/{code}/join', json={'playerName': 'Watcher'})
    assert r.status_code == 200
    assert r.get_json()['isSpectator'] is True


# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

def test_state_requires_token(client):
    created = _create(client)
    r = client.get(f'/api/rooms/{created["roomCode"]}/state')
    assert r.status_code == 401

def test_state_invalid_token(client):
    created = _create(client)
    r = client.get(f'/api/rooms/{created["roomCode"]}/state?token=bad')
    assert r.status_code == 401

def test_state_includes_dictionary(client):
    created = _create(client, dictionary='twl06')
    state = _state(client, created['roomCode'], created['token'])
    assert state['dictionary'] == 'twl06'


# ---------------------------------------------------------------------------
# start
# ---------------------------------------------------------------------------

def test_start_game(client):
    created = _create(client)
    code, token = created['roomCode'], created['token']
    _join(client, code, 'Bob')
    r = client.post(f'/api/rooms/{code}/start', json={'token': token})
    assert r.status_code == 200
    assert r.get_json()['status'] == 'playing'

def test_start_needs_two_players(client):
    created = _create(client)
    r = client.post(f'/api/rooms/{created["roomCode"]}/start', json={'token': created['token']})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# pass / exchange
# ---------------------------------------------------------------------------

def _started_game(client, dictionary='sowpods'):
    created = _create(client, dictionary=dictionary)
    code, t0 = created['roomCode'], created['token']
    t1 = _join(client, code, 'Bob')['token']
    client.post(f'/api/rooms/{code}/start', json={'token': t0})
    return code, t0, t1

def test_pass_advances_turn(client):
    code, t0, t1 = _started_game(client)
    r = client.post(f'/api/rooms/{code}/pass', json={'token': t0})
    assert r.status_code == 200
    state = r.get_json()
    assert state['turnPlayerId'] == t1

def test_pass_wrong_turn(client):
    code, t0, t1 = _started_game(client)
    r = client.post(f'/api/rooms/{code}/pass', json={'token': t1})
    assert r.status_code == 400

def test_spectator_cannot_pass(client):
    code, t0, t1 = _started_game(client)
    spec = client.post(f'/api/rooms/{code}/join', json={'playerName': 'Spec'}).get_json()['token']
    r = client.post(f'/api/rooms/{code}/pass', json={'token': spec})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# bots
# ---------------------------------------------------------------------------

def test_add_remove_bot(client):
    created = _create(client)
    code, token = created['roomCode'], created['token']
    r = client.post(f'/api/rooms/{code}/add-bot', json={'token': token, 'difficulty': 'easy'})
    assert r.status_code == 200
    state = r.get_json()
    bots = [p for p in state['players'] if p['isBot']]
    assert len(bots) == 1
    assert bots[0]['botDifficulty'] == 'easy'

    bot_id = bots[0]['id']
    r2 = client.post(f'/api/rooms/{code}/remove-bot', json={'token': token, 'botId': bot_id})
    assert r2.status_code == 200
    assert all(not p['isBot'] for p in r2.get_json()['players'])

def test_non_host_cannot_add_bot(client):
    created = _create(client)
    code = created['roomCode']
    t1 = _join(client, code, 'Bob')['token']
    r = client.post(f'/api/rooms/{code}/add-bot', json={'token': t1})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# remove spectator
# ---------------------------------------------------------------------------

def test_remove_spectator(client):
    code, t0, t1 = _started_game(client)
    spec_token = client.post(f'/api/rooms/{code}/join', json={'playerName': 'Watcher'}).get_json()['token']
    state = _state(client, code, t0)
    spec_id = state['spectators'][0]['id']
    r = client.post(f'/api/rooms/{code}/remove-spectator', json={'token': t0, 'spectatorId': spec_id})
    assert r.status_code == 200
    assert len(r.get_json()['spectators']) == 0

def test_non_host_cannot_remove_spectator(client):
    code, t0, t1 = _started_game(client)
    client.post(f'/api/rooms/{code}/join', json={'playerName': 'Watcher'})
    state = _state(client, code, t0)
    spec_id = state['spectators'][0]['id']
    r = client.post(f'/api/rooms/{code}/remove-spectator', json={'token': t1, 'spectatorId': spec_id})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# notification plugins
# ---------------------------------------------------------------------------

def test_notification_plugins_endpoint(client):
    r = client.get('/api/notification-plugins')
    assert r.status_code == 200
    assert 'plugins' in r.get_json()
