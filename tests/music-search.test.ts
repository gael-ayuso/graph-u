import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/music/search/route";
import { MusicBrainzError, searchSongs } from "@/lib/musicbrainz";

vi.mock("@/lib/musicbrainz", () => ({
  searchSongs: vi.fn(),
  MusicBrainzError: class extends Error {
    constructor(message: string, public status: number) { super(message); }
  },
}));

const search = vi.mocked(searchSongs);

describe("local music search endpoint", () => {
  beforeEach(() => { search.mockResolvedValue([]); });

  it("rejects empty or excessively long searches before accessing the database", async () => {
    expect((await GET(new Request("http://localhost/api/music/search"))).status).toBe(400);
    expect((await GET(new Request(`http://localhost/api/music/search?q=${"a".repeat(151)}`))).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("accepts an artist-only search and preserves accented search terms", async () => {
    const response = await GET(new Request("http://localhost/api/music/search?artist=Bj%C3%B6rk"));
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith("", "Björk");
    expect(await response.json()).toEqual({ songs: [] });
  });

  it("returns the catalog-import error with retry semantics, without fake songs", async () => {
    search.mockRejectedValueOnce(new MusicBrainzError("La base local todavía no tiene el catálogo importado.", 503));
    const response = await GET(new Request("http://localhost/api/music/search?q=Reckoner"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(await response.json()).toEqual({ error: "La base local todavía no tiene el catálogo importado." });
  });

  it("does not expose process or database details in unexpected failures", async () => {
    search.mockRejectedValueOnce(new Error("private command and credentials"));
    const response = await GET(new Request("http://localhost/api/music/search?q=Reckoner"));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("credentials");
  });
});
