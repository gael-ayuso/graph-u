import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getDb,
  db,
  isCatalogConfigured,
  resolveRecordingCoverTarget,
  resolveArtistCoverTarget,
  resolveReleaseGroupCoverTarget,
} = vi.hoisted(() => ({
  getDb: vi.fn(),
  db: {
    coverCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  isCatalogConfigured: vi.fn(),
  resolveRecordingCoverTarget: vi.fn(),
  resolveArtistCoverTarget: vi.fn(),
  resolveReleaseGroupCoverTarget: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/music-library/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/music-library/catalog")>();
  return {
    ...actual,
    isCatalogConfigured,
    resolveRecordingCoverTarget,
    resolveArtistCoverTarget,
    resolveReleaseGroupCoverTarget,
  };
});

import { GET as getMusicCover } from "@/app/api/music/cover/route";

const RECORDING_MBID = "11111111-2222-4333-8444-555555555555";
const ARTIST_MBID = "99999999-8888-4777-8666-555555555555";
const RELEASE_MBID = "77777777-6666-4555-8444-333333333333";
const RELEASE_GROUP_MBID = "66666666-5555-4444-8333-222222222222";

const globalForCovers = globalThis as unknown as {
  graphuCoverInFlight?: Map<string, unknown>;
  graphuMbLastRequestAt?: number;
};

describe("GET /api/music/cover", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPublicFallback = process.env.ENABLE_PUBLIC_MB_COVER_FALLBACK;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalForCovers.graphuCoverInFlight = undefined;
    globalForCovers.graphuMbLastRequestAt = undefined;
    process.env.DATABASE_URL = "postgres://app:pass@localhost:5431/app";
    process.env.ENABLE_PUBLIC_MB_COVER_FALLBACK = "false";

    getDb.mockReturnValue(db);
    db.coverCache.findUnique.mockResolvedValue(null);
    db.coverCache.upsert.mockResolvedValue({});

    isCatalogConfigured.mockReturnValue(true);
    resolveRecordingCoverTarget.mockResolvedValue({
      releaseMbid: null,
      releaseGroupMbid: null,
    });
    resolveArtistCoverTarget.mockResolvedValue({
      releaseMbid: null,
      releaseGroupMbid: null,
    });
    resolveReleaseGroupCoverTarget.mockResolvedValue({
      releaseMbid: null,
      releaseGroupMbid: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPublicFallback === undefined) delete process.env.ENABLE_PUBLIC_MB_COVER_FALLBACK;
    else process.env.ENABLE_PUBLIC_MB_COVER_FALLBACK = originalPublicFallback;
    vi.restoreAllMocks();
  });

  it("returns 400 on invalid type, mbid, or format", async () => {
    const badType = await getMusicCover(
      new Request(`http://localhost/api/music/cover?type=playlist&mbid=${RECORDING_MBID}`),
    );
    expect(badType.status).toBe(400);
    expect(badType.headers.get("cache-control")).toBe("private, no-store");

    const badMbid = await getMusicCover(
      new Request("http://localhost/api/music/cover?type=recording&mbid=invalid"),
    );
    expect(badMbid.status).toBe(400);

    const badFormat = await getMusicCover(
      new Request(`http://localhost/api/music/cover?type=recording&mbid=${RECORDING_MBID}&format=xml`),
    );
    expect(badFormat.status).toBe(400);
  });

  it("serves cached FOUND cover image bytes without re-querying MusicBrainz catalog", async () => {
    db.coverCache.findUnique.mockResolvedValueOnce({
      entityType: "recording",
      mbid: RECORDING_MBID,
      releaseMbid: RELEASE_MBID,
      releaseGroupMbid: RELEASE_GROUP_MBID,
      coverUrl: `https://coverartarchive.org/release/${RELEASE_MBID}/front-250`,
      status: "FOUND",
      checkedAt: new Date(),
    });

    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(imageBytes, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await getMusicCover(
      new Request(`http://localhost/api/music/cover?type=recording&mbid=${RECORDING_MBID}`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-cover-status")).toBe("FOUND");
    expect(res.headers.get("x-cover-cache")).toBe("HIT");
    expect(resolveRecordingCoverTarget).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(imageBytes);
  });

  it("serves SVG fallback immediately when CoverCache has a fresh NOT_FOUND entry", async () => {
    db.coverCache.findUnique.mockResolvedValueOnce({
      entityType: "artist",
      mbid: ARTIST_MBID,
      releaseMbid: null,
      releaseGroupMbid: null,
      coverUrl: null,
      status: "NOT_FOUND",
      checkedAt: new Date(),
    });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await getMusicCover(
      new Request(`http://localhost/api/music/cover?type=artist&mbid=${ARTIST_MBID}`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("x-cover-status")).toBe("NOT_FOUND");
    expect(res.headers.get("x-cover-cache")).toBe("HIT");
    expect(resolveArtistCoverTarget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const svg = await res.text();
    expect(svg).toContain("#282828");
    expect(svg).toContain("#fe8019");
  });

  it("resolves recording cover via local catalog + CAA, caches FOUND, and deduplicates concurrent requests", async () => {
    resolveRecordingCoverTarget.mockResolvedValue({
      releaseMbid: RELEASE_MBID,
      releaseGroupMbid: RELEASE_GROUP_MBID,
    });

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 15));
      return new Response(pngBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const [res1, res2] = await Promise.all([
      getMusicCover(
        new Request(`http://localhost/api/music/cover?type=recording&mbid=${RECORDING_MBID}`),
      ),
      getMusicCover(
        new Request(`http://localhost/api/music/cover?type=recording&mbid=${RECORDING_MBID}`),
      ),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolveRecordingCoverTarget).toHaveBeenCalledTimes(1);
    expect(db.coverCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType_mbid: { entityType: "recording", mbid: RECORDING_MBID } },
        create: expect.objectContaining({
          status: "FOUND",
          releaseMbid: RELEASE_MBID,
          coverUrl: `https://coverartarchive.org/release/${RELEASE_MBID}/front-250`,
        }),
      }),
    );
  });

  it("resolves artist representative album cover and supports format=json", async () => {
    resolveArtistCoverTarget.mockResolvedValueOnce({
      releaseMbid: RELEASE_MBID,
      releaseGroupMbid: RELEASE_GROUP_MBID,
    });

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await getMusicCover(
      new Request(`http://localhost/api/music/cover?type=artist&mbid=${ARTIST_MBID}&format=json`),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://coverartarchive.org/release/${RELEASE_MBID}/front-250`,
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(await res.json()).toEqual({
      status: "FOUND",
      entityType: "artist",
      mbid: ARTIST_MBID,
      releaseMbid: RELEASE_MBID,
      releaseGroupMbid: RELEASE_GROUP_MBID,
      coverUrl: `https://coverartarchive.org/release/${RELEASE_MBID}/front-250`,
      cached: false,
    });
  });

  it("caches NOT_FOUND and returns SVG fallback when CAA returns 404", async () => {
    resolveRecordingCoverTarget.mockResolvedValueOnce({
      releaseMbid: RELEASE_MBID,
      releaseGroupMbid: null,
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await getMusicCover(
      new Request(`http://localhost/api/music/cover?type=recording&mbid=${RECORDING_MBID}`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("x-cover-status")).toBe("NOT_FOUND");
    expect(db.coverCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "NOT_FOUND",
          coverUrl: null,
        }),
      }),
    );
  });
});
