"""Recomendación híbrida de artistas (RF-20).

- Etiquetas: TF-IDF + similitud coseno sobre las etiquetas de MusicBrainz (contenido).
- Canciones: canciones parecidas según Last.fm track.getSimilar (colaborativo).
- Oyentes: artistas parecidos según Last.fm artist.getSimilar (colaborativo).
- Colaboración: artistas que comparten créditos o banda con los de tus canciones.
"""

from collections import Counter

import numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.feature_extraction.text import TfidfTransformer
from sklearn.metrics.pairwise import cosine_similarity

Tags = dict[str, int]  # {etiqueta: votos}


def rank(seeds: list[Tags], candidates: list[tuple[dict, Tags]], exclude: set[str] = frozenset()) -> list[tuple[dict, float, list[str]]]:
    """Ordena candidatos por parecido al perfil de las semillas.

    Devuelve (candidato, puntuación 0-1, etiquetas compartidas que lo explican).
    """
    pool = [c for c in candidates if c[1] and c[0]["id"] not in exclude]
    if not pool or not any(seeds):
        return []
    # Filas = elementos, columnas = etiquetas. TF-IDF baja el peso de las etiquetas comunes
    # y sublinear_tf evita que una etiqueta con muchos votos lo domine todo.
    matrix = TfidfTransformer(sublinear_tf=True).fit_transform(DictVectorizer().fit_transform(seeds + [t for _, t in pool]))
    profile = np.asarray(matrix[: len(seeds)].mean(axis=0))  # gusto combinado de las semillas
    scores = cosine_similarity(profile, matrix[len(seeds) :])[0]

    weights = Counter()
    for tags in seeds:
        weights.update(tags)
    ranked = []
    for i in np.argsort(-scores, kind="stable"):
        if scores[i] <= 0:
            break
        item, tags = pool[i]
        shared = sorted(set(tags) & set(weights), key=lambda t: -weights[t])[:3]
        ranked.append((item, round(float(scores[i]), 3), shared))
    return ranked


# Peso de cada señal en la puntuación final (0-1).
WEIGHTS = {"tags": 0.4, "songs": 0.25, "listeners": 0.2, "collab": 0.15}
SIGNAL_LABELS = {"songs": "Canciones similares (Last.fm)", "listeners": "Artistas similares (Last.fm)", "collab": "Colaboraciones"}

# Señal de un artista candidato: (artista, puntuación 0-1, ids de las semillas que la originan).
Signal = dict[str, tuple[dict, float, set[str]]]
Ranked = tuple[dict, float, list[str], dict[str, set[str]]]  # (artista, puntuación, etiquetas, señales → semillas)


def hybrid(by_tags: list[tuple[dict, float, list[str]]], signals: dict[str, Signal], exclude: set[str] = frozenset()) -> list[Ranked]:
    """Mezcla ponderada: 0.4·etiquetas + 0.25·canciones + 0.2·oyentes + 0.15·colaboración.

    Todas las señales van de 0 a 1 respecto a su mejor candidato (el coseno de etiquetas también).
    El peso se reparte solo entre las señales que devolvieron datos: si Last.fm está caído
    o una canción no tiene similares, no cuenta como «no se parece».
    Un artista que solo aparece en una señal suma solo esa parte; uno que es el mejor en todas llega a 1.
    """
    by_tags = [t for t in by_tags if t[0]["id"] not in exclude]
    best_tag = max((score for _, score, _ in by_tags), default=0) or 1
    active = ({"tags"} if by_tags else set()) | {name for name, found in signals.items() if found}
    total = sum(WEIGHTS[name] for name in active) or 1
    items = {a["id"]: [a, WEIGHTS["tags"] * score / best_tag, shared, {}] for a, score, shared in by_tags}
    for name, found in signals.items():
        for artist_id, (artist, score, seeds) in found.items():
            if artist_id in exclude:
                continue
            item = items.setdefault(artist_id, [artist, 0.0, [], {}])
            item[1] += WEIGHTS[name] * score
            item[3][name] = seeds
    ranked = sorted(items.values(), key=lambda i: -i[1])
    return [(a, round(score / total, 3), shared, sig) for a, score, shared, sig in ranked if score > 0]


def interleave(artists: list[Ranked], tracks: dict[str, list[dict]], limit: int, per_artist: int = 2) -> list[dict]:
    """Una canción por artista en orden de parecido, luego la segunda, etc. (diversidad)."""
    picks = [
        (round_, position, {"song": song, "score": score, "sharedTags": shared, "signals": list(signals), "artistId": artist["id"]})
        for position, (artist, score, shared, signals) in enumerate(artists)
        for round_, song in enumerate(tracks.get(artist["id"], [])[:per_artist])
    ]
    return [p[2] for p in sorted(picks, key=lambda p: p[:2])][:limit]


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
    nodes = (
        [{"id": f"seed:{s['id']}", "type": "seed", "label": s["title"], "detail": s["artist"]} for s, _ in seeds]
        + [{"id": f"tag:{t}", "type": "tag", "label": t} for t in tags]
        + [{"id": f"signal:{name}", "type": "signal", "label": SIGNAL_LABELS[name]} for name in signals]
        + [{"id": f"artist:{a['id']}", "type": "artist", "label": a["name"], "score": score} for a, score, _, _ in artists]
        + [{"id": f"song:{r['song']['id']}", "type": "song", "label": r["song"]["title"], "detail": r["song"]["artist"], "score": r["score"]} for r in recommendations]
    )
    edges = (
        [{"from": f"seed:{s['id']}", "to": f"tag:{t}"} for s, seed_tags in seeds for t in tags if t in seed_tags]
        + [{"from": f"seed:{seed_id}", "to": f"signal:{name}"} for name, seed_ids in signals.items() for seed_id in sorted(seed_ids)]
        + [{"from": f"tag:{t}", "to": f"artist:{a['id']}"} for a, _, shared, _ in artists for t in shared]
        + [{"from": f"signal:{name}", "to": f"artist:{a['id']}"} for a, _, _, sig in artists for name in sig]
        + [{"from": f"artist:{r['artistId']}", "to": f"song:{r['song']['id']}"} for r in recommendations]
    )
    return {"nodes": nodes, "edges": edges}
