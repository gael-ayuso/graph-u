"""Casos de integración remotos adaptados al contrato actual de recomendaciones."""

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


def uid(n):
    return str(UUID(int=n))


def song(n, title, artist):
    return {"id": uid(n), "title": title, "artist": artist, "release": None, "duration": None, "comment": None}


@pytest.fixture(autouse=True)
def isolate_sources(monkeypatch):
    def forbid(*args, **kwargs):
        raise AssertionError("No se permiten llamadas a red ni DB reales")

    rng = Random(0)
    monkeypatch.setattr(rng, "uniform", lambda *_: 0)
    monkeypatch.setattr(rng, "shuffle", lambda _: None)
    monkeypatch.setattr(main, "Random", lambda: rng)
    monkeypatch.setattr(mb, "_get", forbid)
    monkeypatch.setattr(mb, "_lastfm", forbid)
    monkeypatch.setattr(psycopg, "connect", forbid)
    monkeypatch.setattr(mb, "is_local_db_active", lambda force=False: False)
    monkeypatch.setattr(mb.mb_db, "is_active", lambda _: False)
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [])
    monkeypatch.setattr(mb, "similar_songs", lambda _: ())
    monkeypatch.setattr(mb, "similar_artists", lambda _: {})
    monkeypatch.setattr(mb, "collaborators", lambda _: {})
    monkeypatch.setattr(mb, "album_tracks", lambda _: [])
    mb._versions.cache_clear()
    yield
    mb._versions.cache_clear()


@pytest.fixture
def client():
    return TestClient(main.app)


def test_versions_case_insensitive_and_missing_credits(monkeypatch):
    calls = []

    def fake_get(path, **params):
        assert path == "/recording"
        calls.append(params["query"])
        return {"recordings": [
            {"id": "r1", "title": "Las Nieves de Enero", "artist-credit": [{"artist": {"id": "a1", "name": "Chalino"}}]},
            {"id": "r2", "title": "las nieves de enero", "artist-credit": [{"artist": {"id": "a1", "name": "Chalino"}}]},
            {"id": "r3", "title": "LAS NIEVES DE ENERO", "artist-credit": [{"artist": {"id": "a2", "name": "Banda"}}]},
            {"id": "r4", "title": "Las Nieves de Enero (En Vivo)", "artist-credit": [{"artist": {"id": "a3", "name": "Otro"}}]},
            {"id": "r5", "title": "Las Nieves de Enero", "artist-credit": []},
            {"id": "r6", "title": "Las Nieves de Enero", "artist-credit": None},
            {"id": "r7", "title": "Las Nieves de Enero"},
        ]}

    monkeypatch.setattr(mb, "_get", fake_get)
    assert mb._versions("Las Nieves de Enero") == {
        "a1": ({"id": "a1", "name": "Chalino"}, 1.0), "a2": ({"id": "a2", "name": "Banda"}, 0.5),
    }
    assert calls == ['recording:"Las Nieves de Enero"']


def test_tagless_without_signals_returns_empty_result_without_inventing_versions(client, monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: (song(1, "Tradicional", "Anónimo"), {}, None))
    calls = []
    monkeypatch.setattr(mb, "versions", lambda title: calls.append(title) or {uid(20): ({"id": uid(20), "name": "Otro"}, 1.0)})
    response = client.post("/api/recommendations", json={"seeds": [uid(1)]})
    assert response.status_code == 200
    body = response.json()
    assert body["recommendations"] == [] and body["seedTags"] == []
    assert body["seedResults"][0]["status"] == "no_candidates"
    assert calls == []
    assert (f"seed:{uid(1)}", f"status:{uid(1)}") in {(e["from"], e["to"]) for e in body["graph"]["edges"]}


def test_multiple_seeds_without_data_return_status_for_each(client, monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: ({**song(1, "Rara", "Nadie"), "id": sid}, {}, None))
    response = client.post("/api/recommendations", json={"seeds": [uid(1), uid(2)]})
    assert response.status_code == 200
    body = response.json()
    assert body["recommendations"] == []
    assert [r["status"] for r in body["seedResults"]] == ["no_candidates", "no_candidates"]
    assert all(f"status:{sid}" in {n["id"] for n in body["graph"]["nodes"]} for sid in (uid(1), uid(2)))


def test_duplicate_seeds_exclusions_and_track_deduplication(client, monkeypatch):
    calls = []
    def profile(sid):
        calls.append(sid)
        return ({**song(1, "Reckoner" if sid == uid(1) else "Weird Fishes", "Radiohead"), "id": sid}, {"rock": 5}, uid(10))
    monkeypatch.setattr(mb, "recording_profile", profile)
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [({"id": uid(i), "name": name}, {"rock": 5}) for i, name in [(10, "Radiohead"), (11, "Excluded"), (12, "Good")]])
    monkeypatch.setattr(mb, "similar_songs", lambda _: (
        (song(1, "Seed ID", "Good"), 1, uid(12)), (song(101, "Cloudbusting", "Good"), 0.9, uid(12)),
    ))
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song(102, "cloudbusting", "Good"), song(103, "Hounds", "Good")] if aid == uid(12) else [])
    response = client.post("/api/recommendations", json={"seeds": [uid(1), uid(1), uid(2)], "excludeArtists": [uid(10), uid(11)]})
    assert response.status_code == 200
    recs = response.json()["recommendations"]
    assert calls == [uid(1), uid(2)]
    assert [r["song"]["id"] for r in recs] == [uid(101), uid(103)]
    assert all(r["artistId"] == uid(12) for r in recs)
    assert recs[0]["signals"] == ["songs"] and recs[1]["signals"] == []


