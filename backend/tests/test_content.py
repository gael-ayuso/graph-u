from random import Random

import psycopg
import pytest

from test_recommendations import artist_dict, client, isolate_external_sources, song_dict, uid
from app import main
from app import musicbrainz as mb
from app.content import explicit_metadata


@pytest.fixture(autouse=True)
def clear_content_cache():
    mb.recording_is_explicit.cache_clear()
    yield
    mb.recording_is_explicit.cache_clear()


@pytest.mark.parametrize("comment,tags,expected", [
    (None, [], False), ("Explicit version", [], True), ("parental advisory", [], True),
    ("uncensored", [], True), ("non-explicit", [], False), ("clean version", [], False),
    ("censored version", [], False), ("explicitly live", [], False),
    (None, [" Explicit Lyrics "], True), (None, ["explicit rock"], False),
    ("explicit version, not clean", [], True),
    ("non-explicit version of explicit original", [], False),
    ("clean version of explicit original", [], False),
])
def test_explicit_classification(comment, tags, expected):
    assert explicit_metadata(comment, tags) is expected


def test_public_recording_metadata_and_cache(monkeypatch):
    monkeypatch.setattr(mb, "is_local_db_active", lambda: False)
    calls = []
    def get(path, **params):
        calls.append((path, params))
        return {"disambiguation": "", "tags": [{"name": "explicit", "count": 1}, {"name": "clean", "count": 0}]}
    monkeypatch.setattr(mb, "_get", get)
    assert mb.recording_is_explicit(uid(1)) is True
    assert mb.recording_is_explicit(uid(1)) is True
    assert calls == [(f"/recording/{uid(1)}", {"inc": "tags"})]


def test_local_metadata_missing_and_db_failure_fallback(monkeypatch):
    monkeypatch.setattr(mb, "_env", lambda _: "dsn")
    monkeypatch.setattr(mb, "is_local_db_active", lambda: True)
    monkeypatch.setattr(mb.mb_db, "recording_content_metadata", lambda dsn, mid: ("clean", []))
    monkeypatch.setattr(mb, "_get", lambda *a, **k: pytest.fail("unexpected public request"))
    assert mb.recording_is_explicit(uid(1)) is False
    monkeypatch.setattr(mb.mb_db, "recording_content_metadata", lambda dsn, mid: None)
    with pytest.raises(mb.MusicBrainzError) as error:
        mb.recording_is_explicit(uid(2))
    assert error.value.status == 404
    def broken(*args):
        raise psycopg.OperationalError("offline")
    monkeypatch.setattr(mb.mb_db, "recording_content_metadata", broken)
    monkeypatch.setattr(mb, "_mark_local_db_inactive", lambda _: None)
    monkeypatch.setattr(mb, "_get", lambda *a, **k: {"tags": [{"name": "explicit", "count": 1}]})
    assert mb.recording_is_explicit(uid(3)) is True
