import "server-only";
import { Pool } from "pg";
import type { Song } from "./musicbrainz-types";

export class MusicBrainzError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "MusicBrainzError";
  }
}

const globalMusic = globalThis as typeof globalThis & {
  graphUMusicPool?: Pool;
  graphUMusicConnectionString?: string;
};

function getMusicDb() {
  const connectionString = process.env.MUSICBRAINZ_DATABASE_URL;
  if (!connectionString) {
    throw new MusicBrainzError("No está configurada la conexión de MusicBrainz local.", 503);
  }
  if (!globalMusic.graphUMusicPool || globalMusic.graphUMusicConnectionString !== connectionString) {
    if (globalMusic.graphUMusicPool) void globalMusic.graphUMusicPool.end().catch(() => {});
    const pool = new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      options: "-c default_transaction_read_only=on -c statement_timeout=8000",
    });
    // pg removes failed idle connections; handle the event without exposing credentials.
    pool.on("error", () => {});
    globalMusic.graphUMusicPool = pool;
    globalMusic.graphUMusicConnectionString = connectionString;
  }
  return globalMusic.graphUMusicPool;
}

const SQL = String.raw`
  SELECT r.gid::text AS id, r.name AS title, ac.name AS artist,
         NULL::text AS release, r.length AS duration, NULLIF(r.comment, '') AS comment
  FROM musicbrainz.recording r
  JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
  WHERE ($1 = '' OR r.name ILIKE $2 ESCAPE E'\\')
    AND ($3 = '' OR ac.name ILIKE $4 ESCAPE E'\\')
  ORDER BY CASE WHEN lower(r.name) = lower($1) THEN 0 ELSE 1 END,
           r.name, r.id
  LIMIT 20
`;

function pattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function searchSongs(title: string, artist: string): Promise<Song[]> {
  try {
    const db = getMusicDb();
    const catalog = await db.query<{ recording: string | null; credit: string | null }>(
      "SELECT to_regclass('musicbrainz.recording')::text AS recording, to_regclass('musicbrainz.artist_credit')::text AS credit",
    );
    if (!catalog.rows[0]?.recording || !catalog.rows[0]?.credit) {
      throw new MusicBrainzError("La base local de MusicBrainz todavía no tiene el catálogo importado.", 503);
    }
    const result = await db.query<Song>(SQL, [title, pattern(title), artist, pattern(artist)]);
    return result.rows;
  } catch (error) {
    if (error instanceof MusicBrainzError) throw error;
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    throw new MusicBrainzError(
      code === "57014"
        ? "La búsqueda tardó demasiado. Escribe un título y un artista más específicos."
        : "No se pudo conectar con MusicBrainz local. Comprueba que PostgreSQL esté activo y la conexión configurada.",
      503,
    );
  }
}
