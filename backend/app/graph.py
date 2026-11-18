"""Construcción del grafo explicativo de recomendaciones con NetworkX."""

import networkx as nx

from .recommender import Tags
from .recommender import build_graph as build_reason_graph


def _prune(g: nx.DiGraph) -> None:
    """Elimina nodos tag/signal/artist/song que no estén en ningún camino semilla → canción.

    Las semillas nunca se eliminan, aunque queden aisladas.
    """
    seeds = {n for n, d in g.nodes(data=True) if d.get("type") == "seed"}
    songs = {n for n, d in g.nodes(data=True) if d.get("type") == "song"}
    reachable_from_seeds = seeds | set().union(*(nx.descendants(g, s) for s in seeds))
    can_reach_songs = songs | set().union(*(nx.ancestors(g, t) for t in songs))
    on_path = reachable_from_seeds & can_reach_songs
    dead = [
        n
        for n, d in g.nodes(data=True)
        if d.get("type") != "seed" and n not in on_path
    ]
    g.remove_nodes_from(dead)


def _export(g: nx.DiGraph) -> dict:
    """Exporta el DiGraph al formato JSON esperado por el frontend."""
    nodes = [
        {"id": n, **attrs, "degree": g.degree(n)}
        for n, attrs in g.nodes(data=True)
    ]
    edges = [{"from": u, "to": v} for u, v in g.edges()]
    return {"nodes": nodes, "edges": edges}


def build_graph(seeds: list[tuple[dict, Tags]], recommendations: list[dict], seed_results: list[dict]) -> dict:
    """Export the per-reason topology as a NetworkX graph, including status nodes."""
    result = build_reason_graph(seeds, recommendations, seed_results)
    graph = nx.DiGraph()
    for node in result["nodes"]:
        graph.add_node(node["id"], **{key: value for key, value in node.items() if key != "id"})
    graph.add_edges_from((edge["from"], edge["to"]) for edge in result["edges"])
    return _export(graph)
