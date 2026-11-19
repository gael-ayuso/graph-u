import pytest
from conftest import artist_dict, song_dict, uid

from app import musicbrainz as mb

# isolate_external_sources reemplaza mb.recording_check; guardamos la función real.
real_recording_check = mb.recording_check


@pytest.fixture(autouse=True)
def clear_recording_check_cache():
    real_recording_check.cache_clear()
    yield
    real_recording_check.cache_clear()


@pytest.mark.parametrize(
    "release,expected",
    [
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": []}}, True),
        ({"status": "Official", "release-group": {"primary-type": "Album"}}, True),
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": ["Compilation"]}}, False),
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": ["Live"]}}, False),
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": ["Soundtrack"]}}, False),
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": ["Remix"]}}, False),
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": ["Demo"]}}, False),
        ({"status": "Official", "release-group": {"primary-type": "Album", "secondary-types": ["DJ-mix"]}}, False),
        ({"status": "Bootleg", "release-group": {"primary-type": "Album"}}, False),
    ],
)
def test_release_matches_filters_status_primary_and_secondary_types(release, expected):
    assert mb._release_matches(release) is expected


def test_search_api_discards_compilation_only_and_prefers_studio_album(monkeypatch):
    compilation = {
        "title": "Greatest Hits",
        "status": "Official",
        "release-group": {"primary-type": "Album", "secondary-types": ["Compilation"]},
    }
    live = {
        "title": "Live at Wembley",
        "status": "Official",
        "release-group": {"primary-type": "Album", "secondary-types": ["Live"]},
    }
    studio = {
        "title": "In Rainbows",
        "status": "Official",
        "release-group": {"primary-type": "Album"},
    }
    recordings = [
        {
            "id": uid(1),
            "title": "Reckoner (Live/Comp)",
            "artist-credit": [{"name": "Radiohead"}],
            "releases": [compilation, live],
        },
        {
            "id": uid(2),
            "title": "Reckoner",
            "artist-credit": [{"name": "Radiohead"}],
            "releases": [compilation, studio],
        },
    ]
    calls = []

    def fake_get(path, **params):
        calls.append((path, params))
        return {"recordings": recordings}

    monkeypatch.setattr(mb, "_get", fake_get)
    results = mb._search_api("Reckoner", "Radiohead")

    assert len(calls) == 1
    assert calls[0][0] == "/recording"
    assert calls[0][1]["limit"] == 100
    assert [(song["id"], song["release"]) for song in results] == [(uid(2), "In Rainbows")]


def test_album_tracks_api_queries_single_ep_album_and_discards_compilations(monkeypatch):
    compilation = {
        "title": "Best Of",
        "status": "Official",
        "release-group": {"primary-type": "Album", "secondary-types": ["Compilation"]},
    }
    ep_release = {
        "title": "My Iron Lung EP",
        "status": "Official",
        "release-group": {"primary-type": "EP"},
    }
    recordings = [
        {
            "id": uid(10),
            "title": "Comp Only Track",
            "artist-credit": [{"name": "Radiohead"}],
            "releases": [compilation],
        },
        {
            "id": uid(11),
            "title": "The Trickster",
            "artist-credit": [{"name": "Radiohead"}],
            "releases": [ep_release],
        },
    ]
    calls = []

    def fake_get(path, **params):
        calls.append((path, params))
        return {"recordings": recordings}

    monkeypatch.setattr(mb, "_get", fake_get)
    tracks = mb._album_tracks_api(uid(99))

    assert len(calls) == 1
    path, params = calls[0]
    assert path == "/recording"
    assert "primarytype:single OR primarytype:ep OR primarytype:album" in params["query"]
    assert "status:official" in params["query"]
    assert [track["id"] for track in tracks] == [uid(11)]


