"""Consultas SQL al catálogo local de MusicBrainz en PostgreSQL."""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from uuid import UUID

import psycopg

from .music_search import (
    CANDIDATE_LIMIT,
    TITLE_ONLY_SIMILARITY_THRESHOLD,
    WORD_SIMILARITY_THRESHOLD,
    can_fuzz,
    field_score,
    rank_candidates,
    words,
)

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 2
_STATEMENT_TIMEOUT_MS = 8000
_thread_local = threading.local()


def _connection(dsn: str) -> psycopg.Connection:
    conn: psycopg.Connection | None = getattr(_thread_local, "conn", None)
    cached_dsn: str | None = getattr(_thread_local, "dsn", None)
    if conn is not None and not conn.closed and cached_dsn == dsn:
        return conn
    if conn is not None and not conn.closed:
        conn.close()
    conn = psycopg.connect(
        dsn,
        autocommit=True,
        connect_timeout=_CONNECT_TIMEOUT,
        options=f"-c statement_timeout={_STATEMENT_TIMEOUT_MS}",
    )
    _thread_local.conn = conn
    _thread_local.dsn = dsn
    _thread_local.fuzzy_capabilities = {}
    return conn


def reset_connection() -> None:
    conn: psycopg.Connection | None = getattr(_thread_local, "conn", None)
    if conn is not None and not conn.closed:
        try:
            conn.close()
        except psycopg.Error:
            pass
    _thread_local.conn = None
    _thread_local.dsn = None
    _thread_local.fuzzy_capabilities = {}


def is_active(dsn: str) -> bool:
    """Comprueba rápidamente que PostgreSQL responda y tenga el esquema musicbrainz."""
    if not dsn:
        return False
    try:
        conn = _connection(dsn)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM musicbrainz.recording LIMIT 1")
            cur.fetchone()
        return True
    except psycopg.Error:
        reset_connection()
        return False


def _song_row(gid: UUID, title: str, artist: str, release: str | None, duration: int | None, comment: str | None) -> dict:
    return {
        "id": str(gid),
        "title": title,
        "artist": artist,
        "release": release,
        "duration": duration,
        "comment": comment or None,
    }


def search(dsn: str, title: str, artist: str) -> list[dict]:
    clauses: list[str] = []
    params: list[str] = []
    if title:
        clauses.append(
            "musicbrainz.mb_simple_tsvector(r.name::text) @@ plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower(%s))"
        )
        params.append(title)
    if artist:
        clauses.append(
            "musicbrainz.mb_simple_tsvector(ac.name::text) @@ plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower(%s))"
        )
        params.append(artist)
    if not clauses:
        return []

    order_parts: list[str] = []
    if title:
        order_parts.append("(lower(name) = lower(%s)) DESC")
        params.append(title)
    if artist:
        order_parts.append("(lower(artist) = lower(%s)) DESC")
        params.append(artist)
    order_parts.extend(["(comment IS NULL) DESC", "video ASC", "id ASC"])

    sql = f"""
        WITH matches AS (
            SELECT
                r.id,
                r.gid,
                r.name,
                ac.name AS artist,
                r.length,
                NULLIF(r.comment, '') AS comment,
                r.video
            FROM musicbrainz.recording r
            JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
            WHERE {" AND ".join(clauses)}
            LIMIT 400
        ),
        ranked AS (
            SELECT id, gid, name, artist, length, comment
            FROM matches
            ORDER BY {", ".join(order_parts)}
            LIMIT 20
        )
        SELECT
            rk.gid,
            rk.name,
            rk.artist,
            (
                SELECT rel.name
                FROM musicbrainz.track tr
                JOIN musicbrainz.medium m ON m.id = tr.medium
                JOIN musicbrainz.release rel ON rel.id = m.release
                WHERE tr.recording = rk.id
                ORDER BY (rel.status = 1) DESC NULLS LAST, rel.id
                LIMIT 1
            ) AS release_name,
            rk.length,
            rk.comment
        FROM ranked rk
    """
    try:
        conn = _connection(dsn)
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        if rows:
            return [_song_row(*row) for row in rows]
        return _search_fuzzy(conn, title, artist)
    except psycopg.Error:
        reset_connection()
        raise


