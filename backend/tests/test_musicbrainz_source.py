"""Pruebas de selección de fuente de MusicBrainz (DB local activa vs respaldo API pública)."""

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import musicbrainz as mb


def _clear_caches() -> None:
    mb.reset_source_cache()
    mb.recording_profile.cache_clear()
    mb.artists_by_tags.cache_clear()
    mb.album_tracks.cache_clear()
    mb._collaborators.cache_clear()


def test_uses_public_api_when_no_dsn(monkeypatch) -> None:
    _clear_caches()
    monkeypatch.setenv("MUSICBRAINZ_DATABASE_URL", "")
    monkeypatch.setattr(mb, "_env", lambda _name: "")

    assert mb.is_local_db_active() is False
    assert mb.active_source() == "public_api"

    api_calls = []

    def fake_get(path: str, **params):
        api_calls.append((path, params))
        return {
            "recordings": [
                {
                    "id": "d9b46ecb-5472-4dcd-8fa4-dd6723189e27",
                    "title": "Reckoner",
                    "artist-credit": [{"name": "Radiohead", "joinphrase": ""}],
                    "releases": [{"title": "In Rainbows"}],
                    "length": 290000,
                }
            ]
        }

    monkeypatch.setattr(mb, "_get", fake_get)
    songs = mb.search("Reckoner", "Radiohead")
    assert len(songs) == 1
    assert songs[0]["title"] == "Reckoner"
    assert len(api_calls) == 1


def test_uses_local_db_when_active(monkeypatch) -> None:
    _clear_caches()
    monkeypatch.setattr(mb, "_env", lambda name: "postgresql://local/test" if name == "MUSICBRAINZ_DATABASE_URL" else "")
    monkeypatch.setattr(mb.mb_db, "is_active", lambda dsn: True)

    db_calls = []

    def fake_db_search(dsn: str, title: str, artist: str):
        db_calls.append((dsn, title, artist))
        return [{"id": "1", "title": "Reckoner", "artist": "Radiohead", "release": "In Rainbows", "duration": 290213, "comment": None}]

    def fail_api(*args, **kwargs):
        raise AssertionError("No debe llamarse a la API pública cuando la DB local está activa")

    monkeypatch.setattr(mb.mb_db, "search", fake_db_search)
    monkeypatch.setattr(mb, "_get", fail_api)

    assert mb.active_source() == "local_db"
    songs = mb.search("Reckoner", "Radiohead")
    assert len(songs) == 1
    assert db_calls == [("postgresql://local/test", "Reckoner", "Radiohead")]


def test_falls_back_to_api_when_local_db_inactive(monkeypatch) -> None:
    _clear_caches()
    monkeypatch.setattr(mb, "_env", lambda name: "postgresql://local/test" if name == "MUSICBRAINZ_DATABASE_URL" else "")
    monkeypatch.setattr(mb.mb_db, "is_active", lambda dsn: False)

    api_calls = []

    def fake_get(path: str, **params):
        api_calls.append(path)
        return {"recordings": []}

    monkeypatch.setattr(mb, "_get", fake_get)

    assert mb.active_source() == "public_api"
    assert mb.search("Reckoner", "Radiohead") == []
    # Empty normal results trigger exactly one fuzzy search on the same source.
    assert api_calls == ["/recording", "/recording"]


def test_falls_back_to_api_when_local_db_fails_mid_query(monkeypatch) -> None:
    _clear_caches()
    monkeypatch.setattr(mb, "_env", lambda name: "postgresql://local/test" if name == "MUSICBRAINZ_DATABASE_URL" else "")
    monkeypatch.setattr(mb.mb_db, "is_active", lambda dsn: True)

    def broken_db_search(dsn: str, title: str, artist: str):
        raise psycopg.OperationalError("connection lost")

    api_calls = []

    def fake_get(path: str, **params):
        api_calls.append(path)
        return {
            "recordings": [
                {
                    "id": "id-api",
                    "title": "Reckoner",
                    "artist-credit": [{"name": "Radiohead", "joinphrase": ""}],
                    "releases": [],
                    "length": 290000,
                }
            ]
        }

    monkeypatch.setattr(mb.mb_db, "search", broken_db_search)
    monkeypatch.setattr(mb, "_get", fake_get)

    assert mb.is_local_db_active() is True
    songs = mb.search("Reckoner", "Radiohead")
    assert [s["id"] for s in songs] == ["id-api"]
    assert api_calls == ["/recording"]
    assert mb.is_local_db_active() is False
