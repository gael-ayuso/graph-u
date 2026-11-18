import "server-only";

import { Pool, type PoolConfig } from "pg";
import { buildCoverProxyUrl } from "@/lib/music-library/cover-url";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CONNECT_TIMEOUT_MS = 2500;
const STATEMENT_TIMEOUT_MS = 8000;

export type CatalogErrorCode =
  | "INVALID_MBID"
  | "NOT_FOUND"
  | "CATALOG_UNAVAILABLE"
  | "CATALOG_TIMEOUT";

export class CatalogError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 503,
    public readonly code: CatalogErrorCode
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export interface CatalogRecording {
  recordingMbid: string;
  title: string;
  artistName: string;
  artistMbid: string | null;
  durationMs: number | null;
  comment: string | null;
  coverReleaseMbid: string | null;
  coverReleaseGroupMbid: string | null;
  coverUrl: string | null;
}

export interface CatalogArtist {
  artistMbid: string;
  name: string;
  sortName: string | null;
  comment: string | null;
  coverReleaseMbid: string | null;
  coverReleaseGroupMbid: string | null;
  coverUrl: string | null;
}

export interface CoverTarget {
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
}

type CatalogPoolState = {
  pool: Pool;
  dsn: string;
};

const globalForCatalog = globalThis as unknown as {
  musicBrainzCatalogPool?: CatalogPoolState;
};

export function isValidMbid(value: string): boolean {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function normalizeMbid(value: string): string {
  if (typeof value !== "string") {
    throw new CatalogError("El identificador MBID no es válido.", 400, "INVALID_MBID");
  }
  const trimmed = value.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new CatalogError("El identificador MBID no es válido.", 400, "INVALID_MBID");
  }
  return trimmed.toLowerCase();
}

export function isCatalogConfigured(): boolean {
  return Boolean(process.env.MUSICBRAINZ_DATABASE_URL?.trim());
}

function getCatalogPool(): Pool {
  const dsn = process.env.MUSICBRAINZ_DATABASE_URL?.trim();
  if (!dsn) {
    throw new CatalogError(
      "El catálogo musical local no está configurado.",
      503,
      "CATALOG_UNAVAILABLE"
    );
  }

  const cached = globalForCatalog.musicBrainzCatalogPool;
  if (cached && cached.dsn === dsn) {
    return cached.pool;
  }

  if (cached) {
    void cached.pool.end().catch(() => undefined);
  }

  const config: PoolConfig = {
    connectionString: dsn,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  };

  const pool = new Pool(config);
  pool.on("error", () => {
    // Evitar unhandled pool error events; las consultas individuales devuelven 503.
  });

  globalForCatalog.musicBrainzCatalogPool = { pool, dsn };
  return pool;
}

function resetCatalogPool() {
  const cached = globalForCatalog.musicBrainzCatalogPool;
  if (cached) {
    globalForCatalog.musicBrainzCatalogPool = undefined;
    void cached.pool.end().catch(() => undefined);
  }
}

function mapPgCatalogError(error: unknown): CatalogError {
  if (error instanceof CatalogError) {
    return error;
  }

  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (
    code === "57014" ||
    message.includes("statement timeout") ||
    message.includes("query read timeout") ||
    message.includes("timeout expired")
  ) {
    return new CatalogError(
      "La consulta al catálogo musical tardó demasiado. Intenta de nuevo.",
      503,
      "CATALOG_TIMEOUT"
    );
  }

  resetCatalogPool();
  return new CatalogError(
    "El catálogo musical no está disponible temporalmente.",
    503,
    "CATALOG_UNAVAILABLE"
  );
}

async function queryCatalog<T>(sql: string, params: unknown[]): Promise<T[]> {
  const pool = getCatalogPool();
  try {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    throw mapPgCatalogError(error);
  }
}

interface RecordingRow {
  recording_mbid: string;
  title: string;
  artist_name: string;
  artist_mbid: string | null;
  duration_ms: number | null;
  comment: string | null;
  cover_release_mbid?: string | null;
  cover_release_group_mbid?: string | null;
}

interface ArtistRow {
  artist_mbid: string;
  name: string;
  sort_name: string | null;
  comment: string | null;
  cover_release_mbid?: string | null;
  cover_release_group_mbid?: string | null;
}

