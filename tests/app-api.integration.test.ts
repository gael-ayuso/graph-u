import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GET as getPlaylist } from "@/app/api/me/playlists/[playlistId]/route";
import { GET as getPlaylistTracks } from "@/app/api/me/playlists/[playlistId]/tracks/route";
import { GET as getPlaylists } from "@/app/api/me/playlists/route";
import { GET as getRecommendation } from "@/app/api/me/recommendations/[requestId]/route";
import { GET as getRecommendationEvaluations } from "@/app/api/me/recommendations/[requestId]/evaluations/route";
import { GET as getRecommendationEvents } from "@/app/api/me/recommendations/[requestId]/events/route";
import { GET as getRecommendationFeedback } from "@/app/api/me/recommendations/[requestId]/feedback/route";
import { GET as getRecommendationResults } from "@/app/api/me/recommendations/[requestId]/results/route";
import { GET as getRecommendationSeeds } from "@/app/api/me/recommendations/[requestId]/seeds/route";
import { GET as getRecommendations } from "@/app/api/me/recommendations/route";
import { getDb } from "@/lib/db";

const { getCurrentUserProfile } = vi.hoisted(() => ({ getCurrentUserProfile: vi.fn() }));
vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const fixtures = {
  aliceId: randomUUID(),
  bobId: randomUUID(),
  aliceClerkId: `integration-alice-${randomUUID()}`,
  bobClerkId: `integration-bob-${randomUUID()}`,
  modelId: randomUUID(),
  alicePlaylistId: randomUUID(),
  bobPlaylistId: randomUUID(),
  aliceTrackId: randomUUID(),
  bobTrackId: randomUUID(),
  aliceRequestId: randomUUID(),
  bobRequestId: randomUUID(),
  aliceSeedId: randomUUID(),
  bobSeedId: randomUUID(),
  aliceResultId: randomUUID(),
  bobResultId: randomUUID(),
  aliceEventId: randomUUID(),
  bobEventId: randomUUID(),
  aliceFeedbackId: randomUUID(),
  bobFeedbackId: randomUUID(),
  aliceEvaluationId: randomUUID(),
  bobEvaluationId: randomUUID(),
};

const request = (path: string) => new Request(`http://localhost${path}`);
const playlistContext = (playlistId: string) => ({ params: Promise.resolve({ playlistId }) });
const recommendationContext = (requestId: string) => ({ params: Promise.resolve({ requestId }) });

