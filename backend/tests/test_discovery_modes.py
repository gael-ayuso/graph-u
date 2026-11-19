from random import Random

import pytest
from conftest import artist_dict, reachable_from, song_dict, uid

from app import main
from app import musicbrainz as mb

pytestmark = pytest.mark.usefixtures("isolate_external_sources")


@pytest.fixture
def catalog(monkeypatch):
    seeds = [uid(1), uid(2)]
    shared, rock, jazz, excluded = (uid(i) for i in (20, 21, 22, 23))
    profiles = {
        seeds[0]: (song_dict(seeds[0], "Rock seed", "Rock seed artist"), {"rock": 5}, uid(10)),
        seeds[1]: (song_dict(seeds[1], "Jazz seed", "Jazz seed artist"), {"jazz": 5}, uid(11)),
    }
    candidates = {
        ("rock",): [(artist_dict(shared, "Shared"), {"rock": 5}), (artist_dict(rock, "Rock"), {"rock": 5}), (artist_dict(excluded, "Excluded"), {"rock": 5})],
        ("jazz",): [(artist_dict(shared, "Shared"), {"jazz": 5}), (artist_dict(jazz, "Jazz"), {"jazz": 5}), (artist_dict(excluded, "Excluded"), {"jazz": 5})],
    }
    albums = {
        shared: [song_dict(uid(100), "Shared song", "Shared"), song_dict(uid(101), " shared SONG ", "Shared"), song_dict(uid(102), "Excluded recording", "Shared"), song_dict(uid(103), "Excluded version", "Shared")],
        rock: [song_dict(uid(110), "Rock song", "Rock")],
        jazz: [song_dict(uid(120), "Jazz song", "Jazz")],
        excluded: [song_dict(uid(130), "Excluded artist", "Excluded")],
    }
    monkeypatch.setattr(mb, "recording_profile", lambda sid: profiles[sid])
    monkeypatch.setattr(mb, "artists_by_tags", lambda tags: candidates.get(tags, []))
    monkeypatch.setattr(mb, "album_tracks", lambda aid: albums.get(aid, []))
    return {
        "seeds": [*seeds, seeds[0]], "limit": 10,
        "excludeArtists": [excluded], "excludeRecordings": [uid(102)],
        "excludeVersions": [{"artistId": shared, "title": " excluded VERSION "}],
    }


def request(client, monkeypatch, payload):
    monkeypatch.setattr(main, "Random", lambda: Random(7))
    response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 200
    return response.json()


def test_omitted_mode_matches_explicit_balanced(client, monkeypatch, catalog):
    assert request(client, monkeypatch, catalog) == request(
        client, monkeypatch, {**catalog, "discoveryMode": "balanced"}
    )


@pytest.mark.parametrize("mode", ["conservative", "balanced", "adventurous"])
def test_multi_seed_invariants_across_discovery_modes(client, monkeypatch, catalog, mode):
    data = request(client, monkeypatch, {**catalog, "discoveryMode": mode})
    recommendations = data["recommendations"]
    ids = [rec["song"]["id"] for rec in recommendations]
    assert len(ids) == len(set(ids)) == 3
    assert set(ids) & {uid(100), uid(101)} in ({uid(100)}, {uid(101)})
    assert {uid(110), uid(120)} <= set(ids)
    assert {uid(102), uid(103), uid(130), uid(1), uid(2)}.isdisjoint(ids)
    assert all(rec["artistId"] != uid(23) for rec in recommendations)
    shared = next(rec for rec in recommendations if rec["artistId"] == uid(20))
    assert set(shared["seedIds"]) == {uid(1), uid(2)}
    assert {reason["seedId"] for reason in shared["reasons"]} == {uid(1), uid(2)}
    results = {result["seedId"]: result for result in data["seedResults"]}
    assert len(data["seedResults"]) == 2
    graph = data["graph"]
    nodes = {node["id"] for node in graph["nodes"]}
    assert all(edge["from"] in nodes and edge["to"] in nodes for edge in graph["edges"])
    for seed in (uid(1), uid(2)):
        expected = {rec["song"]["id"] for rec in recommendations if seed in rec["seedIds"]}
        assert results[seed]["status"] == "recommended"
        assert set(results[seed]["recommendationIds"]) == expected
        reachable = reachable_from(graph, f"seed:{seed}")
        assert {f"song:{song_id}" for song_id in expected} <= reachable