function mapRecordingRow(row: RecordingRow): CatalogRecording {
  const recordingMbid = row.recording_mbid.toLowerCase();
  const coverReleaseMbid = row.cover_release_mbid
    ? row.cover_release_mbid.toLowerCase()
    : null;
  const coverReleaseGroupMbid = row.cover_release_group_mbid
    ? row.cover_release_group_mbid.toLowerCase()
    : null;

  return {
    recordingMbid,
    title: row.title,
    artistName: row.artist_name,
    artistMbid: row.artist_mbid ? row.artist_mbid.toLowerCase() : null,
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
    comment: row.comment || null,
    coverReleaseMbid,
    coverReleaseGroupMbid,
    coverUrl: coverReleaseMbid
      ? buildCoverProxyUrl({
          type: "recording",
          mbid: recordingMbid,
          releaseMbid: coverReleaseMbid,
          releaseGroupMbid: coverReleaseGroupMbid,
        })
      : null,
  };
}

function mapArtistRow(row: ArtistRow): CatalogArtist {
  const artistMbid = row.artist_mbid.toLowerCase();
  const coverReleaseMbid = row.cover_release_mbid
    ? row.cover_release_mbid.toLowerCase()
    : null;
  const coverReleaseGroupMbid = row.cover_release_group_mbid
    ? row.cover_release_group_mbid.toLowerCase()
    : null;

  return {
    artistMbid,
    name: row.name,
    sortName: row.sort_name || null,
    comment: row.comment || null,
    coverReleaseMbid,
    coverReleaseGroupMbid,
    coverUrl: coverReleaseMbid
      ? buildCoverProxyUrl({
          type: "artist",
          mbid: artistMbid,
          releaseMbid: coverReleaseMbid,
          releaseGroupMbid: coverReleaseGroupMbid,
        })
      : null,
  };
}

function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

export async function resolveRecordingByMbid(
  recordingMbid: string
): Promise<CatalogRecording> {
  const mbid = normalizeMbid(recordingMbid);

  const sql = `
    WITH rec AS (
      SELECT id, gid, name, artist_credit, length, NULLIF(comment, '') AS comment
      FROM musicbrainz.recording
      WHERE gid = $1::uuid
      UNION ALL
      SELECT r.id, r.gid, r.name, r.artist_credit, r.length, NULLIF(r.comment, '') AS comment
      FROM musicbrainz.recording_gid_redirect red
      JOIN musicbrainz.recording r ON r.id = red.new_id
      WHERE red.gid = $1::uuid
        AND NOT EXISTS (SELECT 1 FROM musicbrainz.recording WHERE gid = $1::uuid)
      LIMIT 1
    )
    SELECT
      rec.gid::text AS recording_mbid,
      rec.name AS title,
      ac.name AS artist_name,
      pa.gid::text AS artist_mbid,
      rec.length AS duration_ms,
      rec.comment,
      cov.release_mbid::text AS cover_release_mbid,
      cov.rg_mbid::text AS cover_release_group_mbid
    FROM rec
    JOIN musicbrainz.artist_credit ac ON ac.id = rec.artist_credit
    LEFT JOIN LATERAL (
      SELECT a.gid
      FROM musicbrainz.artist_credit_name acn
      JOIN musicbrainz.artist a ON a.id = acn.artist
      WHERE acn.artist_credit = rec.artist_credit
      ORDER BY acn.position ASC
      LIMIT 1
    ) pa ON true
    LEFT JOIN LATERAL (
      WITH rel_cand AS (
        SELECT rel.id, rel.gid, rel.status, rg.gid AS rg_gid, rg.type
        FROM musicbrainz.track tr
        JOIN musicbrainz.medium m ON m.id = tr.medium
        JOIN musicbrainz.release rel ON rel.id = m.release
        JOIN musicbrainz.release_group rg ON rg.id = rel.release_group
        WHERE tr.recording = rec.id
        LIMIT 60
      )
      SELECT rc.gid AS release_mbid, rc.rg_gid AS rg_mbid
      FROM rel_cand rc
      JOIN cover_art_archive.cover_art ca ON ca.release = rc.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rc.status = 1) DESC, (rc.type = 1) DESC, (rc.type IN (1, 2, 3)) DESC, ca.ordering ASC, rc.id ASC
      LIMIT 1
    ) cov ON true
  `;

  const rows = await queryCatalog<RecordingRow>(sql, [mbid]);
  if (rows.length === 0) {
    throw new CatalogError(
      "La canción indicada no existe en el catálogo musical.",
      404,
      "NOT_FOUND"
    );
  }
  return mapRecordingRow(rows[0]);
}

