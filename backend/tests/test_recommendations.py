"""Pruebas de integración de POST /api/recommendations (FastAPI + TestClient).

Ejecuta: backend/.venv/Scripts/python -m pytest backend/tests/test_recommendations.py
"""

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
    mb._artist_tags,
    mb.artists_by_tags,
    mb.album_tracks,
    mb._collaborators,
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


@pytest.fixture(autouse=True)
def isolate_external_sources(monkeypatch):
    """Bloquea red y DB reales y limpia cachés entre pruebas."""
    clear_mb_caches()
    # Las pruebas de reglas usan orden estable; las de variación activan su propio RNG.
    stable_rng = Random(0)
    monkeypatch.setattr(stable_rng, "uniform", lambda _a, _b: 0.0)
    monkeypatch.setattr(stable_rng, "shuffle", lambda _items: None)
    monkeypatch.setattr(main, "Random", lambda: stable_rng)

    def forbid(*_args, **_kwargs):
        raise AssertionError("No debe tocar red ni base de datos en las pruebas de integración.")

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
    yield
    clear_mb_caches()


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def test_repeated_seed_varies_selected_artists_without_changing_scores(client, monkeypatch):
    seed, seed_artist, excluded_artist = uid(1), uid(10), uid(11)
    monkeypatch.setattr(mb, "recording_profile", lambda _: (song_dict(seed, "Seed", "Seed Artist"), {"rock": 10}, seed_artist))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [
        (artist_dict(aid, aid), {"rock": 10}) for aid in [seed_artist, excluded_artist, *(uid(i) for i in range(20, 28))]
    ])
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song_dict(uid(int(UUID(aid)) + 100), aid, aid)])
    selections = set()
    for trial in range(8):
        # Entropía controlada para probar variación sin depender del azar del test.
        monkeypatch.setattr(main, "Random", lambda trial=trial: Random(trial))
        response = client.post("/api/recommendations", json={"seeds": [seed], "excludeArtists": [seed_artist, excluded_artist], "limit": 2})
        assert response.status_code == 200
        data = response.json()
        recs = data["recommendations"]
        assert len(recs) == 2
        assert all(rec["artistId"] not in {seed_artist, excluded_artist} for rec in recs)
        assert all(rec["score"] == 1.0 and rec["seedIds"] == [seed] for rec in recs)
        assert data["seedResults"][0]["status"] == "recommended"
        selections.add(frozenset(rec["song"]["id"] for rec in recs))
    assert len(selections) > 1  # Cambia la selección, además del orden.


def test_repeated_seed_varies_album_tracks_and_preserves_cached_catalog(client, monkeypatch):
    seed, artist = uid(1), uid(20)
    catalog = [song_dict(uid(i), f"Track {i}", "Candidate") for i in range(100, 110)]
    original = list(catalog)
    monkeypatch.setattr(mb, "recording_profile", lambda _: (song_dict(seed, "Seed", "Seed Artist"), {"rock": 10}, uid(10)))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [(artist_dict(artist, "Candidate"), {"rock": 10})])
    monkeypatch.setattr(mb, "album_tracks", lambda _: catalog)
    selections = set()
    for trial in range(8):
        monkeypatch.setattr(main, "Random", lambda trial=trial: Random(trial))
        response = client.post("/api/recommendations", json={
            "seeds": [seed], "limit": 2, "excludeRecordings": [uid(100)],
            "excludeVersions": [{"artistId": artist, "title": "Track 101"}],
        })
        assert response.status_code == 200
        data = response.json()
        recs = data["recommendations"]
        assert len(recs) == 2
        assert all(rec["song"]["id"] not in {uid(100), uid(101)} for rec in recs)
        assert all(rec["score"] == 1.0 and rec["signals"] == [] for rec in recs)
        assert all(f"song:{rec['song']['id']}" in reachable_from(data["graph"], f"seed:{seed}") for rec in recs)
        selections.add(frozenset(rec["song"]["id"] for rec in recs))
    assert len(selections) > 1
    assert catalog == original


def test_track_exploration_keeps_strong_hints_ahead_and_varies_close_matches():
    hints = [(score, song_dict(uid(i), f"Track {i}", "Candidate"))
             for i, score in [(100, 1.0), (101, 0.65), (102, 0.64), (103, 0.2)]]
    original = list(hints)
    orders = set()
    for trial in range(8):
        tracks = main._tracks(uid(20), {uid(20): hints}, {}, rng=Random(trial))
        assert tracks[0]["id"] == uid(100)
        assert tracks[-1]["id"] == uid(103)
        orders.add(tuple(track["id"] for track in tracks))
    assert len(orders) > 1
    assert hints == original


def test_artist_exploration_never_promotes_a_distant_match(client, monkeypatch):
    seed = uid(1)
    monkeypatch.setattr(mb, "recording_profile", lambda _: (song_dict(seed, "Seed", "Seed Artist"), {}, uid(10)))
    monkeypatch.setattr(mb, "similar_artists", lambda _: {
        uid(i): (artist_dict(uid(i), f"Artist {i}"), score)
        for i, score in [(20, 0.95), (21, 0.94), (22, 0.2)]
    })
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [song_dict(uid(int(UUID(aid)) + 100), aid, aid)])
    for trial in range(8):
        monkeypatch.setattr(main, "Random", lambda trial=trial: Random(trial))
        response = client.post("/api/recommendations", json={"seeds": [seed], "limit": 1})
        assert response.status_code == 200
        rec = response.json()["recommendations"][0]
        assert rec["artistId"] in {uid(20), uid(21)}
        assert rec["score"] in {0.95, 0.94}


def test_independent_seed_styles_round_robin_and_branch_graph(client, monkeypatch) -> None:
    s_rock, s_salsa = uid(1), uid(2)
    a_rock_seed, a_salsa_seed = uid(10), uid(20)
    a_rock_1, a_rock_2, a_salsa_1 = uid(11), uid(12), uid(21)

    profiles = {
        s_rock: (song_dict(s_rock, "Rock Anthem", "Rock Seed"), {"rock": 500, "alternative rock": 400, "indie rock": 300}, a_rock_seed),
        s_salsa: (song_dict(s_salsa, "Salsa Clásica", "Salsa Seed"), {"salsa": 1}, a_salsa_seed),
    }
    by_tags = {
        ("rock", "alternative rock", "indie rock"): [
            (artist_dict(a_rock_1, "Rock Band 1"), {"rock": 10, "alternative rock": 8}),
            (artist_dict(a_rock_2, "Rock Band 2"), {"rock": 9, "indie rock": 7}),
        ],
        ("salsa",): [
            (artist_dict(a_salsa_1, "Orquesta Salsa"), {"salsa": 5}),
        ],
    }
    albums = {
        a_rock_1: [song_dict(uid(101), "Rock Song 1A", "Rock Band 1"), song_dict(uid(102), "Rock Song 1B", "Rock Band 1")],
        a_rock_2: [song_dict(uid(103), "Rock Song 2A", "Rock Band 2")],
        a_salsa_1: [song_dict(uid(201), "Salsa Song A", "Orquesta Salsa"), song_dict(uid(202), "Salsa Song B", "Orquesta Salsa")],
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(mb, "artists_by_tags", lambda tags: by_tags.get(tags, []))
    monkeypatch.setattr(mb, "album_tracks", lambda aid: albums.get(aid, []))

    resp = client.post("/api/recommendations", json={"seeds": [s_rock, s_salsa], "limit": 4})
    assert resp.status_code == 200
    data = resp.json()

    # Reparto por turnos: la minoría salsa recibe espacio alternado con rock.
    rec_ids = [r["song"]["id"] for r in data["recommendations"]]
    assert rec_ids == [uid(101), uid(201), uid(103), uid(202)]
    assert data["recommendations"][0]["seedIds"] == [s_rock]
    assert data["recommendations"][1]["seedIds"] == [s_salsa]
    assert data["recommendations"][1]["sharedTags"] == ["salsa"]
    assert data["seedTags"] == ["rock", "alternative rock", "indie rock", "salsa"]

    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s_rock]["status"] == "recommended"
    assert by_seed[s_rock]["recommendationIds"] == [uid(101), uid(103)]
    assert by_seed[s_rock]["artistId"] == a_rock_seed
    assert by_seed[s_rock]["searchLimited"] is False
    assert by_seed[s_salsa]["status"] == "recommended"
    assert by_seed[s_salsa]["recommendationIds"] == [uid(201), uid(202)]
    assert by_seed[s_salsa]["artistId"] == a_salsa_seed
    assert by_seed[s_salsa]["searchLimited"] is False

    # Grafo aislado por rama: rock no alcanza canciones de salsa y viceversa.
    graph = data["graph"]
    node_ids = {n["id"] for n in graph["nodes"]}
    assert all(e["from"] in node_ids and e["to"] in node_ids for e in graph["edges"])
    rock_reach = reachable_from(graph, f"seed:{s_rock}")
    salsa_reach = reachable_from(graph, f"seed:{s_salsa}")
    assert {f"song:{uid(101)}", f"song:{uid(103)}"} <= rock_reach
    assert {f"song:{uid(201)}", f"song:{uid(202)}"}.isdisjoint(rock_reach)
    assert {f"song:{uid(201)}", f"song:{uid(202)}"} <= salsa_reach
    assert {f"song:{uid(101)}", f"song:{uid(103)}"}.isdisjoint(salsa_reach)


