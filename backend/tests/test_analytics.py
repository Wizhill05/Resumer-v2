import gzip
import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from posthog import Posthog
from pydantic import ValidationError

from src.core import analytics
from src.models.generation import Generation
from src.schemas.generation import AnalyticsContext


@pytest.fixture
def receiver(monkeypatch):
    events = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            if self.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            payload = json.loads(body)
            events.extend(payload.get('batch', [payload]))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{}')

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    client = Posthog('test-token', host=f'http://127.0.0.1:{server.server_port}', flush_at=1)
    monkeypatch.setattr(analytics, '_client', lambda: client)
    monkeypatch.setattr(analytics.settings, 'POSTHOG_PROJECT_TOKEN', 'test-token')
    monkeypatch.setattr(analytics.settings, 'POSTHOG_ENVIRONMENT', 'production')
    yield client, events
    client.shutdown()
    server.shutdown()
    server.server_close()
    thread.join()


def generation():
    return Generation(
        id=uuid.uuid4(), user_id=uuid.uuid4(), template_id='personal-classic',
        job_description='PRIVATE JOB DESCRIPTION', instructions='PRIVATE INSTRUCTIONS',
        is_guest=True, created_at=datetime.now(timezone.utc) - timedelta(seconds=20),
        completed_at=datetime.now(timezone.utc),
        render_metadata={'_analytics': {'distinct_id': 'guest-browser', 'session_id': 'browser-session'},
                         'tailored_resume': {'summary': 'PRIVATE RESUME'}},
    )


def test_background_outcomes_reach_posthog_with_same_browser_identity(receiver):
    client, events = receiver
    gen = generation()
    for outcome in ['accepted', 'completed', 'failed']:
        analytics.capture_generation(gen, outcome)
    client.flush()
    assert {e['event'] for e in events} == {
        'resume_generation_accepted', 'resume_generation_completed', 'resume_generation_failed'}
    assert all(e['distinct_id'] == 'guest-browser' for e in events)
    assert all(e['properties']['$session_id'] == 'browser-session' for e in events)
    assert all(e['properties']['is_guest'] is True for e in events)
    assert 'PRIVATE' not in json.dumps(events)
    assert next(e for e in events if e['event'].endswith('completed'))['properties']['duration_seconds'] >= 20


def test_retry_uses_same_event_id_and_naive_timestamps_work(receiver):
    client, events = receiver
    gen = generation()
    gen.created_at = gen.created_at.replace(tzinfo=None)
    analytics.capture_generation(gen, 'completed')
    analytics.capture_generation(gen, 'completed')
    client.flush()
    assert len(events) == 2
    assert events[0]['uuid'] == events[1]['uuid']


def test_disabled_analytics_and_missing_browser_consent_send_nothing(receiver, monkeypatch):
    client, events = receiver
    gen = generation()
    monkeypatch.setattr(analytics.settings, 'POSTHOG_ENVIRONMENT', 'development')
    analytics.capture_generation(gen, 'completed')
    monkeypatch.setattr(analytics.settings, 'POSTHOG_ENVIRONMENT', 'production')
    gen.render_metadata = {'_analytics': None}
    analytics.capture_generation(gen, 'completed')
    client.flush()
    assert events == []


def test_sdk_error_does_not_break_generation(monkeypatch):
    monkeypatch.setattr(analytics.settings, 'POSTHOG_PROJECT_TOKEN', 'test-token')
    monkeypatch.setattr(analytics.settings, 'POSTHOG_ENVIRONMENT', 'production')
    def fail():
        raise RuntimeError('network unavailable')
    monkeypatch.setattr(analytics, '_client', fail)
    analytics.capture_generation(generation(), 'completed')


def test_analytics_context_rejects_oversized_identifier():
    with pytest.raises(ValidationError):
        AnalyticsContext(distinct_id='x' * 201)
