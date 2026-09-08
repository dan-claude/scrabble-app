"""Notification plugin registry.

Drop a new module in this directory to add a notification channel - it's
discovered automatically at import time (see _discover below), no other
wiring required anywhere else in the server. Each module must define a
PLUGIN dict:

    PLUGIN = {
        'id': 'browser',                  # stable, unique, used as a dict key
        'name': 'Browser notifications',  # shown to players and on /admin
        'description': '...',             # shown to players and on /admin
        'trigger': 'client',              # 'client' - the browser handles it
                                           #     locally (e.g. the Notification
                                           #     API); the server never sends
                                           #     anything for this plugin.
                                           # 'server' - the server calls this
                                           #     module's send() itself.
        'setup_fields': [
            # Data this plugin needs from each participant, collected on the
            # join page and editable later from inside the room. Every field
            # needs at least a 'key'; 'label' and 'placeholder' are optional.
            # {'key': 'phone', 'label': 'Phone number', 'placeholder': '+1 555 123 4567'},
        ],
    }

A 'server'-trigger plugin must also define:

    def send(setup, context):
        '''Called once when it becomes context['playerName']'s turn.
        setup: this participant's saved setup_fields values, e.g. {'phone': '+15551234567'}.
        context: {'roomCode': str, 'playerId': str, 'playerName': str}.
        Raise on failure - send_notification() below logs it and moves on;
        a broken notification channel must never break gameplay.
        '''

A module that fails validation (missing PLUGIN, bad shape, a 'server' trigger
with no send()) is skipped with a logged warning rather than crashing the
server - one bad plugin should never take the whole app down.
"""
import importlib
import logging
import pkgutil

logger = logging.getLogger(__name__)

_REQUIRED_KEYS = {'id', 'name', 'description', 'trigger', 'setup_fields'}
_VALID_TRIGGERS = {'client', 'server'}


def _validate(module):
    plugin = getattr(module, 'PLUGIN', None)
    if not isinstance(plugin, dict):
        raise ValueError('missing a PLUGIN dict')
    missing = _REQUIRED_KEYS - plugin.keys()
    if missing:
        raise ValueError(f'PLUGIN missing keys: {sorted(missing)}')
    if not isinstance(plugin['id'], str) or not plugin['id']:
        raise ValueError('PLUGIN["id"] must be a non-empty string')
    if plugin['trigger'] not in _VALID_TRIGGERS:
        raise ValueError(f'PLUGIN["trigger"] must be one of {sorted(_VALID_TRIGGERS)}')
    if not isinstance(plugin['setup_fields'], list):
        raise ValueError('PLUGIN["setup_fields"] must be a list')
    for field in plugin['setup_fields']:
        if not isinstance(field, dict) or not field.get('key'):
            raise ValueError('each setup_fields entry needs a "key"')
    if plugin['trigger'] == 'server' and not callable(getattr(module, 'send', None)):
        raise ValueError('trigger "server" plugins must define send(setup, context)')
    return plugin


def _discover():
    plugins = {}
    for _, module_name, is_pkg in pkgutil.iter_modules(__path__):
        if is_pkg or module_name.startswith('_'):
            continue
        full_name = f'{__name__}.{module_name}'
        try:
            module = importlib.import_module(full_name)
            plugin = _validate(module)
        except Exception as exc:  # a broken plugin shouldn't break the server
            logger.warning('Skipping notification plugin %r: %s', module_name, exc)
            continue
        plugin_id = plugin['id']
        if plugin_id in plugins:
            logger.warning('Skipping notification plugin %r: duplicate id %r', module_name, plugin_id)
            continue
        plugins[plugin_id] = {'module': module, 'plugin': plugin}
    return plugins


_REGISTRY = _discover()


def list_plugins():
    """Public-safe plugin descriptions, in discovery order - for the join
    page and the admin UI. Never includes anything participant-specific."""
    return [
        {
            'id': entry['plugin']['id'],
            'name': entry['plugin']['name'],
            'description': entry['plugin']['description'],
            'trigger': entry['plugin']['trigger'],
            'setupFields': [
                {
                    'key': f['key'],
                    'label': f.get('label', f['key']),
                    'placeholder': f.get('placeholder', ''),
                }
                for f in entry['plugin']['setup_fields']
            ],
        }
        for entry in _REGISTRY.values()
    ]


def get_plugin(plugin_id):
    entry = _REGISTRY.get(plugin_id)
    return entry['plugin'] if entry else None


def _allowed_setup_keys(plugin_id):
    entry = _REGISTRY.get(plugin_id)
    if not entry:
        return None
    return {f['key'] for f in entry['plugin']['setup_fields']}


def sanitize_setup(raw):
    """Given a client's whole notificationSetup payload
    ({pluginId: {fieldKey: value}}), drop anything for an unknown plugin id
    or an undeclared field key, and coerce every kept value to a trimmed,
    length-capped string. This is the only path client-supplied notification
    setup data takes on its way into storage."""
    if not isinstance(raw, dict):
        return {}
    cleaned = {}
    for plugin_id, values in raw.items():
        allowed_keys = _allowed_setup_keys(plugin_id)
        if not allowed_keys or not isinstance(values, dict):
            continue
        kept = {}
        for key, value in values.items():
            if key not in allowed_keys or value is None:
                continue
            kept[key] = str(value).strip()[:200]
        if kept:
            cleaned[plugin_id] = kept
    return cleaned


def send_notification(plugin_id, setup, context):
    """Invoke a server-triggered plugin's send(). Swallows and logs any
    error - a broken or unreachable notification channel must never break
    gameplay for the players actually in the room."""
    entry = _REGISTRY.get(plugin_id)
    if not entry or entry['plugin']['trigger'] != 'server':
        return
    try:
        entry['module'].send(setup, context)
    except Exception:
        logger.exception('Notification plugin %r failed to send', plugin_id)
