"""Ejecuta: backend/.venv/Scripts/python backend/tests/test_main.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient

from app import main, musicbrainz as mb

client = TestClient(main.app)

S1 = "00000000-0000-0000-0000-000000000001"
S2 = "00000000-0000-0000-0000-000000000002"
S3 = "00000000-0000-0000-0000-000000000003"
S4 = "00000000-0000-0000-0000-000000000004"
A_EXCL = "00000000-0000-0000-0000-000000000099"


class _Patch:
    """Context manager simple para parchear atributos de un módulo y restaurarlos."""

    def __init__(self, target, **replacements):
        self.target = target
        self.replacements = replacements
        self.originals = {}

    def __enter__(self):
        for k, v in self.replacements.items():
            self.originals[k] = getattr(self.target, k)
            setattr(self.target, k, v)
        return self

    def __exit__(self, *exc):
        for k, v in self.originals.items():
            setattr(self.target, k, v)


def _song(id_: str, title: str, artist: str) -> dict:
    return {"id": id_, "title": title, "artist": artist, "release": None, "duration": None, "comment": None}


def test_versions_case_insensitive_and_missing_credits():
    mb._versions.cache_clear()
    queries = []

    def fake_get(path: str, **params):
        assert path == "/recording"
        queries.append(params.get("query"))
        return {
            "recordings": [
                {"id": "r1", "title": "Las Nieves de Enero", "artist-credit": [{"artist": {"id": "a1", "name": "Chalino Sánchez"}}]},
                {"id": "r2", "title": "las nieves de enero", "artist-credit": [{"artist": {"id": "a1", "name": "Chalino Sánchez"}}]},
                {"id": "r3", "title": "LAS NIEVES DE ENERO", "artist-credit": [{"artist": {"id": "a2", "name": "Banda El Recodo"}}]},
                # Títulos distintos (con sufijo o subcadena) se ignoran.
                {"id": "r4", "title": "Las Nieves de Enero (En Vivo)", "artist-credit": [{"artist": {"id": "a3", "name": "Otro"}}]},
                # Grabaciones sin artist-credit (lista vacía, None o clave ausente) se ignoran sin fallar.
                {"id": "r5", "title": "Las Nieves de Enero", "artist-credit": []},
                {"id": "r6", "title": "Las Nieves de Enero", "artist-credit": None},
                {"id": "r7", "title": "Las Nieves de Enero"},
            ]
        }

    with _Patch(mb, _get=fake_get):
        scored = mb._versions("Las Nieves de Enero")

    assert queries == ['recording:"Las Nieves de Enero"'], queries
    assert scored == {
        "a1": ({"id": "a1", "name": "Chalino Sánchez"}, 1.0),
        "a2": ({"id": "a2", "name": "Banda El Recodo"}, 0.5),
    }, scored
    mb._versions.cache_clear()


def test_seed_without_tags_or_signals_uses_versions():
    version_calls = []
    profiles = {
        S1: (_song(S1, "Corrido Tradicional", "Anónimo"), {}, None),
    }

    with _Patch(
        mb,
        recording_profile=lambda mbid: profiles[mbid],
        artists_by_tags=lambda tags: (_ for _ in ()).throw(AssertionError("No debe llamar a artists_by_tags si no hay etiquetas")),
        similar_songs=lambda song: (),
        similar_artists=lambda name: {},
        collaborators=lambda aid: {},
        versions=lambda title: (version_calls.append(title) or {"a_ver": ({"id": "a_ver", "name": "Intérprete"}, 1.0)}),
        album_tracks=lambda aid: [_song("t1", "Otra Canción", "Intérprete")],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1]})

    assert res.status_code == 200, res.text
    body = res.json()
    assert version_calls == ["Corrido Tradicional"], version_calls
    assert body["seedTags"] == []
    assert [r["song"]["id"] for r in body["recommendations"]] == ["t1"]
    assert body["recommendations"][0]["signals"] == ["versions"]
    nodes = {n["id"]: n for n in body["graph"]["nodes"]}
    assert {"seed:" + S1, "signal:versions", "artist:a_ver", "song:t1"} == set(nodes)
    assert all(e["from"] in nodes and e["to"] in nodes for e in body["graph"]["edges"])


def test_all_seeds_without_data_returns_422():
    with _Patch(
        mb,
        recording_profile=lambda mbid: (_song(mbid, "Canción Rara", "Nadie"), {}, None),
        artists_by_tags=lambda tags: [],
        similar_songs=lambda song: (),
        similar_artists=lambda name: {},
        collaborators=lambda aid: {},
        versions=lambda title: {},
        album_tracks=lambda aid: [],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S2]})

    assert res.status_code == 422, res.status_code
    assert "No encontramos datos" in res.json()["detail"]


def test_duplicate_seeds_exclude_artists_and_skip_seed_titles():
    profile_calls = []
    profiles = {
        S1: (_song(S1, "Reckoner", "Radiohead"), {"art rock": 5}, "art_seed"),
        S2: (_song(S2, "Weird Fishes", "Radiohead"), {"art rock": 3}, "art_seed"),
    }

    def fake_profile(mbid: str):
        profile_calls.append(mbid)
        return profiles[mbid]

    def fake_similar_songs(song: dict):
        if song["id"] != S1:
            return ()
        return (
            # Mismo ID que una semilla: debe ignorarse.
            (_song(S1, "Otra", "Artista Bueno"), 1.0, "art_ok"),
            # Mismo título que una semilla (con otra capitalización): debe ignorarse.
            (_song("cover_id", "RECKONER", "Artista Bueno"), 0.95, "art_ok"),
            # Canción válida de Last.fm.
            (_song("sim_ok", "Cloudbusting", "Artista Bueno"), 0.9, "art_ok"),
        )

    def fake_album_tracks(aid: str):
        return [
            # Otra versión de la segunda semilla en el álbum: _tracks debe filtrarla.
            _song("alb_dup_seed", "weird fishes", "Artista Bueno"),
            # Título repetido respecto a la de Last.fm: _tracks debe deduplicarlo.
            _song("alb_dup_sim", "cloudbusting", "Artista Bueno"),
            # Segunda canción válida (viene del álbum, por lo que no debe llevar la señal "songs").
            _song("alb_ok", "Hounds of Love", "Artista Bueno"),
        ]

    with _Patch(
        mb,
        recording_profile=fake_profile,
        artists_by_tags=lambda tags: [
            ({"id": "art_seed", "name": "Radiohead"}, {"art rock": 5}),
            ({"id": A_EXCL, "name": "Artista Excluido"}, {"art rock": 5}),
            ({"id": "art_ok", "name": "Artista Bueno"}, {"art rock": 4}),
        ],
        similar_songs=fake_similar_songs,
        similar_artists=lambda name: {A_EXCL: ({"id": A_EXCL, "name": "Artista Excluido"}, 1.0)},
        collaborators=lambda aid: {"art_seed": ({"id": "art_seed", "name": "Radiohead"}, 1.0)},
        versions=lambda title: {},
        album_tracks=fake_album_tracks,
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S1, S2], "excludeArtists": [A_EXCL]})

    assert res.status_code == 200, res.text
    # Las semillas duplicadas se consultan una sola vez.
    assert profile_calls == [S1, S2], profile_calls
    body = res.json()
    rec_artists = {r["artistId"] for r in body["recommendations"]}
    assert A_EXCL not in rec_artists and "art_seed" not in rec_artists
    rec_titles = [r["song"]["title"].casefold() for r in body["recommendations"]]
    assert "reckoner" not in rec_titles and "weird fishes" not in rec_titles
    assert [r["song"]["id"] for r in body["recommendations"]] == ["sim_ok", "alb_ok"]
    # "sim_ok" viene de Last.fm (conserva "songs"); "alb_ok" viene de álbum (se le quita "songs").
    assert "songs" in body["recommendations"][0]["signals"]
    assert "songs" not in body["recommendations"][1]["signals"]


def test_no_isolated_seed_when_candidates_exist_and_valid_edges():
    # Semilla mayoritaria (pop) + semilla minoritaria por etiqueta (jazz) + semilla minoritaria solo con versions (corrido).
    profiles = {
        S1: (_song(S1, "Pop 1", "Pop A"), {"pop": 10, "dance": 8}, "a_s1"),
        S2: (_song(S2, "Pop 2", "Pop B"), {"pop": 9, "dance": 7}, "a_s2"),
        S3: (_song(S3, "Jazz Minor", "Jazz C"), {"jazz": 1}, "a_s3"),
        S4: (_song(S4, "Corrido Huérfano", "Tradicional"), {}, None),
    }

    with _Patch(
        mb,
        recording_profile=lambda mbid: profiles[mbid],
        artists_by_tags=lambda tags: [
            ({"id": "pop_rec_1", "name": "Pop Rec 1"}, {"pop": 5, "dance": 5}),
            ({"id": "pop_rec_2", "name": "Pop Rec 2"}, {"pop": 4, "dance": 4}),
            ({"id": "pop_rec_3", "name": "Pop Rec 3"}, {"pop": 3, "dance": 3}),
            ({"id": "jazz_rec", "name": "Jazz Rec"}, {"jazz": 5}),
        ],
        similar_songs=lambda song: (),
        similar_artists=lambda name: {},
        collaborators=lambda aid: {},
        versions=lambda title: {"corrido_rec": ({"id": "corrido_rec", "name": "Corrido Rec"}, 1.0)} if title == "Corrido Huérfano" else {},
        album_tracks=lambda aid: [_song(f"t1_{aid}", f"Canción 1 {aid}", aid), _song(f"t2_{aid}", f"Canción 2 {aid}", aid)],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S2, S3, S4], "limit": 6})

    assert res.status_code == 200, res.text
    graph = res.json()["graph"]
    nodes = {n["id"]: n for n in graph["nodes"]}
    # Ninguna semilla queda aislada cuando hay cupo (limit >= len(seeds)) y candidatos válidos.
    seed_nodes = [n for n in graph["nodes"] if n["type"] == "seed"]
    assert len(seed_nodes) == 4
    assert all(n["degree"] > 0 for n in seed_nodes), seed_nodes
    # Todas las aristas apuntan a nodos existentes.
    assert all(e["from"] in nodes and e["to"] in nodes for e in graph["edges"])


def test_limit_smaller_than_seeds_valid_graph():
    profiles = {
        S1: (_song(S1, "S1", "A1"), {"t1": 5}, "a1"),
        S2: (_song(S2, "S2", "A2"), {"t2": 4}, "a2"),
        S3: (_song(S3, "S3", "A3"), {"t3": 3}, "a3"),
    }

    with _Patch(
        mb,
        recording_profile=lambda mbid: profiles[mbid],
        artists_by_tags=lambda tags: [
            ({"id": "r1", "name": "R1"}, {"t1": 5}),
            ({"id": "r2", "name": "R2"}, {"t2": 4}),
            ({"id": "r3", "name": "R3"}, {"t3": 3}),
        ],
        similar_songs=lambda song: (),
        similar_artists=lambda name: {},
        collaborators=lambda aid: {},
        versions=lambda title: {},
        album_tracks=lambda aid: [_song(f"song_{aid}", f"Track {aid}", aid)],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S2, S3], "limit": 2})

    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["recommendations"]) == 2
    graph = body["graph"]
    nodes = {n["id"]: n for n in graph["nodes"]}
    # Las 3 semillas siguen en el grafo y ninguna arista queda colgando.
    assert {f"seed:{S1}", f"seed:{S2}", f"seed:{S3}"} <= set(nodes)
    assert all(e["from"] in nodes and e["to"] in nodes for e in graph["edges"])
    # El tercer artista ("r3") y su etiqueta ("t3") se podaron al no caber en limit=2.
    assert "artist:r3" not in nodes and "tag:t3" not in nodes


def test_excluded_signal_blocks_versions_fallback():
    """BUG en backend/app/main.py:72-86: `signals` registra artistas antes de filtrar `excluded`.
    Si una semilla sin etiquetas solo tiene señales hacia artistas excluidos (p. ej. en `excludeArtists`
    o el artista de otra semilla), `covered` la da por cubierta y NO llama a `mb.versions()`,
    dejando la semilla aislada (`degree == 0`) aunque `mb.versions` tenga candidatos válidos."""
    profiles = {
        S1: (_song(S1, "Pop Hit", "Pop Star"), {"pop": 5}, "art_pop"),
        S2: (_song(S2, "Corrido Viejo", "Cantante"), {}, "art_corrido"),
    }
    with _Patch(
        mb,
        recording_profile=lambda mbid: profiles[mbid],
        artists_by_tags=lambda tags: [({"id": "art_pop_rec", "name": "Pop Rec"}, {"pop": 5})],
        similar_songs=lambda song: (),
        similar_artists=lambda name: {A_EXCL: ({"id": A_EXCL, "name": "Ya Visto"}, 1.0)} if name == "Cantante" else {},
        collaborators=lambda aid: {},
        versions=lambda title: {"art_ver": ({"id": "art_ver", "name": "Versionista"}, 1.0)} if title == "Corrido Viejo" else {},
        album_tracks=lambda aid: [_song(f"song_{aid}", f"Track {aid}", aid)],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S2], "excludeArtists": [A_EXCL]})

    nodes = {n["id"]: n for n in res.json()["graph"]["nodes"]}
    assert nodes[f"seed:{S2}"]["degree"] > 0, f"Semilla S2 quedó aislada: {nodes[f'seed:{S2}']}"


def test_rank_top3_shared_tags_drops_minority_seed_tag():
    """BUG en backend/app/recommender.py:37: `rank()` recorta `shared` a las 3 etiquetas de mayor peso global (`[:3]`).
    Si un artista candidato comparte las 3 etiquetas de las semillas mayoritarias Y además la etiqueta única
    de una semilla minoritaria, la etiqueta minoritaria se descarta de `shared`, dejando a la semilla minoritaria
    sin arista en el grafo (`degree == 0`) y sin cobertura en `cover()`."""
    profiles = {
        S1: (_song(S1, "Rock Hit", "Rock Band"), {"rock": 10, "indie": 9, "alternative": 8}, "art1"),
        S2: (_song(S2, "Shoegaze Gem", "Shoe Band"), {"shoegaze": 1}, "art2"),
    }
    with _Patch(
        mb,
        recording_profile=lambda mbid: profiles[mbid],
        artists_by_tags=lambda tags: [
            ({"id": "a_rock", "name": "Pure Rock"}, {"rock": 5, "indie": 5, "alternative": 5}),
            ({"id": "a_shoe", "name": "Shoe Artist"}, {"rock": 1, "indie": 1, "alternative": 1, "shoegaze": 5}),
        ],
        similar_songs=lambda song: (),
        similar_artists=lambda name: {},
        collaborators=lambda aid: {},
        versions=lambda title: {},
        album_tracks=lambda aid: [_song(f"song_{aid}", f"Track {aid}", aid)],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S2], "limit": 10})

    nodes = {n["id"]: n for n in res.json()["graph"]["nodes"]}
    assert nodes[f"seed:{S2}"]["degree"] > 0, f"Semilla S2 quedó aislada: {nodes[f'seed:{S2}']}"


def test_tracks_checks_length_before_deduplicating_hints():
    """BUG en backend/app/main.py:41-47: `_tracks` comprueba `if len(songs) < 2:` sobre `hints` ANTES de
    deduplicar por título (`unique`). Si dos semillas distintas coinciden en recomendar la misma canción
    similar en Last.fm para el mismo artista, `hints[artist_id]` tiene 2 entradas con el mismo título,
    `len(songs) < 2` es False (no consulta `album_tracks`) y tras deduplicar solo devuelve 1 canción en vez de 2."""
    profiles = {
        S1: (_song(S1, "Reckoner", "Radiohead"), {"art rock": 5}, "art_seed"),
        S2: (_song(S2, "Weird Fishes", "Radiohead"), {"art rock": 3}, "art_seed"),
    }
    with _Patch(
        mb,
        recording_profile=lambda mbid: profiles[mbid],
        artists_by_tags=lambda tags: [({"id": "art_ok", "name": "Artista Bueno"}, {"art rock": 4})],
        similar_songs=lambda song: ((_song("sim_ok", "Cloudbusting", "Artista Bueno"), 0.9, "art_ok"),),
        similar_artists=lambda name: {},
        collaborators=lambda aid: {},
        versions=lambda title: {},
        album_tracks=lambda aid: [_song("alb_ok", "Hounds of Love", "Artista Bueno")],
    ):
        res = client.post("/api/recommendations", json={"seeds": [S1, S2]})

    songs = [r["song"]["id"] for r in res.json()["recommendations"]]
    assert songs == ["sim_ok", "alb_ok"], f"Faltó completar con álbum: {songs}"


if __name__ == "__main__":
    test_versions_case_insensitive_and_missing_credits()
    test_seed_without_tags_or_signals_uses_versions()
    test_all_seeds_without_data_returns_422()
    test_duplicate_seeds_exclude_artists_and_skip_seed_titles()
    test_no_isolated_seed_when_candidates_exist_and_valid_edges()
    test_limit_smaller_than_seeds_valid_graph()
    test_excluded_signal_blocks_versions_fallback()
    test_rank_top3_shared_tags_drops_minority_seed_tag()
    test_tracks_checks_length_before_deduplicating_hints()
    print("ok")