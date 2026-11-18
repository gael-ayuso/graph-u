import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getFavorites } from "@/app/api/favorites/route";
import { GET as getFavoritesCatalog } from "@/app/api/favorites/catalog/route";
import { POST as postFavoriteTrack } from "@/app/api/favorites/tracks/route";
import { DELETE as deleteFavoriteTrack } from "@/app/api/favorites/tracks/[recordingMbid]/route";
import { POST as postFavoriteArtist } from "@/app/api/favorites/artists/route";
import { DELETE as deleteFavoriteArtist } from "@/app/api/favorites/artists/[artistMbid]/route";
import { CatalogError } from "@/lib/music-library/catalog";

const {
  getCurrentUserProfile,
  getDb,
  db,
  isCatalogConfigured,
  resolveRecordingByMbid,
  resolveArtistByMbid,
  searchCatalogRecordings,
  searchCatalogArtists,
} = vi.hoisted(() => ({
  getCurrentUserProfile: vi.fn(),
  getDb: vi.fn(),
  db: {
    userFavoriteRecording: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    userFavoriteArtist: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    recommendationResult: {
      findMany: vi.fn(),
    },
  },
  isCatalogConfigured: vi.fn(),
  resolveRecordingByMbid: vi.fn(),
  resolveArtistByMbid: vi.fn(),
  searchCatalogRecordings: vi.fn(),
  searchCatalogArtists: vi.fn(),
}));

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/music-library/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/music-library/catalog")>();
  return {
    ...actual,
    isCatalogConfigured,
    resolveRecordingByMbid,
    resolveArtistByMbid,
    searchCatalogRecordings,
    searchCatalogArtists,
  };
});

const ownerUser = { id: "user-1", clerkId: "clerk-1" };
const TRACK_MBID = "11111111-2222-4333-8444-555555555555";
const TRACK_MBID_2 = "22222222-2222-4333-8444-555555555555";
const TRACK_MBID_3 = "33333333-2222-4333-8444-555555555555";
const TRACK_MBID_4 = "44444444-2222-4333-8444-555555555555";
const ARTIST_MBID = "99999999-8888-4777-8666-555555555555";
const ARTIST_MBID_2 = "88888888-8888-4777-8666-555555555555";
const ARTIST_MBID_3 = "77777777-8888-4777-8666-555555555555";

