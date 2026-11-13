import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getFavoriteArtists } from "@/app/api/me/favorites/artists/route";
import { GET as getFavoriteRecordings } from "@/app/api/me/favorites/recordings/route";
import { GET as getPlaylist } from "@/app/api/me/playlists/[playlistId]/route";
import { GET as getPlaylistTracks } from "@/app/api/me/playlists/[playlistId]/tracks/route";
import { GET as getPlaylists } from "@/app/api/me/playlists/route";
import { GET as getPreferences } from "@/app/api/me/preferences/route";
import { GET as getRecommendation } from "@/app/api/me/recommendations/[requestId]/route";
import { GET as getRecommendationEvaluations } from "@/app/api/me/recommendations/[requestId]/evaluations/route";
import { GET as getRecommendationEvents } from "@/app/api/me/recommendations/[requestId]/events/route";
import { GET as getRecommendationFeedback } from "@/app/api/me/recommendations/[requestId]/feedback/route";
import { GET as getRecommendationResults } from "@/app/api/me/recommendations/[requestId]/results/route";
import { GET as getRecommendationSeeds } from "@/app/api/me/recommendations/[requestId]/seeds/route";
import { GET as getRecommendations } from "@/app/api/me/recommendations/route";
import { GET as getRecommendationModels } from "@/app/api/recommendation-models/route";

const { getCurrentUserProfile, getDb, db } = vi.hoisted(() => {
  const delegate = () => ({ findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() });
  return {
    getCurrentUserProfile: vi.fn(),
    getDb: vi.fn(),
    db: {
      userPreferences: delegate(),
      userFavoriteRecording: delegate(),
      userFavoriteArtist: delegate(),
      playlist: delegate(),
      playlistTrack: delegate(),
      recommendationModel: delegate(),
      recommendationRequest: delegate(),
      recommendationSeed: delegate(),
      recommendationResult: delegate(),
      recommendationEvent: delegate(),
      userFeedback: delegate(),
      recommendationEvaluation: delegate(),
    },
  };
});

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/db", () => ({ getDb }));

const ownerId = "authenticated-user";
const playlistId = "7a34b18f-49d8-47b9-99ef-c06648bd0011";
const requestId = "7a34b18f-49d8-47b9-99ef-c06648bd0022";
const url = (path: string, query = "") => new Request(`http://localhost${path}${query}`);
const playlistContext = (id = playlistId) => ({ params: Promise.resolve({ playlistId: id }) });
const recommendationContext = (id = requestId) => ({ params: Promise.resolve({ requestId: id }) });

type RouteCase = { label: string; get: () => Promise<Response> };
const allRoutes: RouteCase[] = [
  { label: "preferences", get: () => getPreferences(url("/api/me/preferences")) },
  { label: "favorite recordings", get: () => getFavoriteRecordings(url("/api/me/favorites/recordings")) },
  { label: "favorite artists", get: () => getFavoriteArtists(url("/api/me/favorites/artists")) },
  { label: "playlists", get: () => getPlaylists(url("/api/me/playlists")) },
  { label: "playlist", get: () => getPlaylist(url(`/api/me/playlists/${playlistId}`), playlistContext()) },
  { label: "playlist tracks", get: () => getPlaylistTracks(url(`/api/me/playlists/${playlistId}/tracks`), playlistContext()) },
  { label: "recommendation models", get: () => getRecommendationModels(url("/api/recommendation-models")) },
  { label: "recommendations", get: () => getRecommendations(url("/api/me/recommendations")) },
  { label: "recommendation", get: () => getRecommendation(url(`/api/me/recommendations/${requestId}`), recommendationContext()) },
  { label: "recommendation seeds", get: () => getRecommendationSeeds(url(`/api/me/recommendations/${requestId}/seeds`), recommendationContext()) },
  { label: "recommendation results", get: () => getRecommendationResults(url(`/api/me/recommendations/${requestId}/results`), recommendationContext()) },
  { label: "recommendation events", get: () => getRecommendationEvents(url(`/api/me/recommendations/${requestId}/events`), recommendationContext()) },
  { label: "recommendation feedback", get: () => getRecommendationFeedback(url(`/api/me/recommendations/${requestId}/feedback`), recommendationContext()) },
  { label: "recommendation evaluations", get: () => getRecommendationEvaluations(url(`/api/me/recommendations/${requestId}/evaluations`), recommendationContext()) },
];