def test_tagless_seeds_use_lastfm_and_collaborators(client, monkeypatch) -> None:
    s_lfm, s_collab = uid(1), uid(2)
    a_lfm_seed, a_collab_seed = uid(10), uid(20)
    a_lfm_song, a_lfm_artist, a_collab_artist = uid(11), uid(12), uid(21)

    profiles = {
        s_lfm: (song_dict(s_lfm, "No Tags LFM", "Seed LFM"), {}, a_lfm_seed),
        s_collab: (song_dict(s_collab, "No Tags Collab", "Seed Collab"), {}, a_collab_seed),
    }

    def fail_if_tags_called(_tags):
        raise AssertionError("artists_by_tags no debe llamarse cuando ninguna semilla tiene etiquetas.")

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(mb, "artists_by_tags", fail_if_tags_called)
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda song: ((song_dict(uid(101), "LFM Similar Track", "LFM Song Artist"), 0.9, a_lfm_song),)
        if song["id"] == s_lfm
        else (),
    )
    monkeypatch.setattr(
        mb,
        "similar_artists",
        lambda artist: {a_lfm_artist: (artist_dict(a_lfm_artist, "LFM Sim Artist"), 0.8)}
        if artist == "Seed LFM"
        else {},
    )
    monkeypatch.setattr(
        mb,
        "collaborators",
        lambda aid: {a_collab_artist: (artist_dict(a_collab_artist, "Collab Partner"), 1.0)}
        if aid == a_collab_seed
        else {},
    )
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda aid: {
            a_lfm_artist: [song_dict(uid(102), "LFM Artist Track", "LFM Sim Artist")],
            a_collab_artist: [song_dict(uid(201), "Collab Track", "Collab Partner")],
        }.get(aid, []),
    )

    resp = client.post("/api/recommendations", json={"seeds": [s_lfm, s_collab], "limit": 10})
    assert resp.status_code == 200
    data = resp.json()

    assert data["seedTags"] == []
    recs = {r["song"]["id"]: r for r in data["recommendations"]}
    assert set(recs) == {uid(101), uid(102), uid(201)}
    assert recs[uid(101)]["signals"] == ["songs"]
    assert recs[uid(101)]["sharedTags"] == []
    assert recs[uid(102)]["signals"] == ["listeners"]
    assert recs[uid(201)]["signals"] == ["collab"]
    assert recs[uid(201)]["seedIds"] == [s_collab]


def test_unavailable_seed_failures_do_not_block_healthy_seeds(client, monkeypatch) -> None:
    s_bad_profile, s_bad_tags, s_bad_tracks, s_partial, s_ok = uid(1), uid(2), uid(3), uid(4), uid(5)
    a_bad_tracks, a_partial_seed, a_partial_cand, a_ok_seed, a_ok_cand = uid(10), uid(20), uid(21), uid(30), uid(31)

    def fake_profile(mbid: str):
        if mbid == s_bad_profile:
            raise mb.MusicBrainzError("No se encontró la canción en MusicBrainz.", 404)
        return {
            s_bad_tags: (song_dict(s_bad_tags, "Broken Tags", "A1"), {"jazz": 5}, uid(91)),
            s_bad_tracks: (song_dict(s_bad_tracks, "Broken Tracks", "A2"), {"blues": 5}, uid(92)),
            s_partial: (song_dict(s_partial, "Partial Fail", "A3"), {"funk": 5}, a_partial_seed),
            s_ok: (song_dict(s_ok, "Healthy", "A4"), {"soul": 5}, a_ok_seed),
        }[mbid]

    def fake_by_tags(tags: tuple[str, ...]):
        if tags in {("jazz",), ("funk",)}:
            raise mb.MusicBrainzError("MusicBrainz no respondió correctamente.", 503)
        if tags == ("blues",):
            return [(artist_dict(a_bad_tracks, "Failing Tracks Artist"), {"blues": 5})]
        if tags == ("soul",):
            return [(artist_dict(a_ok_cand, "Soul Artist"), {"soul": 5})]
        return []

    def fake_album_tracks(aid: str):
        if aid == a_bad_tracks:
            raise mb.MusicBrainzError("Timeout album tracks", 503)
        if aid == a_partial_cand:
            return [song_dict(uid(401), "Partial Collab Track", "Partial Collab")]
        if aid == a_ok_cand:
            return [song_dict(uid(501), "Soul Track", "Soul Artist")]
        return []

    monkeypatch.setattr(mb, "recording_profile", fake_profile)
    monkeypatch.setattr(mb, "artists_by_tags", fake_by_tags)
    monkeypatch.setattr(
        mb,
        "collaborators",
        lambda aid: {a_partial_cand: (artist_dict(a_partial_cand, "Partial Collab"), 1.0)} if aid == a_partial_seed else {},
    )
    monkeypatch.setattr(mb, "album_tracks", fake_album_tracks)

    resp = client.post(
        "/api/recommendations",
        json={"seeds": [s_bad_profile, s_bad_tags, s_bad_tracks, s_partial, s_ok], "limit": 10},
    )
    assert resp.status_code == 200
    data = resp.json()

    rec_ids = {r["song"]["id"] for r in data["recommendations"]}
    assert rec_ids == {uid(401), uid(501)}

    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s_bad_profile]["status"] == "unavailable"
    assert by_seed[s_bad_profile]["artistId"] is None
    assert by_seed[s_bad_profile]["searchLimited"] is False
    assert by_seed[s_bad_tags]["status"] == "unavailable"
    assert by_seed[s_bad_tracks]["status"] == "unavailable"
    assert by_seed[s_partial]["status"] == "recommended"
    assert by_seed[s_ok]["status"] == "recommended"

    graph_nodes = {n["id"]: n for n in data["graph"]["nodes"]}
    graph_edges = {(e["from"], e["to"]) for e in data["graph"]["edges"]}
    for failed_id in (s_bad_profile, s_bad_tags, s_bad_tracks):
        assert f"status:{failed_id}" in graph_nodes
        assert (f"seed:{failed_id}", f"status:{failed_id}") in graph_edges


