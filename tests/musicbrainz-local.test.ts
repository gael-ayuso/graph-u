import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MusicBrainzError, searchSongs } from "@/lib/musicbrainz";

const { query, configure, end } = vi.hoisted(() => ({
  query: vi.fn(), configure: vi.fn(), end: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) { configure(options); }
    query = query;
    end = end;
    on = vi.fn();
  },
}));

const catalog = { rows: [{ recording: "musicbrainz.recording", credit: "musicbrainz.artist_credit" }] };

describe("MusicBrainz local PostgreSQL queries", () => {
  beforeEach(() => {
    delete (globalThis as typeof globalThis & { graphUMusicPool?: unknown }).graphUMusicPool;
    vi.stubEnv("MUSICBRAINZ_DATABASE_URL", "postgresql://musicbrainz:test@127.0.0.1:5433/musicbrainz");
    query.mockReset();
    configure.mockClear();
    end.mockClear();
    query.mockResolvedValueOnce(catalog).mockResolvedValue({ rows: [] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reuses the pool until the configured database changes", async () => {
    query.mockReset();
    query.mockImplementation((sql: string) => Promise.resolve(
      sql.includes("to_regclass") ? catalog : { rows: [] },
    ));
    await searchSongs("Reckoner", "Radiohead");
    await searchSongs("Creep", "Radiohead");
    expect(configure).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();

    const connectionString = "postgresql://musicbrainz:test@127.0.0.1:5434/musicbrainz_db";
    vi.stubEnv("MUSICBRAINZ_DATABASE_URL", connectionString);
    await searchSongs("Reckoner", "Radiohead");
    expect(end).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledTimes(2);
    expect(configure.mock.lastCall?.[0].connectionString).toBe(connectionString);
  });

  it("uses a read-only connection and parameterized SQL for arbitrary search text", async () => {
    const title = "Robert'; DROP TABLE recording; --";
    await searchSongs(title, "100%_artist");
    expect(configure.mock.calls[0][0].options).toContain("default_transaction_read_only=on");
    const [sql, values] = query.mock.calls[1];
    expect(sql).toContain("ILIKE $2");
    expect(sql).not.toContain("Robert");
    expect(values).toEqual([title, `%${title}%`, "100%_artist", "%100\\%\\_artist%"]);
    expect(sql).toContain("LIMIT 20");
  });

  it("distinguishes an empty catalog from a legitimate search with zero matches", async () => {
    await expect(searchSongs("Nothing", "")).resolves.toEqual([]);
    query.mockReset();
    query.mockResolvedValue({ rows: [{ recording: null, credit: null }] });
    await expect(searchSongs("Reckoner", "Radiohead")).rejects.toMatchObject({
      status: 503,
      message: "La base local de MusicBrainz todavía no tiene el catálogo importado.",
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does not expose connection credentials when PostgreSQL is unavailable", async () => {
    query.mockReset();
    query.mockRejectedValue(new Error("private credentials"));
    const failure = await searchSongs("Reckoner", "").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MusicBrainzError);
    expect(failure).toMatchObject({ status: 503 });
    expect((failure as Error).message).not.toContain("private");
  });

  it("explains a statement timeout without exposing raw SQL", async () => {
    query.mockReset();
    query.mockRejectedValue({ code: "57014", message: "raw SQL details" });
    await expect(searchSongs("Reckoner", "Radiohead")).rejects.toMatchObject({
      status: 503,
      message: "La búsqueda tardó demasiado. Escribe un título y un artista más específicos.",
    });
  });
});
