"""Cliente de MusicBrainz: prioriza la base PostgreSQL local si está activa y usa la API pública (ws/2) como respaldo."""

import logging
import os
import threading
import time
from collections import Counter
from functools import lru_cache
from pathlib import Path

import httpx
import psycopg

from . import musicbrainz_db as mb_db
from .music_search import can_fuzz, fuzzy_query, rank_candidates

logger = logging.getLogger(__name__)


def _env(name: str) -> str:
    """Variable de entorno o, si no está, la de .env.local en la raíz del repo (la misma que usa Next).

    ponytail: lector mínimo de KEY=valor; python-dotenv si la configuración crece.
    """
    if os.getenv(name):
        return os.environ[name]
    env_file = Path(__file__).resolve().parents[2] / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == name:
                return value.strip().strip('"').strip("'")
    return ""


API = "https://musicbrainz.org/ws/2"
# MusicBrainz pide un User-Agent que identifique la aplicación.
USER_AGENT = _env("MUSICBRAINZ_USER_AGENT") or "GraphU/0.1 (proyecto academico)"
LASTFM_API_KEY = _env("LASTFM_API_KEY")

_client = httpx.Client(base_url=API, headers={"User-Agent": USER_AGENT}, timeout=8)
_lock = threading.Lock()
_last_request = 0.0

_DB_CHECK_TTL = 15.0
_db_lock = threading.Lock()
_db_status_cache: tuple[str, bool, float] | None = None
_last_logged_source: str | None = None


class MusicBrainzError(Exception):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


def _log_source(source: str) -> None:
    global _last_logged_source
    if source != _last_logged_source:
        _last_logged_source = source
        if source == "local_db":
            logger.info("MusicBrainz: base de datos local activa; usando PostgreSQL local.")
        else:
            logger.info("MusicBrainz: base local inactiva o no configurada; usando API pública.")


def is_local_db_active(force: bool = False) -> bool:
    """Comprueba si la base local de MusicBrainz está configurada y activa."""
    global _db_status_cache
    dsn = _env("MUSICBRAINZ_DATABASE_URL")
    if not dsn:
        _log_source("public_api")
        return False

    now = time.monotonic()
    with _db_lock:
        if not force and _db_status_cache is not None:
            cached_dsn, cached_active, expires_at = _db_status_cache
            if cached_dsn == dsn and now < expires_at:
                return cached_active

    active = mb_db.is_active(dsn)
    with _db_lock:
        _db_status_cache = (dsn, active, time.monotonic() + _DB_CHECK_TTL)
    _log_source("local_db" if active else "public_api")
    return active


def active_source() -> str:
    return "local_db" if is_local_db_active() else "public_api"


def _mark_local_db_inactive(dsn: str) -> None:
    global _db_status_cache
    with _db_lock:
        _db_status_cache = (dsn, False, time.monotonic() + _DB_CHECK_TTL)
    _log_source("public_api")


def reset_source_cache() -> None:
    """Limpia el estado en caché de la comprobación de base local (útil en pruebas)."""
    global _db_status_cache, _last_logged_source
    with _db_lock:
        _db_status_cache = None
    _last_logged_source = None
    mb_db.reset_connection()


def _with_local_fallback(db_fn, api_fn):
    dsn = _env("MUSICBRAINZ_DATABASE_URL")
    if dsn and is_local_db_active():
        try:
            return db_fn(dsn)
        except psycopg.Error:
            logger.warning("Falló la consulta a la base local de MusicBrainz; cambiando a la API pública.")
            _mark_local_db_inactive(dsn)
    return api_fn()


def _get(path: str, **params) -> dict:
    global _last_request
    # ponytail: candado global para respetar 1 petición/s de la API pública;
    # solo aplica cuando se usa el respaldo de la API pública.
    with _lock:
        # MusicBrainz responde 503 cuando está saturado aunque se respete el límite: reintento con espera creciente.
        for delay in (1.05, 2, 4, 6):
            wait = _last_request + delay - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                response = _client.get(path, params={**params, "fmt": "json"})
            except httpx.HTTPError:
                raise MusicBrainzError("No se pudo conectar con MusicBrainz. Inténtalo de nuevo.")
            finally:
                _last_request = time.monotonic()
            if response.status_code != 503:
                break
    if response.status_code == 404:
        raise MusicBrainzError("No se encontró la canción en MusicBrainz.", 404)
    if response.status_code != 200:
        raise MusicBrainzError("MusicBrainz no respondió correctamente. Inténtalo de nuevo.")
    return response.json()