def test_seed_statuses_no_candidates_no_tracks_and_limit(client, monkeypatch) -> None:
    s_no_cand, s_no_tracks, s_rec_1, s_rec_2, s_limit = uid(1), uid(2), uid(3), uid(4), uid(5)
    a_no_tracks, a_rec_1, a_rec_2, a_limit = uid(10), uid(11), uid(12), uid(13)

    profiles = {
        s_no_cand: (song_dict(s_no_cand, "Empty", "Unknown"), {}, None),
        s_no_tracks: (song_dict(s_no_tracks, "No Tracks", "A2"), {"ambient": 4}, uid(91)),
        s_rec_1: (song_dict(s_rec_1, "First", "A3"), {"rock": 4}, uid(92)),
        s_rec_2: (song_dict(s_rec_2, "Second", "A4"), {"pop": 4}, uid(93)),
        s_limit: (song_dict(s_limit, "Capped", "A5"), {"jazz": 4}, uid(94)),
    }
    by_tags = {
        ("ambient",): [(artist_dict(a_no_tracks, "Empty Catalog"), {"ambient": 4})],
        ("rock",): [(artist_dict(a_rec_1, "Rock Artist"), {"rock": 4})],
        ("pop",): [(artist_dict(a_rec_2, "Pop Artist"), {"pop": 4})],
        ("jazz",): [(artist_dict(a_limit, "Jazz Artist"), {"jazz": 4})],
    }
    albums = {
        a_no_tracks: [],
        a_rec_1: [song_dict(uid(301), "Rock Pick", "Rock Artist")],
        a_rec_2: [song_dict(uid(401), "Pop Pick", "Pop Artist")],
        a_limit: [song_dict(uid(501), "Jazz Pick", "Jazz Artist")],
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(mb, "artists_by_tags", lambda tags: by_tags.get(tags, []))
    monkeypatch.setattr(mb, "album_tracks", lambda aid: albums.get(aid, []))

    resp = client.post(
        "/api/recommendations",
        json={"seeds": [s_no_cand, s_no_tracks, s_rec_1, s_rec_2, s_limit], "limit": 2},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(301), uid(401)]
    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s_no_cand]["status"] == "no_candidates"
    assert by_seed[s_no_cand]["artistId"] is None
    assert "No tiene etiquetas" in by_seed[s_no_cand]["message"]
    assert by_seed[s_no_tracks]["status"] == "no_tracks"
    assert by_seed[s_no_tracks]["artistId"] == uid(91)
    assert by_seed[s_rec_1]["status"] == "recommended"
    assert by_seed[s_rec_2]["status"] == "recommended"
    assert by_seed[s_limit]["status"] == "limit"

    graph_nodes = {n["id"] for n in data["graph"]["nodes"]}
    for non_rec in (s_no_cand, s_no_tracks, s_limit):
        assert f"status:{non_rec}" in graph_nodes


def test_exclusions_filter_seed_artists_excluded_artists_and_seed_recordings(client, monkeypatch) -> None:
    s1, s2 = uid(1), uid(2)
    a_s1, a_s2, a_ext, a_ok = uid(10), uid(11), uid(12), uid(13)

    profiles = {
        s1: (song_dict(s1, "Seed One", "Artist S1"), {"indie": 10}, a_s1),
        s2: (song_dict(s2, "Seed Two", "Artist S2"), {"indie": 10}, a_s2),
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [
            (artist_dict(a_s1, "Artist S1"), {"indie": 10}),
            (artist_dict(a_ext, "Excluded Artist"), {"indie": 10}),
            (artist_dict(a_ok, "Valid Artist"), {"indie": 8}),
        ],
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda song: (
            (song_dict(s2, "Seed Two", "Artist S2"), 1.0, a_s2),
            (song_dict(s1, "Seed One", "Valid Artist"), 0.9, a_ok),
            (song_dict(uid(999), "Excluded Song", "Excluded Artist"), 0.9, a_ext),
        ),
    )
    monkeypatch.setattr(
        mb,
        "similar_artists",
        lambda _artist: {
            a_s2: (artist_dict(a_s2, "Artist S2"), 1.0),
            a_ext: (artist_dict(a_ext, "Excluded Artist"), 1.0),
        },
    )
    monkeypatch.setattr(
        mb,
        "collaborators",
        lambda _aid: {a_ext: (artist_dict(a_ext, "Excluded Artist"), 1.0)},
    )
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda aid: {
            a_ok: [song_dict(s1, "Seed One", "Valid Artist"), song_dict(uid(201), "Fresh Track", "Valid Artist")]
        }.get(aid, []),
    )

    resp = client.post("/api/recommendations", json={"seeds": [s1, s2], "excludeArtists": [a_s1, a_s2, a_ext], "limit": 10})
    assert resp.status_code == 200
    data = resp.json()
    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(201)]

    # Si excludeArtists elimina al único candidato restante, seedResults indica exclusión.
    resp_all_excluded = client.post(
        "/api/recommendations",
        json={"seeds": [s1, s2], "excludeArtists": [a_s1, a_s2, a_ext, a_ok], "limit": 10},
    )
    assert resp_all_excluded.status_code == 200
    excluded_data = resp_all_excluded.json()
    assert excluded_data["recommendations"] == []
    assert [r["status"] for r in excluded_data["seedResults"]] == ["no_candidates", "no_candidates"]
    assert "excluyen" in excluded_data["seedResults"][0]["message"]


def test_continues_to_next_artists_when_top_candidates_have_no_tracks(client, monkeypatch) -> None:
    s1 = uid(1)
    a_empty_1, a_empty_2, a_with_tracks, a_unreached = uid(10), uid(11), uid(12), uid(13)

    monkeypatch.setattr(
        mb,
        "recording_profile",
        lambda _mbid: (song_dict(s1, "Seed", "Seed Artist"), {"electronic": 10}, uid(90)),
    )
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [
            (artist_dict(a_empty_1, "Empty 1"), {"electronic": 10}),
            (artist_dict(a_empty_2, "Empty 2"), {"electronic": 9}),
            (artist_dict(a_with_tracks, "Has Tracks"), {"electronic": 8}),
            (artist_dict(a_unreached, "Unreached"), {"electronic": 7}),
        ],
    )
    queried_artists = []

    def fake_albums(aid: str):
        queried_artists.append(aid)
        if aid == a_with_tracks:
            return [song_dict(uid(301), "Track A", "Has Tracks"), song_dict(uid(302), "Track B", "Has Tracks")]
        if aid == a_unreached:
            return [song_dict(uid(303), "Track C", "Unreached")]
        return []

    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    # Sigue con artistas posteriores cuando los primeros no tienen pistas, sin consultar artistas innecesarios.
    resp = client.post("/api/recommendations", json={"seeds": [s1], "limit": 1})
    assert resp.status_code == 200
    data = resp.json()

    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(301)]
    assert data["seedResults"][0]["status"] == "recommended"
    assert queried_artists == [a_empty_1, a_empty_2, a_with_tracks]


