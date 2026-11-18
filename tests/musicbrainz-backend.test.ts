import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicBrainzError, recommendSongs, searchSongs } from "@/lib/musicbrainz";
import { POST } from "@/app/api/recommendations/route";

const { getCurrentUserProfile, recordRecommendations } = vi.hoisted(() => ({
  getCurrentUserProfile: vi.fn().mockResolvedValue(null),
  recordRecommendations: vi.fn(),
}));

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/recommendation-actions", () => ({ recordRecommendations }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const seed = "7f575ec7-2b2a-4065-b6b9-97d1c587066a";
const artistId = "11111111-2222-3333-4444-555555555555";
const recordingId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("GraphU backend client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("forwards searches to FastAPI preserving accents", async () => {
    fetchMock.mockResolvedValueOnce(json({ songs: [] }));
    expect(await searchSongs("", "Björk")).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/music/search?q=&artist=Bj%C3%B6rk");
  });

  it("reports an unreachable backend as retryable without leaking details", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1"));
    const error = await searchSongs("Reckoner", "").catch((e) => e);
    expect(error).toBeInstanceOf(MusicBrainzError);
    expect(error.status).toBe(503);
    expect(error.message).not.toContain("ECONNREFUSED");
  });

  it("passes backend messages through and maps server errors to 503", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Sin etiquetas." }, 422));
    await expect(recommendSongs([seed])).rejects.toMatchObject({ status: 422, message: "Sin etiquetas." });
    fetchMock.mockResolvedValueOnce(json({ detail: [{ msg: "x" }] }, 500));
    await expect(recommendSongs([seed])).rejects.toMatchObject({ status: 503 });
  });

  it("handles non-JSON backend errors with a safe fallback", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(recommendSongs([seed])).rejects.toMatchObject({
      status: 503, message: "El backend de GraphU no pudo completar la solicitud.",
    });
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    await expect(searchSongs("Reckoner", "")).rejects.toMatchObject({
      status: 404, message: "El backend de GraphU no pudo completar la solicitud.",
    });
  });

  it("allows recommendations to finish the backend budget without extending search timeouts", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], seedResults: [], graph: { nodes: [], edges: [] } }));
    await recommendSongs([seed]);
    expect(timeout).toHaveBeenLastCalledWith(180_000);
    fetchMock.mockResolvedValueOnce(json({ songs: [] }));
    await searchSongs("Reckoner", "");
    expect(timeout).toHaveBeenLastCalledWith(60_000);
  });

  it("forwards recommendation options to FastAPI alongside seeds and excludeArtists", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], seedResults: [], graph: { nodes: [], edges: [] } }));
    await recommendSongs([seed], [artistId], {
      limit: 15,
      excludeRecordings: [recordingId],
      excludeVersions: [{ artistId, title: "Echoes" }],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/recommendations");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      seeds: [seed],
      excludeArtists: [artistId],
      limit: 15,
      excludeRecordings: [recordingId],
      excludeVersions: [{ artistId, title: "Echoes" }],
    });
  });
});

