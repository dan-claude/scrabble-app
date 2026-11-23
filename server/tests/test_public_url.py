import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from public_url import MAX_UNRECOGNIZED_HOSTS, PublicUrl


def test_nothing_configured_defers_to_caller():
    p = PublicUrl({})
    assert not p.configured
    assert p.url_for_request_host('anything.example') is None
    p.note_request_host('anything.example')
    assert p.admin_summary('x')['unrecognizedHosts'] == []


def test_priority_base_url_then_hosts_then_railway():
    env = {'PUBLIC_BASE_URL': 'https://a.example/', 'PUBLIC_HOSTS': 'b.example', 'RAILWAY_PUBLIC_DOMAIN': 'c.up.railway.app'}
    assert PublicUrl(env).default_url == 'https://a.example'
    env.pop('PUBLIC_BASE_URL')
    assert PublicUrl(env).default_url == 'https://b.example'
    env.pop('PUBLIC_HOSTS')
    p = PublicUrl(env)
    assert p.default_url == 'https://c.up.railway.app'
    assert p.source == 'RAILWAY_PUBLIC_DOMAIN'


def test_known_hosts_used_as_is_unknown_fall_back():
    p = PublicUrl({'PUBLIC_HOSTS': 'play.example, Old.Up.Railway.App'})
    assert p.url_for_request_host('old.up.railway.app') == 'https://old.up.railway.app'
    assert p.url_for_request_host('PLAY.example') == 'https://play.example'
    assert p.url_for_request_host('evil.example') == 'https://play.example'
    assert p.url_for_request_host(None) == 'https://play.example'


def test_base_url_keeps_its_own_scheme():
    p = PublicUrl({'PUBLIC_BASE_URL': 'http://lan-box:4000'})
    assert p.url_for_request_host('lan-box:4000') == 'http://lan-box:4000'


def test_railway_domain_is_allowed_alongside_base_url():
    p = PublicUrl({'PUBLIC_BASE_URL': 'https://play.example', 'RAILWAY_PUBLIC_DOMAIN': 'x.up.railway.app'})
    assert p.url_for_request_host('x.up.railway.app') == 'https://x.up.railway.app'


def test_unrecognized_hosts_recorded_once_and_capped():
    p = PublicUrl({'PUBLIC_HOSTS': 'play.example'})
    p.note_request_host('new.example')
    p.note_request_host('new.example')
    p.note_request_host('play.example')
    assert p.admin_summary('play.example')['unrecognizedHosts'] == ['new.example']
    for i in range(MAX_UNRECOGNIZED_HOSTS + 5):
        p.note_request_host(f'h{i}.example')
    assert len(p.admin_summary('')['unrecognizedHosts']) == MAX_UNRECOGNIZED_HOSTS
