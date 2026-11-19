import pytest
from conftest import artist_dict, reachable_from, song_dict, uid

from app import main
from app import musicbrainz as mb

pytestmark = pytest.mark.usefixtures("isolate_external_sources")


@pytest.mark.parametrize("field,value", [
    ("allowExplicit", 1), ("allowExplicit", "false"), ("allowExplicit", None),
    ("preferredTags", "rock"), ("preferredTags", [""]), ("preferredTags", ["  "]),
    ("preferredTags", ["x" * 41]), ("preferredTags", [3]), ("preferredTags", ["x"] * 31),
])
def test_invalid_preferences_rejected_before_source(client, monkeypatch, field, value):
    calls = []
    monkeypatch.setattr(mb, "recording_profile", lambda sid: calls.append(sid))
    assert client.post("/api/recommendations", json={"seeds": [uid(1)], field: value}).status_code == 422
    assert calls == []


def test_tags_normalize_and_deduplicate():
    body = main.RecommendationRequest.model_validate({"seeds": [uid(1)], "preferredTags": [" Jazz ", "JAZZ", "Straße", "STRASSE"]})
    assert body.preferred_tags == ["jazz", "strasse"]
    assert body.allow_explicit is True


def test_preferred_candidates_change_order_not_score_or_graph(client, monkeypatch):
    seed, best, preferred, unrelated = uid(1), uid(20), uid(21), uid(22)
    monkeypatch.setattr(mb, "recording_profile", lambda _: (song_dict(seed, "Seed", "Seed artist"), {"rock": 10}, uid(10)))
    queries = []
    def by_tags(tags):
        queries.append(tags)
        return {
            ("rock",): [(artist_dict(best, "Best"), {"rock": 10}), (artist_dict(preferred, "Preferred"), {"rock": 9, "jazz": 1})],
            ("jazz",): [(artist_dict(preferred, "Preferred"), {"rock": 9, "jazz": 1}), (artist_dict(unrelated, "Unrelated"), {"jazz": 5})],
        }.get(tags, [])
    monkeypatch.setattr(mb, "artists_by_tags", by_tags)
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song_dict(uid(100 + int(aid[-2:], 16)), "Track", aid)])
    def run(**options):
        response = client.post("/api/recommendations", json={"seeds": [seed], "limit": 2, "discoveryMode": "conservative", **options})
        assert response.status_code == 200
        return response.json()
    legacy = run()
    assert legacy == run(preferredTags=[])
    baseline = {r["artistId"]: r for r in legacy["recommendations"]}
    result = run(preferredTags=[" Jazz ", "jazz"])
    recs = result["recommendations"]
    assert [r["artistId"] for r in recs] == [preferred, best]
    assert ("jazz",) in queries
    for rec in recs:
        assert rec["score"] == baseline[rec["artistId"]]["score"]
        assert rec["sharedTags"] == ["rock"]
        assert rec["reasons"] == baseline[rec["artistId"]]["reasons"]
        assert f"song:{rec['song']['id']}" in reachable_from(result["graph"], f"seed:{seed}")
    assert unrelated not in [r["artistId"] for r in recs]
    assert [r["artistId"] for r in run(preferredTags=["jazz"], excludeArtists=[preferred])["recommendations"]] == [best]


def test_tagless_preferences_cannot_create_a_signal(client, monkeypatch):
    monkeypatch.setattr(mb, "recording_profile", lambda sid: (song_dict(sid, "Seed", "Seed artist"), {}, uid(10)))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [(artist_dict(uid(20), "Unrelated"), {"jazz": 5}), (artist_dict(uid(21), "Related"), {"jazz": 5})])
    monkeypatch.setattr(mb, "similar_artists", lambda _: {uid(21): (artist_dict(uid(21), "Related"), 0.8)})
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song_dict(uid(100), "Song", aid)])
    data = client.post("/api/recommendations", json={"seeds": [uid(1)], "preferredTags": ["jazz"]}).json()
    assert [r["artistId"] for r in data["recommendations"]] == [uid(21)]
    assert data["recommendations"][0]["sharedTags"] == []
