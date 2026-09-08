"""The browser-notification plugin.

This one is handled entirely on the client (see
client/src/hooks/useBrowserNotifications.js, which drives the browser's own
Notification API) - the server has nothing to send and nothing to store, so
there are no setup_fields and no send() function here. It still needs to
exist as a real plugin module so it shows up in GET /api/notification-plugins
and gets offered on the join page / in-room notification panel alongside any
future plugin.
"""

PLUGIN = {
    'id': 'browser',
    'name': 'Browser notifications',
    'description': "Pings this browser tab when it's your turn.",
    'trigger': 'client',
    'setup_fields': [],
}
