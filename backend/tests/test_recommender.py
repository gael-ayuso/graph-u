"""Ejecuta: backend/.venv/Scripts/python backend/tests/test_recommender.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recommender import build_graph, hybrid, interleave, rank


def test_rank():
    seeds = [{"art rock": 5, "alternative rock": 4, "electronic": 1}]
    candidates = [
        ({"id": "pop"}, {"pop": 3}),                                          # nada en común
        ({"id": "close"}, {"art rock": 2, "alternative rock": 2}),            # muy parecido
        ({"id": "far"}, {"electronic": 1, "house": 3, "techno": 3}),          # poco parecido
        ({"id": "seed-artist"}, {"art rock": 5, "alternative rock": 4}),      # excluido
        ({"id": "empty"}, {}),                                                # sin etiquetas
    ]
    ranked = rank(seeds, candidates, exclude={"seed-artist"})
    ids = [item["id"] for item, _, _ in ranked]
    assert ids == ["close", "far"], ids
    assert ranked[0][2] == ["art rock", "alternative rock"]
    assert 0 < ranked[1][1] < ranked[0][1] <= 1


def test_hybrid():
    by_tags = [({"id": "t"}, 0.8, ["rock"]), ({"id": "both"}, 0.6, ["rock"]), ({"id": "seed"}, 1.0, [])]
    signals = {"listeners": {"both": ({"id": "both"}, 1.0, {"s"}), "seed": ({"id": "seed"}, 1.0, {"s"})},
               "collab": {"c": ({"id": "c"}, 1.0, {"s"})}}
    ranked = hybrid(by_tags, signals, exclude={"seed"})
    # Etiquetas relativas a la mejor (0.8 → 1, 0.6 → 0.75); "songs" no devolvió nada, así que
    # el peso total es 0.4 + 0.2 + 0.15 = 0.75 y no 1.
    assert [(a["id"], score) for a, score, _, _ in ranked] == [("both", 0.667), ("t", 0.533), ("c", 0.2)], ranked
    assert ranked[0][3] == {"listeners": {"s"}} and ranked[2][2] == []


def test_interleave():
    artists = [({"id": "a"}, 0.9, ["x"], {}), ({"id": "b"}, 0.5, ["y"], {"collab": {"s"}}), ({"id": "c"}, 0.4, ["z"], {})]
    tracks = {"a": [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}], "b": [{"id": "b1"}]}
    result = [r["song"]["id"] for r in interleave(artists, tracks, limit=10)]
    assert result == ["a1", "b1", "a2"], result  # 1 por artista primero, máximo 2, "c" sin canciones
    assert interleave(artists, tracks, limit=10)[1]["signals"] == ["collab"]


def test_build_graph():
    seeds = [({"id": "s", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5, "british": 2, "jazz": 1})]
    artists = [({"id": "a", "name": "Kate Bush"}, 0.3, ["art rock", "british"], {"listeners": {"s"}}), ({"id": "b", "name": "Sin canciones"}, 0.2, ["jazz"], {"collab": {"s"}})]
    recs = [{"song": {"id": "k", "title": "This Woman's Work", "artist": "Kate Bush"}, "score": 0.3, "sharedTags": ["art rock", "british"], "artistId": "a"}]
    graph = build_graph(seeds, artists, recs)
    ids = {n["id"] for n in graph["nodes"]}
    assert ids == {"seed:s", "tag:art rock", "tag:british", "signal:listeners", "artist:a", "song:k"}, ids  # "b", "jazz" y "collab" no aparecen
    edges = {(e["from"], e["to"]) for e in graph["edges"]}
    assert edges == {("seed:s", "tag:art rock"), ("seed:s", "tag:british"), ("tag:art rock", "artist:a"), ("tag:british", "artist:a"),
                     ("seed:s", "signal:listeners"), ("signal:listeners", "artist:a"), ("artist:a", "song:k")}, edges
    assert all(e["from"] in ids and e["to"] in ids for e in graph["edges"])


if __name__ == "__main__":
    test_rank()
    test_hybrid()
    test_interleave()
    test_build_graph()
    print("ok")