export async function resolveArtistByMbid(
  artistMbid: string
): Promise<CatalogArtist> {
  const mbid = normalizeMbid(artistMbid);

  const sql = `
    WITH art AS (
      SELECT id, gid, name, NULLIF(sort_name, '') AS sort_name, NULLIF(comment, '') AS comment
      FROM musicbrainz.artist
      WHERE gid = $1::uuid
      UNION ALL
      SELECT a.id, a.gid, a.name, NULLIF(a.sort_name, '') AS sort_name, NULLIF(a.comment, '') AS comment
      FROM musicbrainz.artist_gid_redirect red
      JOIN musicbrainz.artist a ON a.id = red.new_id
      WHERE red.gid = $1::uuid
        AND NOT EXISTS (SELECT 1 FROM musicbrainz.artist WHERE gid = $1::uuid)
      LIMIT 1
    )
    SELECT
      art.gid::text AS artist_mbid,
      art.name,
      art.sort_name,
      art.comment,
      cov.release_mbid::text AS cover_release_mbid,
      cov.rg_mbid::text AS cover_release_group_mbid
    FROM art
    LEFT JOIN LATERAL (
      WITH rg_cand AS (
        SELECT rg.id, rg.gid, rg.type, rg.comment
        FROM musicbrainz.artist_credit_name acn
        JOIN musicbrainz.artist_credit ac ON ac.id = acn.artist_credit
        JOIN musicbrainz.release_group rg ON rg.artist_credit = ac.id
        WHERE acn.artist = art.id
          AND ac.artist_count = 1
          AND rg.type IN (1, 2, 3)
        LIMIT 60
      )
      SELECT rel.gid AS release_mbid, rg_cand.gid AS rg_mbid
      FROM rg_cand
      JOIN musicbrainz.release rel ON rel.release_group = rg_cand.id
      JOIN cover_art_archive.cover_art ca ON ca.release = rel.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rg_cand.type = 1) DESC, (rel.status = 1) DESC, (rg_cand.comment NOT ILIKE '%live%') DESC, ca.ordering ASC, rel.id ASC
      LIMIT 1
    ) cov ON true
  `;

  const rows = await queryCatalog<ArtistRow>(sql, [mbid]);
  if (rows.length === 0) {
    throw new CatalogError(
      "El artista indicado no existe en el catálogo musical.",
      404,
      "NOT_FOUND"
    );
  }
  return mapArtistRow(rows[0]);
}

export async function searchCatalogRecordings(
  query: string,
  artist?: string,
  limit = DEFAULT_LIMIT
): Promise<CatalogRecording[]> {
  const cleanTitle = typeof query === "string" ? query.trim() : "";
  const cleanArtist = typeof artist === "string" ? artist.trim() : "";
  if (!cleanTitle && !cleanArtist) {
    return [];
  }

  const safeLimit = clampLimit(limit);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (cleanTitle) {
    params.push(cleanTitle);
    clauses.push(
      `musicbrainz.mb_simple_tsvector(r.name::text) @@ plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower($${params.length}))`
    );
  }
  if (cleanArtist) {
    params.push(cleanArtist);
    clauses.push(
      `musicbrainz.mb_simple_tsvector(ac.name::text) @@ plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower($${params.length}))`
    );
  }

  const orderParts: string[] = [];
  if (cleanTitle) {
    params.push(cleanTitle);
    orderParts.push(`(lower(title) = lower($${params.length})) DESC`);
  }
  if (cleanArtist) {
    params.push(cleanArtist);
    orderParts.push(`(lower(artist_name) = lower($${params.length})) DESC`);
  }
  orderParts.push("(comment IS NULL) DESC", "video ASC", "id ASC");

  params.push(safeLimit);
  const limitParam = `$${params.length}`;

  const sql = `
    WITH matches AS (
      SELECT
        r.id,
        r.gid,
        r.name AS title,
        r.artist_credit,
        ac.name AS artist_name,
        r.length AS duration_ms,
        NULLIF(r.comment, '') AS comment,
        r.video
      FROM musicbrainz.recording r
      JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
      WHERE ${clauses.join(" AND ")}
      LIMIT 300
    ),
    ranked AS (
      SELECT id, gid, title, artist_credit, artist_name, duration_ms, comment
      FROM matches
      ORDER BY ${orderParts.join(", ")}
      LIMIT ${limitParam}
    )
    SELECT
      rk.gid::text AS recording_mbid,
      rk.title,
      rk.artist_name,
      pa.gid::text AS artist_mbid,
      rk.duration_ms,
      rk.comment,
      cov.release_mbid::text AS cover_release_mbid,
      cov.rg_mbid::text AS cover_release_group_mbid
    FROM ranked rk
    LEFT JOIN LATERAL (
      SELECT a.gid
      FROM musicbrainz.artist_credit_name acn
      JOIN musicbrainz.artist a ON a.id = acn.artist
      WHERE acn.artist_credit = rk.artist_credit
      ORDER BY acn.position ASC
      LIMIT 1
    ) pa ON true
    LEFT JOIN LATERAL (
      WITH rel_cand AS (
        SELECT rel.id, rel.gid, rel.status, rg.gid AS rg_gid, rg.type
        FROM musicbrainz.track tr
        JOIN musicbrainz.medium m ON m.id = tr.medium
        JOIN musicbrainz.release rel ON rel.id = m.release
        JOIN musicbrainz.release_group rg ON rg.id = rel.release_group
        WHERE tr.recording = rk.id
        LIMIT 40
      )
      SELECT rc.gid AS release_mbid, rc.rg_gid AS rg_mbid
      FROM rel_cand rc
      JOIN cover_art_archive.cover_art ca ON ca.release = rc.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rc.status = 1) DESC, (rc.type = 1) DESC, (rc.type IN (1, 2, 3)) DESC, ca.ordering ASC, rc.id ASC
      LIMIT 1
    ) cov ON true
  `;

  const rows = await queryCatalog<RecordingRow>(sql, params);
  return rows.map(mapRecordingRow);
}

