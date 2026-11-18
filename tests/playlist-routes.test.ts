import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUserProfile,
  getDb,
  resolveRecordingByMbid,
  db,
  tx,
} = vi.hoisted(() => {
  const txMock = {
    playlist: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    playlistTrack: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  };

  const dbMock = {
    playlist: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    playlistTrack: {
      findMany: vi.fn(),
    },
    recommendationResult: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return {
    getCurrentUserProfile: vi.fn(),
    getDb: vi.fn(),
    resolveRecordingByMbid: vi.fn(),
    db: dbMock,
    tx: txMock,
  };
});

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/music-library/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/music-library/catalog")>(
    "@/lib/music-library/catalog",
  );
  return {
    ...actual,
    resolveRecordingByMbid,
  };
});

import { CatalogError } from "@/lib/music-library/catalog";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  PlaylistActionError,
  parseExpectedVersion,
  parseExpectedVersionQuery,
  parseUuid,
  validatePlaylistDescription,
  validatePlaylistName,
  validateReorderIds,
} from "@/lib/music-library/playlists";
import { POST as createPlaylist } from "@/app/api/me/playlists/route";
import {
  DELETE as deletePlaylist,
  PATCH as patchPlaylist,
} from "@/app/api/me/playlists/[playlistId]/route";
import {
  GET as getPlaylistTracks,
  POST as addPlaylistTrack,
} from "@/app/api/me/playlists/[playlistId]/tracks/route";
import { DELETE as removePlaylistTrack } from "@/app/api/me/playlists/[playlistId]/tracks/[trackId]/route";
import { PUT as reorderPlaylistTracks } from "@/app/api/me/playlists/[playlistId]/tracks/reorder/route";

const USER_ID = "user-internal-1";
const PLAYLIST_ID = "11111111-2222-4333-8444-555555555555";
const TRACK_ID_1 = "aaaaaaaa-1111-4111-8111-111111111111";
const TRACK_ID_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const TRACK_ID_3 = "cccccccc-3333-4333-8333-333333333333";
const RECORDING_MBID_1 = "dddddddd-4444-4444-8444-444444444444";
const CANONICAL_MBID_1 = "eeeeeeee-5555-4555-8555-555555555555";

const playlistContext = (playlistId = PLAYLIST_ID) => ({
  params: Promise.resolve({ playlistId }),
});