describe("recommendations endpoint", () => {
  afterEach(() => {
    fetchMock.mockReset();
    getCurrentUserProfile.mockReset().mockResolvedValue(null);
    recordRecommendations.mockReset();
  });

  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/recommendations", { method: "POST", body: JSON.stringify(body) }));

  it("rejects invalid seeds before calling the backend", async () => {
    expect((await post({ seeds: [] })).status).toBe(400);
    expect((await post({ seeds: ["not-an-id"] })).status).toBe(400);
    expect((await post({ seeds: Array(11).fill(seed) })).status).toBe(400);
    expect((await post({ seeds: [seed], excludeArtists: ["x"] })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates seeds message, UUIDs, lengths, excludeRecordings, excludeVersions, and integer limit before calling backend or auth", async () => {
    const emptySeedsRes = await post({ seeds: [] });
    expect(emptySeedsRes.status).toBe(400);
    expect(await emptySeedsRes.json()).toEqual({ error: "Elige entre 1 y 10 canciones." });

    const badJsonRes = await POST(
      new Request("http://localhost/api/recommendations", { method: "POST", body: "{not-json" }),
    );
    expect(badJsonRes.status).toBe(400);

    const invalidBodies: unknown[] = [
      null,
      {},
      { seeds: "not-an-array" },
      { seeds: ["-".repeat(36)] },
      { seeds: [seed.replace(/-/g, "")] },
      { seeds: [seed], excludeArtists: "bad" },
      { seeds: [seed], excludeArtists: Array(201).fill(seed) },
      { seeds: [seed], excludeRecordings: "bad" },
      { seeds: [seed], excludeRecordings: ["bad-uuid"] },
      { seeds: [seed], excludeRecordings: [recordingId.replace(/-/g, "")] },
      { seeds: [seed], excludeRecordings: Array(201).fill(recordingId) },
      { seeds: [seed], excludeVersions: "bad" },
      { seeds: [seed], excludeVersions: [null] },
      { seeds: [seed], excludeVersions: [["bad"]] },
      { seeds: [seed], excludeVersions: [{ artistId: "bad-uuid", title: "Track" }] },
      { seeds: [seed], excludeVersions: [{ artistId: artistId.replace(/-/g, ""), title: "Track" }] },
      { seeds: [seed], excludeVersions: [{ artistId, title: "" }] },
      { seeds: [seed], excludeVersions: [{ artistId, title: "   " }] },
      { seeds: [seed], excludeVersions: [{ artistId, title: 123 }] },
      { seeds: [seed], excludeVersions: Array(201).fill({ artistId, title: "Track" }) },
      { seeds: [seed], limit: 0 },
      { seeds: [seed], limit: -1 },
      { seeds: [seed], limit: 31 },
      { seeds: [seed], limit: 1.5 },
      { seeds: [seed], limit: "10" },
      { seeds: [seed], limit: true },
      { seeds: [seed], limit: null },
    ];

    for (const invalidBody of invalidBodies) {
      const response = await post(invalidBody);
      expect(response.status).toBe(400);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCurrentUserProfile).not.toHaveBeenCalled();
    expect(recordRecommendations).not.toHaveBeenCalled();
  });

  it("accepts uppercase UUIDs at the 10-seed and 200-artist boundaries", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], seedResults: [], graph: { nodes: [], edges: [] } }));
    const response = await post({ seeds: Array(10).fill(seed.toUpperCase()), excludeArtists: Array(200).fill(artistId.toUpperCase()) });
    expect(response.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ seeds: Array(10).fill(seed), excludeArtists: Array(200).fill(artistId) });
  });

  it("forwards already shown artists so the backend can exclude them", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], graph: { nodes: [], edges: [] } }));
    await post({ seeds: [seed], excludeArtists: [seed] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ seeds: [seed], excludeArtists: [seed] });
  });

  it("preserves legacy payload compatibility when optional fields are omitted and accepts empty/max boundary arrays", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], seedResults: [], graph: { nodes: [], edges: [] } }));
    const minimalRes = await post({ seeds: [seed] });
    expect(minimalRes.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ seeds: [seed], excludeArtists: [] });

    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], seedResults: [], graph: { nodes: [], edges: [] } }));
    const boundaryRes = await post({
      seeds: [seed],
      limit: 1,
      excludeArtists: Array(200).fill(artistId),
      excludeRecordings: [],
      excludeVersions: [],
    });
    expect(boundaryRes.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      seeds: [seed],
      excludeArtists: Array(200).fill(artistId),
      limit: 1,
      excludeRecordings: [],
      excludeVersions: [],
    });
  });

  it("canonicalizes UUIDs and forwards limit, excludeRecordings, and excludeVersions", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], seedResults: [], graph: { nodes: [], edges: [] } }));
    const response = await post({
      seeds: [seed.toUpperCase()],
      limit: 30,
      excludeArtists: [artistId.toUpperCase()],
      excludeRecordings: [recordingId.toUpperCase()],
      excludeVersions: [{ artistId: artistId.toUpperCase(), title: "  Straße  " }],
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      seeds: [seed],
      excludeArtists: [artistId],
      limit: 30,
      excludeRecordings: [recordingId],
      excludeVersions: [{ artistId, title: "  Straße  " }],
    });
  });

  it("returns the backend recommendations", async () => {
    const data = { seedTags: ["rock"], recommendations: [] };
    fetchMock.mockResolvedValueOnce(json(data));
    const response = await post({ seeds: [seed] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
  });

  it("returns guest responses with private no-store cache control and SeedResult metadata without persisting", async () => {
    const data = {
      seedTags: ["rock"],
      recommendations: [],
      seedResults: [
        {
          seedId: seed,
          title: "Seed",
          artist: "Artist",
          status: "recommended",
          message: "1 recomendación",
          recommendationIds: [recordingId],
          artistId,
          searchLimited: true,
        },
      ],
      graph: { nodes: [], edges: [] },
    };
    fetchMock.mockResolvedValueOnce(json(data));

    const response = await post({ seeds: [seed] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(data);
    expect(recordRecommendations).not.toHaveBeenCalled();
  });

  it("records effective default options for authenticated legacy requests and explicit options for extended requests", async () => {
    getCurrentUserProfile.mockResolvedValue({ id: "user-1" });
    const backendData = {
      seedTags: ["rock"],
      recommendations: [],
      seedResults: [
        {
          seedId: seed,
          title: "Seed",
          artist: "Artist",
          status: "recommended",
          message: "ok",
          recommendationIds: [],
          artistId,
          searchLimited: true,
        },
      ],
      graph: { nodes: [], edges: [] },
    };

    // 1) Legacy payload: forwards only seeds & excludeArtists, records effective defaults (limit: 10, empty arrays)
    fetchMock.mockResolvedValueOnce(json(backendData));
    recordRecommendations.mockResolvedValueOnce({ ...backendData, requestId: "req-1" });

    const legacyRes = await post({
      seeds: [seed.toUpperCase()],
      excludeArtists: [artistId.toUpperCase()],
    });
    expect(legacyRes.status).toBe(200);
    expect(legacyRes.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      seeds: [seed],
      excludeArtists: [artistId],
    });
    expect(recordRecommendations).toHaveBeenNthCalledWith(
      1,
      "user-1",
      [seed],
      [artistId],
      backendData,
      { limit: 10, excludeRecordings: [], excludeVersions: [] },
    );
    expect(await legacyRes.json()).toEqual({ ...backendData, requestId: "req-1" });

    // 2) Extended payload: forwards and records canonicalized options
    fetchMock.mockResolvedValueOnce(json(backendData));
    recordRecommendations.mockResolvedValueOnce({ ...backendData, requestId: "req-2" });

    const extendedRes = await post({
      seeds: [seed.toUpperCase()],
      limit: 12,
      excludeRecordings: [recordingId.toUpperCase()],
      excludeVersions: [{ artistId: artistId.toUpperCase(), title: "Echoes" }],
    });
    expect(extendedRes.status).toBe(200);
    expect(recordRecommendations).toHaveBeenNthCalledWith(
      2,
      "user-1",
      [seed],
      [],
      backendData,
      {
        limit: 12,
        excludeRecordings: [recordingId],
        excludeVersions: [{ artistId, title: "Echoes" }],
      },
    );
    expect(await extendedRes.json()).toEqual({ ...backendData, requestId: "req-2" });
  });

  it("propagates MusicBrainzError status, maps unknown failures to 502, and rethrows Next.js control-flow errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Sin etiquetas." }, 422));
    const mbErrorRes = await post({ seeds: [seed] });
    expect(mbErrorRes.status).toBe(422);
    expect(await mbErrorRes.json()).toEqual({ error: "Sin etiquetas." });

    getCurrentUserProfile.mockRejectedValueOnce(new Error("unexpected db crash"));
    const unknownRes = await post({ seeds: [seed] });
    expect(unknownRes.status).toBe(502);
    expect(await unknownRes.text()).not.toContain("unexpected db crash");

    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/sign-in;307;",
    });
    getCurrentUserProfile.mockRejectedValueOnce(redirectError);
    await expect(post({ seeds: [seed] })).rejects.toBe(redirectError);
  });
});