def test_shared_origin_deduplicates_and_merges_reasons_versions_and_graph(client, monkeypatch) -> None:
    s1, s2 = uid(1), uid(2)
    a_s1, a_s2, a_shared = uid(10), uid(11), uid(20)
    shared_song = song_dict(uid(301), "Shared Song", "Shared Artist")
    twin_s1 = song_dict(uid(302), "Twin Title", "Shared Artist")
    twin_s2 = song_dict(uid(303), "twin title ", "Shared Artist")

    profiles = {
        s1: (song_dict(s1, "Seed 1", "Artist 1"), {"dream pop": 10}, a_s1),
        s2: (song_dict(s2, "Seed 2", "Artist 2"), {"shoegaze": 10}, a_s2),
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda tags: [(artist_dict(a_shared, "Shared Artist"), {"dream pop": 10})] if tags == ("dream pop",) else [],
    )
    monkeypatch.setattr(
        mb,
        "similar_artists",
        lambda artist: {a_shared: (artist_dict(a_shared, "Shared Artist"), 0.85)} if artist == "Artist 2" else {},
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda song: ((twin_s1, 0.9, a_shared),) if song["id"] == s1 else ((twin_s2, 0.7, a_shared),),
    )
    monkeypatch.setattr(mb, "album_tracks", lambda aid: [shared_song] if aid == a_shared else [])

    resp = client.post("/api/recommendations", json={"seeds": [s1, s2], "limit": 10})
    assert resp.status_code == 200
    data = resp.json()

    # Solo 1 vez cada canción compartida (mismo id y mismo título+artista)
    titles = [r["song"]["title"].strip().casefold() for r in data["recommendations"]]
    assert sorted(titles) == ["shared song", "twin title"]

    shared_rec = next(r for r in data["recommendations"] if r["song"]["id"] == uid(301))
    assert shared_rec["seedIds"] == [s1, s2]
    assert len(shared_rec["reasons"]) == 2
    assert shared_rec["sharedTags"] == ["dream pop"]
    assert set(shared_rec["signals"]) == {"listeners"}

    # Deduplicación por título+artista con distinto ID: s1 aporta 'songs' directa y s2 'versions'.
    twin_rec = next(r for r in data["recommendations"] if r["song"]["id"] == uid(302))
    assert twin_rec["seedIds"] == [s1, s2]
    twin_reasons = {r["seedId"]: r for r in twin_rec["reasons"]}
    assert twin_reasons[s1]["signals"] == ["songs"]
    assert twin_reasons[s2]["signals"] == ["listeners", "versions"]
    assert "versions" in twin_rec["signals"]

    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s1]["status"] == "recommended"
    assert by_seed[s2]["status"] == "recommended"
    assert set(by_seed[s1]["recommendationIds"]) == {uid(301), uid(302)}
    assert set(by_seed[s2]["recommendationIds"]) == {uid(301), uid(302)}

    graph_nodes = {n["id"] for n in data["graph"]["nodes"]}
    graph_edges = {(e["from"], e["to"]) for e in data["graph"]["edges"]}
    assert f"artist:{s1}:{a_shared}:{uid(301)}" in graph_nodes
    assert f"artist:{s2}:{a_shared}:{uid(301)}" in graph_nodes
    assert (f"artist:{s1}:{a_shared}:{uid(301)}", f"song:{uid(301)}") in graph_edges
    assert (f"artist:{s2}:{a_shared}:{uid(301)}", f"song:{uid(301)}") in graph_edges
    assert (f"signal:{s2}:versions", f"artist:{s2}:{a_shared}:{uid(302)}") in graph_edges
    assert (f"signal:{s2}:songs", f"artist:{s2}:{a_shared}:{uid(302)}") not in graph_edges
    assert f"artist:{s2}:{a_shared}:{uid(301)}" not in reachable_from(data["graph"], f"tag:{s1}:dream pop")


def test_album_track_does_not_carry_songs_signal_or_query_catalog(client, monkeypatch) -> None:
    s1 = uid(1)
    a_both, a_songs_only = uid(10), uid(11)
    hinted_both = song_dict(uid(101), "Hinted Both", "Artist Both")
    album_both = song_dict(uid(102), "Album Both", "Artist Both")
    hinted_only = song_dict(uid(201), "Hinted Only", "Artist Songs Only")
    album_only = song_dict(uid(202), "Album Only", "Artist Songs Only")

    monkeypatch.setattr(
        mb,
        "recording_profile",
        lambda _mbid: (song_dict(s1, "Seed", "Seed Artist"), {"post-punk": 10}, uid(90)),
    )
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [(artist_dict(a_both, "Artist Both"), {"post-punk": 10})],
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda _song: ((hinted_both, 0.9, a_both), (hinted_only, 0.8, a_songs_only)),
    )
    queried_albums = []

    def fake_albums(aid: str):
        queried_albums.append(aid)
        return {a_both: [album_both], a_songs_only: [album_only]}.get(aid, [])

    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    resp = client.post("/api/recommendations", json={"seeds": [s1], "limit": 10})
    assert resp.status_code == 200
    data = resp.json()

    recs = {r["song"]["id"]: r for r in data["recommendations"]}
    assert set(recs) == {uid(101), uid(102), uid(201)}
    assert uid(202) not in recs  # Pista de álbum sin otra señal no debe recomendarse.
    assert a_songs_only not in queried_albums  # Si solo tiene señal songs, no consulta álbum.

    assert recs[uid(101)]["signals"] == ["songs"]
    assert recs[uid(102)]["signals"] == []
    assert recs[uid(102)]["reasons"][0]["signals"] == []
    assert recs[uid(102)]["sharedTags"] == ["post-punk"]

    graph_edges = {(e["from"], e["to"]) for e in data["graph"]["edges"]}
    assert (f"signal:{s1}:songs", f"artist:{s1}:{a_both}:{uid(101)}") in graph_edges
    assert (f"signal:{s1}:songs", f"artist:{s1}:{a_both}:{uid(102)}") not in graph_edges


def test_seed_coverage_takes_priority_over_per_artist_limit(client, monkeypatch) -> None:
    s1, s2, s3 = uid(1), uid(2), uid(3)
    a_shared, a_empty, a_backup = uid(10), uid(11), uid(12)

    profiles = {
        s1: (song_dict(s1, "Seed 1", "Art 1"), {"tag1": 10}, uid(91)),
        s2: (song_dict(s2, "Seed 2", "Art 2"), {}, uid(92)),
        s3: (song_dict(s3, "Seed 3", "Art 3"), {}, uid(93)),
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda tags: [
            (artist_dict(a_shared, "Shared Top"), {"tag1": 10}),
            (artist_dict(a_empty, "Empty Mid"), {"tag1": 5}),
            (artist_dict(a_backup, "Backup Artist"), {"tag1": 3}),
        ]
        if tags == ("tag1",)
        else [],
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda song: {
            s1: (
                (song_dict(uid(101), "Shared 1A", "Shared Top"), 0.95, a_shared),
                (song_dict(uid(102), "Shared 1B", "Shared Top"), 0.90, a_shared),
            ),
            s2: ((song_dict(uid(201), "Shared 2", "Shared Top"), 0.95, a_shared),),
            s3: ((song_dict(uid(301), "Shared 3", "Shared Top"), 0.95, a_shared),),
        }[song["id"]],
    )
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda aid: [song_dict(uid(401), "Backup Track", "Backup Artist")] if aid == a_backup else [],
    )

    resp = client.post("/api/recommendations", json={"seeds": [s1, s2, s3], "limit": 4})
    assert resp.status_code == 200
    data = resp.json()

    # Shared Top supera per_artist=2 para cubrir s3; luego s1 (ya cubierta) salta Shared 1B y toma Backup Track.
    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(101), uid(201), uid(301), uid(401)]
    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert all(by_seed[sid]["status"] == "recommended" for sid in (s1, s2, s3))