def _quote(value: str) -> str:
    """Frase literal para la sintaxis Lucene de MusicBrainz."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _tags(entity: dict) -> dict[str, int]:
    return {t["name"]: t["count"] for t in entity.get("tags") or [] if t["count"] > 0}


def _song(recording: dict) -> dict:
    credit = "".join(c["name"] + c.get("joinphrase", "") for c in recording.get("artist-credit", []))
    releases = recording.get("releases") or []
    return {
        "id": recording["id"],
        "title": recording["title"],
        "artist": credit,
        "release": releases[0]["title"] if releases else None,
        "duration": recording.get("length"),
        "comment": recording.get("disambiguation") or None,
    }


def _search_api(title: str, artist: str) -> list[dict]:
    query = " AND ".join(f"{field}:{_quote(value)}" for field, value in (("recording", title), ("artist", artist)) if value)
    songs = [_song(r) for r in _get("/recording", query=query, limit=20)["recordings"]]
    if songs or not can_fuzz(title, artist):
        return songs
    query = fuzzy_query(title, artist)
    if not query:
        return []
    # MusicBrainz caps a single response at 100; don't paginate/retry broader
    # queries. _get retains the existing rate limiting and error semantics.
    candidates = [_song(r) for r in _get("/recording", query=query, limit=100)["recordings"]]
    return rank_candidates(candidates, title, artist)


def search(title: str, artist: str) -> list[dict]:
    return _with_local_fallback(
        lambda dsn: mb_db.search(dsn, title, artist),
        lambda: _search_api(title, artist),
    )


@lru_cache(maxsize=2048)
def _artist_tags(mbid: str) -> dict[str, int]:
    return _tags(_get(f"/artist/{mbid}", inc="tags"))


def _recording_profile_api(mbid: str) -> tuple[dict, dict[str, int], str | None]:
    recording = _get(f"/recording/{mbid}", inc="artist-credits+tags")
    tags = _tags(recording)
    credits = recording.get("artist-credit", [])
    artist_id = credits[0]["artist"]["id"] if credits else None
    if artist_id:
        for name, count in _artist_tags(artist_id).items():
            tags[name] = tags.get(name, 0) + count
    return _song(recording), tags, artist_id


def _recording_profile_db(dsn: str, mbid: str) -> tuple[dict, dict[str, int], str | None]:
    profile = mb_db.recording_profile(dsn, mbid)
    if profile is None:
        raise MusicBrainzError("No se encontró la canción en MusicBrainz.", 404)
    return profile


@lru_cache(maxsize=2048)
def recording_profile(mbid: str) -> tuple[dict, dict[str, int], str | None]:
    """(canción, etiquetas de la grabación + de su artista principal, id del artista).

    Las grabaciones suelen tener pocas etiquetas; las del artista dan más contexto.
    """
    return _with_local_fallback(
        lambda dsn: _recording_profile_db(dsn, mbid),
        lambda: _recording_profile_api(mbid),
    )


def _artists_by_tags_api(top_tags: tuple[str, ...]) -> list[tuple[dict, dict[str, int]]]:
    query = " OR ".join(f"tag:{_quote(tag)}" for tag in top_tags)
    return [({"id": a["id"], "name": a["name"]}, _tags(a)) for a in _get("/artist", query=query, limit=100)["artists"]]


@lru_cache(maxsize=512)
def artists_by_tags(top_tags: tuple[str, ...]) -> list[tuple[dict, dict[str, int]]]:
    """Hasta 100 artistas con alguna de las etiquetas, cada uno con su perfil completo de etiquetas."""
    return _with_local_fallback(
        lambda dsn: mb_db.artists_by_tags(dsn, top_tags),
        lambda: _artists_by_tags_api(top_tags),
    )


def _album_tracks_api(artist_id: str) -> list[dict]:
    query = f"arid:{artist_id} AND primarytype:album AND status:official AND NOT comment:live"
    tracks, seen = [], set()
    for recording in _get("/recording", query=query, limit=15)["recordings"]:
        if recording["title"].casefold() not in seen:
            seen.add(recording["title"].casefold())
            tracks.append(_song(recording))
    return tracks


@lru_cache(maxsize=2048)
def album_tracks(artist_id: str) -> list[dict]:
    """Canciones de álbumes oficiales (sin directos) de un artista, sin títulos repetidos."""
    return _with_local_fallback(
        lambda dsn: mb_db.album_tracks(dsn, artist_id),
        lambda: _album_tracks_api(artist_id),
    )


Scored = dict[str, tuple[dict, float]]  # {id de artista: (artista, puntuación 0-1)}
SimilarSong = tuple[dict, float, str]  # (canción, puntuación 0-1, id del artista principal)


def _normalized(counts: dict[str, float], names: dict[str, str]) -> Scored:
    top = max(counts.values(), default=0) or 1
    return {i: ({"id": i, "name": names[i]}, round(c / top, 3)) for i, c in counts.items()}


def _optional(source, empty):
    """Las señales extra son opcionales: si su servicio falla, se recomienda sin ellas."""
    try:
        return source()
    except (MusicBrainzError, httpx.HTTPError, psycopg.Error, ValueError, KeyError, TypeError):
        return empty


def _collaborators_api(artist_id: str) -> Scored:
    counts, names = Counter(), {}
    credits = [c["artist"] for r in _get("/recording", artist=artist_id, inc="artist-credits", limit=100)["recordings"] for c in r.get("artist-credit", [])]
    relations = [r["artist"] for r in _get(f"/artist/{artist_id}", inc="artist-rels").get("relations", []) if r["type"] in ("member of band", "collaboration")]
    for artist in credits + relations:
        if artist["id"] != artist_id:
            counts[artist["id"]] += 1
            names[artist["id"]] = artist["name"]
    return _normalized(counts, names)


def _collaborators_db(dsn: str, artist_id: str) -> Scored:
    counts, names = mb_db.collaborators(dsn, artist_id)
    return _normalized(counts, names)


@lru_cache(maxsize=1024)
def _collaborators(artist_id: str) -> Scored:
    return _with_local_fallback(
        lambda dsn: _collaborators_db(dsn, artist_id),
        lambda: _collaborators_api(artist_id),
    )


def collaborators(artist_id: str) -> Scored:
    """Artistas que comparten créditos en grabaciones (featurings) o son miembros/colaboradores."""
    return _optional(lambda: _collaborators(artist_id), {})


# Last.fm: similitud colaborativa a partir de los scrobbles de sus usuarios.
def _lastfm(method: str, **params) -> dict:
    if not LASTFM_API_KEY:
        return {}
    response = httpx.get(
        "https://ws.audioscrobbler.com/2.0/",
        params={"method": method, **params, "api_key": LASTFM_API_KEY, "format": "json", "autocorrect": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=8,
    )
    response.raise_for_status()
    return response.json()


@lru_cache(maxsize=1024)
def _similar_artists(artist_name: str) -> Scored:
    found = [a for a in _lastfm("artist.getsimilar", artist=artist_name, limit=100).get("similarartists", {}).get("artist", []) if a.get("mbid")]
    return {a["mbid"]: ({"id": a["mbid"], "name": a["name"]}, round(float(a["match"]), 3)) for a in found}


def similar_artists(artist_name: str) -> Scored:
    """Last.fm artist.getSimilar (match 0-1). Solo los que traen MBID, para enlazar con MusicBrainz."""
    return _optional(lambda: _similar_artists(artist_name), {})


@lru_cache(maxsize=1024)
def _similar_songs(title: str, artist: str) -> tuple[SimilarSong, ...]:
    tracks = _lastfm("track.getsimilar", track=title, artist=artist, limit=50).get("similartracks", {}).get("track", [])
    return tuple(
        ({"id": t["mbid"], "title": t["name"], "artist": t["artist"]["name"], "release": None, "duration": None, "comment": None}, round(float(t["match"]), 3), t["artist"]["mbid"])
        for t in tracks
        if t.get("mbid") and t.get("artist", {}).get("mbid")
    )


def similar_songs(song: dict) -> tuple[SimilarSong, ...]:
    """Last.fm track.getSimilar. Muchas canciones no tienen datos y devuelve vacío.

    ponytail: solo se usan las canciones que Last.fm trae con MBID de grabación y de artista;
    resolver el resto exigiría una búsqueda en MusicBrainz por canción (~1 s cada una).
    """
    return _optional(lambda: _similar_songs(song["title"], song["artist"]), ())