describe.skipIf(!testDatabaseUrl)("application GET routes against the opt-in test database", () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(async () => {
    // Never fall back to DATABASE_URL: this suite is enabled only by TEST_DATABASE_URL.
    vi.stubEnv("DATABASE_URL", testDatabaseUrl!);
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl);
    db = getDb();

    const now = new Date();
    await db.user.createMany({ data: [
      { id: fixtures.aliceId, clerkId: fixtures.aliceClerkId, clerkUpdatedAt: now, updatedAt: now },
      { id: fixtures.bobId, clerkId: fixtures.bobClerkId, clerkUpdatedAt: now, updatedAt: now },
    ] });
    await db.recommendationModel.create({
      data: { id: fixtures.modelId, name: `route-tests-${fixtures.modelId}`, version: "1" },
    });
    await db.playlist.createMany({ data: [
      { id: fixtures.alicePlaylistId, userId: fixtures.aliceId, name: "Alice playlist", updatedAt: now },
      { id: fixtures.bobPlaylistId, userId: fixtures.bobId, name: "Bob playlist", updatedAt: now },
    ] });
    await db.playlistTrack.createMany({ data: [
      { id: fixtures.aliceTrackId, playlistId: fixtures.alicePlaylistId, recordingId: randomUUID(), position: 0 },
      { id: fixtures.bobTrackId, playlistId: fixtures.bobPlaylistId, recordingId: randomUUID(), position: 0 },
    ] });
    await db.recommendationRequest.createMany({ data: [
      { id: fixtures.aliceRequestId, userId: fixtures.aliceId, modelId: fixtures.modelId },
      { id: fixtures.bobRequestId, userId: fixtures.bobId, modelId: fixtures.modelId },
    ] });
    await db.recommendationSeed.createMany({ data: [
      { requestId: fixtures.aliceRequestId, recordingId: fixtures.aliceSeedId, position: 0 },
      { requestId: fixtures.bobRequestId, recordingId: fixtures.bobSeedId, position: 0 },
    ] });
    await db.recommendationResult.createMany({ data: [
      { id: fixtures.aliceResultId, requestId: fixtures.aliceRequestId, recordingId: randomUUID(), rank: 1, score: 0.8 },
      { id: fixtures.bobResultId, requestId: fixtures.bobRequestId, recordingId: randomUUID(), rank: 1, score: 0.7 },
    ] });
    await db.recommendationEvent.createMany({ data: [
      { id: fixtures.aliceEventId, userId: fixtures.aliceId, requestId: fixtures.aliceRequestId, resultId: fixtures.aliceResultId, type: "view" },
      { id: fixtures.bobEventId, userId: fixtures.bobId, requestId: fixtures.bobRequestId, resultId: fixtures.bobResultId, type: "view" },
    ] });
    await db.userFeedback.createMany({ data: [
      { id: fixtures.aliceFeedbackId, userId: fixtures.aliceId, requestId: fixtures.aliceRequestId, resultId: fixtures.aliceResultId, value: "LIKE", updatedAt: now },
      { id: fixtures.bobFeedbackId, userId: fixtures.bobId, requestId: fixtures.bobRequestId, resultId: fixtures.bobResultId, value: "DISLIKE", updatedAt: now },
    ] });
    await db.recommendationEvaluation.createMany({ data: [
      { id: fixtures.aliceEvaluationId, requestId: fixtures.aliceRequestId, metrics: { owner: "alice" } },
      { id: fixtures.bobEvaluationId, requestId: fixtures.bobRequestId, metrics: { owner: "bob" } },
    ] });
  });

  afterAll(async () => {
    if (!db) return;
    // Deleting only the unique fixture users cascades through their request and playlist rows.
    await db.user.deleteMany({ where: { id: { in: [fixtures.aliceId, fixtures.bobId] } } });
    await db.recommendationModel.deleteMany({ where: { id: fixtures.modelId } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("returns only the signed-in owner's playlists, tracks, and recommendation history", async () => {
    getCurrentUserProfile.mockResolvedValue({ id: fixtures.aliceId });

    const playlistsResponse = await getPlaylists(request("/api/me/playlists?userId=" + fixtures.bobId));
    const playlists = await playlistsResponse.json();
    expect(playlists.items.map((item: { id: string }) => item.id)).toEqual([fixtures.alicePlaylistId]);

    const ownTracksResponse = await getPlaylistTracks(
      request(`/api/me/playlists/${fixtures.alicePlaylistId}/tracks`),
      playlistContext(fixtures.alicePlaylistId),
    );
    const ownTracks = await ownTracksResponse.json();
    expect(ownTracks.items.map((item: { id: string }) => item.id)).toEqual([fixtures.aliceTrackId]);
    expect((await getPlaylist(request(`/api/me/playlists/${fixtures.bobPlaylistId}`), playlistContext(fixtures.bobPlaylistId))).status).toBe(404);
    expect((await getPlaylistTracks(
      request(`/api/me/playlists/${fixtures.bobPlaylistId}/tracks`),
      playlistContext(fixtures.bobPlaylistId),
    )).status).toBe(404);

    const recommendationsResponse = await getRecommendations(request("/api/me/recommendations?userId=" + fixtures.bobId));
    const recommendations = await recommendationsResponse.json();
    expect(recommendations.items.map((item: { id: string }) => item.id)).toEqual([fixtures.aliceRequestId]);
    expect((await getRecommendation(
      request(`/api/me/recommendations/${fixtures.aliceRequestId}`),
      recommendationContext(fixtures.aliceRequestId),
    )).status).toBe(200);
    expect((await getRecommendation(
      request(`/api/me/recommendations/${fixtures.bobRequestId}`),
      recommendationContext(fixtures.bobRequestId),
    )).status).toBe(404);
  });

  it.each([
    { segment: "seeds", get: getRecommendationSeeds, itemId: fixtures.aliceSeedId },
    { segment: "results", get: getRecommendationResults, itemId: fixtures.aliceResultId },
    { segment: "events", get: getRecommendationEvents, itemId: fixtures.aliceEventId },
    { segment: "feedback", get: getRecommendationFeedback, itemId: fixtures.aliceFeedbackId },
    { segment: "evaluations", get: getRecommendationEvaluations, itemId: fixtures.aliceEvaluationId },
  ])("scopes $segment to the owning recommendation and returns 404 for another user's request", async ({ segment, get, itemId }) => {
    getCurrentUserProfile.mockResolvedValue({ id: fixtures.aliceId });

    const ownResponse = await get(
      request(`/api/me/recommendations/${fixtures.aliceRequestId}/${segment}`),
      recommendationContext(fixtures.aliceRequestId),
    );
    const ownBody = await ownResponse.json();
    expect(ownResponse.status).toBe(200);
    expect(ownBody.items.map((item: { id: string; recordingId?: string }) => item.id ?? item.recordingId)).toContain(itemId);

    const foreignResponse = await get(
      request(`/api/me/recommendations/${fixtures.bobRequestId}/${segment}`),
      recommendationContext(fixtures.bobRequestId),
    );
    expect(foreignResponse.status).toBe(404);
  });
});
