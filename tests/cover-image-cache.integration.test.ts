import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/music/cover/route";
import { getDb } from "@/lib/db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const releaseMbid = randomUUID();
const coverUrl = `https://coverartarchive.org/release/${releaseMbid}/front-250`;
const runtime = globalThis as unknown as {
  prisma?: ReturnType<typeof getDb>;
  graphuCoverInFlight?: Map<string, unknown>;
  graphuCoverImageInFlight?: Map<string, unknown>;
};

describe.skipIf(!testDatabaseUrl)("persistent cover images against PostgreSQL", () => {
  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl!);
  });

  afterAll(async () => {
    const db = getDb();
    await db.coverImageCache.deleteMany({ where: { url: coverUrl } });
    await db.coverCache.deleteMany({ where: { entityType: "release", mbid: releaseMbid } });
    await db.$disconnect();
    runtime.prisma = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves identical bytes after a new database connection without fetching upstream again", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const request = () => new Request(`http://localhost/api/music/cover?type=release&mbid=${releaseMbid}`);

    const first = await GET(request());
    expect(first.headers.get("x-cover-image-cache")).toBe("MISS");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
    const stored = await getDb().coverImageCache.findUniqueOrThrow({ where: { url: coverUrl } });
    expect(new Uint8Array(stored.bytes)).toEqual(bytes);

    await getDb().$disconnect();
    runtime.prisma = undefined;
    runtime.graphuCoverInFlight = undefined;
    runtime.graphuCoverImageInFlight = undefined;
    fetchMock.mockRejectedValue(new Error("upstream unavailable"));

    const second = await GET(request());
    expect(second.headers.get("x-cover-image-cache")).toBe("HIT");
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
