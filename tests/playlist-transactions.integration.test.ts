import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { getDb } from "@/lib/db";

const { getCurrentUserProfile, resolveRecordingByMbid } = vi.hoisted(() => ({
  getCurrentUserProfile: vi.fn(),
  resolveRecordingByMbid: vi.fn(),
}));

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/music-library/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/music-library/catalog")>(
    "@/lib/music-library/catalog",
  );
  return {
    ...actual,
    resolveRecordingByMbid,
  };
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const userId = randomUUID();
const clerkId = `playlist-tx-${randomUUID()}`;

const recordings = [
  {
    recordingMbid: randomUUID(),
    title: "Track Alpha",
    artistName: "Artist One",
    artistMbid: null,
    durationMs: 210000,
    comment: null,
  },
  {
    recordingMbid: randomUUID(),
    title: "Track Beta",
    artistName: "Artist Two",
    artistMbid: null,
    durationMs: 225000,
    comment: null,
  },
  {
    recordingMbid: randomUUID(),
    title: "Track Gamma",
    artistName: "Artist Three",
    artistMbid: null,
    durationMs: 240000,
    comment: null,
  },
];

const playlistContext = (playlistId: string) => ({
  params: Promise.resolve({ playlistId }),
});

const trackContext = (playlistId: string, trackId: string) => ({
  params: Promise.resolve({ playlistId, trackId }),
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

describe.skipIf(!testDatabaseUrl)(
  "playlist transactions against the opt-in test database",
  () => {
    let db: ReturnType<typeof getDb>;

    beforeAll(async () => {
      // Never fall back to DATABASE_URL: this suite is enabled only by TEST_DATABASE_URL.
      vi.stubEnv("DATABASE_URL", testDatabaseUrl!);
      expect(process.env.DATABASE_URL).toBe(testDatabaseUrl);
      db = getDb();

      const now = new Date();
      await db.user.create({
        data: {
          id: userId,
          clerkId,
          clerkUpdatedAt: now,
          updatedAt: now,
        },
      });

      getCurrentUserProfile.mockResolvedValue({ id: userId });
    });

    afterAll(async () => {
      if (!db) return;
      await db.user.deleteMany({ where: { id: userId } });
      await db.$disconnect();
      vi.unstubAllEnvs();
    });

    it("executes full atomic playlist lifecycle, optimistic concurrency, positive-shift reorder, and middle-track compaction", async () => {
      // 1) Create playlist
      const createRes = await createPlaylist(
        jsonRequest("http://localhost/api/me/playlists", "POST", {
          name: "PostgreSQL Transaction Mix",
          description: "Integración real",
        }),
      );
      expect(createRes.status).toBe(201);
      const createdBody = (await createRes.json()) as {
        playlist: { id: string; version: number; name: string };
      };
      const playlistId = createdBody.playlist.id;
      expect(createdBody.playlist.version).toBe(1);

      // 2) Add 3 tracks sequentially, checking version increments and cached metadata
      const addedTrackIds: string[] = [];
      let expectedVersion = 1;

      for (let i = 0; i < recordings.length; i += 1) {
        const rec = recordings[i];
        resolveRecordingByMbid.mockResolvedValueOnce(rec);

        const addRes = await addPlaylistTrack(
          jsonRequest(`http://localhost/api/me/playlists/${playlistId}/tracks`, "POST", {
            recordingId: rec.recordingMbid,
            expectedVersion,
          }),
          playlistContext(playlistId),
        );
        expect(addRes.status).toBe(201);
        const addBody = (await addRes.json()) as {
          track: { id: string; position: number; title: string; artistName: string };
          version: number;
          trackCount: number;
        };
        expectedVersion += 1;
        expect(addBody.version).toBe(expectedVersion);
        expect(addBody.trackCount).toBe(i + 1);
        expect(addBody.track.position).toBe(i);
        expect(addBody.track.title).toBe(rec.title);
        expect(addBody.track.artistName).toBe(rec.artistName);
        addedTrackIds.push(addBody.track.id);
      }
      expect(expectedVersion).toBe(4);

      // 3) Attempt duplicate track -> 409 DUPLICATE_TRACK without changing playlist version
      resolveRecordingByMbid.mockResolvedValueOnce(recordings[0]);
      const dupRes = await addPlaylistTrack(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}/tracks`, "POST", {
          recordingId: recordings[0].recordingMbid,
          expectedVersion: 4,
        }),
        playlistContext(playlistId),
      );
      expect(dupRes.status).toBe(409);
      expect(await dupRes.json()).toMatchObject({ code: "DUPLICATE_TRACK" });

      const playlistAfterDup = await db.playlist.findUniqueOrThrow({
        where: { id: playlistId },
        select: { version: true },
      });
      expect(playlistAfterDup.version).toBe(4);

      // 4) Reorder tracks atomically (satisfies CHECK (position >= 0) and @@unique([playlistId, position]))
      const reorderedIds = [addedTrackIds[2], addedTrackIds[0], addedTrackIds[1]];
      const reorderRes = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}/tracks/reorder`, "PUT", {
          trackIds: reorderedIds,
          expectedVersion: 4,
        }),
        playlistContext(playlistId),
      );
      expect(reorderRes.status).toBe(200);
      expect(await reorderRes.json()).toEqual({
        ok: true,
        version: 5,
        trackIds: reorderedIds,
      });

      const rowsAfterReorder = await db.playlistTrack.findMany({
        where: { playlistId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      expect(rowsAfterReorder).toEqual([
        { id: addedTrackIds[2], position: 0 },
        { id: addedTrackIds[0], position: 1 },
        { id: addedTrackIds[1], position: 2 },
      ]);

      // 5) Reorder with stale expectedVersion -> 409 VERSION_CONFLICT without partial write
      const staleReorderRes = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}/tracks/reorder`, "PUT", {
          trackIds: addedTrackIds,
          expectedVersion: 4,
        }),
        playlistContext(playlistId),
      );
      expect(staleReorderRes.status).toBe(409);
      expect(await staleReorderRes.json()).toMatchObject({ code: "VERSION_CONFLICT" });

      // 6) Reorder with mismatched trackIds -> 409 TRACK_SET_MISMATCH without bumping version or partial write
      const mismatchReorderRes = await reorderPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}/tracks/reorder`, "PUT", {
          trackIds: [addedTrackIds[0], addedTrackIds[1]],
          expectedVersion: 5,
        }),
        playlistContext(playlistId),
      );
      expect(mismatchReorderRes.status).toBe(409);
      expect(await mismatchReorderRes.json()).toMatchObject({ code: "TRACK_SET_MISMATCH" });

      const playlistAfterFailedReorders = await db.playlist.findUniqueOrThrow({
        where: { id: playlistId },
        select: { version: true },
      });
      expect(playlistAfterFailedReorders.version).toBe(5);

      const rowsStillUnchanged = await db.playlistTrack.findMany({
        where: { playlistId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      expect(rowsStillUnchanged).toEqual(rowsAfterReorder);

      // 7) Delete middle track (position 1 = addedTrackIds[0]) -> contiguous compaction 0,1 and version = 6
      const removeRes = await removePlaylistTrack(
        jsonRequest(
          `http://localhost/api/me/playlists/${playlistId}/tracks/${addedTrackIds[0]}`,
          "DELETE",
          { expectedVersion: 5 },
        ),
        trackContext(playlistId, addedTrackIds[0]),
      );
      expect(removeRes.status).toBe(200);
      expect(await removeRes.json()).toEqual({
        deleted: true,
        trackId: addedTrackIds[0],
        version: 6,
        remainingCount: 2,
      });

      const getTracksRes = await getPlaylistTracks(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}/tracks`, "GET"),
        playlistContext(playlistId),
      );
      expect(getTracksRes.status).toBe(200);
      const tracksBody = (await getTracksRes.json()) as {
        items: Array<{ id: string; position: number }>;
      };
      expect(tracksBody.items.map((t) => ({ id: t.id, position: t.position }))).toEqual([
        { id: addedTrackIds[2], position: 0 },
        { id: addedTrackIds[1], position: 1 },
      ]);

      // 8) PATCH with 409 conflict vs 200 success
      const patchConflict = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}`, "PATCH", {
          name: "Stale Name",
          expectedVersion: 5,
        }),
        playlistContext(playlistId),
      );
      expect(patchConflict.status).toBe(409);
      expect(await patchConflict.json()).toMatchObject({ code: "VERSION_CONFLICT" });

      const patchOk = await patchPlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}`, "PATCH", {
          name: "Renamed Mix",
          description: null,
          expectedVersion: 6,
        }),
        playlistContext(playlistId),
      );
      expect(patchOk.status).toBe(200);
      const patchBody = (await patchOk.json()) as {
        playlist: { name: string; description: string | null; version: number };
      };
      expect(patchBody.playlist).toMatchObject({
        name: "Renamed Mix",
        description: null,
        version: 7,
      });

      // 9) DELETE playlist with 409 conflict vs 200 success
      const deleteConflict = await deletePlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}`, "DELETE", {
          expectedVersion: 6,
        }),
        playlistContext(playlistId),
      );
      expect(deleteConflict.status).toBe(409);
      expect(await deleteConflict.json()).toMatchObject({ code: "VERSION_CONFLICT" });

      const deleteOk = await deletePlaylist(
        jsonRequest(`http://localhost/api/me/playlists/${playlistId}`, "DELETE", {
          expectedVersion: 7,
        }),
        playlistContext(playlistId),
      );
      expect(deleteOk.status).toBe(200);
      expect(await deleteOk.json()).toEqual({ deleted: true, id: playlistId });

      expect(
        await db.playlist.findUnique({ where: { id: playlistId } }),
      ).toBeNull();
      expect(
        await db.playlistTrack.findMany({ where: { playlistId } }),
      ).toEqual([]);
    });
  },
);
