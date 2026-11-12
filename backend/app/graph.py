"""Construcción del grafo explicativo de recomendaciones con NetworkX."""

import networkx as nx

from .recommender import SIGNAL_LABELS, Ranked, Tags


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


def build_graph(seeds: list[tuple[dict, Tags]], artists: list[Ranked], recommendations: list[dict]) -> dict:
    """Grafo que explica las recomendaciones: semilla → etiqueta/señal → artista → canción.

    Cada camino desde una semilla hasta una canción es una razón por la que se recomendó.
    """
    used = {r["artistId"] for r in recommendations}
    artists = [a for a in artists if a[0]["id"] in used]
    # Canciones agrupadas por artista para que las aristas no se crucen al dibujar.
    order = {a["id"]: i for i, (a, *_) in enumerate(artists)}
    recommendations = sorted(recommendations, key=lambda r: order[r["artistId"]])
    tags = list(dict.fromkeys(tag for _, _, shared, _ in artists for tag in shared))
    signals = {name: set().union(*(sig[name] for *_, sig in artists if name in sig)) for name in SIGNAL_LABELS}
    signals = {name: seed_ids for name, seed_ids in signals.items() if seed_ids}

    g = nx.DiGraph()
    for s, _ in seeds:
        g.add_node(f"seed:{s['id']}", type="seed", label=s["title"], detail=s["artist"])
    for t in tags:
        g.add_node(f"tag:{t}", type="tag", label=t)
    for name in signals:
        g.add_node(f"signal:{name}", type="signal", label=SIGNAL_LABELS[name])
    for a, score, _, _ in artists:
        g.add_node(f"artist:{a['id']}", type="artist", label=a["name"], score=score)
    for r in recommendations:
        g.add_node(f"song:{r['song']['id']}", type="song", label=r["song"]["title"], detail=r["song"]["artist"], score=r["score"])

    for s, seed_tags in seeds:
        for t in tags:
            if t in seed_tags:
                g.add_edge(f"seed:{s['id']}", f"tag:{t}")
    for name, seed_ids in signals.items():
        for seed_id in sorted(seed_ids):
            g.add_edge(f"seed:{seed_id}", f"signal:{name}")
    for a, _, shared, _ in artists:
        for t in shared:
            g.add_edge(f"tag:{t}", f"artist:{a['id']}")
    for a, _, _, sig in artists:
        for name in sig:
            g.add_edge(f"signal:{name}", f"artist:{a['id']}")
    for r in recommendations:
        g.add_edge(f"artist:{r['artistId']}", f"song:{r['song']['id']}")

    _prune(g)
    return _export(g)