def _fuzzy_ready(conn: psycopg.Connection, title: str, artist: str) -> bool:
    indexes = tuple(name for value, name in (
        (title, "musicbrainz.graphu_recording_name_trgm"),
        (artist, "musicbrainz.graphu_artist_credit_name_trgm"),
    ) if value)
    cache = getattr(_thread_local, "fuzzy_capabilities", {})
    active, expires = cache.get(indexes, (False, 0.0))
    if time.monotonic() < expires:
        return active
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
            ) AND NOT EXISTS (
                SELECT 1 FROM unnest(%s::text[]) AS required(name)
                WHERE NOT EXISTS (
                    SELECT 1 FROM pg_index i
                    WHERE i.indexrelid = to_regclass(required.name)
                      AND i.indisvalid AND i.indisready
                )
            )
        """, (list(indexes),))
        active = cur.fetchone()[0]
    cache[indexes] = (active, time.monotonic() + 15)
    _thread_local.fuzzy_capabilities = cache
    if not active:
        logger.warning("Búsqueda aproximada local no preparada; ejecuta backend/sql/enable_fuzzy_search.sql. La búsqueda normal sigue activa.")
    return active


def _search_fuzzy(conn: psycopg.Connection, title: str, artist: str) -> list[dict]:
    if not can_fuzz(title, artist) or any(value and not words(value) for value in (title, artist)):
        return []
    if not _fuzzy_ready(conn, title, artist):
        return []
    clauses, scores = [], []
    params = {"title": title, "artist": artist, "limit": CANDIDATE_LIMIT}
    for key, column in (("title", "r.name"), ("artist", "ac.name")):
        value = params[key]
        if not value:
            continue
        if key == "artist":
            # Validate a bounded set of credits BEFORE joining the 40M-row
            # recording catalog. Broad trigram matches otherwise fan out to
            # hundreds of thousands of recordings, even in artist-only search.
            clauses.append("r.artist_credit = ANY(%(artist_ids)s::integer[])")
            scores.append("public.word_similarity(lower(%(artist)s), lower(ac.name::text))")
        elif any(len(word) >= 4 for word in words(value)):
            # Query on the left of <% matches a continuous extent of the name;
            # the commuted operator can use the GIN index on lower(name::text).
            clauses.append(f"lower(%({key})s) OPERATOR(public.<%%) lower({column}::text)")
            scores.append(f"public.word_similarity(lower(%({key})s), lower({column}::text))")
        else:
            clauses.append(
                f"musicbrainz.mb_simple_tsvector({column}::text) @@ "
                f"plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower(%({key})s))"
            )
            scores.append("1.0")
    sql = f"""
        SELECT r.gid, r.name, ac.name, NULL, r.length, NULLIF(r.comment, '')
        FROM musicbrainz.recording r
        JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
        WHERE {" AND ".join(clauses)}
        ORDER BY LEAST({", ".join(scores)}) DESC,
                 ({" + ".join(scores)}) DESC, r.gid
        LIMIT %(limit)s
    """
    if not artist:
        # Rank at most 400 recordings before looking up artist credits. At
        # catalog scale, joining every loose title match first is too costly.
        sql = f"""
            WITH fuzzy_recordings AS MATERIALIZED (
                SELECT r.gid, r.name, r.artist_credit, r.length, r.comment
                FROM musicbrainz.recording r
                WHERE {" AND ".join(clauses)}
                ORDER BY {scores[0]} DESC, r.gid
                LIMIT %(limit)s
            )
            SELECT r.gid, r.name, ac.name, NULL, r.length, NULLIF(r.comment, '')
            FROM fuzzy_recordings r
            JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
        """
    # This connection is reused in autocommit mode. SET LOCAL must live in an
    # explicit transaction so the retrieval threshold never leaks to later work.
    with conn.transaction(), conn.cursor() as cur:
        threshold = WORD_SIMILARITY_THRESHOLD if artist else TITLE_ONLY_SIMILARITY_THRESHOLD
        cur.execute("SELECT set_config('pg_trgm.word_similarity_threshold', %s, true)", (str(threshold),))
        if artist:
            params["artist_ids"] = _fuzzy_artist_ids(cur, artist)
            if not params["artist_ids"]:
                return []
        cur.execute(sql, params)
        candidates = [_song_row(*row) for row in cur.fetchall()]
    selected = rank_candidates(candidates, title, artist)
    if not selected:
        return []
    # Look up release metadata only for accepted results, never for all 400
    # fuzzy candidates. Preserve the Python ranking when the rows come back.
    with conn.cursor() as cur:
        cur.execute("""
            SELECT r.gid, r.name, ac.name,
                (SELECT rel.name
                 FROM musicbrainz.track tr
                 JOIN musicbrainz.medium m ON m.id = tr.medium
                 JOIN musicbrainz.release rel ON rel.id = m.release
                 WHERE tr.recording = r.id
                 ORDER BY (rel.status = 1) DESC NULLS LAST, rel.id LIMIT 1),
                r.length, NULLIF(r.comment, '')
            FROM musicbrainz.recording r
            JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
            WHERE r.gid = ANY(%s::uuid[])
        """, ([song["id"] for song in selected],))
        enriched = {song["id"]: song for song in (_song_row(*row) for row in cur.fetchall())}
    return [enriched[song["id"]] for song in selected if song["id"] in enriched]


def _fuzzy_artist_ids(cur: psycopg.Cursor, artist: str) -> list[int]:
    if any(len(word) >= 4 for word in words(artist)):
        condition = "lower(%(artist)s) OPERATOR(public.<%%) lower(ac.name::text)"
    else:
        condition = (
            "musicbrainz.mb_simple_tsvector(ac.name::text) @@ "
            "plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower(%(artist)s))"
        )
    cur.execute(f"""
        SELECT ac.id, ac.name
        FROM musicbrainz.artist_credit ac
        WHERE {condition}
        ORDER BY public.word_similarity(lower(%(artist)s), lower(ac.name::text)) DESC, ac.id
        LIMIT %(limit)s
    """, {"artist": artist, "limit": CANDIDATE_LIMIT})
    return [credit_id for credit_id, name in cur.fetchall() if field_score(artist, name) > 0]


def recording_profile(dsn: str, mbid: str) -> tuple[dict, dict[str, int], str | None] | None:
    try:
        UUID(mbid)
    except ValueError:
        return None

    sql_rec = """
        WITH rec AS (
            SELECT id, gid, name, artist_credit, length, NULLIF(comment, '') AS comment
            FROM musicbrainz.recording
            WHERE gid = %(mbid)s::uuid
            UNION ALL
            SELECT r.id, r.gid, r.name, r.artist_credit, r.length, NULLIF(r.comment, '') AS comment
            FROM musicbrainz.recording_gid_redirect red
            JOIN musicbrainz.recording r ON r.id = red.new_id
            WHERE red.gid = %(mbid)s::uuid
              AND NOT EXISTS (SELECT 1 FROM musicbrainz.recording WHERE gid = %(mbid)s::uuid)
            LIMIT 1
        )
        SELECT
            rec.id,
            rec.gid,
            rec.name,
            ac.name AS artist,
            rec.length,
            rec.comment,
            pa.id AS primary_artist_id,
            pa.gid AS primary_artist_gid
        FROM rec
        JOIN musicbrainz.artist_credit ac ON ac.id = rec.artist_credit
        LEFT JOIN LATERAL (
            SELECT a.id, a.gid
            FROM musicbrainz.artist_credit_name acn
            JOIN musicbrainz.artist a ON a.id = acn.artist
            WHERE acn.artist_credit = rec.artist_credit
            ORDER BY acn.position ASC
            LIMIT 1
        ) pa ON true
    """
    try:
        conn = _connection(dsn)
        with conn.cursor() as cur:
            cur.execute(sql_rec, {"mbid": mbid})
            row = cur.fetchone()
            if not row:
                return None
            rec_id, rec_gid, title, artist_name, duration, comment, artist_internal_id, artist_gid = row

            tags: dict[str, int] = {}
            cur.execute(
                """
                SELECT t.name, rt.count
                FROM musicbrainz.recording_tag rt
                JOIN musicbrainz.tag t ON t.id = rt.tag
                WHERE rt.recording = %s AND rt.count > 0
                """,
                (rec_id,),
            )
            for tag_name, count in cur.fetchall():
                tags[tag_name] = tags.get(tag_name, 0) + count

            if artist_internal_id is not None:
                cur.execute(
                    """
                    SELECT t.name, at.count
                    FROM musicbrainz.artist_tag at
                    JOIN musicbrainz.tag t ON t.id = at.tag
                    WHERE at.artist = %s AND at.count > 0
                    """,
                    (artist_internal_id,),
                )
                for tag_name, count in cur.fetchall():
                    tags[tag_name] = tags.get(tag_name, 0) + count

        song = _song_row(rec_gid, title, artist_name, None, duration, comment)
        return song, tags, str(artist_gid) if artist_gid else None
    except psycopg.Error:
        reset_connection()
        raise


def artists_by_tags(dsn: str, top_tags: tuple[str, ...]) -> list[tuple[dict, dict[str, int]]]:
    if not top_tags:
        return []
    sql = """
        WITH top_artists AS (
            SELECT
                at.artist,
                COUNT(DISTINCT at.tag) AS matched_tags,
                SUM(at.count) AS matched_votes
            FROM musicbrainz.artist_tag at
            JOIN musicbrainz.tag t ON t.id = at.tag
            WHERE t.name = ANY(%s) AND at.count > 0
            GROUP BY at.artist
            ORDER BY matched_tags DESC, matched_votes DESC
            LIMIT 100
        )
        SELECT a.gid, a.name, t.name AS tag_name, at.count
        FROM top_artists ta
        JOIN musicbrainz.artist a ON a.id = ta.artist
        JOIN musicbrainz.artist_tag at ON at.artist = a.id
        JOIN musicbrainz.tag t ON t.id = at.tag
        WHERE at.count > 0
        ORDER BY ta.matched_tags DESC, ta.matched_votes DESC, a.id
    """
    try:
        conn = _connection(dsn)
        with conn.cursor() as cur:
            cur.execute(sql, (list(top_tags),))
            rows = cur.fetchall()
    except psycopg.Error:
        reset_connection()
        raise

    artists: dict[str, dict] = {}
    artist_tags: dict[str, dict[str, int]] = defaultdict(dict)
    for gid, name, tag_name, count in rows:
        key = str(gid)
        if key not in artists:
            artists[key] = {"id": key, "name": name}
        artist_tags[key][tag_name] = count
    return [(artists[key], artist_tags[key]) for key in artists]


def album_tracks(dsn: str, artist_id: str) -> list[dict]:
    try:
        UUID(artist_id)
    except ValueError:
        return []

    sql = """
        WITH a AS (
            SELECT id FROM musicbrainz.artist WHERE gid = %(mbid)s::uuid
            UNION ALL
            SELECT ar.id
            FROM musicbrainz.artist_gid_redirect red
            JOIN musicbrainz.artist ar ON ar.id = red.new_id
            WHERE red.gid = %(mbid)s::uuid
              AND NOT EXISTS (SELECT 1 FROM musicbrainz.artist WHERE gid = %(mbid)s::uuid)
            LIMIT 1
        ),
        rg AS (
            SELECT DISTINCT rg.id
            FROM a
            JOIN musicbrainz.artist_credit_name acn ON acn.artist = a.id
            JOIN musicbrainz.release_group rg ON rg.artist_credit = acn.artist_credit
            WHERE rg.type = 1
              AND rg.comment NOT ILIKE '%%live%%'
            LIMIT 20
        ),
        rels AS (
            SELECT DISTINCT ON (rg.id) rel.id, rel.name
            FROM rg
            JOIN musicbrainz.release rel ON rel.release_group = rg.id
            WHERE rel.status = 1
              AND rel.comment NOT ILIKE '%%live%%'
            ORDER BY rg.id, rel.id
        )
        SELECT r.gid, r.name, ac.name AS artist, rels.name AS release_name, r.length, NULLIF(r.comment, '') AS comment
        FROM rels
        JOIN musicbrainz.medium m ON m.release = rels.id
        JOIN musicbrainz.track tr ON tr.medium = m.id
        JOIN musicbrainz.recording r ON r.id = tr.recording
        JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
        WHERE r.comment NOT ILIKE '%%live%%'
          AND tr.is_data_track = false
        ORDER BY rels.id, m.position, tr.position
        LIMIT 80
    """
    try:
        conn = _connection(dsn)
        with conn.cursor() as cur:
            cur.execute(sql, {"mbid": artist_id})
            rows = cur.fetchall()
    except psycopg.Error:
        reset_connection()
        raise

    tracks: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        title_key = row[1].casefold()
        if title_key not in seen:
            seen.add(title_key)
            tracks.append(_song_row(*row))
            if len(tracks) >= 15:
                break
    return tracks


def collaborators(dsn: str, artist_id: str) -> tuple[dict[str, int], dict[str, str]]:
    try:
        UUID(artist_id)
    except ValueError:
        return {}, {}

    sql = """
        WITH a AS (
            SELECT id FROM musicbrainz.artist WHERE gid = %(mbid)s::uuid
            UNION ALL
            SELECT ar.id
            FROM musicbrainz.artist_gid_redirect red
            JOIN musicbrainz.artist ar ON ar.id = red.new_id
            WHERE red.gid = %(mbid)s::uuid
              AND NOT EXISTS (SELECT 1 FROM musicbrainz.artist WHERE gid = %(mbid)s::uuid)
            LIMIT 1
        ),
        recs AS (
            SELECT r.artist_credit
            FROM a
            JOIN musicbrainz.artist_credit_name acn ON acn.artist = a.id
            JOIN musicbrainz.artist_credit ac ON ac.id = acn.artist_credit
            JOIN musicbrainz.recording r ON r.artist_credit = ac.id
            WHERE ac.artist_count > 1
            LIMIT 100
        ),
        credit_collabs AS (
            SELECT a2.gid, a2.name, COUNT(*)::int AS cnt
            FROM recs
            JOIN musicbrainz.artist_credit_name acn2 ON acn2.artist_credit = recs.artist_credit
            JOIN musicbrainz.artist a2 ON a2.id = acn2.artist
            CROSS JOIN a
            WHERE a2.id <> a.id
            GROUP BY a2.gid, a2.name
        ),
        rel_collabs AS (
            SELECT a2.gid, a2.name, 1 AS cnt
            FROM a
            JOIN musicbrainz.l_artist_artist laa ON laa.entity0 = a.id OR laa.entity1 = a.id
            JOIN musicbrainz.link l ON l.id = laa.link
            JOIN musicbrainz.link_type lt ON lt.id = l.link_type
            JOIN musicbrainz.artist a2 ON a2.id = CASE WHEN laa.entity0 = a.id THEN laa.entity1 ELSE laa.entity0 END
            WHERE lt.name IN ('member of band', 'collaboration')
        )
        SELECT gid, name, SUM(cnt)::int AS total
        FROM (
            SELECT * FROM credit_collabs
            UNION ALL
            SELECT * FROM rel_collabs
        ) combined
        GROUP BY gid, name
    """
    try:
        conn = _connection(dsn)
        with conn.cursor() as cur:
            cur.execute(sql, {"mbid": artist_id})
            rows = cur.fetchall()
    except psycopg.Error:
        reset_connection()
        raise

    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    for gid, name, total in rows:
        key = str(gid)
        counts[key] = total
        names[key] = name
    return counts, names
