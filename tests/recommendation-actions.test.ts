import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteFavoriteRecording } from "@/app/api/me/favorites/recordings/route";
import { PUT as putRecommendationFeedback } from "@/app/api/me/recommendations/[requestId]/feedback/route";
import { PUT as putRecommendationSaved } from "@/app/api/me/recommendations/[requestId]/saved/route";
import { GET as getSavedRecommendations } from "@/app/api/me/saved-recommendations/route";
import type { RecommendationResponse, Song } from "@/lib/musicbrainz-types";
import {
  recordRecommendations,
  removeSavedRecording,
  savedRecommendations,
  setRecommendationFeedback,
  setSavedRecommendation,
} from "@/lib/recommendation-actions";

const { getCurrentUserProfile, getDb, db, tx } = vi.hoisted(() => {
  const txMock = {
    userFeedback: { upsert: vi.fn(), deleteMany: vi.fn() },
    userFavoriteRecording: { upsert: vi.fn(), deleteMany: vi.fn() },
    recommendationEvent: { create: vi.fn() },
  };
  return {
    getCurrentUserProfile: vi.fn(),
    getDb: vi.fn(),
    tx: txMock,
    db: {
      recommendationModel: { upsert: vi.fn() },
      recommendationRequest: { create: vi.fn() },
      recommendationResult: { findFirst: vi.fn(), findMany: vi.fn() },
      userFavoriteRecording: { findMany: vi.fn(), deleteMany: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/db", () => ({ getDb }));

const ownerId = "authenticated-user";
const requestId = "7a34b18f-49d8-47b9-99ef-c06648bd0011";
const resultId = "7a34b18f-49d8-47b9-99ef-c06648bd0022";
const resultId2 = "7a34b18f-49d8-47b9-99ef-c06648bd0033";
const recordingId = "7a34b18f-49d8-47b9-99ef-c06648bd0044";
const recordingId2 = "7a34b18f-49d8-47b9-99ef-c06648bd0055";
const seedId1 = "7a34b18f-49d8-47b9-99ef-c06648bd0066";
const seedId2 = "7a34b18f-49d8-47b9-99ef-c06648bd0077";
const artistId1 = "7a34b18f-49d8-47b9-99ef-c06648bd0088";
const artistId2 = "7a34b18f-49d8-47b9-99ef-c06648bd0099";

const context = (id = requestId) => ({ params: Promise.resolve({ requestId: id }) });

function jsonRequest(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function rawRequest(path: string, method: string, rawBody: string) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

const song1: Song = {
  id: recordingId,
  title: "Track One",
  artist: "Artist One",
  release: "Album One",
  duration: 215000,
  comment: "live",
};

const song2: Song = {
  id: recordingId2,
  title: "Track Two",
  artist: "Artist Two",
  release: null,
  duration: null,
  comment: null,
};

describe("recommendation-actions and public mutation/query routes", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({ id: ownerId });
    getDb.mockReturnValue(db);

    db.recommendationModel.upsert.mockResolvedValue({ id: "model-1", name: "hybrid-tags-lastfm", version: "1" });
    db.recommendationRequest.create.mockResolvedValue({ id: requestId, results: [] });
    db.recommendationResult.findFirst.mockResolvedValue(null);
    db.recommendationResult.findMany.mockResolvedValue([]);
    db.userFavoriteRecording.findMany.mockResolvedValue([]);
    db.userFavoriteRecording.deleteMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    tx.userFeedback.upsert.mockResolvedValue({ id: "fb-1" });
    tx.userFeedback.deleteMany.mockResolvedValue({ count: 1 });
    tx.userFavoriteRecording.upsert.mockResolvedValue({ id: "fav-1" });
    tx.userFavoriteRecording.deleteMany.mockResolvedValue({ count: 1 });
    tx.recommendationEvent.create.mockResolvedValue({ id: "evt-1" });

    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("exports the recommendation actions directly on the public route handlers", () => {
    expect(putRecommendationFeedback).toBe(setRecommendationFeedback);
    expect(putRecommendationSaved).toBe(setSavedRecommendation);
    expect(deleteFavoriteRecording).toBe(removeSavedRecording);
    expect(getSavedRecommendations).toBe(savedRecommendations);
  });

  it.each([
    {
      label: "PUT feedback",
      call: () =>
        putRecommendationFeedback(
          jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: "LIKE" }),
          context(),
        ),
    },
    {
      label: "PUT saved",
      call: () =>
        putRecommendationSaved(
          jsonRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", { resultId, saved: true }),
          context(),
        ),
    },
    {
      label: "DELETE favorites/recordings",
      call: () =>
        deleteFavoriteRecording(
          jsonRequest("/api/me/favorites/recordings", "DELETE", { recordingId }),
        ),
    },
    {
      label: "GET saved-recommendations",
      call: () =>
        getSavedRecommendations(new Request("http://localhost/api/me/saved-recommendations")),
    },
  ])("returns 401 without accessing the database for $label", async ({ call }) => {
    getCurrentUserProfile.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "No autorizado." });
    expect(getDb).not.toHaveBeenCalled();
  });

  describe("input validation", () => {
    it.each(["{not-json", "null", '"text"', "123", "[]"])(
      "rejects invalid JSON body (%s) across write routes before touching the DB",
      async (rawBody) => {
        const responses = await Promise.all([
          putRecommendationFeedback(rawRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", rawBody), context()),
          putRecommendationSaved(rawRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", rawBody), context()),
          deleteFavoriteRecording(rawRequest("/api/me/favorites/recordings", "DELETE", rawBody)),
        ]);

        for (const response of responses) {
          expect(response.status).toBe(400);
          expect(response.headers.get("cache-control")).toBe("private, no-store");
          expect(await response.json()).toEqual({ error: "Solicitud no válida." });
        }
        expect(db.recommendationResult.findFirst).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.userFavoriteRecording.deleteMany).not.toHaveBeenCalled();
      },
    );

    it("validates requestId, resultId, and recordingId UUIDs and normalizes uppercase UUIDs", async () => {
      const badRequestIdFeedback = await putRecommendationFeedback(
        jsonRequest("/api/me/recommendations/bad-id/feedback", "PUT", { resultId, value: "LIKE" }),
        context("bad-id"),
      );
      expect(badRequestIdFeedback.status).toBe(400);

      const badRequestIdSaved = await putRecommendationSaved(
        jsonRequest("/api/me/recommendations/bad-id/saved", "PUT", { resultId, saved: true }),
        context("bad-id"),
      );
      expect(badRequestIdSaved.status).toBe(400);

      for (const badResultId of ["bad-uuid", 123, null, undefined, ""]) {
        const fbRes = await putRecommendationFeedback(
          jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId: badResultId, value: "LIKE" }),
          context(),
        );
        expect(fbRes.status).toBe(400);

        const savedRes = await putRecommendationSaved(
          jsonRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", { resultId: badResultId, saved: true }),
          context(),
        );
        expect(savedRes.status).toBe(400);
      }

      for (const badRecordingId of ["bad-uuid", 42, null, undefined, ""]) {
        const delRes = await deleteFavoriteRecording(
          jsonRequest("/api/me/favorites/recordings", "DELETE", { recordingId: badRecordingId }),
        );
        expect(delRes.status).toBe(400);
      }

      expect(db.recommendationResult.findFirst).not.toHaveBeenCalled();
      expect(db.userFavoriteRecording.deleteMany).not.toHaveBeenCalled();

      // Uppercase UUIDs should normalize to lowercase when querying
      db.recommendationResult.findFirst.mockResolvedValueOnce({ id: resultId });
      const normalized = await putRecommendationFeedback(
        jsonRequest(`/api/me/recommendations/${requestId.toUpperCase()}/feedback`, "PUT", {
          resultId: resultId.toUpperCase(),
          value: "LIKE",
        }),
        context(requestId.toUpperCase()),
      );
      expect(normalized.status).toBe(200);
      expect(db.recommendationResult.findFirst).toHaveBeenCalledWith({
        where: { id: resultId, requestId, request: { userId: ownerId } },
        select: { id: true },
      });
    });

    it.each(["LOVE", "like", "", 1, true, undefined, {}])(
      "rejects invalid feedback value (%j)",
      async (badValue) => {
        const response = await putRecommendationFeedback(
          jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: badValue }),
          context(),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Elige Me gusta o No me interesa." });
        expect(db.recommendationResult.findFirst).not.toHaveBeenCalled();
      },
    );

    it.each(["true", "false", 1, 0, null, undefined, {}])(
      "rejects non-boolean saved flag (%j)",
      async (badSaved) => {
        const response = await putRecommendationSaved(
          jsonRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", { resultId, saved: badSaved }),
          context(),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Indica si quieres guardar la canción." });
        expect(db.recommendationResult.findFirst).not.toHaveBeenCalled();
      },
    );
  });

  describe("404 ownership checks for foreign or missing results", () => {
    it("returns 404 without running a transaction when feedback targets a foreign or missing result", async () => {
      db.recommendationResult.findFirst.mockResolvedValueOnce(null);

      const response = await putRecommendationFeedback(
        jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: "LIKE" }),
        context(),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Recurso no encontrado." });
      expect(db.recommendationResult.findFirst).toHaveBeenCalledWith({
        where: { id: resultId, requestId, request: { userId: ownerId } },
        select: { id: true },
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("returns 404 without running a transaction when saved targets a foreign or missing result", async () => {
      db.recommendationResult.findFirst.mockResolvedValueOnce(null);

      const response = await putRecommendationSaved(
        jsonRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", { resultId, saved: true }),
        context(),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Recurso no encontrado." });
      expect(db.recommendationResult.findFirst).toHaveBeenCalledWith({
        where: { id: resultId, requestId, request: { userId: ownerId } },
        select: { recordingId: true },
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/me/recommendations/[requestId]/feedback", () => {
    it("upserts LIKE, changes to DISLIKE, removes on null, and records FEEDBACK events in a transaction", async () => {
      db.recommendationResult.findFirst.mockResolvedValue({ id: resultId });

      // 1) Create / upsert LIKE
      const likeRes = await putRecommendationFeedback(
        jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: "LIKE" }),
        context(),
      );
      expect(likeRes.status).toBe(200);
      expect(likeRes.headers.get("cache-control")).toBe("private, no-store");
      expect(await likeRes.json()).toEqual({ value: "LIKE" });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.userFeedback.upsert).toHaveBeenNthCalledWith(1, {
        where: { userId_resultId: { userId: ownerId, resultId } },
        create: { userId: ownerId, requestId, resultId, value: "LIKE" },
        update: { value: "LIKE" },
      });
      expect(tx.recommendationEvent.create).toHaveBeenNthCalledWith(1, {
        data: { userId: ownerId, requestId, resultId, type: "FEEDBACK", metadata: { value: "LIKE" } },
      });

      // 2) Switch to DISLIKE via upsert
      const dislikeRes = await putRecommendationFeedback(
        jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: "DISLIKE" }),
        context(),
      );
      expect(dislikeRes.status).toBe(200);
      expect(await dislikeRes.json()).toEqual({ value: "DISLIKE" });
      expect(db.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.userFeedback.upsert).toHaveBeenNthCalledWith(2, {
        where: { userId_resultId: { userId: ownerId, resultId } },
        create: { userId: ownerId, requestId, resultId, value: "DISLIKE" },
        update: { value: "DISLIKE" },
      });
      expect(tx.recommendationEvent.create).toHaveBeenNthCalledWith(2, {
        data: { userId: ownerId, requestId, resultId, type: "FEEDBACK", metadata: { value: "DISLIKE" } },
      });

      // 3) Clear feedback with value: null
      const clearRes = await putRecommendationFeedback(
        jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: null }),
        context(),
      );
      expect(clearRes.status).toBe(200);
      expect(await clearRes.json()).toEqual({ value: null });
      expect(db.$transaction).toHaveBeenCalledTimes(3);
      expect(tx.userFeedback.upsert).toHaveBeenCalledTimes(2);
      expect(tx.userFeedback.deleteMany).toHaveBeenCalledWith({
        where: { userId: ownerId, resultId, requestId },
      });
      expect(tx.recommendationEvent.create).toHaveBeenNthCalledWith(3, {
        data: { userId: ownerId, requestId, resultId, type: "FEEDBACK", metadata: { value: null } },
      });
    });

    it("propagates transaction failures through readApp as 503 without leaking internal details", async () => {
      db.recommendationResult.findFirst.mockResolvedValueOnce({ id: resultId });
      tx.recommendationEvent.create.mockRejectedValueOnce(new Error("tx failed: constraint xyz"));

      const response = await putRecommendationFeedback(
        jsonRequest(`/api/me/recommendations/${requestId}/feedback`, "PUT", { resultId, value: "LIKE" }),
        context(),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain("constraint xyz");
    });
  });

  describe("PUT /api/me/recommendations/[requestId]/saved and DELETE /api/me/favorites/recordings", () => {
    it("upserts favorite recording without duplicating on repeated saves, removes on false, and logs SAVE/UNSAVE events in a transaction", async () => {
      db.recommendationResult.findFirst.mockResolvedValue({ recordingId });

      // Repeated saved: true calls use idempotent upsert with empty update
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const saveRes = await putRecommendationSaved(
          jsonRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", { resultId, saved: true }),
          context(),
        );
        expect(saveRes.status).toBe(200);
        expect(saveRes.headers.get("cache-control")).toBe("private, no-store");
        expect(await saveRes.json()).toEqual({ saved: true });
        expect(tx.userFavoriteRecording.upsert).toHaveBeenNthCalledWith(attempt, {
          where: { userId_recordingId: { userId: ownerId, recordingId } },
          create: { userId: ownerId, recordingId },
          update: {},
        });
        expect(tx.recommendationEvent.create).toHaveBeenNthCalledWith(attempt, {
          data: { userId: ownerId, requestId, resultId, type: "SAVE" },
        });
      }

      // Remove with saved: false
      const unsaveRes = await putRecommendationSaved(
        jsonRequest(`/api/me/recommendations/${requestId}/saved`, "PUT", { resultId, saved: false }),
        context(),
      );
      expect(unsaveRes.status).toBe(200);
      expect(await unsaveRes.json()).toEqual({ saved: false });
      expect(db.$transaction).toHaveBeenCalledTimes(3);
      expect(tx.userFavoriteRecording.deleteMany).toHaveBeenCalledWith({
        where: { userId: ownerId, recordingId },
      });
      expect(tx.recommendationEvent.create).toHaveBeenNthCalledWith(3, {
        data: { userId: ownerId, requestId, resultId, type: "UNSAVE" },
      });
    });

    it("deletes a saved recording scoped to the authenticated user on DELETE /api/me/favorites/recordings", async () => {
      const response = await deleteFavoriteRecording(
        jsonRequest("/api/me/favorites/recordings", "DELETE", { recordingId: recordingId.toUpperCase() }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ saved: false });
      expect(db.userFavoriteRecording.deleteMany).toHaveBeenCalledWith({
        where: { userId: ownerId, recordingId },
      });
    });
  });

  describe("recordRecommendations", () => {
    it("persists nested deduplicated seeds, ranked results with song metadata, GENERATED event with user.connect, and attaches resultId", async () => {
      const data: RecommendationResponse = {
        seedTags: ["indie", "shoegaze"],
        recommendations: [
          {
            song: song1,
            score: 0.92,
            sharedTags: ["indie"],
            signals: ["songs", "listeners"],
            artistId: artistId1,
            seedIds: [seedId1],
            reasons: [{ seedId: seedId1, score: 0.92, sharedTags: ["indie"], signals: ["songs"] }],
          },
          {
            song: song2,
            score: 0.74,
            sharedTags: ["shoegaze"],
            signals: ["collab"],
            artistId: artistId2,
            seedIds: [seedId2],
            reasons: [{ seedId: seedId2, score: 0.74, sharedTags: ["shoegaze"], signals: ["collab"] }],
          },
        ],
        seedResults: [
          {
            seedId: seedId1,
            title: "Seed One",
            artist: "Seed Artist",
            status: "recommended",
            message: "ok",
            recommendationIds: [recordingId],
          },
        ],
        graph: { nodes: [], edges: [] },
      };

      db.recommendationModel.upsert.mockResolvedValueOnce({ id: "model-hybrid-1" });
      // Return results in reverse order to verify matching by recordingId
      db.recommendationRequest.create.mockResolvedValueOnce({
        id: requestId,
        results: [
          { id: resultId2, recordingId: recordingId2 },
          { id: resultId, recordingId },
        ],
      });

      const recorded = await recordRecommendations(
        ownerId,
        [seedId1, seedId2, seedId1],
        ["Excluded Artist"],
        data,
      );

      expect(db.recommendationModel.upsert).toHaveBeenCalledWith({
        where: { name_version: { name: "hybrid-tags-lastfm", version: "1" } },
        create: { name: "hybrid-tags-lastfm", version: "1" },
        update: {},
      });

      expect(db.recommendationRequest.create).toHaveBeenCalledWith({
        data: {
          userId: ownerId,
          modelId: "model-hybrid-1",
          status: "COMPLETED",
          completedAt: expect.any(Date),
          parameters: { excludeArtists: ["Excluded Artist"] },
          seeds: {
            create: [
              { recordingId: seedId1, position: 0 },
              { recordingId: seedId2, position: 1 },
            ],
          },
          results: {
            create: [
              {
                recordingId,
                rank: 1,
                score: 0.92,
                explanation: expect.objectContaining({ song: song1, score: 0.92, artistId: artistId1 }),
              },
              {
                recordingId: recordingId2,
                rank: 2,
                score: 0.74,
                explanation: expect.objectContaining({ song: song2, score: 0.74, artistId: artistId2 }),
              },
            ],
          },
          events: {
            create: {
              user: { connect: { id: ownerId } },
              type: "GENERATED",
              metadata: { count: 2 },
            },
          },
        },
        include: { results: { select: { id: true, recordingId: true } } },
      });

      expect(recorded).toEqual({
        ...data,
        requestId,
        recommendations: [
          { ...data.recommendations[0], resultId },
          { ...data.recommendations[1], resultId: resultId2 },
        ],
      });
    });

    it("stores limit, excludeRecordings, and excludeVersions in parameters without adding exploration/batch fields and preserves seedResults metadata", async () => {
      const data: RecommendationResponse = {
        seedTags: ["dream pop"],
        recommendations: [
          {
            song: song1,
            score: 0.88,
            sharedTags: ["dream pop"],
            signals: ["songs"],
            artistId: artistId1,
            seedIds: [seedId1],
            reasons: [{ seedId: seedId1, score: 0.88, sharedTags: ["dream pop"], signals: ["songs"] }],
          },
        ],
        seedResults: [
          {
            seedId: seedId1,
            title: "Seed One",
            artist: "Seed Artist",
            status: "recommended",
            message: "1 recomendación a partir de esta canción.",
            recommendationIds: [recordingId],
            artistId: artistId2,
            searchLimited: true,
          },
        ],
        graph: { nodes: [], edges: [] },
      };

      db.recommendationModel.upsert.mockResolvedValueOnce({ id: "model-hybrid-1" });
      db.recommendationRequest.create.mockResolvedValueOnce({
        id: requestId,
        results: [{ id: resultId, recordingId }],
      });

      const recorded = await recordRecommendations(
        ownerId,
        [seedId1],
        [artistId2],
        data,
        {
          limit: 15,
          excludeRecordings: [recordingId2],
          excludeVersions: [{ artistId: artistId1, title: "Track Two" }],
        },
      );

      expect(db.recommendationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parameters: {
              excludeArtists: [artistId2],
              limit: 15,
              excludeRecordings: [recordingId2],
              excludeVersions: [{ artistId: artistId1, title: "Track Two" }],
            },
          }),
        }),
      );
      const createCall = db.recommendationRequest.create.mock.calls[0][0];
      expect(Object.keys(createCall.data.parameters).sort()).toEqual([
        "excludeArtists",
        "excludeRecordings",
        "excludeVersions",
        "limit",
      ]);
      expect(recorded.seedResults).toEqual(data.seedResults);
      expect(recorded.recommendations[0].resultId).toBe(resultId);
    });

    it("stores effective default options in parameters when passed and records count 0 for empty recommendations", async () => {
      const data: RecommendationResponse = {
        seedTags: [],
        recommendations: [],
        seedResults: [
          {
            seedId: seedId1,
            title: "Seed One",
            artist: "Seed Artist",
            status: "search_limit",
            message: "Límite alcanzado",
            recommendationIds: [],
            artistId: null,
            searchLimited: true,
          },
        ],
        graph: { nodes: [], edges: [] },
      };

      db.recommendationModel.upsert.mockResolvedValueOnce({ id: "model-hybrid-1" });
      db.recommendationRequest.create.mockResolvedValueOnce({
        id: requestId,
        results: [],
      });

      const recorded = await recordRecommendations(
        ownerId,
        [seedId1],
        [],
        data,
        { limit: 10, excludeRecordings: [], excludeVersions: [] },
      );

      expect(db.recommendationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parameters: {
              excludeArtists: [],
              limit: 10,
              excludeRecordings: [],
              excludeVersions: [],
            },
            events: {
              create: {
                user: { connect: { id: ownerId } },
                type: "GENERATED",
                metadata: { count: 0 },
              },
            },
          }),
        }),
      );
      expect(recorded).toEqual({
        ...data,
        requestId,
        recommendations: [],
      });
    });
  });

  describe("GET /api/me/saved-recommendations", () => {
    it("recovers saved song metadata filtered by owner, preserving favorite order and skipping invalid or unowned entries", async () => {
      const missingSongRecId = "7a34b18f-49d8-47b9-99ef-c06648bd00aa";
      const malformedRecId = "7a34b18f-49d8-47b9-99ef-c06648bd00bb";

      db.userFavoriteRecording.findMany.mockResolvedValueOnce([
        { recordingId: recordingId2 },
        { recordingId: missingSongRecId },
        { recordingId: malformedRecId },
        { recordingId },
      ]);

      db.recommendationResult.findMany.mockResolvedValueOnce([
        { recordingId, explanation: { song: song1 } },
        { recordingId: recordingId2, explanation: { song: song2 } },
        { recordingId: malformedRecId, explanation: ["not-an-object"] },
      ]);

      const response = await getSavedRecommendations(
        new Request("http://localhost/api/me/saved-recommendations?userId=other-user"),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(db.userFavoriteRecording.findMany).toHaveBeenCalledWith({
        where: { userId: ownerId },
        orderBy: { createdAt: "desc" },
      });
      expect(db.recommendationResult.findMany).toHaveBeenCalledWith({
        where: {
          recordingId: { in: [recordingId2, missingSongRecId, malformedRecId, recordingId] },
          request: { userId: ownerId },
        },
        orderBy: { createdAt: "desc" },
        distinct: ["recordingId"],
        select: { recordingId: true, explanation: true },
      });
      expect(await response.json()).toEqual({
        songs: [song2, song1],
      });
    });

    it("returns an empty songs list when the user has no saved recordings", async () => {
      db.userFavoriteRecording.findMany.mockResolvedValueOnce([]);
      db.recommendationResult.findMany.mockResolvedValueOnce([]);

      const response = await getSavedRecommendations(
        new Request("http://localhost/api/me/saved-recommendations"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ songs: [] });
    });
  });
});
