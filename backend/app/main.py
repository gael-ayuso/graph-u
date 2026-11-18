import time
from collections import Counter
from random import Random
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from . import musicbrainz as mb
from .graph import build_graph
from .recommender import distribute, hybrid, interleave, rank

app = FastAPI(title="GraphU API", version="0.1.0")
RECOMMENDATION_SECONDS = 45.0
# Solo intercambia candidatos cuya afinidad difiere como máximo en 0.1.
EXPLORATION_JITTER = 0.05


@app.get("/health")
def health():
    return {"status": "ok", "musicbrainz": mb.active_source()}


@app.get("/api/music/search")
def search(q: str = "", artist: str = ""):
    title, artist = q.strip(), artist.strip()
    if (not title and not artist) or any(0 < len(v) < 2 or len(v) > 150 for v in (title, artist)):
        raise HTTPException(400, "Escribe entre 2 y 150 caracteres en canción o artista.")
    try:
        return {"songs": mb.search(title, artist)}
    except mb.MusicBrainzError as error:
        raise HTTPException(error.status, str(error))


def _canonical_uuid(value: str) -> str:
    """Normalize UUIDs received from MusicBrainz as well as client input."""
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        return value


def _validate_uuid(value):
    if not isinstance(value, str) or len(value) != 36:
        raise ValueError("Invalid UUID")
    try:
        parsed = UUID(value)
    except ValueError as error:
        raise ValueError("Invalid UUID") from error
    if str(parsed) != value.lower():
        raise ValueError("Invalid UUID")
    return parsed


