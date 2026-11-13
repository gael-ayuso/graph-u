"""Ejecuta: backend/.venv/Scripts/python backend/tests/test_recommender.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recommender import build_graph, distribute, hybrid, interleave, rank


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


def test_coverage_skips_empty_branches_and_reaches_lower_ranked_seed():
    def rec(song, seed, artist):
        return {"song": {"id": song, "title": song}, "artistId": artist, "reasons": [{"seedId": seed}]}

    queues = [
        [rec("pop1", "pop", "a"), rec("pop2", "pop", "b"), rec("pop3", "pop", "c")],
        [rec("jazz_ok", "jazz", "d")],  # El candidato anterior no produjo pistas.
        [rec("corrido", "corrido", "e")],
    ]
    assert [r["song"]["id"] for r in distribute(queues, 3)] == ["pop1", "jazz_ok", "corrido"]
    assert [r["song"]["id"] for r in distribute(queues, 4)] == ["pop1", "jazz_ok", "corrido", "pop2"]


def test_interleave():
    artists = [({"id": "a"}, 0.9, ["x"], {}), ({"id": "b"}, 0.5, ["y"], {"collab": {"s"}}), ({"id": "c"}, 0.4, ["z"], {})]
    tracks = {"a": [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}], "b": [{"id": "b1"}]}
    result = [r["song"]["id"] for r in interleave(artists, tracks, limit=10)]
    assert result == ["a1", "b1", "a2"], result  # 1 por artista primero, máximo 2, "c" sin canciones
    assert interleave(artists, tracks, limit=10)[1]["signals"] == ["collab"]


def test_build_graph():
    seeds = [({"id": "s", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5})]
    recs = [{"song": {"id": "k", "title": "This Woman's Work", "artist": "Kate Bush"}, "score": 0.3, "artistId": "a",
             "reasons": [{"seedId": "s", "score": 0.3, "sharedTags": ["art rock"], "signals": ["listeners"]}]}]
    graph = build_graph(seeds, recs, [])
    ids = {n["id"] for n in graph["nodes"]}
    assert ids == {"seed:s", "tag:s:art rock", "signal:s:listeners", "artist:s:a:k", "song:k"}, ids
    edges = {(e["from"], e["to"]) for e in graph["edges"]}
    assert edges == {("seed:s", "tag:s:art rock"), ("tag:s:art rock", "artist:s:a:k"),
                     ("seed:s", "signal:s:listeners"), ("signal:s:listeners", "artist:s:a:k"), ("artist:s:a:k", "song:k")}, edges
    assert all(e["from"] in ids and e["to"] in ids for e in graph["edges"])


def test_distribute_prioritizes_seed_coverage_and_removes_duplicates():
    def rec(id, seed, artist="a", title=None):
        return {"song": {"id": id, "title": title or id}, "artistId": artist, "reasons": [{"seedId": seed}]}
    queues = [[rec("a1", "rock"), rec("a2", "rock"), rec("a3", "rock")], [rec("b1", "salsa", "b")]]
    assert [r["song"]["id"] for r in distribute(queues, 3)] == ["a1", "b1", "a2"]
    assert len(distribute([[rec("same", "s1")], [rec("same", "s2")], [rec("version", "s3", title="same")]], 10)) == 1
    # Si cada semilla necesita una pista distinta del mismo artista, cubrirlas tiene prioridad.
    assert len(distribute([[rec("r1", "s1")], [rec("r2", "s2")], [rec("r3", "s3")]], 10)) == 3


def test_distribute_normalizes_casefold_titles_and_keeps_same_title_for_other_artist():
    def rec(id, seed, artist, title):
        return {"song": {"id": id, "title": title}, "artistId": artist, "reasons": [{"seedId": seed}]}

    queues = [
        [rec("r1", "s1", "a1", "  Straße  "), rec("r3", "s1", "a1", "Extra")],
        [rec("r2", "s2", "a1", "STRASSE"), rec("r4", "s2", "a2", "Straße")],
    ]
    selected = distribute(queues, 10)
    assert [r["song"]["id"] for r in selected] == ["r1", "r3", "r4"]
    assert [reason["seedId"] for reason in selected[0]["reasons"]] == ["s1", "s2"]

    limited = distribute([[rec("x1", "s1", "a1", "One"), rec("x2", "s1", "a2", "Two")]], 1)
    assert [r["song"]["id"] for r in limited] == ["x1"]


def test_graph_does_not_create_paths_between_unrelated_seeds():
    seeds = [({"id": id, "title": id, "artist": id}, {}) for id in ("s1", "s2", "empty")]
    recs = [{"song": {"id": f"r{i}", "title": f"r{i}", "artist": "Shared Artist"}, "artistId": "a", "score": 1,
             "reasons": [{"seedId": f"s{i}", "score": 1, "sharedTags": [], "signals": ["listeners"]}]} for i in (1, 2)]
    graph = build_graph(seeds, recs, [{"seedId": "empty", "status": "no_candidates", "message": "Sin candidatos."}])
    def reachable(start):
        seen, pending = set(), [start]
        while pending:
            current = pending.pop()
            if current not in seen:
                seen.add(current)
                pending.extend(edge["to"] for edge in graph["edges"] if edge["from"] == current)
        return seen
    assert "song:r1" in reachable("seed:s1") and "song:r2" not in reachable("seed:s1")
    assert "song:r2" in reachable("seed:s2") and "song:r1" not in reachable("seed:s2")
    assert "status:empty" in reachable("seed:empty")


def test_graph_omits_status_node_for_recommended_seed_with_search_limited():
    seeds = [
        ({"id": "s1", "title": "Seed 1", "artist": "Art 1"}, {}),
        ({"id": "s2", "title": "Seed 2", "artist": "Art 2"}, {}),
    ]
    recs = [{
        "song": {"id": "r1", "title": "Rec 1", "artist": "Cand 1"},
        "artistId": "a1",
        "score": 0.9,
        "reasons": [{"seedId": "s1", "score": 0.9, "sharedTags": [], "signals": ["collab"]}],
    }]
    seed_results = [
        {"seedId": "s1", "status": "recommended", "message": "1 recomendación", "artistId": "art-1", "searchLimited": True},
        {"seedId": "s2", "status": "search_limit", "message": "Límite de búsqueda", "artistId": None, "searchLimited": True},
    ]
    graph = build_graph(seeds, recs, seed_results)
    node_ids = {n["id"] for n in graph["nodes"]}
    assert "status:s1" not in node_ids
    assert "status:s2" in node_ids


def test_excluded_signals_do_not_lower_tag_scores():
    ranked = hybrid([({"id": "a"}, 1, ["rock"])], {"listeners": {"excluded": ({"id": "excluded"}, 1, {"s"})}}, exclude={"excluded"})
    assert ranked[0][1] == 1


if __name__ == "__main__":
    test_rank()
    test_hybrid()
    test_coverage_skips_empty_branches_and_reaches_lower_ranked_seed()
    test_interleave()
    print("ok")