def test_catalog_query_budget_public_api_vs_local_db(client, monkeypatch) -> None:
    s1, s2 = uid(1), uid(2)
    s1_artists = {uid(100 + i) for i in range(13)}
    s2_artists = {uid(200 + i) for i in range(7)}
    candidates_s1 = [(artist_dict(uid(100 + i), f"Empty S1 {i}"), {"metal": 20 - i}) for i in range(13)]
    candidates_s2 = [(artist_dict(uid(200 + i), f"Empty S2 {i}"), {"folk": 20 - i}) for i in range(7)]

    profiles = {
        s1: (song_dict(s1, "Metal Seed", "Art 1"), {"metal": 20}, uid(91)),
        s2: (song_dict(s2, "Folk Seed", "Art 2"), {"folk": 20}, uid(92)),
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda tags: candidates_s1 if tags == ("metal",) else candidates_s2,
    )

    queried = []

    def fake_albums(aid: str):
        queried.append(aid)
        if aid == uid(112):  # 13º candidato de s1
            return [song_dict(uid(901), "Late Metal Track", "Empty S1 12")]
        return []

    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    # API pública con 1 semilla: tope 12 consultas -> el 13º no se consulta y queda en search_limit.
    resp_pub_1 = client.post("/api/recommendations", json={"seeds": [s1], "limit": 5})
    assert resp_pub_1.status_code == 200
    data_pub_1 = resp_pub_1.json()
    assert len(queried) == 12
    assert data_pub_1["recommendations"] == []
    assert data_pub_1["seedResults"][0]["status"] == "search_limit"
    assert data_pub_1["seedResults"][0]["searchLimited"] is True
    assert f"status:{s1}" in {n["id"] for n in data_pub_1["graph"]["nodes"]}

    # API pública con 2 semillas: cuota separada max(1, 12 // 2) = 6 por semilla.
    queried.clear()
    resp_pub_2 = client.post("/api/recommendations", json={"seeds": [s1, s2], "limit": 5})
    assert resp_pub_2.status_code == 200
    data_pub_2 = resp_pub_2.json()
    assert sum(aid in s1_artists for aid in queried) == 6
    assert sum(aid in s2_artists for aid in queried) == 6
    assert [r["status"] for r in data_pub_2["seedResults"]] == ["search_limit", "search_limit"]
    assert all(r["searchLimited"] is True for r in data_pub_2["seedResults"])

    # DB local activa: presupuesto sube a 100, alcanza al 13º candidato y recomienda.
    queried.clear()
    monkeypatch.setattr(mb, "is_local_db_active", lambda force=False: True)
    resp_local = client.post("/api/recommendations", json={"seeds": [s1], "limit": 5})
    assert resp_local.status_code == 200
    data_local = resp_local.json()
    assert len(queried) == 13
    assert [r["song"]["id"] for r in data_local["recommendations"]] == [uid(901)]
    assert data_local["seedResults"][0]["status"] == "recommended"
    assert data_local["seedResults"][0]["searchLimited"] is False


def test_time_budget_preserves_early_results_and_skips_later_queries(client, monkeypatch) -> None:
    s_fast, s_slow, s_third = uid(1), uid(2), uid(3)
    a_fast, a_slow, a_third = uid(10), uid(20), uid(30)
    now = [1000.0]

    profiles = {
        s_fast: (song_dict(s_fast, "Fast Seed", "Fast Art"), {"synthpop": 10}, uid(91)),
        s_slow: (song_dict(s_slow, "Slow Seed", "Slow Art"), {"krautrock": 10}, uid(92)),
        s_third: (song_dict(s_third, "Third Seed", "Third Art"), {"ambient": 10}, uid(93)),
    }

    calls = {"tags": [], "songs": [], "artists": [], "collab": [], "albums": []}

    def fake_by_tags(tags: tuple[str, ...]):
        calls["tags"].append(tags)
        if tags == ("synthpop",):
            return [(artist_dict(a_fast, "Fast Cand"), {"synthpop": 10})]
        if tags == ("krautrock",):
            now[0] += main.RECOMMENDATION_SECONDS + 1.0
            return [(artist_dict(a_slow, "Slow Cand"), {"krautrock": 10})]
        if tags == ("ambient",):
            return [(artist_dict(a_third, "Third Cand"), {"ambient": 10})]
        return []

    def fake_similar_songs(song: dict):
        calls["songs"].append(song["id"])
        return ()

    def fake_similar_artists(artist: str):
        calls["artists"].append(artist)
        return {}

    def fake_collaborators(aid: str):
        calls["collab"].append(aid)
        return {}

    def fake_albums(aid: str):
        calls["albums"].append(aid)
        if aid == a_fast:
            return [song_dict(uid(101), "Fast Pick", "Fast Cand")]
        return [song_dict(uid(201), "Should Not Fetch", "Slow Cand")]

    monkeypatch.setattr(main.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(mb, "artists_by_tags", fake_by_tags)
    monkeypatch.setattr(mb, "similar_songs", fake_similar_songs)
    monkeypatch.setattr(mb, "similar_artists", fake_similar_artists)
    monkeypatch.setattr(mb, "collaborators", fake_collaborators)
    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    resp = client.post("/api/recommendations", json={"seeds": [s_fast, s_slow, s_third], "limit": 6})
    assert resp.status_code == 200
    data = resp.json()

    # La rama rápida conservó su recomendación antes de que la rama lenta agotara el reloj.
    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(101)]
    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s_fast]["status"] == "recommended"
    assert by_seed[s_fast]["searchLimited"] is False
    assert by_seed[s_slow]["status"] == "search_limit"
    assert by_seed[s_slow]["searchLimited"] is True
    assert by_seed[s_third]["status"] == "search_limit"
    assert by_seed[s_third]["searchLimited"] is True

    # Después de superar el plazo en s_slow, no se consultan fuentes posteriores ni su catálogo ni s_third.
    assert calls["tags"] == [("synthpop",), ("krautrock",)]
    assert calls["songs"] == [s_fast]
    assert calls["artists"] == ["Fast Art"]
    assert calls["collab"] == [uid(91)]
    assert calls["albums"] == [a_fast]

    graph_nodes = {n["id"] for n in data["graph"]["nodes"]}
    assert f"status:{s_slow}" in graph_nodes
    assert f"status:{s_third}" in graph_nodes


def test_time_budget_expired_during_initial_profiles_defers_pending_seed(client, monkeypatch) -> None:
    s1, s2 = uid(1), uid(2)
    now = [1000.0]
    profile_calls = []
    downstream_calls = []

    def fake_profile(mbid: str):
        profile_calls.append(mbid)
        now[0] += main.RECOMMENDATION_SECONDS + 1.0
        return (song_dict(mbid, "First Seed", "First Art"), {"rock": 10}, uid(91))

    def record_and_return_empty(name: str):
        def _fn(*args, **_kwargs):
            downstream_calls.append((name, args))
            return [] if name in {"tags", "albums"} else (() if name == "songs" else {})
        return _fn

    monkeypatch.setattr(main.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(mb, "recording_profile", fake_profile)
    monkeypatch.setattr(mb, "artists_by_tags", record_and_return_empty("tags"))
    monkeypatch.setattr(mb, "similar_songs", record_and_return_empty("songs"))
    monkeypatch.setattr(mb, "similar_artists", record_and_return_empty("artists"))
    monkeypatch.setattr(mb, "collaborators", record_and_return_empty("collab"))
    monkeypatch.setattr(mb, "album_tracks", record_and_return_empty("albums"))

    resp = client.post("/api/recommendations", json={"seeds": [s1, s2], "limit": 5})
    assert resp.status_code == 200
    data = resp.json()

    assert profile_calls == [s1]
    assert downstream_calls == []
    assert data["recommendations"] == []

    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s1]["status"] == "search_limit"
    assert by_seed[s1]["artistId"] == uid(91)
    assert by_seed[s1]["searchLimited"] is True
    assert by_seed[s2]["status"] == "search_limit"
    assert by_seed[s2]["artistId"] is None
    assert by_seed[s2]["searchLimited"] is True
    assert by_seed[s2]["title"] == "Canción pendiente"
    assert f"status:{s2}" in {n["id"] for n in data["graph"]["nodes"]}


