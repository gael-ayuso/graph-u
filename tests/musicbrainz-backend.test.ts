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

  it("forwards already shown artists so the backend can exclude them", async () => {
    fetchMock.mockResolvedValueOnce(json({ seedTags: [], recommendations: [], graph: { nodes: [], edges: [] } }));
    await post({ seeds: [seed], excludeArtists: [seed] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ seeds: [seed], excludeArtists: [seed] });
  });

  it("returns the backend recommendations", async () => {
    const data = { seedTags: ["rock"], recommendations: [] };
    fetchMock.mockResolvedValueOnce(json(data));
    const response = await post({ seeds: [seed] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
  });
});