export async function searchCatalogArtists(
  query: string,
  limit = DEFAULT_LIMIT
): Promise<CatalogArtist[]> {
  const cleanQuery = typeof query === "string" ? query.trim() : "";
  if (!cleanQuery) {
    return [];
  }

  const safeLimit = clampLimit(limit);
  const sql = `
    WITH matches AS (
      SELECT
        a.id,
        a.gid,
        a.name,
        NULLIF(a.sort_name, '') AS sort_name,
        NULLIF(a.comment, '') AS comment
      FROM musicbrainz.artist a
      WHERE musicbrainz.mb_simple_tsvector(a.name::text) @@ plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower($1))
      LIMIT 300
    ),
    ranked AS (
      SELECT id, gid, name, sort_name, comment
      FROM matches
      ORDER BY (lower(name) = lower($1)) DESC, (comment IS NULL) DESC, id ASC
      LIMIT $2
    )
    SELECT
      rk.gid::text AS artist_mbid,
      rk.name,
      rk.sort_name,
      rk.comment,
      cov.release_mbid::text AS cover_release_mbid,
      cov.rg_mbid::text AS cover_release_group_mbid
    FROM ranked rk
    LEFT JOIN LATERAL (
      WITH rg_cand AS (
        SELECT rg.id, rg.gid, rg.type, rg.comment
        FROM musicbrainz.artist_credit_name acn
        JOIN musicbrainz.artist_credit ac ON ac.id = acn.artist_credit
        JOIN musicbrainz.release_group rg ON rg.artist_credit = ac.id
        WHERE acn.artist = rk.id
          AND ac.artist_count = 1
          AND rg.type IN (1, 2, 3)
        LIMIT 40
      )
      SELECT rel.gid AS release_mbid, rg_cand.gid AS rg_mbid
      FROM rg_cand
      JOIN musicbrainz.release rel ON rel.release_group = rg_cand.id
      JOIN cover_art_archive.cover_art ca ON ca.release = rel.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rg_cand.type = 1) DESC, (rel.status = 1) DESC, (rg_cand.comment NOT ILIKE '%live%') DESC, ca.ordering ASC, rel.id ASC
      LIMIT 1
    ) cov ON true
  `;

  const rows = await queryCatalog<ArtistRow>(sql, [cleanQuery, safeLimit]);
  return rows.map(mapArtistRow);
}

