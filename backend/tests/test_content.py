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


@pytest.fixture
def tracks(monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: (song_dict(sid, "Seed", "Seed artist"), {"rock": 5}, uid(10)))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [(artist_dict(uid(20), "Artist"), {"rock": 5})])
    marked = {**song_dict(uid(100), "Duplicate", "Artist"), "comment": "explicit"}
    clean = song_dict(uid(101), " duplicate ", "Artist")
    unavailable = song_dict(uid(102), "Unavailable", "Artist")
    blocked = song_dict(uid(103), "Blocked", "Artist")
    fallback = song_dict(uid(104), "Fallback", "Artist")
    monkeypatch.setattr(mb, "similar_songs", lambda _: ((marked, 0.99, uid(20)), (unavailable, 0.98, uid(20)), (blocked, 0.97, uid(20)), (clean, 0.96, uid(20))))
    monkeypatch.setattr(mb, "album_tracks", lambda _: [fallback])
    calls = []
    def check(mid):
        calls.append(mid)
        if mid == uid(102):
            raise mb.MusicBrainzError("unavailable")
        return mid == uid(103)
    monkeypatch.setattr(mb, "recording_is_explicit", check)
    return calls


def test_explicit_allowed_skips_content_queries(client, tracks):
    response = client.post("/api/recommendations", json={"seeds": [uid(1)], "discoveryMode": "conservative"})
    assert response.status_code == 200
    assert tracks == []
    assert uid(100) in [rec["song"]["id"] for rec in response.json()["recommendations"]]


def test_content_filter_backfills_and_shares_checks_between_branches(client, tracks):
    response = client.post("/api/recommendations", json={"seeds": [uid(1), uid(2)], "allowExplicit": False, "discoveryMode": "conservative"})
    assert response.status_code == 200
    data = response.json()
    assert {rec["song"]["id"] for rec in data["recommendations"]} == {uid(101), uid(104)}
    assert uid(100) not in tracks
    assert set(tracks) == {uid(101), uid(102), uid(103), uid(104)}
    assert len(tracks) == len(set(tracks))
    assert all(set(rec["seedIds"]) == {uid(1), uid(2)} for rec in data["recommendations"])


def test_failed_metadata_without_backfill_reports_unavailable(client, monkeypatch, tracks):
    monkeypatch.setattr(mb, "similar_songs", lambda _: ((song_dict(uid(102), "Unknown", "Artist"), 0.9, uid(20)),))
    monkeypatch.setattr(mb, "album_tracks", lambda _: [])
    data = client.post("/api/recommendations", json={"seeds": [uid(1)], "allowExplicit": False}).json()
    assert data["recommendations"] == []
    assert data["seedResults"][0]["status"] == "unavailable"


def test_deadline_blocks_checks_and_marks_search_limited(monkeypatch):
    branch = {"song": song_dict(uid(1), "Seed", "Seed"), "tags": {}, "artistId": uid(10)}
    monkeypatch.setattr(main, "_candidates", lambda *a: {"artists": [(artist_dict(uid(20), "Artist"), 1.0, ["rock"], [])], "hints": {uid(20): [(1.0, song_dict(uid(100), "Song", "Artist"))]}, "byId": {}, "tracksFailed": False, "searchLimited": False})
    monkeypatch.setattr(main.time, "monotonic", lambda: 2.0)
    monkeypatch.setattr(mb, "recording_is_explicit", lambda _: pytest.fail("lookup beyond deadline"))
    assert list(main._branch_queue(branch, set(), {uid(1)}, {}, 1, 1, 1.0, Random(0), allow_explicit=False)) == []
    assert branch["searchLimited"] is True


def assert_clean_album_variant_survives(monkeypatch, catalog):
    assert [song["id"] for song in catalog] == [uid(100), uid(101)]
    monkeypatch.setattr(mb, "album_tracks", lambda _: catalog)
    rng = Random(0)
    monkeypatch.setattr(rng, "shuffle", lambda songs: None)
    result = main._tracks(uid(20), {}, {}, rng=rng,
                          track_allowed=lambda song: not explicit_metadata(song.get("comment")))
    assert [song["id"] for song in result] == [uid(101)]


def test_public_album_retains_recording_versions_until_content_filter(monkeypatch):
    records = [
        {"id": uid(100), "title": "Same Song", "disambiguation": "explicit", "artist-credit": [{"name": "Artist"}]},
        {"id": uid(101), "title": "Same Song", "disambiguation": "clean", "artist-credit": [{"name": "Artist"}]},
    ]
    calls = []
    def get(path, **kwargs):
        calls.append((path, kwargs))
        return {"recordings": [records[0], records[0], records[1]]}
    monkeypatch.setattr(mb, "_get", get)
    catalog = mb._album_tracks_api(uid(20))
    assert calls[0][0] == "/recording"
    assert calls[0][1]["limit"] == 15
    assert_clean_album_variant_survives(monkeypatch, catalog)


def test_local_album_retains_recording_versions_until_content_filter(monkeypatch):
    rows = [
        (uid(100), "Same Song", "Artist", "Album", None, "explicit", None, None),
        (uid(100), "Same Song", "Artist", "Album", None, "explicit", None, None),
        (uid(101), "Same Song", "Artist", "Album", None, "clean", None, None),
    ]
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, params):
            assert "LIMIT 80" in sql
            assert params == {"mbid": uid(20)}
        def fetchall(self): return rows
    class Connection:
        def cursor(self): return Cursor()
    monkeypatch.setattr(mb.mb_db, "_connection", lambda dsn: Connection())
    catalog = mb.mb_db.album_tracks("test-dsn", uid(20))
    assert_clean_album_variant_survives(monkeypatch, catalog)
