import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { syncProfile, type ProfileSnapshot } from "@/lib/users/sync";

// Explicit opt-in: never fall back to the application's database.
const connectionString = process.env.TEST_DATABASE_URL;
describe.skipIf(!connectionString)("profile synchronization against PostgreSQL", () => {
  const ids: string[] = [];
  if (connectionString) vi.stubEnv("DATABASE_URL", connectionString);

  function snapshot(): ProfileSnapshot {
    const clerkId = `user_integration_${randomUUID()}`;
    ids.push(clerkId);
    return {
      clerkId, name: "Initial", email: "test@example.com", avatarUrl: null,
      clerkUpdatedAt: new Date(1000), deletedAt: null,
    };
  }

  afterAll(async () => {
    await getDb().user.deleteMany({ where: { clerkId: { in: ids } } });
    await getDb().$disconnect();
  });

  it("creates once and ignores duplicate or stale events", async () => {
    const input = snapshot();
    const first = await syncProfile(input);
    const duplicate = await syncProfile(input);
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.updatedAt).toEqual(first.updatedAt);
    await syncProfile({ ...input, name: "New", clerkUpdatedAt: new Date(3000) });
    const stale = await syncProfile({ ...input, clerkUpdatedAt: new Date(2000) });
    expect(stale.name).toBe("New");
  });

  it("concurrent first access and webhook deliveries keep the newest data", async () => {
    const input = snapshot();
    await Promise.all(Array.from({ length: 8 }, (_, i) => syncProfile({
      ...input, name: `Version ${i}`, clerkUpdatedAt: new Date(1000 + i),
    })));
    const rows = await getDb().user.findMany({ where: { clerkId: input.clerkId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Version 7");
  });

  it("deletion clears personal data and cannot be reversed by delayed writes", async () => {
    const input = snapshot();
    await syncProfile(input);
    await syncProfile({
      ...input, email: null, name: null, avatarUrl: null,
      deletedAt: new Date(2000), clerkUpdatedAt: new Date(2000),
    });
    const result = await syncProfile({ ...input, clerkUpdatedAt: new Date(3000) });
    expect(result).toMatchObject({
      email: null, name: null, avatarUrl: null, deletedAt: new Date(2000),
    });
  });

  it("a deletion delivered before creation still prevents resurrection", async () => {
    const input = snapshot();
    await syncProfile({
      ...input, name: null, email: null,
      deletedAt: new Date(2000), clerkUpdatedAt: new Date(2000),
    });
    const result = await syncProfile(input);
    expect(result.deletedAt).toEqual(new Date(2000));
    expect(result.name).toBeNull();
  });
});
