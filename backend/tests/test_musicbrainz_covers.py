"""Tests para extracción de releaseMbid / releaseGroupMbid para portadas."""

import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import musicbrainz as mb
from app import musicbrainz_db as db


class _Conn:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        self._res = next(self.responses)

    def fetchall(self):
        return self._res

    def fetchone(self):
        return self._res[0] if self._res else None


def test_song_row_emits_cover_mbids_only_when_present():
    rec_id = UUID("d9b46ecb-5472-4dcd-8fa4-dd6723189e27")
    rel_id = UUID("ea92a194-2d60-35c7-9d56-0e1dba20cd45")
    rg_id = UUID("6e335887-60ba-38f0-95af-fae7774336bf")

    minimal = db._song_row(rec_id, "Reckoner", "Radiohead", "In Rainbows", 290000, None)
    assert minimal == {
        "id": str(rec_id),
        "title": "Reckoner",
        "artist": "Radiohead",
        "release": "In Rainbows",
        "duration": 290000,
        "comment": None,
    }

    with_cover = db._song_row(rec_id, "Reckoner", "Radiohead", "In Rainbows", 290000, None, rel_id, rg_id)
    assert with_cover["releaseMbid"] == str(rel_id)
    assert with_cover["releaseGroupMbid"] == str(rg_id)


def test_search_and_album_tracks_include_release_mbid_from_caa_join(monkeypatch):
    rec_id = UUID("d9b46ecb-5472-4dcd-8fa4-dd6723189e27")
    rel_id = UUID("ea92a194-2d60-35c7-9d56-0e1dba20cd45")
    rg_id = UUID("6e335887-60ba-38f0-95af-fae7774336bf")

    conn = _Conn([
        [(rec_id, "Reckoner", "Radiohead", "In Rainbows", 290000, None, rel_id, rg_id)],
        [(rec_id, "Reckoner", "Radiohead", "In Rainbows", 290000, None, rel_id, rg_id)],
    ])
    monkeypatch.setattr(db, "_connection", lambda _dsn: conn)

    found = db.search("local", "Reckoner", "Radiohead")
    assert found[0]["releaseMbid"] == str(rel_id)
    assert found[0]["releaseGroupMbid"] == str(rg_id)
    assert "cover_art_archive.cover_art" in conn.calls[0][0]

    tracks = db.album_tracks("local", "a74b1b7f-71a5-4011-9441-d0b5e4122711")
    assert tracks[0]["releaseMbid"] == str(rel_id)
    assert tracks[0]["releaseGroupMbid"] == str(rg_id)
    assert "cover_art_archive.cover_art" in conn.calls[1][0]


def test_public_api_song_includes_release_mbid_when_available():
    recording = {
        "id": "d9b46ecb-5472-4dcd-8fa4-dd6723189e27",
        "title": "Reckoner",
        "artist-credit": [{"name": "Radiohead", "joinphrase": ""}],
        "releases": [
            {
                "id": "ea92a194-2d60-35c7-9d56-0e1dba20cd45",
                "title": "In Rainbows",
                "status": "Official",
                "release-group": {
                    "id": "6e335887-60ba-38f0-95af-fae7774336bf",
                    "primary-type": "Album",
                },
            }
        ],
    }
    song = mb._song(recording)
    assert song["releaseMbid"] == "ea92a194-2d60-35c7-9d56-0e1dba20cd45"
    assert song["releaseGroupMbid"] == "6e335887-60ba-38f0-95af-fae7774336bf"