def test_request_validation_rejects_invalid_options_and_canonicalizes_uuids(client, monkeypatch) -> None:
    profile_calls = []

    def fail_or_record(mbid: str):
        profile_calls.append(mbid)
        return (song_dict(mbid, "Seed", "Seed Artist"), {"rock": 10}, uid(90))

    monkeypatch.setattr(mb, "recording_profile", fail_or_record)
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [(artist_dict(uid(10), "Cand Artist"), {"rock": 10})],
    )
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda _aid: [song_dict(uid(101), "Fresh Song", "Cand Artist")],
    )

    valid_seed = uid(1)
    invalid_payloads = [
        {"seeds": []},
        {"seeds": [uid(i) for i in range(1, 12)]},
        {"seeds": ["not-a-uuid"]},
        {"seeds": [valid_seed.replace("-", "")]},
        {"seeds": [f"{valid_seed} "]},
        {"seeds": [valid_seed], "limit": 0},
        {"seeds": [valid_seed], "limit": -1},
        {"seeds": [valid_seed], "limit": 31},
        {"seeds": [valid_seed], "limit": 1.5},
        {"seeds": [valid_seed], "limit": True},
        {"seeds": [valid_seed], "limit": "10"},
        {"seeds": [valid_seed], "limit": None},
        {"seeds": [valid_seed], "excludeArtists": ["bad-uuid"]},
        {"seeds": [valid_seed], "excludeArtists": [uid(2).replace("-", "")]},
        {"seeds": [valid_seed], "excludeArtists": [uid(i) for i in range(1, 202)]},
        {"seeds": [valid_seed], "excludeRecordings": ["bad-uuid"]},
        {"seeds": [valid_seed], "excludeRecordings": [uid(2).replace("-", "")]},
        {"seeds": [valid_seed], "excludeRecordings": [uid(i) for i in range(1, 202)]},
        {"seeds": [valid_seed], "excludeVersions": [{"artistId": "bad-uuid", "title": "Song"}]},
        {"seeds": [valid_seed], "excludeVersions": [{"artistId": uid(2).replace("-", ""), "title": "Song"}]},
        {"seeds": [valid_seed], "excludeVersions": [{"artistId": uid(2), "title": ""}]},
        {"seeds": [valid_seed], "excludeVersions": [{"artistId": uid(2), "title": "   "}]},
        {"seeds": [valid_seed], "excludeVersions": [{"artistId": uid(2), "title": 123}]},
        {"seeds": [valid_seed], "excludeVersions": [{"artistId": uid(i), "title": "T"} for i in range(1, 202)]},
    ]

    for payload in invalid_payloads:
        resp = client.post("/api/recommendations", json=payload)
        assert resp.status_code == 422, f"Expected 422 for {payload}, got {resp.status_code}"
    assert profile_calls == []

    # Límites máximos exactos (200 exclusiones, limit 1 y 30) y UUID en mayúsculas canonicalizados.
    resp_ok = client.post(
        "/api/recommendations",
        json={
            "seeds": [valid_seed.upper()],
            "limit": 1,
            "excludeArtists": [uid(i).upper() for i in range(200, 400)],
            "excludeRecordings": [uid(i).upper() for i in range(500, 700)],
            "excludeVersions": [{"artistId": uid(i).upper(), "title": "Seen"} for i in range(700, 900)],
        },
    )
    assert resp_ok.status_code == 200
    data = resp_ok.json()
    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(101)]
    assert data["recommendations"][0]["seedIds"] == [valid_seed]
    assert data["seedResults"][0]["seedId"] == valid_seed
    assert data["seedResults"][0]["artistId"] == uid(90)
    assert data["seedResults"][0]["searchLimited"] is False
    assert {n["id"] for n in data["graph"]["nodes"]} >= {f"seed:{valid_seed}", f"song:{uid(101)}"}


def test_exclude_recordings_and_versions_canonicalize_and_keep_other_artists(client, monkeypatch) -> None:
    s1 = uid(1)
    a_seed, a_cand_1, a_cand_2 = uid(10), uid(11), uid(12)
    rec_seen_mbid = uid(101)
    rec_same_title_same_artist = uid(102)
    rec_same_title_same_artist_casefold = uid(103)
    rec_same_title_other_artist = uid(201)
    rec_other_recording_unknown_artist = uid(104)
    profile_calls = []

    def fake_profile(mbid: str):
        profile_calls.append(mbid)
        return (song_dict(mbid, "Seed Song", "Seed Artist"), {"dream pop": 10}, a_seed)

    monkeypatch.setattr(mb, "recording_profile", fake_profile)
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [
            (artist_dict(a_cand_1, "Artist One"), {"dream pop": 10}),
            (artist_dict(a_cand_2, "Artist Two"), {"dream pop": 9}),
        ],
    )
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda aid: {
            a_cand_1: [
                song_dict(rec_seen_mbid, "Seen By MBID", "Artist One"),
                song_dict(rec_same_title_same_artist, "  Straße  ", "Artist One"),
                song_dict(rec_same_title_same_artist_casefold, "Seen By MBID", "Artist One"),
            ],
            a_cand_2: [
                song_dict(rec_same_title_other_artist, "Straße", "Artist Two"),
            ],
        }.get(aid, []),
    )

    resp = client.post(
        "/api/recommendations",
        json={
            "seeds": [s1],
            "excludeRecordings": [rec_seen_mbid.upper()],
            "excludeVersions": [{"artistId": a_cand_1.upper(), "title": "  STRASSE  "}],
            "limit": 10,
        },
    )
    assert resp.status_code == 200
    data = resp.json()

    # No reconsulta perfiles de historial previo; solo consulta la semilla actual.
    assert profile_calls == [s1]
    # MBID visto se excluye; versión por (artistId, casefold(title)) se excluye;
    # otro artista con el mismo título sí permanece; sin excludeVersions para "Seen By MBID",
    # otra grabación del mismo título/artista sigue siendo candidata cuando no se envió su artista.
    assert [r["song"]["id"] for r in data["recommendations"]] == [
        rec_same_title_same_artist_casefold,
        rec_same_title_other_artist,
    ]
    assert rec_same_title_same_artist not in {r["song"]["id"] for r in data["recommendations"]}

    # Si Artist One tiene otra grabación y solo se excluyó rec_seen_mbid por MBID (artista desconocido),
    # rec_other_recording_unknown_artist tampoco queda bloqueado por título inventado.
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda aid: [
            song_dict(rec_seen_mbid, "Unknown Artist Track", "Artist One"),
            song_dict(rec_other_recording_unknown_artist, "Unknown Artist Track", "Artist One"),
        ]
        if aid == a_cand_1
        else [],
    )
    resp_unknown = client.post(
        "/api/recommendations",
        json={"seeds": [s1], "excludeRecordings": [rec_seen_mbid], "limit": 10},
    )
    assert resp_unknown.status_code == 200
    assert [r["song"]["id"] for r in resp_unknown.json()["recommendations"]] == [rec_other_recording_unknown_artist]