export async function resolveRecordingCoverTarget(
  recordingMbid: string
): Promise<CoverTarget> {
  const mbid = normalizeMbid(recordingMbid);
  const rows = await queryCatalog<{
    release_mbid: string | null;
    rg_mbid: string | null;
  }>(
    `
      WITH rec AS (
        SELECT id
        FROM musicbrainz.recording
        WHERE gid = $1::uuid
        UNION ALL
        SELECT r.id
        FROM musicbrainz.recording_gid_redirect red
        JOIN musicbrainz.recording r ON r.id = red.new_id
        WHERE red.gid = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM musicbrainz.recording WHERE gid = $1::uuid)
        LIMIT 1
      ),
      rel_cand AS (
        SELECT rel.id, rel.gid, rel.status, rg.gid AS rg_gid, rg.type
        FROM rec
        JOIN musicbrainz.track tr ON tr.recording = rec.id
        JOIN musicbrainz.medium m ON m.id = tr.medium
        JOIN musicbrainz.release rel ON rel.id = m.release
        JOIN musicbrainz.release_group rg ON rg.id = rel.release_group
        LIMIT 60
      )
      SELECT rc.gid::text AS release_mbid, rc.rg_gid::text AS rg_mbid
      FROM rel_cand rc
      JOIN cover_art_archive.cover_art ca ON ca.release = rc.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rc.status = 1) DESC, (rc.type = 1) DESC, (rc.type IN (1, 2, 3)) DESC, ca.ordering ASC, rc.id ASC
      LIMIT 1
    `,
    [mbid]
  );

  if (rows.length === 0) {
    return { releaseMbid: null, releaseGroupMbid: null };
  }
  return {
    releaseMbid: rows[0].release_mbid?.toLowerCase() ?? null,
    releaseGroupMbid: rows[0].rg_mbid?.toLowerCase() ?? null,
  };
}

export async function resolveArtistCoverTarget(
  artistMbid: string
): Promise<CoverTarget> {
  const mbid = normalizeMbid(artistMbid);
  const rows = await queryCatalog<{
    release_mbid: string | null;
    rg_mbid: string | null;
  }>(
    `
      WITH art AS (
        SELECT id
        FROM musicbrainz.artist
        WHERE gid = $1::uuid
        UNION ALL
        SELECT a.id
        FROM musicbrainz.artist_gid_redirect red
        JOIN musicbrainz.artist a ON a.id = red.new_id
        WHERE red.gid = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM musicbrainz.artist WHERE gid = $1::uuid)
        LIMIT 1
      ),
      rg_cand AS (
        SELECT rg.id, rg.gid, rg.type, rg.comment, ac.artist_count
        FROM art
        JOIN musicbrainz.artist_credit_name acn ON acn.artist = art.id
        JOIN musicbrainz.artist_credit ac ON ac.id = acn.artist_credit
        JOIN musicbrainz.release_group rg ON rg.artist_credit = ac.id
        WHERE rg.type IN (1, 2, 3)
        LIMIT 80
      )
      SELECT rel.gid::text AS release_mbid, rg_cand.gid::text AS rg_mbid
      FROM rg_cand
      JOIN musicbrainz.release rel ON rel.release_group = rg_cand.id
      JOIN cover_art_archive.cover_art ca ON ca.release = rel.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rg_cand.artist_count = 1) DESC, (rg_cand.type = 1) DESC, (rel.status = 1) DESC, (rg_cand.comment NOT ILIKE '%live%') DESC, ca.ordering ASC, rel.id ASC
      LIMIT 1
    `,
    [mbid]
  );

  if (rows.length === 0) {
    return { releaseMbid: null, releaseGroupMbid: null };
  }
  return {
    releaseMbid: rows[0].release_mbid?.toLowerCase() ?? null,
    releaseGroupMbid: rows[0].rg_mbid?.toLowerCase() ?? null,
  };
}

export async function resolveReleaseGroupCoverTarget(
  releaseGroupMbid: string
): Promise<CoverTarget> {
  const mbid = normalizeMbid(releaseGroupMbid);
  const rows = await queryCatalog<{
    release_mbid: string | null;
    rg_mbid: string | null;
  }>(
    `
      WITH rg AS (
        SELECT id, gid
        FROM musicbrainz.release_group
        WHERE gid = $1::uuid
        UNION ALL
        SELECT rg2.id, rg2.gid
        FROM musicbrainz.release_group_gid_redirect red
        JOIN musicbrainz.release_group rg2 ON rg2.id = red.new_id
        WHERE red.gid = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM musicbrainz.release_group WHERE gid = $1::uuid)
        LIMIT 1
      )
      SELECT rel.gid::text AS release_mbid, rg.gid::text AS rg_mbid
      FROM rg
      JOIN musicbrainz.release rel ON rel.release_group = rg.id
      JOIN cover_art_archive.cover_art ca ON ca.release = rel.id
      JOIN cover_art_archive.cover_art_type cat ON cat.id = ca.id AND cat.type_id = 1
      ORDER BY (rel.status = 1) DESC, ca.ordering ASC, rel.id ASC
      LIMIT 1
    `,
    [mbid]
  );

  if (rows.length === 0) {
    return { releaseMbid: null, releaseGroupMbid: mbid };
  }
  return {
    releaseMbid: rows[0].release_mbid?.toLowerCase() ?? null,
    releaseGroupMbid: rows[0].rg_mbid?.toLowerCase() ?? mbid,
  };
}