describe("application query GET routes", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({ id: ownerId });
    getDb.mockReturnValue(db);
    for (const model of Object.values(db)) {
      model.findMany.mockResolvedValue([]);
      model.findFirst.mockResolvedValue(null);
      model.findUnique.mockResolvedValue(null);
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(allRoutes)("requires auth before accessing PostgreSQL for $label", async ({ get }) => {
    getCurrentUserProfile.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns the caller's preferences, including the empty state", async () => {
    db.userPreferences.findUnique.mockResolvedValueOnce(null);
    const emptyResponse = await getPreferences(url("/api/me/preferences"));
    expect(await emptyResponse.json()).toEqual({ preferences: null });
    expect(db.userPreferences.findUnique).toHaveBeenCalledWith({ where: { userId: ownerId } });

    const preferences = { userId: ownerId, settings: { theme: "dark" } };
    db.userPreferences.findUnique.mockResolvedValueOnce(preferences);
    const response = await getPreferences(url("/api/me/preferences"));
    expect(await response.json()).toEqual({ preferences });
  });

  it("uses default pagination and requests one extra row to report hasMore", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ recordingId: `recording-${index}` }));
    db.userFavoriteRecording.findMany.mockResolvedValueOnce(rows);

    const response = await getFavoriteRecordings(url("/api/me/favorites/recordings"));
    const body = await response.json();

    expect(db.userFavoriteRecording.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: ownerId }, take: 21, skip: 0,
    }));
    expect(body.items).toHaveLength(20);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, hasMore: true, nextOffset: 20 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns last-page metadata for a custom limit and offset", async () => {
    db.playlist.findMany.mockResolvedValueOnce([{ id: "one" }, { id: "two" }]);

    const response = await getPlaylists(url("/api/me/playlists", "?limit=2&offset=8&userId=someone-else"));

    expect(db.playlist.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: ownerId }, take: 3, skip: 8,
    }));
    expect(await response.json()).toMatchObject({
      items: [{ id: "one" }, { id: "two" }],
      pagination: { limit: 2, offset: 8, hasMore: false, nextOffset: null },
    });
  });

  it.each(["?limit=0", "?offset=10001", "?limit=2.5", "?limit=1&limit=2"]) (
    "rejects invalid or duplicated pagination parameters (%s) before querying",
    async (query) => {
      const response = await getFavoriteRecordings(url("/api/me/favorites/recordings", query));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
      expect(db.userFavoriteRecording.findMany).not.toHaveBeenCalled();
    },
  );

  it("validates dynamic UUIDs and hides missing or foreign playlists the same way", async () => {
    const invalid = await getPlaylist(url("/api/me/playlists/not-a-uuid"), playlistContext("not-a-uuid"));
    expect(invalid.status).toBe(400);
    expect(db.playlist.findFirst).not.toHaveBeenCalled();

    const missing = await getPlaylist(url(`/api/me/playlists/${playlistId}`), playlistContext());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Recurso no encontrado." });
    expect(db.playlist.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: playlistId, userId: ownerId },
    }));
  });

  it("scopes every recommendation child query to a request owned by the caller", async () => {
    const childRoutes = [
      { get: getRecommendationSeeds, delegate: db.recommendationSeed, scope: { request: { userId: ownerId } } },
      { get: getRecommendationResults, delegate: db.recommendationResult, scope: { request: { userId: ownerId } } },
      { get: getRecommendationEvents, delegate: db.recommendationEvent, scope: { userId: ownerId } },
      { get: getRecommendationFeedback, delegate: db.userFeedback, scope: { userId: ownerId } },
      { get: getRecommendationEvaluations, delegate: db.recommendationEvaluation, scope: { request: { userId: ownerId } } },
    ];

    for (const { get, delegate, scope } of childRoutes) {
      db.recommendationRequest.findFirst.mockResolvedValueOnce({ id: requestId });
      const response = await get(url(`/api/me/recommendations/${requestId}/children`, "?userId=someone-else"), recommendationContext());
      expect(response.status).toBe(200);
      expect(db.recommendationRequest.findFirst).toHaveBeenLastCalledWith({
        where: { id: requestId, userId: ownerId }, select: { id: true },
      });
      expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { requestId, ...scope },
      }));
    }
  });

  it("lists only the authenticated user's recommendations and only active shared models", async () => {
    await getRecommendations(url("/api/me/recommendations", "?userId=someone-else"));
    expect(db.recommendationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: ownerId },
    }));

    await getRecommendationModels(url("/api/recommendation-models", "?userId=someone-else"));
    expect(db.recommendationModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true },
    }));
  });

  it("returns a generic unavailable response without leaking database errors", async () => {
    db.userFavoriteArtist.findMany.mockRejectedValueOnce(new Error("private host and credentials"));

    const response = await getFavoriteArtists(url("/api/me/favorites/artists"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("private host and credentials");
  });

  it("rethrows Next.js redirect signals", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/sign-in;307;",
    });
    getCurrentUserProfile.mockRejectedValueOnce(redirect);

    await expect(getPreferences(url("/api/me/preferences"))).rejects.toBe(redirect);
  });
});