def test_preselection_filtering_drives_album_fallback_and_respects_catalog_quota(client, monkeypatch) -> None:
    s1 = uid(1)
    a_seed = uid(10)
    a_fallback = uid(11)
    a_songs_only = uid(12)
    a_two_hints = uid(13)

    hint_seen_1 = song_dict(uid(101), "Hint Seen 1", "Fallback Artist")
    hint_seen_2 = song_dict(uid(102), "Hint Seen 2", "Fallback Artist")
    album_seen_2_version = song_dict(uid(103), "hint seen 2", "Fallback Artist")
    fresh_1 = song_dict(uid(104), "Fresh Album 1", "Fallback Artist")
    fresh_2 = song_dict(uid(105), "Fresh Album 2", "Fallback Artist")
    fresh_3 = song_dict(uid(106), "Fresh Album 3", "Fallback Artist")

    hint_only_seen = song_dict(uid(201), "Only Songs Seen", "Songs Only Artist")
    album_only_track = song_dict(uid(202), "Only Songs Album", "Songs Only Artist")

    hint_ok_1 = song_dict(uid(301), "Hint OK 1", "Two Hints Artist")
    hint_ok_2 = song_dict(uid(302), "Hint OK 2", "Two Hints Artist")

    monkeypatch.setattr(
        mb,
        "recording_profile",
        lambda _mbid: (song_dict(s1, "Seed", "Seed Artist"), {"shoegaze": 10}, a_seed),
    )
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [
            (artist_dict(a_fallback, "Fallback Artist"), {"shoegaze": 10}),
            (artist_dict(a_two_hints, "Two Hints Artist"), {"shoegaze": 8}),
        ],
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda _song: (
            (hint_seen_1, 0.95, a_fallback),
            (hint_seen_2, 0.90, a_fallback),
            (hint_only_seen, 0.85, a_songs_only),
            (hint_ok_1, 0.70, a_two_hints),
            (hint_ok_2, 0.65, a_two_hints),
        ),
    )
    queried_albums = []

    def fake_albums(aid: str):
        queried_albums.append(aid)
        if aid == a_fallback:
            return [hint_seen_1, album_seen_2_version, fresh_1, fresh_2, fresh_3]
        if aid == a_songs_only:
            return [album_only_track]
        return []

    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    resp = client.post(
        "/api/recommendations",
        json={
            "seeds": [s1],
            "excludeRecordings": [hint_seen_1["id"], hint_only_seen["id"]],
            "excludeVersions": [{"artistId": a_fallback, "title": "  HINT SEEN 2 "}],
            "limit": 10,
        },
    )
    assert resp.status_code == 200
    data = resp.json()

    # 2 hints vistos en a_fallback no bloquean el fallback a álbumes; a_songs_only sin otra señal no consulta álbum;
    # a_two_hints ya tiene 2 hints elegibles y tampoco consulta álbum.
    assert queried_albums == [a_fallback]
    assert [r["song"]["id"] for r in data["recommendations"]] == [
        fresh_1["id"],
        hint_ok_1["id"],
        fresh_2["id"],
        hint_ok_2["id"],
    ]
    by_rec = {r["song"]["id"]: r for r in data["recommendations"]}
    assert by_rec[fresh_1["id"]]["signals"] == []
    assert by_rec[fresh_1["id"]]["sharedTags"] == ["shoegaze"]
    assert by_rec[hint_ok_1["id"]]["signals"] == ["songs"]


def test_filtered_hints_do_not_expand_catalog_quota_and_expose_partial_search_limited(client, monkeypatch) -> None:
    s1 = uid(1)
    a_seed = uid(10)
    candidates = [(artist_dict(uid(100 + i), f"Cand {i}"), {"post-rock": 30 - i}) for i in range(13)]
    hints = tuple(
        (song_dict(uid(500 + i), f"Seen Hint {i}", f"Cand {i}"), 0.9, uid(100 + i))
        for i in range(13)
    ) + tuple(
        (song_dict(uid(600 + i), f"Seen Hint B {i}", f"Cand {i}"), 0.8, uid(100 + i))
        for i in range(13)
    )

    monkeypatch.setattr(
        mb,
        "recording_profile",
        lambda _mbid: (song_dict(s1, "Seed", "Seed Artist"), {"post-rock": 30}, a_seed),
    )
    monkeypatch.setattr(mb, "artists_by_tags", lambda _tags: candidates)
    monkeypatch.setattr(mb, "similar_songs", lambda _song: hints)

    queried = []

    def fake_albums(aid: str):
        queried.append(aid)
        if aid == uid(100):
            return [song_dict(uid(900), "Early Fresh Track", "Cand 0")]
        if aid == uid(112):
            return [song_dict(uid(912), "Unreached 13th Track", "Cand 12")]
        return []

    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    resp = client.post(
        "/api/recommendations",
        json={
            "seeds": [s1],
            "excludeRecordings": [song["id"] for song, _, _ in hints],
            "limit": 5,
        },
    )
    assert resp.status_code == 200
    data = resp.json()

    # Exactamente 12 consultas de catálogo (no sube por los 26 hints filtrados); el 13º queda sin consultar.
    assert len(queried) == 12
    assert uid(112) not in queried
    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(900)]
    assert data["seedResults"] == [
        {
            "seedId": s1,
            "title": "Seed",
            "artist": "Seed Artist",
            "status": "recommended",
            "message": "1 recomendación a partir de esta canción.",
            "recommendationIds": [uid(900)],
            "artistId": a_seed,
            "searchLimited": True,
        }
    ]
    assert f"status:{s1}" not in {n["id"] for n in data["graph"]["nodes"]}


def test_partial_time_budget_limit_sets_search_limited_on_recommended_seed(client, monkeypatch) -> None:
    s1 = uid(1)
    a_seed, a_first, a_second = uid(10), uid(11), uid(12)
    now = [2000.0]
    queried_albums = []

    monkeypatch.setattr(main.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(
        mb,
        "recording_profile",
        lambda _mbid: (song_dict(s1, "Seed", "Seed Artist"), {"ambient": 10}, a_seed),
    )
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda _tags: [
            (artist_dict(a_first, "First Cand"), {"ambient": 10}),
            (artist_dict(a_second, "Second Cand"), {"ambient": 9}),
        ],
    )

    def fake_albums(aid: str):
        queried_albums.append(aid)
        if aid == a_first:
            now[0] += main.RECOMMENDATION_SECONDS + 1.0
            return [song_dict(uid(101), "First Fresh", "First Cand")]
        return [song_dict(uid(201), "Should Not Query", "Second Cand")]

    monkeypatch.setattr(mb, "album_tracks", fake_albums)

    resp = client.post("/api/recommendations", json={"seeds": [s1], "limit": 5})
    assert resp.status_code == 200
    data = resp.json()

    assert queried_albums == [a_first]
    assert [r["song"]["id"] for r in data["recommendations"]] == [uid(101)]
    assert data["seedResults"][0]["status"] == "recommended"
    assert data["seedResults"][0]["searchLimited"] is True
    assert data["seedResults"][0]["artistId"] == a_seed
    assert f"status:{s1}" not in {n["id"] for n in data["graph"]["nodes"]}