def test_minorities_keep_coverage_and_valid_edges(client, monkeypatch):
    tags = {uid(1): {"pop": 10, "dance": 8}, uid(2): {"pop": 9}, uid(3): {"jazz": 1}, uid(4): {}}
    monkeypatch.setattr(mb, "recording_profile", lambda sid: ({**song(1, sid, sid), "id": sid}, tags[sid], uid(10 + int(UUID(sid)))))
    monkeypatch.setattr(mb, "artists_by_tags", lambda ts: [({"id": uid(20), "name": "Pop"}, {"pop": 5, "dance": 5}), ({"id": uid(21), "name": "Jazz"}, {"jazz": 5})])
    monkeypatch.setattr(mb, "similar_songs", lambda s: ((song(104, "Corrido", "Corrido"), 0.9, uid(24)),) if s["id"] == uid(4) else ())
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song(100 + int(UUID(aid)), "Track", aid)])
    response = client.post("/api/recommendations", json={"seeds": list(tags), "limit": 6})
    assert response.status_code == 200
    body = response.json()
    assert all(r["status"] == "recommended" for r in body["seedResults"])
    nodes = {n["id"]: n for n in body["graph"]["nodes"]}
    assert all(nodes[f"seed:{sid}"]["degree"] > 0 for sid in tags)
    assert all(e["from"] in nodes and e["to"] in nodes for e in body["graph"]["edges"])


def test_limit_smaller_than_seeds_preserves_status_and_graph(client, monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: ({**song(1, sid, sid), "id": sid}, {sid: 5}, uid(10 + int(UUID(sid)))))
    monkeypatch.setattr(mb, "artists_by_tags", lambda tags: [({"id": uid(20 + int(UUID(tags[0]))), "name": "Candidate"}, {tags[0]: 5})])
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song(100 + int(UUID(aid)), "Track", "Candidate")])
    response = client.post("/api/recommendations", json={"seeds": [uid(1), uid(2), uid(3)], "limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert len(body["recommendations"]) == 2
    assert [r["status"] for r in body["seedResults"]] == ["recommended", "recommended", "limit"]
    nodes = {n["id"] for n in body["graph"]["nodes"]}
    assert {f"seed:{uid(i)}" for i in (1, 2, 3)} <= nodes
    assert f"status:{uid(3)}" in nodes
    assert all(e["from"] in nodes and e["to"] in nodes for e in body["graph"]["edges"])


def test_excluded_signals_do_not_suppress_other_real_candidate(client, monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: (song(1, "Traditional", "Singer"), {}, uid(10)))
    monkeypatch.setattr(mb, "similar_artists", lambda _: {uid(11): ({"id": uid(11), "name": "Excluded"}, 1)})
    monkeypatch.setattr(mb, "similar_songs", lambda _: ((song(101, "Fresh", "Other"), 0.8, uid(12)),))
    response = client.post("/api/recommendations", json={"seeds": [uid(1)], "excludeArtists": [uid(11)]})
    assert response.status_code == 200
    recs = response.json()["recommendations"]
    assert [r["artistId"] for r in recs] == [uid(12)]
    assert recs[0]["signals"] == ["songs"]


def test_minority_tag_remains_in_its_own_branch(client, monkeypatch):
    tags = {uid(1): {"rock": 10, "indie": 9, "alternative": 8}, uid(2): {"shoegaze": 1}}
    monkeypatch.setattr(mb, "recording_profile", lambda sid: ({**song(1, sid, sid), "id": sid}, tags[sid], uid(10 + int(UUID(sid)))))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [({"id": uid(20), "name": "Shared"}, {"rock": 1, "indie": 1, "alternative": 1, "shoegaze": 5})])
    monkeypatch.setattr(mb, "album_tracks", lambda _: [song(101, "Track", "Shared")])
    response = client.post("/api/recommendations", json={"seeds": [uid(1), uid(2)]})
    assert response.status_code == 200
    rec = response.json()["recommendations"][0]
    reasons = {r["seedId"]: r for r in rec["reasons"]}
    assert reasons[uid(2)]["sharedTags"] == ["shoegaze"]
    edges = {(e["from"], e["to"]) for e in response.json()["graph"]["edges"]}
    assert (f"seed:{uid(2)}", f"tag:{uid(2)}:shoegaze") in edges


def test_duplicate_hints_trigger_album_fallback(client, monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: ({**song(1, sid, "Seed"), "id": sid}, {"rock": 5}, uid(10)))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [({"id": uid(20), "name": "Good"}, {"rock": 5})])
    monkeypatch.setattr(mb, "similar_songs", lambda _: ((song(101, "Cloudbusting", "Good"), 0.9, uid(20)), (song(102, " cloudbusting ", "Good"), 0.8, uid(20))))
    calls = []
    monkeypatch.setattr(mb, "album_tracks", lambda aid: calls.append(aid) or [song(103, "Hounds", "Good")])
    response = client.post("/api/recommendations", json={"seeds": [uid(1), uid(2)]})
    assert response.status_code == 200
    assert [r["song"]["id"] for r in response.json()["recommendations"]] == [uid(101), uid(103)]
    assert calls == [uid(20)]