const trackContext = (playlistId = PLAYLIST_ID, trackId = TRACK_ID_1) => ({
  params: Promise.resolve({ playlistId, trackId }),
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

describe("lib/music-library/playlists pure validation", () => {
  describe("parseUuid", () => {
    it("normalizes valid uppercase and padded UUIDs to lowercase", () => {
      expect(parseUuid(`  ${PLAYLIST_ID.toUpperCase()}  `)).toBe(PLAYLIST_ID);
    });

    it("throws PlaylistActionError 400 INVALID_INPUT for invalid or non-string UUIDs", () => {
      for (const bad of ["", "   ", "not-a-uuid", "11111111-2222-4333-8444-55555555555", 123, null, undefined]) {
        try {
          parseUuid(bad, "identificador de playlist");
          expect.unreachable("Expected parseUuid to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(PlaylistActionError);
          expect(error).toMatchObject({
            status: 400,
            code: "INVALID_INPUT",
          });
        }
      }
    });
  });

  describe("validatePlaylistName", () => {
    it("trims valid names and allows up to MAX_PLAYLIST_NAME_LENGTH characters", () => {
      expect(validatePlaylistName("  Noche de estudio  ")).toBe("Noche de estudio");
      expect(validatePlaylistName("a".repeat(MAX_PLAYLIST_NAME_LENGTH))).toBe(
        "a".repeat(MAX_PLAYLIST_NAME_LENGTH),
      );
    });

    it("rejects non-strings, empty/whitespace names, and names exceeding 200 characters", () => {
      for (const bad of [null, undefined, 42, "", "   ", "a".repeat(MAX_PLAYLIST_NAME_LENGTH + 1)]) {
        try {
          validatePlaylistName(bad);
          expect.unreachable("Expected validatePlaylistName to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(PlaylistActionError);
          expect(error).toMatchObject({
            status: 400,
            code: "INVALID_INPUT",
          });
        }
      }
    });
  });

  describe("validatePlaylistDescription", () => {
    it("normalizes null, undefined, and empty whitespace to null and trims valid strings", () => {
      expect(validatePlaylistDescription(null)).toBeNull();
      expect(validatePlaylistDescription(undefined)).toBeNull();
      expect(validatePlaylistDescription("")).toBeNull();
      expect(validatePlaylistDescription("   ")).toBeNull();
      expect(validatePlaylistDescription("  Selección nocturna  ")).toBe("Selección nocturna");
      expect(validatePlaylistDescription("b".repeat(MAX_PLAYLIST_DESCRIPTION_LENGTH))).toBe(
        "b".repeat(MAX_PLAYLIST_DESCRIPTION_LENGTH),
      );
    });

    it("rejects non-strings and descriptions exceeding 1000 characters", () => {
      for (const bad of [123, {}, [], "b".repeat(MAX_PLAYLIST_DESCRIPTION_LENGTH + 1)]) {
        try {
          validatePlaylistDescription(bad);
          expect.unreachable("Expected validatePlaylistDescription to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(PlaylistActionError);
          expect(error).toMatchObject({
            status: 400,
            code: "INVALID_INPUT",
          });
        }
      }
    });
  });

  describe("parseExpectedVersion & parseExpectedVersionQuery", () => {
    it("returns undefined for null/undefined and accepts positive safe integers", () => {
      expect(parseExpectedVersion(undefined)).toBeUndefined();
      expect(parseExpectedVersion(null)).toBeUndefined();
      expect(parseExpectedVersion(1)).toBe(1);
      expect(parseExpectedVersion(42)).toBe(42);

      expect(parseExpectedVersionQuery(new Request("http://localhost/api/me/playlists/1"))).toBeUndefined();
      expect(
        parseExpectedVersionQuery(new Request("http://localhost/api/me/playlists/1?expectedVersion=3")),
      ).toBe(3);
    });

    it("rejects 0, negatives, floats, non-numbers, and invalid query strings", () => {
      for (const bad of [0, -1, 1.5, "2", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
        expect(() => parseExpectedVersion(bad)).toThrowError(PlaylistActionError);
      }

      for (const query of ["?expectedVersion=0", "?expectedVersion=-2", "?expectedVersion=abc", "?expectedVersion=1.5"]) {
        expect(() =>
          parseExpectedVersionQuery(new Request(`http://localhost/api/me/playlists/1${query}`)),
        ).toThrowError(PlaylistActionError);
      }
    });
  });

  describe("validateReorderIds", () => {
    it("accepts trackIds or itemIds and normalizes UUIDs to lowercase", () => {
      expect(
        validateReorderIds({
          trackIds: [` ${TRACK_ID_1.toUpperCase()} `, TRACK_ID_2],
        }),
      ).toEqual([TRACK_ID_1, TRACK_ID_2]);

      expect(
        validateReorderIds({
          itemIds: [TRACK_ID_2.toUpperCase(), TRACK_ID_1],
        }),
      ).toEqual([TRACK_ID_2, TRACK_ID_1]);
    });

    it("rejects empty arrays, non-arrays, invalid UUIDs, and duplicate IDs (case-insensitive)", () => {
      for (const body of [
        {},
        { trackIds: [] },
        { trackIds: "not-array" },
        { trackIds: ["not-a-uuid"] },
        { trackIds: [TRACK_ID_1, TRACK_ID_1] },
        { trackIds: [TRACK_ID_1, TRACK_ID_1.toUpperCase()] },
      ]) {
        try {
          validateReorderIds(body);
          expect.unreachable("Expected validateReorderIds to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(PlaylistActionError);
          expect(error).toMatchObject({
            status: 400,
            code: "INVALID_INPUT",
          });
        }
      }
    });
  });
});

describe("playlist API route handlers", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({ id: USER_ID });
    getDb.mockReturnValue(db);
    db.playlist.findFirst.mockReset();
    db.playlist.create.mockReset();
    db.playlistTrack.findMany.mockReset();
    db.recommendationResult.findMany.mockReset();
    db.$transaction.mockReset();
    db.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));

    tx.playlist.findFirst.mockReset();
    tx.playlist.updateMany.mockReset();
    tx.playlist.deleteMany.mockReset();
    tx.playlistTrack.findUnique.mockReset();
    tx.playlistTrack.findFirst.mockReset();
    tx.playlistTrack.findMany.mockReset();
    tx.playlistTrack.create.mockReset();
    tx.playlistTrack.update.mockReset();
    tx.playlistTrack.updateMany.mockReset();
    tx.playlistTrack.deleteMany.mockReset();
    tx.playlistTrack.count.mockReset();
    resolveRecordingByMbid.mockReset();

    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("authentication 401 without touching DB", () => {
    const authCases = [
      {
        label: "POST /api/me/playlists",
        call: () => createPlaylist(jsonRequest("http://localhost/api/me/playlists", "POST", { name: "Mi lista" })),
      },
      {
        label: "PATCH /api/me/playlists/[playlistId]",
        call: () =>
          patchPlaylist(
            jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "PATCH", { name: "Nueva" }),
            playlistContext(),
          ),
      },
      {
        label: "DELETE /api/me/playlists/[playlistId]",
        call: () =>
          deletePlaylist(
            jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "DELETE"),
            playlistContext(),
          ),
      },
      {
        label: "GET /api/me/playlists/[playlistId]/tracks",
        call: () =>
          getPlaylistTracks(
            jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "GET"),
            playlistContext(),
          ),
      },
      {
        label: "POST /api/me/playlists/[playlistId]/tracks",
        call: () =>
          addPlaylistTrack(
            jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
              recordingId: RECORDING_MBID_1,
            }),
            playlistContext(),
          ),
      },
      {
        label: "DELETE /api/me/playlists/[playlistId]/tracks/[trackId]",
        call: () =>
          removePlaylistTrack(
            jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/${TRACK_ID_1}`, "DELETE"),
            trackContext(),
          ),
      },
      {
        label: "PUT /api/me/playlists/[playlistId]/tracks/reorder",
        call: () =>
          reorderPlaylistTracks(
            jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
              trackIds: [TRACK_ID_1],
            }),
            playlistContext(),
          ),
      },
    ];

    it.each(authCases)("returns 401 with Cache-Control: private, no-store and skips getDb for $label", async ({ call }) => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await call();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: "No autorizado." });
      expect(getDb).not.toHaveBeenCalled();
    });
  });

  describe("validation 400 errors", () => {
    it("rejects invalid playlist create payloads (empty, >200 name, >1000 description, malformed JSON)", async () => {
      for (const req of [
        jsonRequest("http://localhost/api/me/playlists", "POST", "{bad-json"),
        jsonRequest("http://localhost/api/me/playlists", "POST", ["not-object"]),
        jsonRequest("http://localhost/api/me/playlists", "POST", { name: "   " }),
        jsonRequest("http://localhost/api/me/playlists", "POST", { name: "x".repeat(201) }),
        jsonRequest("http://localhost/api/me/playlists", "POST", {
          name: "Valida",
          description: "d".repeat(1001),
        }),
      ]) {
        const res = await createPlaylist(req);
        expect(res.status).toBe(400);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(await res.json()).toMatchObject({ code: "INVALID_INPUT", error: expect.any(String) });
      }
      expect(db.playlist.create).not.toHaveBeenCalled();
    });

    it("rejects invalid UUIDs, missing update fields, invalid expectedVersion, and empty/duplicate trackIds", async () => {
      const badPatchUuid = await patchPlaylist(
        jsonRequest("http://localhost/api/me/playlists/bad", "PATCH", { name: "Hola" }),
        playlistContext("bad"),
      );
      expect(badPatchUuid.status).toBe(400);

      const emptyPatch = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "PATCH", { expectedVersion: 1 }),
        playlistContext(),
      );
      expect(emptyPatch.status).toBe(400);

      const badPatchVersion = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "PATCH", {
          name: "Hola",
          expectedVersion: 0,
        }),
        playlistContext(),
      );
      expect(badPatchVersion.status).toBe(400);

      const badDeleteQueryVersion = await deletePlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}?expectedVersion=0`, "DELETE"),
        playlistContext(),
      );
      expect(badDeleteQueryVersion.status).toBe(400);

      const badAddRecording = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: "invalid-mbid",
        }),
        playlistContext(),
      );
      expect(badAddRecording.status).toBe(400);

      const badDeleteTrackUuid = await removePlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/nope`, "DELETE"),
        trackContext(PLAYLIST_ID, "nope"),
      );
      expect(badDeleteTrackUuid.status).toBe(400);

      const emptyReorder = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
          trackIds: [],
        }),
        playlistContext(),
      );
      expect(emptyReorder.status).toBe(400);

      const dupReorder = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
          trackIds: [TRACK_ID_1, TRACK_ID_1],
        }),
        playlistContext(),
      );
      expect(dupReorder.status).toBe(400);

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();
    });
  });

  describe("404 for missing or foreign playlists and tracks", () => {
    it("returns 404 on PATCH, DELETE, GET tracks, POST track, DELETE track, and PUT reorder when playlist is missing/foreign", async () => {
      tx.playlist.updateMany.mockResolvedValue({ count: 0 });
      tx.playlist.deleteMany.mockResolvedValue({ count: 0 });
      tx.playlist.findFirst.mockResolvedValue(null);
      db.playlist.findFirst.mockResolvedValue(null);

      const patchRes = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "PATCH", { name: "Nueva" }),
        playlistContext(),
      );
      expect(patchRes.status).toBe(404);
      expect(await patchRes.json()).toMatchObject({ code: "NOT_FOUND" });

      const deleteRes = await deletePlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "DELETE"),
        playlistContext(),
      );
      expect(deleteRes.status).toBe(404);
      expect(await deleteRes.json()).toMatchObject({ code: "NOT_FOUND" });

      const getTracksRes = await getPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "GET"),
        playlistContext(),
      );
      expect(getTracksRes.status).toBe(404);

      const addTrackRes = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
        }),
        playlistContext(),
      );
      expect(addTrackRes.status).toBe(404);
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();

      const delTrackRes = await removePlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/${TRACK_ID_1}`, "DELETE"),
        trackContext(),
      );
      expect(delTrackRes.status).toBe(404);

      const reorderRes = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
          trackIds: [TRACK_ID_1],
        }),
        playlistContext(),
      );
      expect(reorderRes.status).toBe(404);
    });

    it("returns 404 when playlist exists but trackId does not belong to it in DELETE .../tracks/[trackId]", async () => {
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 2 });
      tx.playlistTrack.deleteMany.mockResolvedValueOnce({ count: 0 });

      const res = await removePlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/${TRACK_ID_1}`, "DELETE"),
        trackContext(),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(tx.playlistTrack.findMany).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/me/playlists, PATCH, and DELETE playlist CRUD", () => {
    it("creates playlist returning 201 with trimmed name and normalized null description", async () => {
      const created = {
        id: PLAYLIST_ID,
        userId: USER_ID,
        name: "Indie nocturno",
        description: null,
        version: 1,
        _count: { tracks: 0 },
      };
      db.playlist.create.mockResolvedValueOnce(created);

      const res = await createPlaylist(
        jsonRequest("http://localhost/api/me/playlists", "POST", {
          name: "  Indie nocturno  ",
          description: "   ",
        }),
      );

      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(db.playlist.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, name: "Indie nocturno", description: null },
        include: { _count: { select: { tracks: true } } },
      });
      expect(await res.json()).toEqual({ playlist: created });
    });

    it("updates playlist name/description checking expectedVersion and returns 409 VERSION_CONFLICT when stale", async () => {
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst
        .mockResolvedValueOnce({ version: 2 })
        .mockResolvedValueOnce({
          id: PLAYLIST_ID,
          userId: USER_ID,
          name: "Actualizada",
          description: "Desc",
          version: 2,
          _count: { tracks: 3 },
        });

      const okRes = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "PATCH", {
          name: " Actualizada ",
          description: " Desc ",
          expectedVersion: 1,
        }),
        playlistContext(),
      );

      expect(okRes.status).toBe(200);
      expect(tx.playlist.updateMany).toHaveBeenCalledWith({
        where: { id: PLAYLIST_ID, userId: USER_ID, version: 1 },
        data: { name: "Actualizada", description: "Desc", version: { increment: 1 } },
      });
      expect(await okRes.json()).toMatchObject({ playlist: { id: PLAYLIST_ID, version: 2 } });

      tx.playlist.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 3 });

      const conflictRes = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "PATCH", {
          name: "Stale",
          expectedVersion: 1,
        }),
        playlistContext(),
      );
      expect(conflictRes.status).toBe(409);
      expect(await conflictRes.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    });

    it("deletes playlist with expectedVersion from body or query and returns 409 VERSION_CONFLICT when stale", async () => {
      tx.playlist.deleteMany.mockResolvedValueOnce({ count: 1 });

      const okRes = await deletePlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}?expectedVersion=2`, "DELETE"),
        playlistContext(),
      );
      expect(okRes.status).toBe(200);
      expect(tx.playlist.deleteMany).toHaveBeenCalledWith({
        where: { id: PLAYLIST_ID, userId: USER_ID, version: 2 },
      });
      expect(await okRes.json()).toEqual({ deleted: true, id: PLAYLIST_ID });

      tx.playlist.deleteMany.mockResolvedValueOnce({ count: 0 });
      tx.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID });

      const conflictRes = await deletePlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}`, "DELETE", {
          expectedVersion: 1,
        }),
        playlistContext(),
      );
      expect(conflictRes.status).toBe(409);
      expect(await conflictRes.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    });
  });

  describe("POST /api/me/playlists/[playlistId]/tracks", () => {
    it("does not open a transaction or insert/bump version when resolveRecordingByMbid throws CatalogError 404 or 503", async () => {
      db.playlist.findFirst.mockResolvedValue({ id: PLAYLIST_ID, version: 1 });

      resolveRecordingByMbid.mockRejectedValueOnce(
        new CatalogError("No existe en catálogo", 404, "NOT_FOUND"),
      );
      const notFoundRes = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
          expectedVersion: 1,
        }),
        playlistContext(),
      );
      expect(notFoundRes.status).toBe(404);
      expect(await notFoundRes.json()).toEqual({
        error: "No existe en catálogo",
        code: "NOT_FOUND",
      });

      resolveRecordingByMbid.mockRejectedValueOnce(
        new CatalogError("Catálogo caído", 503, "CATALOG_UNAVAILABLE"),
      );
      const unavailableRes = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
          expectedVersion: 1,
        }),
        playlistContext(),
      );
      expect(unavailableRes.status).toBe(503);
      expect(await unavailableRes.json()).toEqual({
        error: "Catálogo caído",
        code: "CATALOG_UNAVAILABLE",
      });

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(tx.playlist.updateMany).not.toHaveBeenCalled();
      expect(tx.playlistTrack.create).not.toHaveBeenCalled();
    });

    it("caches resolved title and artistName, increments version, appends position, and returns 201", async () => {
      const expectedCoverUrl = `/api/music/cover?type=recording&mbid=${CANONICAL_MBID_1}`;
      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 2 });
      resolveRecordingByMbid.mockResolvedValueOnce({
        recordingMbid: CANONICAL_MBID_1,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: null,
        durationMs: 290000,
        comment: null,
      });

      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 3 });
      tx.playlistTrack.findUnique.mockResolvedValueOnce(null);
      tx.playlistTrack.findFirst.mockResolvedValueOnce({ position: 1 });

      const createdTrack = {
        id: TRACK_ID_3,
        playlistId: PLAYLIST_ID,
        recordingId: CANONICAL_MBID_1,
        title: "Reckoner",
        artistName: "Radiohead",
        coverReleaseMbid: null,
        coverUrl: expectedCoverUrl,
        position: 2,
      };
      tx.playlistTrack.create.mockResolvedValueOnce(createdTrack);
      tx.playlistTrack.count.mockResolvedValueOnce(3);

      const res = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingMbid: RECORDING_MBID_1.toUpperCase(),
          expectedVersion: 2,
        }),
        playlistContext(),
      );

      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(resolveRecordingByMbid).toHaveBeenCalledWith(RECORDING_MBID_1);
      expect(tx.playlistTrack.create).toHaveBeenCalledWith({
        data: {
          playlistId: PLAYLIST_ID,
          recordingId: CANONICAL_MBID_1,
          title: "Reckoner",
          artistName: "Radiohead",
          coverReleaseMbid: null,
          coverUrl: expectedCoverUrl,
          position: 2,
        },
      });
      expect(await res.json()).toEqual({
        track: createdTrack,
        version: 3,
        trackCount: 3,
      });
    });

    it("returns 409 DUPLICATE_TRACK when recording is already in playlist", async () => {
      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 1 });
      resolveRecordingByMbid.mockResolvedValueOnce({
        recordingMbid: CANONICAL_MBID_1,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: null,
        durationMs: 290000,
        comment: null,
      });
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 2 });
      tx.playlistTrack.findUnique.mockResolvedValueOnce({ id: TRACK_ID_1 });

      const res = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
          expectedVersion: 1,
        }),
        playlistContext(),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "DUPLICATE_TRACK" });
      expect(tx.playlistTrack.create).not.toHaveBeenCalled();
    });

    it("returns 409 VERSION_CONFLICT when expectedVersion is stale (pre-check and in-transaction)", async () => {
      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 4 });

      const preCheckRes = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
          expectedVersion: 2,
        }),
        playlistContext(),
      );
      expect(preCheckRes.status).toBe(409);
      expect(await preCheckRes.json()).toMatchObject({ code: "VERSION_CONFLICT" });
      expect(resolveRecordingByMbid).not.toHaveBeenCalled();

      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 2 });
      resolveRecordingByMbid.mockResolvedValueOnce({
        recordingMbid: CANONICAL_MBID_1,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: null,
        durationMs: null,
        comment: null,
      });
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 3 });

      const txConflictRes = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
          expectedVersion: 2,
        }),
        playlistContext(),
      );
      expect(txConflictRes.status).toBe(409);
      expect(await txConflictRes.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    });

    it("maps Prisma P2002 unique constraint error to 409 DUPLICATE_TRACK", async () => {
      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 1 });
      resolveRecordingByMbid.mockResolvedValueOnce({
        recordingMbid: CANONICAL_MBID_1,
        title: "Reckoner",
        artistName: "Radiohead",
        artistMbid: null,
        durationMs: null,
        comment: null,
      });
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 2 });
      tx.playlistTrack.findUnique.mockResolvedValueOnce(null);
      tx.playlistTrack.findFirst.mockResolvedValueOnce(null);
      tx.playlistTrack.create.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      const res = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "POST", {
          recordingId: RECORDING_MBID_1,
          expectedVersion: 1,
        }),
        playlistContext(),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "DUPLICATE_TRACK" });
    });
  });

  describe("GET /api/me/playlists/[playlistId]/tracks", () => {
    it("returns { items, pagination } and skips recommendationResult query when all tracks have cached metadata", async () => {
      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID });
      db.playlistTrack.findMany.mockResolvedValueOnce([
        {
          id: TRACK_ID_1,
          playlistId: PLAYLIST_ID,
          recordingId: RECORDING_MBID_1,
          title: "Reckoner",
          artistName: "Radiohead",
          position: 0,
        },
        {
          id: TRACK_ID_2,
          playlistId: PLAYLIST_ID,
          recordingId: CANONICAL_MBID_1,
          title: "Nude",
          artistName: "Radiohead",
          position: 1,
        },
      ]);

      const res = await getPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks?limit=1&offset=0`, "GET"),
        playlistContext(),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(db.recommendationResult.findMany).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({
        items: [
          {
            id: TRACK_ID_1,
            playlistId: PLAYLIST_ID,
            recordingId: RECORDING_MBID_1,
            title: "Reckoner",
            artistName: "Radiohead",
            coverReleaseMbid: null,
            coverUrl: `/api/music/cover?type=recording&mbid=${RECORDING_MBID_1}`,
            position: 0,
          },
        ],
        pagination: { limit: 1, offset: 0, hasMore: true, nextOffset: 1 },
      });
    });

    it("falls back to recommendationResult.explanation.song only for tracks missing title or artistName and leaves null when unavailable", async () => {
      db.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID });
      db.playlistTrack.findMany.mockResolvedValueOnce([
        {
          id: TRACK_ID_1,
          playlistId: PLAYLIST_ID,
          recordingId: RECORDING_MBID_1,
          title: null,
          artistName: null,
          position: 0,
        },
        {
          id: TRACK_ID_2,
          playlistId: PLAYLIST_ID,
          recordingId: CANONICAL_MBID_1,
          title: "Título en caché",
          artistName: null,
          position: 1,
        },
        {
          id: TRACK_ID_3,
          playlistId: PLAYLIST_ID,
          recordingId: "ffffffff-6666-4666-8666-666666666666",
          title: null,
          artistName: null,
          position: 2,
        },
      ]);

      db.recommendationResult.findMany.mockResolvedValueOnce([
        {
          recordingId: RECORDING_MBID_1,
          explanation: { song: { title: "Bizarre Love Triangle", artist: "New Order" } },
        },
        {
          recordingId: CANONICAL_MBID_1,
          explanation: { song: { title: "Otro título", artist: "Artista Fallback" } },
        },
        {
          recordingId: "ffffffff-6666-4666-8666-666666666666",
          explanation: {},
        },
      ]);

      const res = await getPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "GET"),
        playlistContext(),
      );

      expect(res.status).toBe(200);
      expect(db.recommendationResult.findMany).toHaveBeenCalledWith({
        where: {
          recordingId: {
            in: [
              RECORDING_MBID_1,
              CANONICAL_MBID_1,
              "ffffffff-6666-4666-8666-666666666666",
            ],
          },
          request: { userId: USER_ID },
        },
        orderBy: { createdAt: "desc" },
        distinct: ["recordingId"],
        select: { recordingId: true, explanation: true },
      });

      const body = await res.json();
      expect(body.items).toEqual([
        {
          id: TRACK_ID_1,
          playlistId: PLAYLIST_ID,
          recordingId: RECORDING_MBID_1,
          title: "Bizarre Love Triangle",
          artistName: "New Order",
          coverReleaseMbid: null,
          coverUrl: `/api/music/cover?type=recording&mbid=${RECORDING_MBID_1}`,
          position: 0,
        },
        {
          id: TRACK_ID_2,
          playlistId: PLAYLIST_ID,
          recordingId: CANONICAL_MBID_1,
          title: "Título en caché",
          artistName: "Artista Fallback",
          coverReleaseMbid: null,
          coverUrl: `/api/music/cover?type=recording&mbid=${CANONICAL_MBID_1}`,
          position: 1,
        },
        {
          id: TRACK_ID_3,
          playlistId: PLAYLIST_ID,
          recordingId: "ffffffff-6666-4666-8666-666666666666",
          title: null,
          artistName: null,
          coverReleaseMbid: null,
          coverUrl: "/api/music/cover?type=recording&mbid=ffffffff-6666-4666-8666-666666666666",
          position: 2,
        },
      ]);
    });
  });

  describe("DELETE .../tracks/[trackId] & PUT .../tracks/reorder", () => {
    it("compacts remaining tracks after DELETE using positive shift without negative positions", async () => {
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 4 });
      tx.playlistTrack.deleteMany.mockResolvedValueOnce({ count: 1 });
      tx.playlistTrack.findMany.mockResolvedValueOnce([
        { id: TRACK_ID_1, position: 0 },
        { id: TRACK_ID_3, position: 2 },
      ]);

      const res = await removePlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/${TRACK_ID_2}`, "DELETE", {
          expectedVersion: 3,
        }),
        trackContext(PLAYLIST_ID, TRACK_ID_2),
      );

      expect(res.status).toBe(200);
      expect(tx.playlistTrack.updateMany).toHaveBeenCalledWith({
        where: { playlistId: PLAYLIST_ID },
        data: { position: { increment: 3 } },
      });
      const incrementArg = tx.playlistTrack.updateMany.mock.calls[0][0].data.position.increment;
      expect(incrementArg).toBeGreaterThan(0);

      expect(tx.playlistTrack.update).toHaveBeenNthCalledWith(1, {
        where: { id: TRACK_ID_1 },
        data: { position: 0 },
      });
      expect(tx.playlistTrack.update).toHaveBeenNthCalledWith(2, {
        where: { id: TRACK_ID_3 },
        data: { position: 1 },
      });
      expect(await res.json()).toEqual({
        deleted: true,
        trackId: TRACK_ID_2,
        version: 4,
        remainingCount: 2,
      });
    });

    it("returns 409 VERSION_CONFLICT when DELETE .../tracks/[trackId] has stale expectedVersion", async () => {
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 5 });

      const res = await removePlaylistTrack(
        jsonRequest(
          `http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/${TRACK_ID_1}?expectedVersion=2`,
          "DELETE",
        ),
        trackContext(),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "VERSION_CONFLICT" });
      expect(tx.playlistTrack.deleteMany).not.toHaveBeenCalled();
    });

    it("reorders tracks using positive shift and updates positions 0..N-1", async () => {
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 6 });
      tx.playlistTrack.findMany.mockResolvedValueOnce([
        { id: TRACK_ID_1, position: 0 },
        { id: TRACK_ID_2, position: 1 },
        { id: TRACK_ID_3, position: 2 },
      ]);

      const res = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
          trackIds: [TRACK_ID_3, TRACK_ID_1, TRACK_ID_2],
          expectedVersion: 5,
        }),
        playlistContext(),
      );

      expect(res.status).toBe(200);
      expect(tx.playlistTrack.updateMany).toHaveBeenCalledWith({
        where: { playlistId: PLAYLIST_ID },
        data: { position: { increment: 4 } },
      });
      const incrementArg = tx.playlistTrack.updateMany.mock.calls[0][0].data.position.increment;
      expect(incrementArg).toBeGreaterThan(0);

      expect(tx.playlistTrack.update).toHaveBeenNthCalledWith(1, {
        where: { id: TRACK_ID_3 },
        data: { position: 0 },
      });
      expect(tx.playlistTrack.update).toHaveBeenNthCalledWith(2, {
        where: { id: TRACK_ID_1 },
        data: { position: 1 },
      });
      expect(tx.playlistTrack.update).toHaveBeenNthCalledWith(3, {
        where: { id: TRACK_ID_2 },
        data: { position: 2 },
      });
      expect(await res.json()).toEqual({
        ok: true,
        version: 6,
        trackIds: [TRACK_ID_3, TRACK_ID_1, TRACK_ID_2],
      });
    });

    it("returns 409 TRACK_SET_MISMATCH and 409 VERSION_CONFLICT on reorder mismatches without writing positions", async () => {
      tx.playlist.updateMany.mockResolvedValueOnce({ count: 1 });
      tx.playlist.findFirst.mockResolvedValueOnce({ version: 3 });
      tx.playlistTrack.findMany.mockResolvedValueOnce([
        { id: TRACK_ID_1, position: 0 },
        { id: TRACK_ID_2, position: 1 },
      ]);

      const mismatchRes = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
          trackIds: [TRACK_ID_1, TRACK_ID_3],
          expectedVersion: 2,
        }),
        playlistContext(),
      );
      expect(mismatchRes.status).toBe(409);
      expect(await mismatchRes.json()).toMatchObject({ code: "TRACK_SET_MISMATCH" });
      expect(tx.playlistTrack.updateMany).not.toHaveBeenCalled();
      expect(tx.playlistTrack.update).not.toHaveBeenCalled();

      tx.playlist.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.playlist.findFirst.mockResolvedValueOnce({ id: PLAYLIST_ID, version: 4 });

      const staleVersionRes = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks/reorder`, "PUT", {
          trackIds: [TRACK_ID_2, TRACK_ID_1],
          expectedVersion: 2,
        }),
        playlistContext(),
      );
      expect(staleVersionRes.status).toBe(409);
      expect(await staleVersionRes.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    });
  });

  describe("503 sanitization and unstable_rethrow", () => {
    it("returns 503 without leaking database connection secrets on unexpected errors", async () => {
      db.playlist.create.mockRejectedValueOnce(
        new Error("postgres://super:secret_pw@db.internal:5432/graphu"),
      );
      const mutationRes = await createPlaylist(
        jsonRequest("http://localhost/api/me/playlists", "POST", { name: "Test" }),
      );
      expect(mutationRes.status).toBe(503);
      expect(mutationRes.headers.get("cache-control")).toBe("private, no-store");
      expect(await mutationRes.text()).not.toContain("secret_pw");

      db.playlist.findFirst.mockRejectedValueOnce(
        new Error("password=ultra_secret_db_cred"),
      );
      const queryRes = await getPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "GET"),
        playlistContext(),
      );
      expect(queryRes.status).toBe(503);
      expect(queryRes.headers.get("cache-control")).toBe("private, no-store");
      expect(await queryRes.text()).not.toContain("ultra_secret_db_cred");
    });

    it("rethrows Next.js NEXT_REDIRECT signals via unstable_rethrow", async () => {
      const redirectSignal = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });

      getCurrentUserProfile.mockRejectedValueOnce(redirectSignal);
      await expect(
        createPlaylist(jsonRequest("http://localhost/api/me/playlists", "POST", { name: "Test" })),
      ).rejects.toBe(redirectSignal);

      getCurrentUserProfile.mockRejectedValueOnce(redirectSignal);
      await expect(
        getPlaylistTracks(
          jsonRequest(`http://localhost/api/me/playlists/${PLAYLIST_ID}/tracks`, "GET"),
          playlistContext(),
        ),
      ).rejects.toBe(redirectSignal);
    });
  });
});
