from collections import Counter
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import musicbrainz as mb
from .recommender import build_graph, hybrid, interleave, rank

app = FastAPI(title="GraphU API", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/music/search")
def search(q: str = "", artist: str = ""):
    title, artist = q.strip(), artist.strip()
    if (not title and not artist) or any(0 < len(v) < 2 or len(v) > 150 for v in (title, artist)):
        raise HTTPException(400, "Escribe entre 2 y 150 caracteres en canción o artista.")
    try:
        return {"songs": mb.search(title, artist)}
    except mb.MusicBrainzError as error:
        raise HTTPException(error.status, str(error))


class RecommendationRequest(BaseModel):
    seeds: list[UUID] = Field(min_length=1, max_length=10)
    limit: int = Field(10, ge=1, le=30)
    # Artistas ya mostrados: "Otras recomendaciones" los excluye para ofrecer artistas nuevos.
    exclude_artists: list[UUID] = Field(default_factory=list, max_length=200, alias="excludeArtists")


def _tracks(artist_id: str, hints: dict[str, list[tuple[float, dict]]]) -> list[dict]:
    """Canciones similares (Last.fm) del artista (mejor primero) y, si no llegan a 2, las de álbum; sin títulos repetidos."""
    songs = [song for _, song in sorted(hints.get(artist_id, []), key=lambda h: -h[0])]
    if len(songs) < 2:
        songs += mb._optional(lambda: mb.album_tracks(artist_id), [])
    unique = {}
    for song in songs:
        unique.setdefault(song["title"].casefold(), song)
    return list(unique.values())


@app.post("/api/recommendations")
def recommend(body: RecommendationRequest):
    try:
        # 1. Perfil de gusto: etiquetas de cada semilla y de su artista.
        seeds = [mb.recording_profile(str(s)) for s in dict.fromkeys(body.seeds)]
        seed_tags = [tags for _, tags, _ in seeds]
        weights = Counter()
        for tags in seed_tags:
            weights.update(tags)
        if not weights:
            raise HTTPException(422, "Las canciones elegidas no tienen etiquetas en MusicBrainz. Prueba con otras.")
        top_tags = tuple(tag for tag, _ in weights.most_common(3))
        # 2. Candidatos de cuatro señales. Se excluyen los artistas de las semillas (para descubrir
        #    música nueva) y los ya mostrados.
        excluded = {artist for _, _, artist in seeds if artist} | {str(a) for a in body.exclude_artists}
        by_tags = rank(seed_tags, mb.artists_by_tags(top_tags), exclude=excluded)
        signals = {"songs": {}, "listeners": {}, "collab": {}}
        hints = {}  # artista → canciones similares de Last.fm (puntuación, canción)
        seed_ids = {song["id"] for song, _, _ in seeds}
        seed_titles = {song["title"].casefold() for song, _, _ in seeds}  # otras versiones de tus canciones
        for song, _, artist_id in seeds:
            for similar, score, similar_artist in mb.similar_songs(song):
                if similar["id"] in seed_ids or similar["title"].casefold() in seed_titles:
                    continue
                _, best, origin = signals["songs"].get(similar_artist, (None, 0.0, set()))
                signals["songs"][similar_artist] = ({"id": similar_artist, "name": similar["artist"]}, max(best, score), origin | {song["id"]})
                hints.setdefault(similar_artist, []).append((score, similar))
            if not artist_id:
                continue
            for name, found in (("listeners", mb.similar_artists(song["artist"])), ("collab", mb.collaborators(artist_id))):
                for candidate_id, (artist, score) in found.items():
                    _, best, origin = signals[name].get(candidate_id, (artist, 0.0, set()))
                    signals[name][candidate_id] = (artist, max(best, score), origin | {song["id"]})
        artists = hybrid(by_tags, signals, exclude=excluded)
        # 3. Canciones de los artistas ganadores, intercaladas por artista: primero las canciones
        #    similares de Last.fm; si no hay 2, se completa con canciones de álbum.
        #    Con 2 canciones por artista bastan limit/2 artistas (+1 por si alguno no tiene canciones).
        artists = artists[: (body.limit + 1) // 2 + 1]
        tracks = {artist["id"]: _tracks(artist["id"], hints) for artist, *_ in artists}
        recommendations = interleave(artists, tracks, body.limit)
        hinted = {song["id"] for found in hints.values() for _, song in found}
        for rec in recommendations:
            if rec["song"]["id"] not in hinted and "songs" in rec["signals"]:
                rec["signals"].remove("songs")  # esta canción concreta viene del álbum, no de Last.fm
        # 4. Grafo explicativo para el explorador (semilla → etiqueta/señal → artista → canción).
        graph = build_graph([(song, tags) for song, tags, _ in seeds], artists, recommendations)
        return {"seedTags": list(top_tags), "recommendations": recommendations, "graph": graph}
    except mb.MusicBrainzError as error:
        raise HTTPException(error.status, str(error))