def test_exclusions_preserve_reasons_seed_coverage_and_graph_consistency(client, monkeypatch) -> None:
    s1, s2 = uid(1), uid(2)
    a_s1, a_s2, a_shared, a_backup = uid(10), uid(11), uid(20), uid(21)

    seen_shared_1 = song_dict(uid(101), "Seen Shared", "Shared Artist")
    fresh_shared_1 = song_dict(uid(102), "Fresh Shared 1", "Shared Artist")
    fresh_shared_2 = song_dict(uid(103), "Fresh Shared 2", "Shared Artist")
    backup_track = song_dict(uid(201), "Backup Fresh", "Backup Artist")

    profiles = {
        s1: (song_dict(s1, "Seed 1", "Artist 1"), {"indie": 10}, a_s1),
        s2: (song_dict(s2, "Seed 2", "Artist 2"), {"folk": 10}, a_s2),
    }

    monkeypatch.setattr(mb, "recording_profile", lambda mbid: profiles[mbid])
    monkeypatch.setattr(
        mb,
        "artists_by_tags",
        lambda tags: [
            (artist_dict(a_shared, "Shared Artist"), {"indie": 10}),
            (artist_dict(a_backup, "Backup Artist"), {"indie": 5}),
        ]
        if tags == ("indie",)
        else [(artist_dict(a_shared, "Shared Artist"), {"folk": 10})],
    )
    monkeypatch.setattr(
        mb,
        "similar_songs",
        lambda song: (
            (seen_shared_1, 0.95, a_shared),
            (fresh_shared_1, 0.90, a_shared),
        )
        if song["id"] == s1
        else (),
    )
    monkeypatch.setattr(
        mb,
        "album_tracks",
        lambda aid: {
            a_shared: [seen_shared_1, fresh_shared_2],
            a_backup: [backup_track],
        }.get(aid, []),
    )

    resp = client.post(
        "/api/recommendations",
        json={"seeds": [s1, s2], "excludeRecordings": [seen_shared_1["id"]], "limit": 3},
    )
    assert resp.status_code == 200
    data = resp.json()

    # s1 toma fresh_shared_1 (songs), s2 toma fresh_shared_2 (folk), luego s1 toma backup_track (no excede per_artist=2).
    assert [r["song"]["id"] for r in data["recommendations"]] == [
        fresh_shared_1["id"],
        fresh_shared_2["id"],
        backup_track["id"],
    ]
    by_rec = {r["song"]["id"]: r for r in data["recommendations"]}
    assert by_rec[fresh_shared_1["id"]]["seedIds"] == [s1, s2]
    assert by_rec[fresh_shared_1["id"]]["signals"] == ["songs"]
    assert by_rec[fresh_shared_2["id"]]["seedIds"] == [s1, s2]
    assert by_rec[fresh_shared_2["id"]]["signals"] == []
    assert by_rec[backup_track["id"]]["seedIds"] == [s1]

    by_seed = {r["seedId"]: r for r in data["seedResults"]}
    assert by_seed[s1]["status"] == "recommended"
    assert by_seed[s2]["status"] == "recommended"
    assert set(by_seed[s1]["recommendationIds"]) == {fresh_shared_1["id"], fresh_shared_2["id"], backup_track["id"]}
    assert set(by_seed[s2]["recommendationIds"]) == {fresh_shared_1["id"], fresh_shared_2["id"]}

    node_ids = {n["id"] for n in data["graph"]["nodes"]}
    assert f"song:{seen_shared_1['id']}" not in node_ids
    assert all(e["from"] in node_ids and e["to"] in node_ids for e in data["graph"]["edges"])


@pytest.mark.parametrize("exclude_original", [False, True])
def test_seed_artist_is_eligible_from_real_signals_and_explicit_exclusion_wins(client, monkeypatch, exclude_original):
    seed, original, other = uid(1), uid(10), uid(20)
    own_fresh = song_dict(uid(101), "Fresh Own", "Original")
    own_seen = song_dict(uid(102), "Previously Heard", "Original")
    own_version = song_dict(uid(103), "  KNOWN Song  ", "Original")
    other_fresh = song_dict(uid(201), "Fresh Other", "Other")
    monkeypatch.setattr(mb, "recording_profile", lambda _: (song_dict(seed, "Seed", "Original"), {"indie": 10}, original))
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [
        (artist_dict(original, "Original"), {"indie": 10}),
        (artist_dict(other, "Other"), {"indie": 9}),
    ])
    monkeypatch.setattr(mb, "similar_songs", lambda _: (
        (song_dict(seed, "Seed", "Original"), 1.0, original),
        (own_seen, 0.99, original),
        (own_version, 0.98, original),
        (own_fresh, 0.9, original),
        (other_fresh, 0.8, other),
    ))
    queried = []

    def albums(aid):
        queried.append(aid)
        return []

    monkeypatch.setattr(mb, "album_tracks", albums)
    response = client.post("/api/recommendations", json={
        "seeds": [seed], "excludeArtists": [original] if exclude_original else [],
        "excludeRecordings": [own_seen["id"]],
        "excludeVersions": [{"artistId": original, "title": " known SONG "}], "limit": 10,
    })
    assert response.status_code == 200
    data = response.json()
    by_id = {rec["song"]["id"]: rec for rec in data["recommendations"]}
    assert set(by_id) == ({other_fresh["id"]} if exclude_original else {own_fresh["id"], other_fresh["id"]})
    assert all(rec["seedIds"] == [seed] and rec["signals"] == ["songs"] for rec in by_id.values())
    assert all(rec["sharedTags"] == ["indie"] and rec["score"] > 0 for rec in by_id.values())
    assert data["seedResults"][0]["status"] == "recommended"
    assert set(data["seedResults"][0]["recommendationIds"]) == set(by_id)
    assert original not in queried if exclude_original else queried.count(original) == 1
    assert queried.count(other) == 1
    assert all(f"song:{rid}" in reachable_from(data["graph"], f"seed:{seed}") for rid in by_id)
    assert not {f"song:{own_seen['id']}", f"song:{own_version['id']}"} & {n["id"] for n in data["graph"]["nodes"]}


def test_original_artist_respects_multi_seed_coverage_diversity_and_reasons(client, monkeypatch):
    s1, s2, s3 = uid(1), uid(2), uid(3)
    original, backup = uid(10), uid(20)
    profiles = {
        s1: (song_dict(s1, "Seed 1", "Original"), {"indie": 10}, original),
        s2: (song_dict(s2, "Seed 2", "Second"), {}, uid(11)),
        s3: (song_dict(s3, "Seed 3", "Third"), {}, uid(12)),
    }
    monkeypatch.setattr(mb, "recording_profile", lambda sid: profiles[sid])
    monkeypatch.setattr(mb, "artists_by_tags", lambda _: [
        (artist_dict(original, "Original"), {"indie": 10}),
        (artist_dict(backup, "Backup"), {"indie": 3}),
    ])
    hints = {
        s1: ((song_dict(uid(101), "Own A", "Original"), 0.95, original),
             (song_dict(uid(102), "Own B", "Original"), 0.90, original)),
        s2: ((song_dict(uid(201), "Own C", "Original"), 0.95, original),),
        s3: ((song_dict(uid(301), "Own D", "Original"), 0.95, original),),
    }
    monkeypatch.setattr(mb, "similar_songs", lambda song: hints[song["id"]])
    queried = []

    def albums(aid):
        queried.append(aid)
        return [song_dict(uid(401), "Backup Track", "Backup")] if aid == backup else []

    monkeypatch.setattr(mb, "album_tracks", albums)
    response = client.post("/api/recommendations", json={"seeds": [s1, s2, s3], "limit": 4})
    assert response.status_code == 200
    data = response.json()
    recs = data["recommendations"]
    assert [rec["song"]["id"] for rec in recs] == [uid(101), uid(201), uid(301), uid(401)]
    assert [rec["artistId"] for rec in recs] == [original, original, original, backup]
    assert all(result["status"] == "recommended" and not result["searchLimited"] for result in data["seedResults"])
    by_id = {rec["song"]["id"]: rec for rec in recs}
    for sid, rid in [(s1, uid(101)), (s2, uid(201)), (s3, uid(301))]:
        reasons = {reason["seedId"]: reason for reason in by_id[rid]["reasons"]}
        assert reasons[sid]["signals"] == ["songs"]
        assert f"song:{rid}" in reachable_from(data["graph"], f"seed:{sid}")
        node = f"artist:{sid}:{original}:{rid}"
        edges = {(edge["from"], edge["to"]) for edge in data["graph"]["edges"]}
        assert (f"signal:{sid}:songs", node) in edges
        assert (node, f"song:{rid}") in edges
    assert by_id[uid(401)]["seedIds"] == [s1]
    assert by_id[uid(401)]["signals"] == []
    assert by_id[uid(401)]["sharedTags"] == ["indie"]
    # Las pistas directas no requieren cat?logo; solo se consulta el respaldo.
    assert queried == [backup]
