"""Ejecuta: backend/.venv/Scripts/python backend/tests/test_graph.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.graph import build_graph


def test_build_graph_and_degree():
    seeds = [({"id": "s", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5, "british": 2, "jazz": 1})]
    artists = [
        ({"id": "a", "name": "Kate Bush"}, 0.3, ["art rock", "british"], {"listeners": {"s"}}),
        ({"id": "b", "name": "Sin canciones"}, 0.2, ["jazz"], {"collab": {"s"}}),
    ]
    recs = [{"song": {"id": "k", "title": "This Woman's Work", "artist": "Kate Bush"}, "score": 0.3, "sharedTags": ["art rock", "british"], "artistId": "a"}]

    graph = build_graph(seeds, artists, recs)
    nodes = {n["id"]: n for n in graph["nodes"]}
    # "b", "jazz" y "collab" no aparecen: "b" no tiene canciones recomendadas.
    assert set(nodes) == {"seed:s", "tag:art rock", "tag:british", "signal:listeners", "artist:a", "song:k"}, nodes
    assert nodes["artist:a"] == {"id": "artist:a", "type": "artist", "label": "Kate Bush", "score": 0.3, "degree": 4}
    edges = {(e["from"], e["to"]) for e in graph["edges"]}
    assert edges == {("seed:s", "tag:art rock"), ("seed:s", "tag:british"), ("tag:art rock", "artist:a"), ("tag:british", "artist:a"),
                     ("seed:s", "signal:listeners"), ("signal:listeners", "artist:a"), ("artist:a", "song:k")}, edges

    degrees = {n["id"]: n["degree"] for n in graph["nodes"]}
    assert all(isinstance(d, int) for d in degrees.values())
    assert degrees == {
        "seed:s": 3,
        "tag:art rock": 2,
        "tag:british": 2,
        "signal:listeners": 2,
        "artist:a": 4,
        "song:k": 1,
    }, degrees


def test_prune_removes_dead_nodes_and_keeps_isolated_seeds():
    seeds = [
        ({"id": "s1", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5}),
        ({"id": "s2", "title": "Semilla aislada", "artist": "Otro"}, {"ambient": 3}),
    ]
    artists = [
        ({"id": "a", "name": "Kate Bush"}, 0.3, ["art rock", "orphan-tag"], {"listeners": {"s1"}, "collab": {"ghost"}}),
        ({"id": "dead-artist", "name": "Desconectado"}, 0.1, ["no-seed-tag"], {}),
    ]
    recs = [
        {"song": {"id": "k", "title": "This Woman's Work", "artist": "Kate Bush"}, "score": 0.3, "sharedTags": ["art rock"], "artistId": "a"},
        {"song": {"id": "d", "title": "Canción sin camino", "artist": "Desconectado"}, "score": 0.1, "sharedTags": [], "artistId": "dead-artist"},
    ]

    graph = build_graph(seeds, artists, recs)
    nodes = {n["id"]: n for n in graph["nodes"]}

    # Etiqueta sin semilla ("orphan-tag"), señal con semilla no presente ("collab")
    # y artista desconectado de semillas ("dead-artist", junto con "no-seed-tag") se podan.
    assert "tag:orphan-tag" not in nodes
    assert "tag:no-seed-tag" not in nodes
    assert "signal:collab" not in nodes
    assert "artist:dead-artist" not in nodes

    # El camino válido y la semilla aislada se conservan.
    # NOTA BUG (backend/app/graph.py:18-22): "song:d" NO se poda porque _prune solo filtra
    # d.get("type") in {"tag", "signal", "artist"}, dejando "song:d" huérfana (degree=0) cuando su artista fue podado.
    assert {"seed:s1", "seed:s2", "tag:art rock", "signal:listeners", "artist:a", "song:k"} <= set(nodes)
    assert nodes["seed:s2"]["degree"] == 0
    assert all(e["from"] in nodes and e["to"] in nodes for e in graph["edges"])


def test_repeated_ids_and_empty_recommendations():
    # Semillas duplicadas y mismo artista con dos canciones recomendadas (y desordenadas respecto a artists).
    seeds = [
        ({"id": "s1", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5}),
        ({"id": "s1", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5}),
        ({"id": "s2", "title": "Aislada", "artist": "Nadie"}, {}),
    ]
    artists = [
        ({"id": "a1", "name": "Artista 1"}, 0.8, ["art rock"], {}),
        ({"id": "a2", "name": "Artista 2"}, 0.5, ["art rock"], {}),
    ]
    recs = [
        {"song": {"id": "k2", "title": "Canción A2", "artist": "Artista 2"}, "score": 0.5, "sharedTags": ["art rock"], "artistId": "a2"},
        {"song": {"id": "k1a", "title": "Canción A1-1", "artist": "Artista 1"}, "score": 0.8, "sharedTags": ["art rock"], "artistId": "a1"},
        {"song": {"id": "k1b", "title": "Canción A1-2", "artist": "Artista 1"}, "score": 0.8, "sharedTags": ["art rock"], "artistId": "a1"},
    ]

    graph = build_graph(seeds, artists, recs)
    node_ids = [n["id"] for n in graph["nodes"]]
    # Sin nodos duplicados aunque la semilla se repita o el mismo artista tenga 2 recomendaciones.
    assert len(node_ids) == len(set(node_ids)), node_ids
    assert node_ids.count("artist:a1") == 1
    assert node_ids.count("seed:s1") == 1
    # Las canciones quedan agrupadas por el orden de `artists` (a1 antes que a2).
    song_ids = [n["id"] for n in graph["nodes"] if n["type"] == "song"]
    assert song_ids == ["song:k1a", "song:k1b", "song:k2"], song_ids
    nodes = {n["id"]: n for n in graph["nodes"]}
    # a1 tiene 1 etiqueta de entrada + 2 canciones de salida = grado 3.
    assert nodes["artist:a1"]["degree"] == 3

    # Recomendaciones vacías: solo quedan las semillas con grado 0 y sin aristas.
    empty_rec_graph = build_graph(seeds, artists, [])
    assert empty_rec_graph == {
        "nodes": [
            {"id": "seed:s1", "type": "seed", "label": "Reckoner", "detail": "Radiohead", "degree": 0},
            {"id": "seed:s2", "type": "seed", "label": "Aislada", "detail": "Nadie", "degree": 0},
        ],
        "edges": [],
    }
    assert build_graph([], [], []) == {"nodes": [], "edges": []}


def test_prune_leaves_orphan_song_when_artist_is_dead():
    """BUG en backend/app/graph.py:18-22: si un artista recomendado no tiene camino desde ninguna semilla,
    _prune elimina `artist:dead-artist` pero NO elimina `song:d`, dejándola huérfana con degree=0."""
    seeds = [({"id": "s1", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5})]
    artists = [({"id": "dead-artist", "name": "Desconectado"}, 0.1, ["no-seed-tag"], {})]
    recs = [{"song": {"id": "d", "title": "Canción sin camino", "artist": "Desconectado"}, "score": 0.1, "sharedTags": [], "artistId": "dead-artist"}]
    graph = build_graph(seeds, artists, recs)
    nodes = {n["id"] for n in graph["nodes"]}
    assert "song:d" not in nodes, f"song:d quedó huérfana en el grafo: {graph['nodes']}"


if __name__ == "__main__":
    test_build_graph_and_degree()
    test_prune_removes_dead_nodes_and_keeps_isolated_seeds()
    test_repeated_ids_and_empty_recommendations()
    test_prune_leaves_orphan_song_when_artist_is_dead()
    print("ok")