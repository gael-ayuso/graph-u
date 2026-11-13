"""Pruebas de la exportación NetworkX y el grafo por razón vigente."""

import sys
from pathlib import Path

import networkx as nx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.graph import _export, _prune, build_graph
from app.recommender import build_graph as build_reason_graph


def test_build_graph_and_degree():
    seeds = [({"id": "s", "title": "Reckoner", "artist": "Radiohead"}, {"art rock": 5, "british": 2})]
    recs = [{"song": {"id": "k", "title": "Song", "artist": "Kate"}, "artistId": "a", "score": 0.3,
             "reasons": [{"seedId": "s", "score": 0.3, "sharedTags": ["art rock", "british"], "signals": ["listeners"]}]}]
    graph = build_graph(seeds, recs, [])
    nodes = {n["id"]: n for n in graph["nodes"]}
    edges = {(e["from"], e["to"]) for e in graph["edges"]}
    assert set(nodes) == {"seed:s", "tag:s:art rock", "tag:s:british", "signal:s:listeners", "artist:s:a:k", "song:k"}
    assert edges == {("seed:s", "tag:s:art rock"), ("seed:s", "tag:s:british"),
                     ("seed:s", "signal:s:listeners"), ("tag:s:art rock", "artist:s:a:k"),
                     ("tag:s:british", "artist:s:a:k"), ("signal:s:listeners", "artist:s:a:k"),
                     ("artist:s:a:k", "song:k")}
    assert {n: v["degree"] for n, v in nodes.items()} == {
        "seed:s": 3, "tag:s:art rock": 2, "tag:s:british": 2, "signal:s:listeners": 2,
        "artist:s:a:k": 4, "song:k": 1,
    }


def test_prune_removes_dead_nodes_and_keeps_isolated_seeds():
    g = nx.DiGraph()
    g.add_nodes_from([("s1", {"type": "seed"}), ("s2", {"type": "seed"}), ("tag", {"type": "tag"}),
                      ("artist", {"type": "artist"}), ("song", {"type": "song"}),
                      ("orphan-tag", {"type": "tag"}), ("dead-artist", {"type": "artist"}),
                      ("orphan-song", {"type": "song"})])
    g.add_edges_from([("s1", "tag"), ("tag", "artist"), ("artist", "song"), ("dead-artist", "orphan-song")])
    _prune(g)
    assert set(g.nodes) == {"s1", "s2", "tag", "artist", "song"}
    exported = _export(g)
    assert next(n for n in exported["nodes"] if n["id"] == "s2")["degree"] == 0
    assert all(e["from"] in g and e["to"] in g for e in exported["edges"])


def test_repeated_ids_empty_recommendations_and_status():
    seeds = [({"id": "s1", "title": "Seed", "artist": "Artist"}, {}),
             ({"id": "s1", "title": "Seed", "artist": "Artist"}, {}),
             ({"id": "s2", "title": "Empty", "artist": "Artist"}, {})]
    recs = [{"song": {"id": rid, "title": rid, "artist": "Candidate"}, "score": 0.8, "artistId": "a",
             "reasons": [{"seedId": "s1", "score": 0.8, "sharedTags": ["rock"], "signals": []}]}
            for rid in ("k1", "k2")]
    graph = build_graph(seeds, recs, [{"seedId": "s2", "status": "limit", "message": "Límite"}])
    ids = [n["id"] for n in graph["nodes"]]
    assert len(ids) == len(set(ids)) and ids.count("seed:s1") == 1
    assert {"artist:s1:a:k1", "artist:s1:a:k2", "song:k1", "song:k2", "status:s2"} <= set(ids)
    empty = build_graph(seeds, [], [])
    assert {n["id"] for n in empty["nodes"]} == {"seed:s1", "seed:s2"}
    assert all(n["degree"] == 0 for n in empty["nodes"]) and empty["edges"] == []
    assert build_graph([], [], []) == {"nodes": [], "edges": []}


def test_adapter_preserves_reason_topology_without_fabricating_shared_paths():
    seeds = [({"id": sid, "title": sid, "artist": sid}, {}) for sid in ("s1", "s2")]
    recs = [{"song": {"id": f"r{i}", "title": f"r{i}", "artist": "Shared"}, "score": 0.9, "artistId": "a",
             "reasons": [{"seedId": f"s{i}", "score": 0.9, "sharedTags": [], "signals": ["songs"]}]} for i in (1, 2)]
    graph = build_graph(seeds, recs, [])
    reference = build_reason_graph(seeds, recs, [])
    assert [{k: v for k, v in node.items() if k != "degree"} for node in graph["nodes"]] == reference["nodes"]
    assert {(e["from"], e["to"]) for e in graph["edges"]} == {(e["from"], e["to"]) for e in reference["edges"]}
    g = nx.DiGraph((e["from"], e["to"]) for e in graph["edges"])
    assert nx.has_path(g, "seed:s1", "song:r1") and not nx.has_path(g, "seed:s1", "song:r2")
    assert nx.has_path(g, "seed:s2", "song:r2") and not nx.has_path(g, "seed:s2", "song:r1")
