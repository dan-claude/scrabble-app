"""TextBelt SMS integration.

Required env var:
  TEXTBELT_KEY   — your TextBelt API key (get one at textbelt.com)

Optional env var:
  SMS_BRAND_NAME — brand name shown in brackets at the start of every
                   message (default: WordGame).  Must match the brand you
                   registered for 10DLC.
"""

import logging
import os

import requests as _requests

logger = logging.getLogger(__name__)

TEXTBELT_URL = 'https://textbelt.com/text'
_TIMEOUT = 10  # seconds


def _brand() -> str:
    return os.environ.get('SMS_BRAND_NAME', 'WordGame')


def _key() -> str:
    return os.environ.get('TEXTBELT_KEY', '')


# ---------------------------------------------------------------------------
# Message templates  (10DLC-compliant)
# ---------------------------------------------------------------------------

def msg_optin_confirmation() -> str:
    b = _brand()
    return (
        f'[{b}] You\'re signed up for turn notifications. '
        'Msg & data rates may apply. '
        'Reply STOP to cancel, HELP for info.'
    )


def msg_turn_notification(room_url: str) -> str:
    b = _brand()
    return (
        f'[{b}] It\'s your turn! '
        f'Join here: {room_url} — Reply STOP to opt out.'
    )


def msg_help() -> str:
    b = _brand()
    return (
        f'[{b}] You\'ll get a text when it\'s your turn in a game. '
        'Msg & data rates may apply. Reply STOP to cancel.'
    )


def msg_stop_confirmation() -> str:
    b = _brand()
    return (
        f'[{b}] You\'ve been unsubscribed from {b} notifications. '
        'No more messages will be sent. Reply START to re-subscribe.'
    )


def msg_start_confirmation() -> str:
    b = _brand()
    return (
        f'[{b}] You\'ve been re-subscribed to turn notifications. '
        'Reply STOP at any time to cancel.'
    )


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

def send(phone: str, message: str, webhook_url: str | None = None) -> bool:
    """Send an SMS via TextBelt.  Returns True on success.

    Logs a warning (not an exception) when TEXTBELT_KEY is absent so the
    app starts cleanly in environments where SMS isn't configured yet.
    """
    key = _key()
    if not key:
        logger.warning('TEXTBELT_KEY not set — skipping SMS to %s', _redact(phone))
        return False

    payload: dict = {'phone': phone, 'message': message, 'key': key}
    if webhook_url:
        payload['replyWebhookUrl'] = webhook_url

    try:
        resp = _requests.post(TEXTBELT_URL, data=payload, timeout=_TIMEOUT)
        result = resp.json()
    except Exception:
        logger.exception('TextBelt HTTP request failed for %s', _redact(phone))
        return False

    if result.get('success'):
        logger.info('TextBelt sent to %s (textId=%s)', _redact(phone), result.get('textId'))
        return True

    logger.error('TextBelt send failed for %s: %s', _redact(phone), result)
    return False


def _redact(phone: str) -> str:
    """Log only the last 4 digits of a phone number."""
    digits = ''.join(c for c in phone if c.isdigit())
    return f'***{digits[-4:]}' if len(digits) >= 4 else '***'
