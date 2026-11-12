import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicBrainzError, recommendSongs, searchSongs } from "@/lib/musicbrainz";
import { POST } from "@/app/api/recommendations/route";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const seed = "7f575ec7-2b2a-4065-b6b9-97d1c587066a";

describe("GraphU backend client", () => {
  afterEach(() => fetchMock.mockReset());

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

  it("handles non-JSON error responses from the backend gracefully with fallback message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(recommendSongs([seed])).rejects.toMatchObject({
      status: 503,
      message: "El backend de GraphU no pudo completar la solicitud.",
    });
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    await expect(searchSongs("Reckoner", "")).rejects.toMatchObject({
      status: 404,
      message: "El backend de GraphU no pudo completar la solicitud.",
    });
  });
});

describe("recommendations endpoint", () => {
  afterEach(() => fetchMock.mockReset());
  const post = (body: unknown) => POST(new Request("http://localhost/api/recommendations", { method: "POST", body: JSON.stringify(body) }));

  it("rejects invalid seeds before calling the backend", async () => {
    expect((await post({ seeds: [] })).status).toBe(400);
    expect((await post({ seeds: ["not-an-id"] })).status).toBe(400);
    expect((await post({ seeds: Array(11).fill(seed) })).status).toBe(400);
    expect((await post({ seeds: [seed], excludeArtists: ["x"] })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies, missing seeds, and oversized excludeArtists", async () => {
    const malformed = await POST(new Request("http://localhost/api/recommendations", { method: "POST", body: "{not-json" }));
    expect(malformed.status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ seeds: [seed], excludeArtists: "not-an-array" })).status).toBe(400);
    expect((await post({ seeds: [seed], excludeArtists: Array(201).fill(seed) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts uppercase hex MBIDs and boundary lengths (10 seeds, 200 excludeArtists)", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], graph: { nodes: [], edges: [] } }));
    const upperSeed = seed.toUpperCase();
    const response = await post({ seeds: Array(10).fill(upperSeed), excludeArtists: Array(200).fill(upperSeed) });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects 36-char strings of hyphens or bad UUID groups before calling FastAPI", async () => {
    // route.ts usa /^[a-f0-9-]{36}$/i en lugar de formato UUID 8-4-4-4-12: deja pasar "---..." (36 guiones)
    // y recién falla en FastAPI con 422 y detalle no string ("El backend de GraphU no pudo completar la solicitud.").
    const badUuid = "-".repeat(36);
    const response = await post({ seeds: [badUuid] });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards already shown artists so the backend can exclude them", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], graph: { nodes: [], edges: [] } }));
    await post({ seeds: [seed], excludeArtists: [seed] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ seeds: [seed], excludeArtists: [seed] });
  });

  it("propagates MusicBrainzError status/message and sets Cache-Control: no-store on success", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "No encontramos datos para recomendar." }, 422));
    const errRes = await post({ seeds: [seed] });
    expect(errRes.status).toBe(422);
    expect(await errRes.json()).toEqual({ error: "No encontramos datos para recomendar." });

    const data = { seedTags: ["rock"], recommendations: [] };
    fetchMock.mockResolvedValueOnce(json(data));
    const response = await post({ seeds: [seed] });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(data);
  });
});