const trackContext = (recordingMbid: string) => ({
  params: Promise.resolve({ recordingMbid }),
});
const artistContext = (artistMbid: string) => ({
  params: Promise.resolve({ artistMbid }),
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("favorites API routes", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue(ownerUser);
    getDb.mockReturnValue(db);

    db.userFavoriteRecording.findMany.mockResolvedValue([]);
    db.userFavoriteRecording.findUnique.mockResolvedValue(null);
    db.userFavoriteRecording.upsert.mockReset();
    db.userFavoriteRecording.update.mockReset();
    db.userFavoriteRecording.deleteMany.mockResolvedValue({ count: 0 });

    db.userFavoriteArtist.findMany.mockResolvedValue([]);
    db.userFavoriteArtist.findUnique.mockResolvedValue(null);
    db.userFavoriteArtist.upsert.mockReset();
    db.userFavoriteArtist.update.mockReset();
    db.userFavoriteArtist.deleteMany.mockResolvedValue({ count: 0 });

    db.recommendationResult.findMany.mockResolvedValue([]);

    isCatalogConfigured.mockReturnValue(true);
    resolveRecordingByMbid.mockReset();
    resolveArtistByMbid.mockReset();
    searchCatalogRecordings.mockResolvedValue([]);
    searchCatalogArtists.mockResolvedValue([]);

    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("GET /api/favorites", () => {
    it("returns 401 with private no-store without touching DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await getFavorites();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("resolves metadata offline-first in 4 steps and keeps returning 200 even if MusicBrainz returns 503", async () => {
      const created1 = new Date("2025-05-04T00:00:00.000Z");
      const created2 = new Date("2025-05-03T00:00:00.000Z");
      const created3 = new Date("2025-05-02T00:00:00.000Z");
      const created4 = new Date("2025-05-01T00:00:00.000Z");

      // 1) cached columns, 2) RecommendationResult.explanation.song, 3) catalog lookup, 4) safe fallback on 503
      db.userFavoriteRecording.findMany.mockResolvedValueOnce([
        {
          id: "fav-t1",
          userId: ownerUser.id,
          recordingId: TRACK_MBID,
          title: "Reckoner",
          artistName: "Radiohead",
          createdAt: created1,
        },
        {
          id: "fav-t2",
          userId: ownerUser.id,
          recordingId: TRACK_MBID_2,
          title: null,
          artistName: null,
          createdAt: created2,
        },
        {
          id: "fav-t3",
          userId: ownerUser.id,
          recordingId: TRACK_MBID_3,
          title: null,
          artistName: null,
          createdAt: created3,
        },
        {
          id: "fav-t4",
          userId: ownerUser.id,
          recordingId: TRACK_MBID_4,
          title: null,
          artistName: null,
          createdAt: created4,
        },
      ]);

      db.userFavoriteArtist.findMany.mockResolvedValueOnce([
        {
          id: "fav-a1",
          userId: ownerUser.id,
          artistId: ARTIST_MBID,
          name: "Portishead",
          createdAt: created1,
        },
        {
          id: "fav-a2",
          userId: ownerUser.id,
          artistId: ARTIST_MBID_2,
          name: null,
          createdAt: created2,
        },
        {
          id: "fav-a3",
          userId: ownerUser.id,
          artistId: ARTIST_MBID_3,
          name: "   ",
          createdAt: created3,
        },
      ]);

      db.recommendationResult.findMany.mockResolvedValueOnce([
        {
          recordingId: TRACK_MBID_2,
          explanation: { song: { title: "Nude", artist: "Radiohead" } },
        },
      ]);

      resolveRecordingByMbid.mockImplementation(async (mbid: string) => {
        if (mbid === TRACK_MBID_3) {
          return {
            recordingMbid: TRACK_MBID_3,
            title: "All I Need",
            artistName: "Radiohead",
            artistMbid: ARTIST_MBID,
            durationMs: 228000,
            comment: null,
          };
        }
        throw new CatalogError("Catalog down", 503, "CATALOG_UNAVAILABLE");
      });

      resolveArtistByMbid.mockImplementation(async (mbid: string) => {
        if (mbid === ARTIST_MBID_2) {
          return {
            artistMbid: ARTIST_MBID_2,
            name: "Massive Attack",
            sortName: "Massive Attack",
            comment: null,
          };
        }
        throw new CatalogError("Catalog timeout", 503, "CATALOG_TIMEOUT");
      });

      const response = await getFavorites();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");

      expect(db.userFavoriteRecording.findMany).toHaveBeenCalledWith({
        where: { userId: ownerUser.id },
        orderBy: [{ createdAt: "desc" }, { recordingId: "asc" }],
      });
      expect(db.userFavoriteArtist.findMany).toHaveBeenCalledWith({
        where: { userId: ownerUser.id },
        orderBy: [{ createdAt: "desc" }, { artistId: "asc" }],
      });
      expect(db.recommendationResult.findMany).toHaveBeenCalledWith({
        where: {
          recordingId: { in: [TRACK_MBID_2, TRACK_MBID_3, TRACK_MBID_4] },
          request: { userId: ownerUser.id },
        },
        orderBy: { createdAt: "desc" },
        distinct: ["recordingId"],
        select: { recordingId: true, explanation: true },
      });

      // Step 1 & 2 resolved items should NOT trigger catalog lookups
      expect(resolveRecordingByMbid).toHaveBeenCalledTimes(2);
      expect(resolveRecordingByMbid).not.toHaveBeenCalledWith(TRACK_MBID);
      expect(resolveRecordingByMbid).not.toHaveBeenCalledWith(TRACK_MBID_2);
      expect(resolveArtistByMbid).toHaveBeenCalledTimes(2);
      expect(resolveArtistByMbid).not.toHaveBeenCalledWith(ARTIST_MBID);

      expect(await response.json()).toEqual({
        tracks: [
          {
            id: "fav-t1",
            recordingMbid: TRACK_MBID,
            title: "Reckoner",
            artistName: "Radiohead",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=recording&mbid=${TRACK_MBID}`,
            createdAt: created1.toISOString(),
          },
          {
            id: "fav-t2",
            recordingMbid: TRACK_MBID_2,
            title: "Nude",
            artistName: "Radiohead",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=recording&mbid=${TRACK_MBID_2}`,
            createdAt: created2.toISOString(),
          },
          {
            id: "fav-t3",
            recordingMbid: TRACK_MBID_3,
            title: "All I Need",
            artistName: "Radiohead",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=recording&mbid=${TRACK_MBID_3}`,
            createdAt: created3.toISOString(),
          },
          {
            id: "fav-t4",
            recordingMbid: TRACK_MBID_4,
            title: "Canción 44444444",
            artistName: "Artista no disponible",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=recording&mbid=${TRACK_MBID_4}`,
            createdAt: created4.toISOString(),
          },
        ],
        artists: [
          {
            id: "fav-a1",
            artistMbid: ARTIST_MBID,
            name: "Portishead",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=artist&mbid=${ARTIST_MBID}`,
            createdAt: created1.toISOString(),
          },
          {
            id: "fav-a2",
            artistMbid: ARTIST_MBID_2,
            name: "Massive Attack",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=artist&mbid=${ARTIST_MBID_2}`,
            createdAt: created2.toISOString(),
          },
          {
            id: "fav-a3",
            artistMbid: ARTIST_MBID_3,
            name: "Artista 77777777",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=artist&mbid=${ARTIST_MBID_3}`,
            createdAt: created3.toISOString(),
          },
        ],
      });
    });

    it("skips catalog lookups completely when rows already have cached metadata or catalog is not configured", async () => {
      const created = new Date("2025-05-04T00:00:00.000Z");
      db.userFavoriteRecording.findMany.mockResolvedValueOnce([
        {
          id: "fav-t1",
          userId: ownerUser.id,
          recordingId: TRACK_MBID,
          title: "Cached Song",
          artistName: "Cached Artist",
          createdAt: created,
        },
      ]);
      db.userFavoriteArtist.findMany.mockResolvedValueOnce([
        {
          id: "fav-a1",
          userId: ownerUser.id,
          artistId: ARTIST_MBID,
          name: null,
          createdAt: created,
        },
      ]);
      isCatalogConfigured.mockReturnValueOnce(false);

      const response = await getFavorites();

      expect(response.status).toBe(200);
      expect(db.recommendationResult.findMany).not.toHaveBeenCalled();
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();
      expect(resolveArtistByMbid).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({
        tracks: [
          {
            id: "fav-t1",
            recordingMbid: TRACK_MBID,
            title: "Cached Song",
            artistName: "Cached Artist",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=recording&mbid=${TRACK_MBID}`,
            createdAt: created.toISOString(),
          },
        ],
        artists: [
          {
            id: "fav-a1",
            artistMbid: ARTIST_MBID,
            name: "Artista 99999999",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=artist&mbid=${ARTIST_MBID}`,
            createdAt: created.toISOString(),
          },
        ],
      });
    });

    it("returns 503 without leaking DB secrets and rethrows NEXT_REDIRECT", async () => {
      db.userFavoriteRecording.findMany.mockRejectedValueOnce(
        new Error("postgres://user:topsecret@db.internal:5432/app"),
      );
      const errRes = await getFavorites();
      expect(errRes.status).toBe(503);
      expect(errRes.headers.get("cache-control")).toBe("private, no-store");
      expect(await errRes.text()).not.toContain("topsecret");

      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);
      await expect(getFavorites()).rejects.toBe(redirect);
    });
  });

  describe("GET /api/favorites/catalog", () => {
    it("returns 401 when unauthenticated without querying catalog", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await getFavoritesCatalog(
        new Request("http://localhost/api/favorites/catalog?type=tracks&q=Reckoner"),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(searchCatalogRecordings).not.toHaveBeenCalled();
      expect(searchCatalogArtists).not.toHaveBeenCalled();
    });

    it.each([
      "?type=albums&q=Reckoner",
      "?type=tracks&q=Reckoner&limit=0",
      "?type=tracks&q=Reckoner&limit=26",
      "?type=tracks&q=Reckoner&limit=abc",
      "?type=tracks&q=a",
      `?type=tracks&q=${"x".repeat(151)}`,
      "?type=tracks",
      "?type=tracks&artist=a",
      `?type=tracks&artist=${"y".repeat(151)}`,
      "?type=artists&q=a",
      `?type=artists&q=${"z".repeat(151)}`,
    ])("returns 400 for invalid query params (%s)", async (query) => {
      const response = await getFavoritesCatalog(
        new Request(`http://localhost/api/favorites/catalog${query}`),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(searchCatalogRecordings).not.toHaveBeenCalled();
      expect(searchCatalogArtists).not.toHaveBeenCalled();
    });

    it("returns 200 for type=tracks and type=artists", async () => {
      const trackItems = [
        {
          recordingMbid: TRACK_MBID,
          title: "Reckoner",
          artistName: "Radiohead",
          artistMbid: ARTIST_MBID,
          durationMs: 290000,
          comment: null,
        },
      ];
      searchCatalogRecordings.mockResolvedValueOnce(trackItems);

      const tracksRes = await getFavoritesCatalog(
        new Request(
          "http://localhost/api/favorites/catalog?type=tracks&q=Reckoner&artist=Radiohead&limit=10",
        ),
      );
      expect(tracksRes.status).toBe(200);
      expect(tracksRes.headers.get("cache-control")).toBe("private, no-store");
      expect(searchCatalogRecordings).toHaveBeenCalledWith("Reckoner", "Radiohead", 10);
      expect(await tracksRes.json()).toEqual({ type: "tracks", items: trackItems });

      const artistItems = [
        {
          artistMbid: ARTIST_MBID,
          name: "Radiohead",
          sortName: "Radiohead",
          comment: null,
        },
      ];
      searchCatalogArtists.mockResolvedValueOnce(artistItems);

      const artistsRes = await getFavoritesCatalog(
        new Request("http://localhost/api/favorites/catalog?type=artists&q=Radiohead"),
      );
      expect(artistsRes.status).toBe(200);
      expect(searchCatalogArtists).toHaveBeenCalledWith("Radiohead", 15);
      expect(await artistsRes.json()).toEqual({ type: "artists", items: artistItems });
    });

    it("returns 503 with Retry-After: 3 on CatalogError 503 and hides unexpected errors", async () => {
      searchCatalogRecordings.mockRejectedValueOnce(
        new CatalogError("El catálogo musical no está disponible.", 503, "CATALOG_UNAVAILABLE"),
      );

      const catalogErrRes = await getFavoritesCatalog(
        new Request("http://localhost/api/favorites/catalog?type=tracks&q=Reckoner"),
      );
      expect(catalogErrRes.status).toBe(503);
      expect(catalogErrRes.headers.get("cache-control")).toBe("private, no-store");
      expect(catalogErrRes.headers.get("retry-after")).toBe("3");
      expect(await catalogErrRes.json()).toEqual({
        error: "El catálogo musical no está disponible.",
        code: "CATALOG_UNAVAILABLE",
      });

      searchCatalogArtists.mockRejectedValueOnce(
        new Error("postgres://catalog_secret_password@mb:5432/mb"),
      );
      const unexpectedRes = await getFavoritesCatalog(
        new Request("http://localhost/api/favorites/catalog?type=artists&q=Radiohead"),
      );
      expect(unexpectedRes.status).toBe(503);
      expect(await unexpectedRes.text()).not.toContain("catalog_secret_password");
    });

    it("rethrows NEXT_REDIRECT signals", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(
        getFavoritesCatalog(new Request("http://localhost/api/favorites/catalog?q=Reckoner")),
      ).rejects.toBe(redirect);
    });
  });

  describe("POST /api/favorites/tracks", () => {
    it("returns 401 when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: TRACK_MBID,
        }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 400 on invalid JSON/object body or invalid MBID without touching DB", async () => {
      const nonJsonRes = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", "{bad-json"),
      );
      expect(nonJsonRes.status).toBe(400);

      const arrayRes = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", []),
      );
      expect(arrayRes.status).toBe(400);

      const invalidMbidRes = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: "not-a-uuid",
        }),
      );
      expect(invalidMbidRes.status).toBe(400);
      expect(await invalidMbidRes.json()).toMatchObject({ code: "INVALID_MBID" });
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 404 when MusicBrainz reports NOT_FOUND without writing to DB", async () => {
      resolveRecordingByMbid.mockRejectedValueOnce(
        new CatalogError("La canción indicada no existe.", 404, "NOT_FOUND"),
      );

      const response = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: TRACK_MBID,
        }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(db.userFavoriteRecording.upsert).not.toHaveBeenCalled();
    });

    it("returns 503 when MusicBrainz catalog is unavailable without writing to DB", async () => {
      resolveRecordingByMbid.mockRejectedValueOnce(
        new CatalogError("Catálogo caído", 503, "CATALOG_UNAVAILABLE"),
      );

      const response = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: TRACK_MBID,
        }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
      expect(db.userFavoriteRecording.upsert).not.toHaveBeenCalled();
    });

    it("returns 201 on new creation saving title and artistName, and 200 idempotently when already existing", async () => {
      const now = new Date("2025-05-05T12:00:00.000Z");
      const expectedCoverUrl = `/api/music/cover?type=recording&mbid=${TRACK_MBID}`;
      resolveRecordingByMbid.mockResolvedValue({
        recordingMbid: TRACK_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: ARTIST_MBID,
        durationMs: 290000,
        comment: null,
      });

      // 1) New favorite -> 201
      db.userFavoriteRecording.findUnique.mockResolvedValueOnce(null);
      db.userFavoriteRecording.upsert.mockResolvedValueOnce({
        id: "fav-1",
        userId: ownerUser.id,
        recordingId: TRACK_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        createdAt: now,
      });

      const createRes = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: ` ${TRACK_MBID.toUpperCase()} `,
        }),
      );

      expect(createRes.status).toBe(201);
      expect(createRes.headers.get("cache-control")).toBe("private, no-store");
      expect(resolveRecordingByMbid).toHaveBeenCalledWith(TRACK_MBID);
      expect(db.userFavoriteRecording.upsert).toHaveBeenCalledWith({
        where: {
          userId_recordingId: { userId: ownerUser.id, recordingId: TRACK_MBID },
        },
        create: {
          userId: ownerUser.id,
          recordingId: TRACK_MBID,
          title: "Reckoner",
          artistName: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
        },
        update: {
          title: "Reckoner",
          artistName: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
        },
      });
      expect(await createRes.json()).toEqual({
        track: {
          id: "fav-1",
          recordingMbid: TRACK_MBID,
          title: "Reckoner",
          artistName: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
          createdAt: now.toISOString(),
        },
        created: true,
        alreadyExists: false,
      });

      // 2) Already existing -> 200 alreadyExists: true
      db.userFavoriteRecording.findUnique.mockResolvedValueOnce({
        id: "fav-1",
        userId: ownerUser.id,
        recordingId: TRACK_MBID,
      });
      db.userFavoriteRecording.upsert.mockResolvedValueOnce({
        id: "fav-1",
        userId: ownerUser.id,
        recordingId: TRACK_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        createdAt: now,
      });

      const existingRes = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: TRACK_MBID,
        }),
      );

      expect(existingRes.status).toBe(200);
      expect(await existingRes.json()).toMatchObject({
        created: false,
        alreadyExists: true,
      });
    });

    it("handles concurrent P2002 unique constraint error by updating and returning 200 idempotently", async () => {
      const now = new Date("2025-05-05T12:00:00.000Z");
      const expectedCoverUrl = `/api/music/cover?type=recording&mbid=${TRACK_MBID}`;
      resolveRecordingByMbid.mockResolvedValueOnce({
        recordingMbid: TRACK_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: ARTIST_MBID,
        durationMs: 290000,
        comment: null,
      });
      db.userFavoriteRecording.findUnique.mockResolvedValueOnce(null);
      db.userFavoriteRecording.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      db.userFavoriteRecording.update.mockResolvedValueOnce({
        id: "fav-1",
        userId: ownerUser.id,
        recordingId: TRACK_MBID,
        title: "Reckoner",
        artistName: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        createdAt: now,
      });

      const response = await postFavoriteTrack(
        jsonRequest("http://localhost/api/favorites/tracks", "POST", {
          recordingMbid: TRACK_MBID,
        }),
      );

      expect(response.status).toBe(200);
      expect(db.userFavoriteRecording.update).toHaveBeenCalledWith({
        where: {
          userId_recordingId: { userId: ownerUser.id, recordingId: TRACK_MBID },
        },
        data: {
          title: "Reckoner",
          artistName: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
        },
      });
      expect(await response.json()).toEqual({
        track: {
          id: "fav-1",
          recordingMbid: TRACK_MBID,
          title: "Reckoner",
          artistName: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
          createdAt: now.toISOString(),
        },
        created: false,
        alreadyExists: true,
      });
    });

    it("rethrows NEXT_REDIRECT signals", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(
        postFavoriteTrack(
          jsonRequest("http://localhost/api/favorites/tracks", "POST", {
            recordingMbid: TRACK_MBID,
          }),
        ),
      ).rejects.toBe(redirect);
    });
  });

  describe("DELETE /api/favorites/tracks/[recordingMbid]", () => {
    it("returns 401 without touching DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await deleteFavoriteTrack(
        new Request(`http://localhost/api/favorites/tracks/${TRACK_MBID}`, {
          method: "DELETE",
        }),
        trackContext(TRACK_MBID),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 400 on invalid UUID without touching DB", async () => {
      const response = await deleteFavoriteTrack(
        new Request("http://localhost/api/favorites/tracks/not-a-uuid", {
          method: "DELETE",
        }),
        trackContext("not-a-uuid"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_MBID" });
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 404 when count === 0 and scopes deletion strictly to the authenticated userId", async () => {
      db.userFavoriteRecording.deleteMany.mockResolvedValueOnce({ count: 0 });

      const response = await deleteFavoriteTrack(
        new Request(`http://localhost/api/favorites/tracks/${TRACK_MBID}`, {
          method: "DELETE",
        }),
        trackContext(TRACK_MBID.toUpperCase()),
      );

      expect(response.status).toBe(404);
      expect(db.userFavoriteRecording.deleteMany).toHaveBeenCalledWith({
        where: { userId: ownerUser.id, recordingId: TRACK_MBID },
      });
    });

    it("returns 200 on deletion without depending on MusicBrainz", async () => {
      isCatalogConfigured.mockReturnValue(false);
      resolveRecordingByMbid.mockRejectedValue(
        new CatalogError("Down", 503, "CATALOG_UNAVAILABLE"),
      );
      db.userFavoriteRecording.deleteMany.mockResolvedValueOnce({ count: 1 });

      const response = await deleteFavoriteTrack(
        new Request(`http://localhost/api/favorites/tracks/${TRACK_MBID}`, {
          method: "DELETE",
        }),
        trackContext(TRACK_MBID.toUpperCase()),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({
        deleted: true,
        recordingMbid: TRACK_MBID,
      });
    });

    it("rethrows NEXT_REDIRECT signals", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(
        deleteFavoriteTrack(
          new Request(`http://localhost/api/favorites/tracks/${TRACK_MBID}`, {
            method: "DELETE",
          }),
          trackContext(TRACK_MBID),
        ),
      ).rejects.toBe(redirect);
    });
  });

  describe("POST /api/favorites/artists", () => {
    it("returns 401 when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: ARTIST_MBID,
        }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(resolveArtistByMbid).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 400 on invalid body or invalid MBID without touching DB", async () => {
      const badBody = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", "not-json"),
      );
      expect(badBody.status).toBe(400);

      const badMbid = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: "bad-mbid",
        }),
      );
      expect(badMbid.status).toBe(400);
      expect(await badMbid.json()).toMatchObject({ code: "INVALID_MBID" });
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 404 when artist is not found in MusicBrainz and 503 when catalog is down", async () => {
      resolveArtistByMbid.mockRejectedValueOnce(
        new CatalogError("No existe el artista", 404, "NOT_FOUND"),
      );
      const notFoundRes = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: ARTIST_MBID,
        }),
      );
      expect(notFoundRes.status).toBe(404);
      expect(db.userFavoriteArtist.upsert).not.toHaveBeenCalled();

      resolveArtistByMbid.mockRejectedValueOnce(
        new CatalogError("Catálogo no disponible", 503, "CATALOG_UNAVAILABLE"),
      );
      const unavailableRes = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: ARTIST_MBID,
        }),
      );
      expect(unavailableRes.status).toBe(503);
      expect(db.userFavoriteArtist.upsert).not.toHaveBeenCalled();
    });

    it("returns 201 on creation, 200 idempotently when already saved, and handles P2002 race", async () => {
      const now = new Date("2025-05-05T12:00:00.000Z");
      const expectedCoverUrl = `/api/music/cover?type=artist&mbid=${ARTIST_MBID}`;
      resolveArtistByMbid.mockResolvedValue({
        artistMbid: ARTIST_MBID,
        name: "Radiohead",
        sortName: "Radiohead",
        comment: null,
      });

      // 1) New -> 201
      db.userFavoriteArtist.findUnique.mockResolvedValueOnce(null);
      db.userFavoriteArtist.upsert.mockResolvedValueOnce({
        id: "fav-a1",
        userId: ownerUser.id,
        artistId: ARTIST_MBID,
        name: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        createdAt: now,
      });
      const createdRes = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: ARTIST_MBID.toUpperCase(),
        }),
      );
      expect(createdRes.status).toBe(201);
      expect(await createdRes.json()).toEqual({
        artist: {
          id: "fav-a1",
          artistMbid: ARTIST_MBID,
          name: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
          createdAt: now.toISOString(),
        },
        created: true,
        alreadyExists: false,
      });

      // 2) Existing -> 200
      db.userFavoriteArtist.findUnique.mockResolvedValueOnce({
        id: "fav-a1",
        userId: ownerUser.id,
        artistId: ARTIST_MBID,
      });
      db.userFavoriteArtist.upsert.mockResolvedValueOnce({
        id: "fav-a1",
        userId: ownerUser.id,
        artistId: ARTIST_MBID,
        name: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        createdAt: now,
      });
      const existingRes = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: ARTIST_MBID,
        }),
      );
      expect(existingRes.status).toBe(200);
      expect(await existingRes.json()).toMatchObject({
        created: false,
        alreadyExists: true,
      });

      // 3) P2002 concurrency -> 200
      db.userFavoriteArtist.findUnique.mockResolvedValueOnce(null);
      db.userFavoriteArtist.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      db.userFavoriteArtist.update.mockResolvedValueOnce({
        id: "fav-a1",
        userId: ownerUser.id,
        artistId: ARTIST_MBID,
        name: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        createdAt: now,
      });
      const raceRes = await postFavoriteArtist(
        jsonRequest("http://localhost/api/favorites/artists", "POST", {
          artistMbid: ARTIST_MBID,
        }),
      );
      expect(raceRes.status).toBe(200);
      expect(db.userFavoriteArtist.update).toHaveBeenCalledWith({
        where: {
          userId_artistId: { userId: ownerUser.id, artistId: ARTIST_MBID },
        },
        data: {
          name: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
        },
      });
      expect(await raceRes.json()).toMatchObject({
        created: false,
        alreadyExists: true,
      });
    });

    it("rethrows NEXT_REDIRECT signals", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(
        postFavoriteArtist(
          jsonRequest("http://localhost/api/favorites/artists", "POST", {
            artistMbid: ARTIST_MBID,
          }),
        ),
      ).rejects.toBe(redirect);
    });
  });

  describe("DELETE /api/favorites/artists/[artistMbid]", () => {
    it("returns 401 and 400 without touching DB", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);
      const unauthRes = await deleteFavoriteArtist(
        new Request(`http://localhost/api/favorites/artists/${ARTIST_MBID}`, {
          method: "DELETE",
        }),
        artistContext(ARTIST_MBID),
      );
      expect(unauthRes.status).toBe(401);
      expect(getDb).not.toHaveBeenCalled();

      const invalidRes = await deleteFavoriteArtist(
        new Request("http://localhost/api/favorites/artists/bad-uuid", {
          method: "DELETE",
        }),
        artistContext("bad-uuid"),
      );
      expect(invalidRes.status).toBe(400);
      expect(await invalidRes.json()).toMatchObject({ code: "INVALID_MBID" });
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 404 when count === 0 (userId isolated) and 200 on deletion offline", async () => {
      db.userFavoriteArtist.deleteMany.mockResolvedValueOnce({ count: 0 });
      const missingRes = await deleteFavoriteArtist(
        new Request(`http://localhost/api/favorites/artists/${ARTIST_MBID}`, {
          method: "DELETE",
        }),
        artistContext(ARTIST_MBID.toUpperCase()),
      );
      expect(missingRes.status).toBe(404);
      expect(db.userFavoriteArtist.deleteMany).toHaveBeenCalledWith({
        where: { userId: ownerUser.id, artistId: ARTIST_MBID },
      });

      isCatalogConfigured.mockReturnValue(false);
      db.userFavoriteArtist.deleteMany.mockResolvedValueOnce({ count: 1 });
      const deletedRes = await deleteFavoriteArtist(
        new Request(`http://localhost/api/favorites/artists/${ARTIST_MBID}`, {
          method: "DELETE",
        }),
        artistContext(ARTIST_MBID.toUpperCase()),
      );
      expect(deletedRes.status).toBe(200);
      expect(deletedRes.headers.get("cache-control")).toBe("private, no-store");
      expect(resolveArtistByMbid).not.toHaveBeenCalled();
      expect(await deletedRes.json()).toEqual({
        deleted: true,
        artistMbid: ARTIST_MBID,
      });
    });

    it("rethrows NEXT_REDIRECT signals", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(
        deleteFavoriteArtist(
          new Request(`http://localhost/api/favorites/artists/${ARTIST_MBID}`, {
            method: "DELETE",
          }),
          artistContext(ARTIST_MBID),
        ),
      ).rejects.toBe(redirect);
    });
  });
});
