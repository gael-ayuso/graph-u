"""Ejecuta: backend/.venv/Scripts/python backend/tests/test_recommender.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recommender import cover, hybrid, interleave, rank


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


def test_cover():
    seeds = [
        ({"id": "s_pop"}, {"pop": 5}),
        ({"id": "s_corrido"}, {"corrido": 5}),
        ({"id": "s_jazz"}, {"jazz": 5}),
    ]
    artists = [
        ({"id": "pop1"}, 0.9, ["pop"], {}),                     # conectado a s_pop por etiqueta
        ({"id": "pop2"}, 0.8, ["pop"], {}),                     # relleno de alta puntuación
        ({"id": "pop3"}, 0.7, ["pop"], {}),                     # fuera de cupo si slots=3
        ({"id": "jazz_dead"}, 0.6, ["jazz"], {}),               # conectado a s_jazz pero sin canciones
        ({"id": "jazz_ok"}, 0.5, ["jazz"], {}),                 # siguiente conectado a s_jazz, sí reproducible
        ({"id": "corrido1"}, 0.1, [], {"versions": {"s_corrido"}}),  # al final del ranking, conectado por señal
    ]
    tracks = {a["id"]: [{"id": f"t_{a['id']}"}] for a, *_ in artists if a["id"] != "jazz_dead"}
    picked = cover(seeds, artists, slots=3, playable=lambda a: tracks.get(a["id"], []))
    ids = [a["id"] for a, *_ in picked]
    scores = [score for _, score, *_ in picked]
    # Entran pop1 (etiqueta), jazz_ok (saltando jazz_dead) y corrido1 (señal al final) aunque slots=3 < posición 6.
    assert ids == ["pop1", "jazz_ok", "corrido1"], ids
    assert scores == sorted(scores, reverse=True) and len(ids) == len(set(ids))
    # Si sobran cupos, rellena con los mejores restantes sin duplicar y mantiene orden por puntuación.
    picked_more = cover(seeds, artists, slots=4, playable=lambda a: tracks.get(a["id"], []))
    assert [a["id"] for a, *_ in picked_more] == ["pop1", "pop2", "jazz_ok", "corrido1"]


def test_interleave():
    artists = [({"id": "a"}, 0.9, ["x"], {}), ({"id": "b"}, 0.5, ["y"], {"collab": {"s"}}), ({"id": "c"}, 0.4, ["z"], {})]
    tracks = {"a": [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}], "b": [{"id": "b1"}]}
    result = [r["song"]["id"] for r in interleave(artists, tracks, limit=10)]
    assert result == ["a1", "b1", "a2"], result  # 1 por artista primero, máximo 2, "c" sin canciones
    assert interleave(artists, tracks, limit=10)[1]["signals"] == ["collab"]


if __name__ == "__main__":
    test_rank()
    test_hybrid()
    test_cover()
    test_interleave()
    print("ok")
