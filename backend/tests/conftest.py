import sys
from pathlib import Path
from random import Random
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main
from app import musicbrainz as mb

_CACHED_MB_FNS = (
    mb.recording_profile,
    mb.recording_check,
    mb._artist_tags,
    mb.artists_by_tags,
    mb.album_tracks,
    mb._collaborators,
    mb._versions,
    mb._similar_artists,
    mb._similar_songs,
)


def uid(n: int) -> str:
    return str(UUID(int=n))


def song_dict(song_id: str, title: str, artist: str) -> dict:
    return {
        "id": song_id,
        "title": title,
        "artist": artist,
        "release": None,
        "duration": None,
        "comment": None,
    }


def artist_dict(artist_id: str, name: str) -> dict:
    return {"id": artist_id, "name": name}


def reachable_from(graph: dict, start: str) -> set[str]:
    seen, pending = set(), [start]
    while pending:
        current = pending.pop()
        if current not in seen:
            seen.add(current)
            pending.extend(edge["to"] for edge in graph["edges"] if edge["from"] == current)
    return seen


def clear_mb_caches() -> None:
    mb.reset_source_cache()
    for fn in _CACHED_MB_FNS:
        fn.cache_clear()


@pytest.fixture
def isolate_external_sources(monkeypatch):
    """Bloquea red y DB reales y limpia cach?s entre pruebas."""
    clear_mb_caches()
    # Las pruebas de reglas usan orden estable; las de variaci?n activan su propio RNG.
    stable_rng = Random(0)
    monkeypatch.setattr(stable_rng, "uniform", lambda _a, _b: 0.0)
    monkeypatch.setattr(stable_rng, "shuffle", lambda _items: None)
    monkeypatch.setattr(main, "Random", lambda: stable_rng)

    def forbid(*_args, **_kwargs):
        raise AssertionError("No debe tocar red ni base de datos en las pruebas de integraci?n.")

    monkeypatch.setattr(mb, "_get", forbid)
    monkeypatch.setattr(mb, "_lastfm", forbid)
    monkeypatch.setattr(mb, "is_local_db_active", lambda force=False: False)
    monkeypatch.setattr(mb.mb_db, "is_active", lambda _dsn: False)
    monkeypatch.setattr(psycopg, "connect", forbid)

    monkeypatch.setattr(mb, "artists_by_tags", lambda _tags: [])
    monkeypatch.setattr(mb, "similar_songs", lambda _song: ())
    monkeypatch.setattr(mb, "similar_artists", lambda _artist: {})
    monkeypatch.setattr(mb, "collaborators", lambda _artist_id: {})
    monkeypatch.setattr(mb, "album_tracks", lambda _artist_id: [])
    monkeypatch.setattr(mb, "recording_check", lambda _mbid: (False, True))  # oficial y no expl?cita
    yield
    clear_mb_caches()


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)
