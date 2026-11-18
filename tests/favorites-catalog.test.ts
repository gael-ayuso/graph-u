import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolInstances, PoolMock } = vi.hoisted(() => {
  const instances: Array<{
    config: unknown;
    query: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }> = [];

  const MockPool = vi.fn(function PoolConstructor(config: unknown) {
    const instance = {
      config,
      query: vi.fn(),
      on: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    instances.push(instance);
    return instance;
  });

  return { poolInstances: instances, PoolMock: MockPool };
});

vi.mock("pg", () => ({ Pool: PoolMock }));

import {
  CatalogError,
  isCatalogConfigured,
  isValidMbid,
  normalizeMbid,
  resolveArtistByMbid,
  resolveRecordingByMbid,
  searchCatalogArtists,
  searchCatalogRecordings,
} from "@/lib/music-library/catalog";

const RECORDING_MBID_UPPER = "  11111111-2222-4333-8444-555555555555  ";
const RECORDING_MBID = "11111111-2222-4333-8444-555555555555";
const CANONICAL_RECORDING_MBID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ARTIST_MBID = "99999999-8888-4777-8666-555555555555";
const RELEASE_MBID = "77777777-6666-4555-8444-333333333333";
const RELEASE_GROUP_MBID = "66666666-5555-4444-8333-222222222222";

const globalCatalogStore = globalThis as unknown as {
  musicBrainzCatalogPool?: unknown;
};

describe("lib/music-library/catalog", () => {
  const originalMusicBrainzUrl = process.env.MUSICBRAINZ_DATABASE_URL;

  beforeEach(() => {
    poolInstances.length = 0;
    PoolMock.mockClear();
    globalCatalogStore.musicBrainzCatalogPool = undefined;
    process.env.MUSICBRAINZ_DATABASE_URL =
      "postgres://musicbrainz:secret@localhost:5432/musicbrainz_db";
  });

  afterEach(() => {
    globalCatalogStore.musicBrainzCatalogPool = undefined;
    if (originalMusicBrainzUrl === undefined) {
      delete process.env.MUSICBRAINZ_DATABASE_URL;
    } else {
      process.env.MUSICBRAINZ_DATABASE_URL = originalMusicBrainzUrl;
    }
  });

  describe("isValidMbid, normalizeMbid, isCatalogConfigured", () => {
    it("validates UUID MBIDs with optional surrounding whitespace and rejects invalid values", () => {
      expect(isValidMbid(RECORDING_MBID)).toBe(true);
      expect(isValidMbid(RECORDING_MBID_UPPER)).toBe(true);
      expect(isValidMbid("not-a-uuid")).toBe(false);
      expect(isValidMbid("11111111-2222-4333-8444-55555555555")).toBe(false);
      expect(isValidMbid("")).toBe(false);
      expect(isValidMbid(null as unknown as string)).toBe(false);
    });

    it("normalizes uppercase and padded MBIDs to lowercase and throws CatalogError 400 INVALID_MBID when invalid", () => {
      expect(normalizeMbid(RECORDING_MBID_UPPER)).toBe(RECORDING_MBID);

      for (const bad of ["invalid", "", "1234", null as unknown as string]) {
        try {
          normalizeMbid(bad);
          expect.unreachable("Expected normalizeMbid to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(CatalogError);
          expect(error).toMatchObject({
            status: 400,
            code: "INVALID_MBID",
          });
        }
      }
    });

    it("reports whether MUSICBRAINZ_DATABASE_URL is configured", () => {
      expect(isCatalogConfigured()).toBe(true);
      process.env.MUSICBRAINZ_DATABASE_URL = "   ";
      expect(isCatalogConfigured()).toBe(false);
      delete process.env.MUSICBRAINZ_DATABASE_URL;
      expect(isCatalogConfigured()).toBe(false);
    });
  });

  describe("resolveRecordingByMbid", () => {
    it("resolves a direct recording and normalizes returned MBIDs", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({
            rows: [
              {
                recording_mbid: RECORDING_MBID.toUpperCase(),
                title: "Reckoner",
                artist_name: "Radiohead",
                artist_mbid: ARTIST_MBID.toUpperCase(),
                duration_ms: 290000,
                comment: "",
              },
            ],
          }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      const recording = await resolveRecordingByMbid(RECORDING_MBID_UPPER);

      expect(PoolMock).toHaveBeenCalledTimes(1);
      expect(poolInstances[0].on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(poolInstances[0].query).toHaveBeenCalledWith(
        expect.stringContaining("FROM musicbrainz.recording"),
        [RECORDING_MBID],
      );
      expect(recording).toEqual({
        recordingMbid: RECORDING_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: ARTIST_MBID,
        durationMs: 290000,
        comment: null,
        coverReleaseMbid: null,
        coverReleaseGroupMbid: null,
        coverUrl: null,
      });
    });

    it("builds a proxy coverUrl when cover_release_mbid is present on recording", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({
            rows: [
              {
                recording_mbid: RECORDING_MBID,
                title: "Reckoner",
                artist_name: "Radiohead",
                artist_mbid: ARTIST_MBID,
                duration_ms: 290000,
                comment: null,
                cover_release_mbid: RELEASE_MBID.toUpperCase(),
                cover_release_group_mbid: RELEASE_GROUP_MBID.toUpperCase(),
              },
            ],
          }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      const recording = await resolveRecordingByMbid(RECORDING_MBID);
      expect(recording).toEqual({
        recordingMbid: RECORDING_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: ARTIST_MBID,
        durationMs: 290000,
        comment: null,
        coverReleaseMbid: RELEASE_MBID,
        coverReleaseGroupMbid: RELEASE_GROUP_MBID,
        coverUrl: `/api/music/cover?type=recording&mbid=${RECORDING_MBID}&releaseMbid=${RELEASE_MBID}&releaseGroupMbid=${RELEASE_GROUP_MBID}`,
      });
    });

    it("resolves a recording via recording_gid_redirect returning the canonical MBID", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({
            rows: [
              {
                recording_mbid: CANONICAL_RECORDING_MBID.toUpperCase(),
                title: "Weird Fishes/Arpeggi",
                artist_name: "Radiohead",
                artist_mbid: null,
                duration_ms: null,
                comment: "album version",
              },
            ],
          }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      const recording = await resolveRecordingByMbid(RECORDING_MBID);

      const [sql, params] = poolInstances[0].query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("musicbrainz.recording_gid_redirect");
      expect(params).toEqual([RECORDING_MBID]);
      expect(recording).toEqual({
        recordingMbid: CANONICAL_RECORDING_MBID,
        title: "Weird Fishes/Arpeggi",
        artistName: "Radiohead",
        artistMbid: null,
        durationMs: null,
        comment: "album version",
        coverReleaseMbid: null,
        coverReleaseGroupMbid: null,
        coverUrl: null,
      });
    });

    it("throws CatalogError 404 NOT_FOUND when no recording rows are returned", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({ rows: [] }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(resolveRecordingByMbid(RECORDING_MBID)).rejects.toMatchObject({
        name: "CatalogError",
        status: 404,
        code: "NOT_FOUND",
      });
    });

    it("throws CatalogError 503 CATALOG_UNAVAILABLE when MUSICBRAINZ_DATABASE_URL is missing", async () => {
      delete process.env.MUSICBRAINZ_DATABASE_URL;

      await expect(resolveRecordingByMbid(RECORDING_MBID)).rejects.toMatchObject({
        name: "CatalogError",
        status: 503,
        code: "CATALOG_UNAVAILABLE",
      });
      expect(PoolMock).not.toHaveBeenCalled();
    });

    it("throws CatalogError 503 CATALOG_UNAVAILABLE and resets pool when PG connection fails", async () => {
      const endMock = vi.fn().mockResolvedValue(undefined);
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
          on: vi.fn(),
          end: endMock,
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(resolveRecordingByMbid(RECORDING_MBID)).rejects.toMatchObject({
        name: "CatalogError",
        status: 503,
        code: "CATALOG_UNAVAILABLE",
      });
      expect(endMock).toHaveBeenCalledTimes(1);
      expect(globalCatalogStore.musicBrainzCatalogPool).toBeUndefined();
    });

    it("throws CatalogError 503 CATALOG_TIMEOUT on PostgreSQL statement timeout code 57014", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockRejectedValueOnce(
            Object.assign(new Error("canceling statement due to statement timeout"), {
              code: "57014",
            }),
          ),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(resolveRecordingByMbid(RECORDING_MBID)).rejects.toMatchObject({
        name: "CatalogError",
        status: 503,
        code: "CATALOG_TIMEOUT",
      });
    });
  });

  describe("resolveArtistByMbid", () => {
    it("resolves a valid artist and normalizes artistMbid", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({
            rows: [
              {
                artist_mbid: ARTIST_MBID.toUpperCase(),
                name: "Radiohead",
                sort_name: "Radiohead",
                comment: "UK rock band",
                cover_release_mbid: RELEASE_MBID,
                cover_release_group_mbid: RELEASE_GROUP_MBID,
              },
            ],
          }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      const artist = await resolveArtistByMbid(`  ${ARTIST_MBID.toUpperCase()}  `);

      expect(poolInstances[0].query).toHaveBeenCalledWith(
        expect.stringContaining("musicbrainz.artist_gid_redirect"),
        [ARTIST_MBID],
      );
      expect(artist).toEqual({
        artistMbid: ARTIST_MBID,
        name: "Radiohead",
        sortName: "Radiohead",
        comment: "UK rock band",
        coverReleaseMbid: RELEASE_MBID,
        coverReleaseGroupMbid: RELEASE_GROUP_MBID,
        coverUrl: `/api/music/cover?type=artist&mbid=${ARTIST_MBID}&releaseMbid=${RELEASE_MBID}&releaseGroupMbid=${RELEASE_GROUP_MBID}`,
      });
    });

    it("throws CatalogError 404 NOT_FOUND when artist does not exist", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({ rows: [] }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(resolveArtistByMbid(ARTIST_MBID)).rejects.toMatchObject({
        name: "CatalogError",
        status: 404,
        code: "NOT_FOUND",
      });
    });

    it("throws CatalogError 503 when env is missing or PG query fails", async () => {
      delete process.env.MUSICBRAINZ_DATABASE_URL;
      await expect(resolveArtistByMbid(ARTIST_MBID)).rejects.toMatchObject({
        status: 503,
        code: "CATALOG_UNAVAILABLE",
      });

      process.env.MUSICBRAINZ_DATABASE_URL =
        "postgres://musicbrainz:secret@localhost:5432/musicbrainz_db";
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockRejectedValueOnce({ code: "57014" }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(resolveArtistByMbid(ARTIST_MBID)).rejects.toMatchObject({
        status: 503,
        code: "CATALOG_TIMEOUT",
      });
    });
  });

  describe("searchCatalogRecordings", () => {
    it("returns [] without querying PG when title and artist are empty", async () => {
      delete process.env.MUSICBRAINZ_DATABASE_URL;

      await expect(searchCatalogRecordings("")).resolves.toEqual([]);
      await expect(searchCatalogRecordings("   ", "   ")).resolves.toEqual([]);
      expect(PoolMock).not.toHaveBeenCalled();
    });

    it("searches by title and artist and clamps limit between 1 and 50", async () => {
      const queryMock = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              recording_mbid: RECORDING_MBID.toUpperCase(),
              title: "Reckoner",
              artist_name: "Radiohead",
              artist_mbid: ARTIST_MBID.toUpperCase(),
              duration_ms: 290000,
              comment: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      PoolMock.mockImplementation(function () {
        const instance = {
          config: null,
          query: queryMock,
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      const results = await searchCatalogRecordings("  Reckoner  ", "  Radiohead  ", 999);
      expect(results).toEqual([
        {
          recordingMbid: RECORDING_MBID,
          title: "Reckoner",
          artistName: "Radiohead",
          artistMbid: ARTIST_MBID,
          durationMs: 290000,
          comment: null,
          coverReleaseMbid: null,
          coverReleaseGroupMbid: null,
          coverUrl: null,
        },
      ]);

      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("musicbrainz.mb_simple_tsvector(r.name::text)");
      expect(sql).toContain("musicbrainz.mb_simple_tsvector(ac.name::text)");
      expect(params).toEqual(["Reckoner", "Radiohead", "Reckoner", "Radiohead", 50]);

      await searchCatalogRecordings("Reckoner", undefined, 0);
      expect((queryMock.mock.calls[1] as [string, unknown[]])[1]).toEqual([
        "Reckoner",
        "Reckoner",
        1,
      ]);

      await searchCatalogRecordings("Reckoner", undefined, Number.NaN);
      expect((queryMock.mock.calls[2] as [string, unknown[]])[1]).toEqual([
        "Reckoner",
        "Reckoner",
        20,
      ]);
    });

    it("throws CatalogError 503 when PG search fails", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockRejectedValueOnce(new Error("socket hang up")),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(searchCatalogRecordings("Reckoner")).rejects.toMatchObject({
        name: "CatalogError",
        status: 503,
        code: "CATALOG_UNAVAILABLE",
      });
    });
  });

  describe("searchCatalogArtists", () => {
    it("returns [] without querying PG when query is empty or whitespace", async () => {
      delete process.env.MUSICBRAINZ_DATABASE_URL;

      await expect(searchCatalogArtists("")).resolves.toEqual([]);
      await expect(searchCatalogArtists("   ")).resolves.toEqual([]);
      expect(PoolMock).not.toHaveBeenCalled();
    });

    it("searches artists, clamps limit, and maps results", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockResolvedValueOnce({
            rows: [
              {
                artist_mbid: ARTIST_MBID.toUpperCase(),
                name: "Radiohead",
                sort_name: "Radiohead",
                comment: null,
              },
            ],
          }),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      const results = await searchCatalogArtists("  Radiohead  ", 120);

      expect(poolInstances[0].query).toHaveBeenCalledWith(
        expect.stringContaining("FROM musicbrainz.artist a"),
        ["Radiohead", 50],
      );
      expect(results).toEqual([
        {
          artistMbid: ARTIST_MBID,
          name: "Radiohead",
          sortName: "Radiohead",
          comment: null,
          coverReleaseMbid: null,
          coverReleaseGroupMbid: null,
          coverUrl: null,
        },
      ]);
    });

    it("throws CatalogError 503 when PG artist search fails", async () => {
      PoolMock.mockImplementationOnce(function () {
        const instance = {
          config: null,
          query: vi.fn().mockRejectedValueOnce(new Error("connection terminated")),
          on: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        };
        poolInstances.push(instance);
        return instance;
      });

      await expect(searchCatalogArtists("Radiohead")).rejects.toMatchObject({
        name: "CatalogError",
        status: 503,
        code: "CATALOG_UNAVAILABLE",
      });
    });
  });
});
