"""Which address outbound links (turn SMS, TextBelt reply webhook, admin
rejoin links) point at.

Request Host / X-Forwarded-Host headers are client-controlled, so a request's
host is only used when it's one of ours. Sources, highest priority first:

  PUBLIC_BASE_URL        full origin, e.g. https://play.example.com
  PUBLIC_HOSTS           comma-separated hostnames; first is the default
  RAILWAY_PUBLIC_DOMAIN  set automatically by Railway (may lag a domain change)

A request on a host that isn't in any of them is logged once and listed on
the admin page, so a new custom domain that was never added gets noticed.
"""

import logging
import threading
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

MAX_UNRECOGNIZED_HOSTS = 20


def _host(value):
    return value.strip().lower().rstrip('.')


class PublicUrl:
    def __init__(self, env):
        base = env.get('PUBLIC_BASE_URL', '').strip().rstrip('/')
        hosts = [_host(h) for h in env.get('PUBLIC_HOSTS', '').split(',') if h.strip()]
        railway = _host(env.get('RAILWAY_PUBLIC_DOMAIN', ''))

        self._base_host = _host(urlsplit(base).netloc) if base else ''
        if base:
            self.default_url, self.source = base, 'PUBLIC_BASE_URL'
        elif hosts:
            self.default_url, self.source = f'https://{hosts[0]}', 'PUBLIC_HOSTS'
        elif railway:
            self.default_url, self.source = f'https://{railway}', 'RAILWAY_PUBLIC_DOMAIN'
        else:
            self.default_url, self.source = None, None

        self.allowed_hosts = list(dict.fromkeys(
            h for h in [self._base_host, *hosts, railway] if h
        ))
        self._base_url = base
        self._unrecognized = []
        self._lock = threading.Lock()

    @property
    def configured(self):
        return self.default_url is not None

    def is_recognized(self, host):
        return _host(host) in self.allowed_hosts

    def url_for_request_host(self, host):
        """Origin for links built while handling a request on `host`, or None
        when nothing is configured (local dev - caller decides)."""
        if not self.configured:
            return None
        h = _host(host or '')
        if h and h == self._base_host:
            return self._base_url
        if h and h in self.allowed_hosts:
            return f'https://{h}'
        return self.default_url

    def note_request_host(self, host):
        if not self.configured or not host or self.is_recognized(host):
            return
        h = _host(host)
        with self._lock:
            if h in self._unrecognized or len(self._unrecognized) >= MAX_UNRECOGNIZED_HOSTS:
                return
            self._unrecognized.append(h)
        logger.warning(
            'Request arrived on host %r, which is not in PUBLIC_BASE_URL / PUBLIC_HOSTS / '
            'RAILWAY_PUBLIC_DOMAIN. Links in texts will keep using %s. If this is your '
            'domain, add it to PUBLIC_HOSTS (or update PUBLIC_BASE_URL); if not, the Host '
            'header may have been forged.', h, self.default_url)

    def admin_summary(self, request_host):
        with self._lock:
            unrecognized = list(self._unrecognized)
        return {
            'linkBaseUrl': self.default_url,
            'source': self.source,
            'allowedHosts': list(self.allowed_hosts),
            'requestHost': _host(request_host or ''),
            'requestHostRecognized': self.is_recognized(request_host or ''),
            'unrecognizedHosts': unrecognized,
        }