def test_public_recording_check_distinguishes_official_from_compilation(monkeypatch):
    monkeypatch.setattr(mb, "is_local_db_active", lambda force=False: False)
    payloads = {
        f"/recording/{uid(1)}": {
            "disambiguation": "",
            "tags": [],
            "releases": [
                {
                    "title": "OK Computer",
                    "status": "Official",
                    "release-group": {"primary-type": "Album"},
                }
            ],
        },
        f"/recording/{uid(2)}": {
            "disambiguation": "",
            "tags": [],
            "releases": [
                {
                    "title": "Greatest Hits",
                    "status": "Official",
                    "release-group": {"primary-type": "Album", "secondary-types": ["Compilation"]},
                }
            ],
        },
    }
    calls = []

    def fake_get(path, **params):
        calls.append((path, params))
        return payloads[path]

    monkeypatch.setattr(mb, "_get", fake_get)

    assert real_recording_check(uid(1)) == (False, True, {"release": "OK Computer"})
    assert real_recording_check(uid(2)) == (False, False, {})
    assert calls == [
        (f"/recording/{uid(1)}", {"inc": "tags+releases+release-groups"}),
        (f"/recording/{uid(2)}", {"inc": "tags+releases+release-groups"}),
    ]


def test_recommendations_allow_explicit_true_skips_unofficial_lastfm_and_does_not_check_catalog(client, monkeypatch):
    seed = uid(1)
    seed_artist = uid(10)
    cand_artist = uid(20)
    lfm_unofficial = song_dict(uid(101), "Live Bootleg Track", "Candidate")
    lfm_official = song_dict(uid(102), "Official Single Track", "Candidate")
    catalog_track = song_dict(uid(103), "Album Studio Track", "Candidate")

    monkeypatch.setattr(
        mb,
        "recording_profile",
        lambda _: (song_dict(seed, "Seed", "Seed Artist"), {"rock": 10}, seed_artist),
    )
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _: [(artist_dict(cand_artist, "Candidate"), {"rock": 10})],
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda _: (
            (lfm_unofficial, 0.95, cand_artist),
            (lfm_official, 0.85, cand_artist),
        ),
    )
    monkeypatch.setattr(mb, "album_tracks", lambda _: [catalog_track])

    checked = []

    def fake_check(mbid: str):
        checked.append(mbid)
        if mbid == uid(101):
            return (False, False)
        if mbid == uid(102):
            return (False, True)
        pytest.fail(f"No debería consultar recording_check para {mbid} del catálogo cuando allowExplicit=True")

    monkeypatch.setattr(mb, "recording_check", fake_check)

    resp = client.post(
        "/api/recommendations",
        json={"seeds": [seed], "allowExplicit": True, "discoveryMode": "conservative", "limit": 2},
    )
    assert resp.status_code == 200
    rec_ids = [rec["song"]["id"] for rec in resp.json()["recommendations"]]

    assert uid(101) not in rec_ids
    assert rec_ids == [uid(102), uid(103)]
    assert checked == [uid(101), uid(102)]


def test_local_sql_queries_filter_secondary_types_and_include_single_ep_album(monkeypatch):
    executed = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, sql, params):
            executed.append((sql, params))

        def fetchall(self):
            return [(uid(100), "Track", "Artist", "Album", None, None, None, None)]

        def fetchone(self):
            return (None, [], "Album", uid(40), uid(41))

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr(mb.mb_db, "_connection", lambda dsn: FakeConnection())

    tracks = mb.mb_db.album_tracks("test-dsn", uid(20))
    metadata = mb.mb_db.recording_content_metadata("test-dsn", uid(30))

    assert len(tracks) == 1
    assert metadata == (None, [], True, {"release": "Album", "releaseMbid": uid(40), "releaseGroupMbid": uid(41)})
    assert len(executed) == 2

    album_sql, album_params = executed[0]
    assert album_params == {"mbid": uid(20)}
    assert "release_group_secondary_type_join" in album_sql
    assert "rg.type IN (1, 2, 3)" in album_sql

    meta_sql, meta_params = executed[1]
    assert meta_params == {"mbid": uid(30)}
    assert "release_group_secondary_type_join" in meta_sql
    assert "rg.type IN (1, 2, 3)" in meta_sql
