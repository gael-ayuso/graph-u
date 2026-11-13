"""Recomendación híbrida de artistas (RF-20).

- Etiquetas: TF-IDF + similitud coseno sobre las etiquetas de MusicBrainz (contenido).
- Canciones: canciones parecidas según Last.fm track.getSimilar (colaborativo).
- Oyentes: artistas parecidos según Last.fm artist.getSimilar (colaborativo).
- Colaboración: artistas que comparten créditos o banda con los de tus canciones.
"""

from collections import Counter, deque
from collections.abc import Iterable

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
        shared = sorted(set(tags) & set(weights), key=lambda t: -weights[t])
        # Las 3 de más peso + la mejor de cada semilla: así una semilla minoritaria sigue conectada.
        per_seed = (max((t for t in shared if t in seed), key=seed.get, default=None) for seed in seeds)
        shared = list(dict.fromkeys(shared[:3] + [t for t in per_seed if t]))
        ranked.append((item, round(float(scores[i]), 3), shared))
    return ranked


# Peso de cada señal en la puntuación final (0-1).
WEIGHTS = {"tags": 0.4, "songs": 0.25, "listeners": 0.2, "collab": 0.15}
SIGNAL_LABELS = {"songs": "Canciones similares (Last.fm)", "versions": "Otra grabación de una canción similar (Last.fm)",
                 "listeners": "Artistas similares (Last.fm)", "collab": "Colaboraciones"}

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
    signals = {name: {key: value for key, value in found.items() if key not in exclude and value[1] > 0} for name, found in signals.items()}
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


def distribute(queues: list[Iterable[dict]], limit: int, per_artist: int = 2) -> list[dict]:
    """Un turno por semilla; sin repetir grabaciones ni versiones del mismo título/artista."""
    pending = deque(iter(queue) for queue in queues)
    selected, titles, artist_counts = {}, {}, Counter()
    while pending and len(selected) < limit:
        queue = pending.popleft()
        for rec in queue:
            song_id = rec["song"]["id"]
            title_key = (rec["artistId"], rec["song"]["title"].strip().casefold())
            duplicate = selected.get(song_id) or titles.get(title_key)
            if duplicate is not None:
                known = {reason["seedId"] for reason in duplicate["reasons"]}
                duplicate["reasons"].extend(reason for reason in rec["reasons"] if reason["seedId"] not in known)
                pending.append(queue)
                break
            covered = {reason["seedId"] for chosen in selected.values() for reason in chosen["reasons"]}
            adds_seed = any(reason["seedId"] not in covered for reason in rec["reasons"])
            # La cobertura de una semilla tiene prioridad sobre la diversidad de artistas.
            if artist_counts[rec["artistId"]] >= per_artist and not adds_seed:
                continue
            selected[song_id] = rec
            titles[title_key] = rec
            artist_counts[rec["artistId"]] += 1
            pending.append(queue)
            break
    return list(selected.values())


def build_graph(seeds: list[tuple[dict, Tags]], recommendations: list[dict], seed_results: list[dict]) -> dict:
    """Ramas por semilla y resultado: una señal nunca crea caminos de otras canciones."""
    nodes, edges = {}, set()

    def node(id: str, type: str, label: str, **extra):
        nodes[id] = {"id": id, "type": type, "label": label, **extra}

    for song, _ in seeds:
        node(f"seed:{song['id']}", "seed", song["title"], detail=song["artist"])
    for rec in recommendations:
        song = rec["song"]
        song_node = f"song:{song['id']}"
        node(song_node, "song", song["title"], detail=song["artist"], score=rec["score"])
        for reason in rec["reasons"]:
            seed_id = reason["seedId"]
            # Una instancia por resultado evita atribuir a otra canción del mismo artista
            # la señal track.getSimilar que solo corresponde a esta grabación.
            artist_node = f"artist:{seed_id}:{rec['artistId']}:{song['id']}"
            node(artist_node, "artist", song["artist"], score=reason["score"])
            edges.add((artist_node, song_node))
            for tag in reason["sharedTags"]:
                tag_node = f"tag:{seed_id}:{tag}"
                node(tag_node, "tag", tag)
                edges.update(((f"seed:{seed_id}", tag_node), (tag_node, artist_node)))
            for signal in reason["signals"]:
                signal_node = f"signal:{seed_id}:{signal}"
                node(signal_node, "signal", SIGNAL_LABELS[signal])
                edges.update(((f"seed:{seed_id}", signal_node), (signal_node, artist_node)))
    for result in seed_results:
        if result["status"] == "recommended":
            continue
        status_node = f"status:{result['seedId']}"
        node(status_node, "status", "Sin resultados en esta tanda", detail=result["message"])
        edges.add((f"seed:{result['seedId']}", status_node))
    return {"nodes": list(nodes.values()), "edges": [{"from": a, "to": b} for a, b in sorted(edges)]}