class ExcludedVersion(BaseModel):
    artist_id: UUID = Field(alias="artistId")
    title: str

    @field_validator("artist_id", mode="before")
    @classmethod
    def validate_artist(cls, value):
        return _validate_uuid(value)

    @field_validator("title", mode="before")
    @classmethod
    def validate_title(cls, value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Title must not be empty")
        return value


class RecommendationRequest(BaseModel):
    seeds: list[UUID] = Field(min_length=1, max_length=10)
    limit: int = Field(10, ge=1, le=30)
    exclude_artists: list[UUID] = Field(default_factory=list, max_length=200, alias="excludeArtists")
    exclude_recordings: list[UUID] = Field(default_factory=list, max_length=200, alias="excludeRecordings")
    exclude_versions: list[ExcludedVersion] = Field(default_factory=list, max_length=200, alias="excludeVersions")

    @field_validator("seeds", "exclude_artists", "exclude_recordings", mode="before")
    @classmethod
    def validate_ids(cls, value):
        if isinstance(value, list):
            return [_validate_uuid(item) for item in value]
        return value

    @field_validator("limit", mode="before")
    @classmethod
    def validate_limit(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not value.is_integer()):
            raise ValueError("Limit must be an integer")
        return value


def _eligible_tracks(artist_id: str, songs: list[dict], excluded_ids: set[str], excluded_versions: set[tuple[str, str]]) -> list[dict]:
    unique = {}
    artist_key = _canonical_uuid(artist_id)
    for song in songs:
        title = song["title"].strip().casefold()
        song_id = _canonical_uuid(song["id"])
        if song_id not in excluded_ids and (artist_key, title) not in excluded_versions:
            unique.setdefault(title, {**song, "id": song_id})
    return list(unique.values())


def _tracks(artist_id: str, hints: dict[str, list[tuple[float, dict]]], catalog: dict[str, list[dict] | None],
            allow_album: bool = True, excluded_ids: set[str] = frozenset(),
            excluded_versions: set[tuple[str, str]] = frozenset(), *, rng: Random) -> list[dict]:
    """Count only eligible, distinct hints before deciding whether to query albums."""
    songs = _eligible_tracks(artist_id, [song for _, song in sorted(hints.get(artist_id, []),
                             key=lambda h: -(h[0] + rng.uniform(-EXPLORATION_JITTER, EXPLORATION_JITTER)))],
                             excluded_ids, excluded_versions)
    if len(songs) < 2 and allow_album:
        if artist_id not in catalog:
            catalog[artist_id] = mb._optional(lambda: mb.album_tracks(artist_id), None)
        # Copiar antes de mezclar: el catálogo puede venir de una caché compartida.
        album = list(catalog[artist_id] or [])
        rng.shuffle(album)
        songs += album
    return _eligible_tracks(artist_id, songs, excluded_ids, excluded_versions)


def _candidates(song: dict, tags: dict, artist_id: str | None, excluded: set[str], seed_ids: set[str], deadline: float, rng: Random) -> dict:
    """Un perfil y cuatro señales independientes para esta canción."""
    top_tags = tuple(tag for tag, _ in Counter(tags).most_common(3))
    by_tags, source_failed, search_limited = [], False, False
    if top_tags and time.monotonic() < deadline:
        try:
            candidates = [({**artist, "id": _canonical_uuid(artist["id"])}, artist_tags)
                          for artist, artist_tags in mb.artists_by_tags(top_tags)]
            by_tags = rank([tags], candidates, exclude=excluded)
        except mb.MusicBrainzError:
            source_failed = True  # Las otras señales todavía pueden recomendar.
    elif top_tags:
        search_limited = True
    signals = {"songs": {}, "listeners": {}, "collab": {}}
    hints = {}
    if time.monotonic() < deadline:
        similar_songs = mb.similar_songs(song)
    else:
        similar_songs, search_limited = (), True
    for similar, score, similar_artist in similar_songs:
        similar = {**similar, "id": _canonical_uuid(similar["id"])}
        similar_artist = _canonical_uuid(similar_artist)
        if similar["id"] in seed_ids or similar_artist in excluded or score <= 0:
            continue
        _, best, _ = signals["songs"].get(similar_artist, (None, 0.0, set()))
        signals["songs"][similar_artist] = ({"id": similar_artist, "name": similar["artist"]}, max(best, score), {song["id"]})
        hints.setdefault(similar_artist, []).append((score, similar))
    if artist_id:
        for name, source in (("listeners", lambda: mb.similar_artists(song["artist"])), ("collab", lambda: mb.collaborators(artist_id))):
            if time.monotonic() >= deadline:
                search_limited = True
                continue
            found = source()
            signals[name] = {_canonical_uuid(key): ({**artist, "id": _canonical_uuid(artist["id"])}, score, {song["id"]})
                             for key, (artist, score) in found.items()}
    artists = hybrid(by_tags, signals, exclude=excluded)
    # Variar la selección sin cambiar las puntuaciones ni sus explicaciones.
    artists.sort(key=lambda candidate: -(candidate[1] + rng.uniform(-EXPLORATION_JITTER, EXPLORATION_JITTER)))
    return {"song": song, "artists": artists, "byId": {a[0]["id"]: a for a in artists}, "hints": hints,
            "sourceFailed": source_failed, "tracksFailed": False, "searchLimited": search_limited,
            "prepared": True, "exhausted": False, "yielded": False}


def _reason(branch: dict, song: dict, artist_id: str) -> dict | None:
    ranked = branch["byId"].get(artist_id)
    if ranked is None:
        return None
    _, score, shared, signals = ranked
    # Una pista de álbum no debe presentarse como similar directa en Last.fm.
    hinted = [track for _, track in branch["hints"].get(artist_id, [])]
    direct = any(track["id"] == song["id"] for track in hinted)
    actual_signals = [name for name in signals if name != "songs" or direct]
    if "songs" in signals and not direct and any(track["title"].strip().casefold() == song["title"].strip().casefold() for track in hinted):
        actual_signals.append("versions")
    if not shared and not actual_signals:
        return None
    return {"seedId": branch["song"]["id"], "score": score, "sharedTags": shared, "signals": actual_signals}


def _seed_queue(branch: dict, catalog: dict, seed_ids: set[str], batch_size: int, catalog_limit: int, deadline: float, rng: Random,
                excluded_versions: set[tuple[str, str]] = frozenset()):
    artists = branch["artists"]
    queries = 0
    # Cargar solo los lotes que se consumen y seguir con otros artistas si faltan pistas.
    for start in range(0, len(artists), batch_size):
        batch = artists[start:start + batch_size]
        seconds = []
        for ranked in batch:
            artist, _, shared, signals = ranked
            # Las pistas de álbum solo tienen una razón propia si hay etiquetas u otra señal.
            allow_album = bool(shared or any(name != "songs" for name in signals))
            eligible_hints = _eligible_tracks(artist["id"], [song for _, song in branch["hints"].get(artist["id"], [])],
                                              seed_ids, excluded_versions)
            if allow_album and len(eligible_hints) < 2 and artist["id"] not in catalog:
                if queries >= catalog_limit or time.monotonic() >= deadline:
                    allow_album = False
                    branch["searchLimited"] = True
                else:
                    queries += 1
            tracks = [song for song in _tracks(artist["id"], branch["hints"], catalog, allow_album, seed_ids, excluded_versions, rng=rng)
                      if song["id"] not in seed_ids and _reason(branch, song, artist["id"]) is not None]
            if artist["id"] in catalog and catalog[artist["id"]] is None:
                branch["tracksFailed"] = True
            picks = interleave([ranked], {artist["id"]: tracks}, 2)
            for rec in picks:
                rec["reasons"] = [_reason(branch, rec["song"], rec["artistId"])]
            if picks:
                branch["yielded"] = True
                yield picks[0]
                seconds.extend(picks[1:])
        for rec in seconds:
            yield rec
    branch["exhausted"] = True


def _branch_queue(branch: dict, excluded: set[str], seed_ids: set[str], catalog: dict, batch_size: int, catalog_limit: int, deadline: float, rng: Random,
                  excluded_versions: set[tuple[str, str]] = frozenset(), excluded_ids: set[str] = frozenset()):
    branch.update(_candidates(branch["song"], branch["tags"], branch["artistId"], excluded, seed_ids, deadline, rng))
    yield from _seed_queue(branch, catalog, seed_ids | excluded_ids, batch_size, catalog_limit, deadline, rng, excluded_versions)


@app.post("/api/recommendations")
def recommend(body: RecommendationRequest):
    deadline = time.monotonic() + RECOMMENDATION_SECONDS
    rng = Random()  # Entropía nueva por petición, independiente de las canciones seed.
    seeds, unavailable, deferred = [], set(), set()
    for seed_id in dict.fromkeys(body.seeds):
        if time.monotonic() >= deadline:
            deferred.add(str(seed_id))
            seeds.append(({"id": str(seed_id), "title": "Canción pendiente", "artist": ""}, {}, None))
            continue
        try:
            song, tags, artist = mb.recording_profile(str(seed_id))
            seeds.append(({**song, "id": _canonical_uuid(song["id"])}, tags, _canonical_uuid(artist) if artist else None))
        except mb.MusicBrainzError:
            # Una semilla no disponible no bloquea las recomendaciones de las demás.
            unavailable.add(str(seed_id))
            seeds.append(({"id": str(seed_id), "title": "Canción no disponible", "artist": ""}, {}, None))
    excluded = {str(a) for a in body.exclude_artists}
    seed_ids = {_canonical_uuid(song["id"]) for song, _, _ in seeds}
    excluded_ids = seed_ids | {str(recording) for recording in body.exclude_recordings}
    excluded_versions = {(str(version.artist_id), version.title.strip().casefold()) for version in body.exclude_versions}
    branches = [{"song": song, "tags": tags, "artistId": artist, "artists": [], "byId": {}, "hints": {},
                 "prepared": False, "searchLimited": False} for song, tags, artist in seeds
                if song["id"] not in unavailable | deferred]
    catalog = {}
    batch_size = max(1, (body.limit + len(seeds) - 1) // len(seeds))
    # La API pública limita peticiones por segundo: no recorrer 100 catálogos vacíos
    # por semilla. La cuota separada evita que una semilla consuma la de las demás.
    catalog_limit = 100 if branches and mb.active_source() == "local_db" else max(1, 12 // len(seeds))
    recommendations = distribute([_branch_queue(branch, excluded, seed_ids, catalog, batch_size, catalog_limit, deadline, rng, excluded_versions, excluded_ids)
                                  for branch in branches], body.limit)
    for rec in recommendations:
        # También reconocer las semillas que comparten un resultado ya elegido, sin duplicarlo.
        rec["reasons"] = [reason for branch in branches if (reason := _reason(branch, rec["song"], rec["artistId"])) is not None]
        rec["seedIds"] = [reason["seedId"] for reason in rec["reasons"]]
        rec["sharedTags"] = list(dict.fromkeys(tag for reason in rec["reasons"] for tag in reason["sharedTags"]))
        rec["signals"] = list(dict.fromkeys(name for reason in rec["reasons"] for name in reason["signals"]))
        rec["score"] = max(reason["score"] for reason in rec["reasons"])
    by_seed = {branch["song"]["id"]: branch for branch in branches}
    seed_results = []
    for song, tags, artist_id in seeds:
        found = [rec["song"]["id"] for rec in recommendations if song["id"] in rec["seedIds"]]
        branch = by_seed.get(song["id"])
        if found:
            status = "recommended"
            message = "1 recomendación a partir de esta canción." if len(found) == 1 else f"{len(found)} recomendaciones a partir de esta canción."
        elif song["id"] in deferred or (branch is not None and branch["searchLimited"]):
            status, message = "search_limit", "La búsqueda alcanzó su límite de tiempo o consultas; quedaron candidatos sin revisar."
        elif branch is None:
            status, message = "unavailable", "No pudimos consultar todos los datos de esta canción. Inténtalo de nuevo."
        elif not branch["prepared"]:
            status, message = "limit", "No hubo espacio en esta tanda por el límite de resultados."
        elif not branch["artists"] and branch["sourceFailed"]:
            status, message = "unavailable", "No pudimos consultar todos los datos de esta canción. Inténtalo de nuevo."
        elif not branch["artists"]:
            status = "no_candidates"
            message = "No encontramos artistas nuevos con los datos disponibles de esta canción."
            if not tags:
                message += " No tiene etiquetas; tampoco obtuvimos similares ni colaboraciones utilizables."
            if body.exclude_artists:
                message += " Los artistas ya mostrados se excluyen; puedes empezar de nuevo."
        elif branch["exhausted"] and not branch["yielded"]:
            if branch["tracksFailed"]:
                status, message = "unavailable", "Encontramos artistas candidatos, pero falló la consulta de sus canciones. Inténtalo de nuevo."
            else:
                status, message = "no_tracks", "Encontramos artistas candidatos, pero no canciones nuevas utilizables en su catálogo."
        else:
            status, message = "limit", "No hubo espacio en esta tanda por el límite de resultados o de canciones por artista."
        seed_results.append({"seedId": song["id"], "title": song["title"], "artist": song["artist"],
                             "status": status, "message": message, "recommendationIds": found,
                             "artistId": _canonical_uuid(artist_id) if artist_id else None,
                             "searchLimited": song["id"] in deferred or bool(branch and branch["searchLimited"])})
    # Solo descriptivas: estas etiquetas ya no restringen la búsqueda de otras semillas.
    seed_tags = list(dict.fromkeys(tag for _, tags, _ in seeds for tag, _ in Counter(tags).most_common(3)))
    graph = build_graph([(song, tags) for song, tags, _ in seeds], recommendations, seed_results)
    return {"seedTags": seed_tags, "recommendations": recommendations, "seedResults": seed_results, "graph": graph}
