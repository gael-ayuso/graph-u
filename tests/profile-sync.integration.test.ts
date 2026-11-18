import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { syncProfile, type ProfileSnapshot } from "@/lib/users/sync";

// Explicit opt-in: never fall back to the application's database.
const connectionString = process.env.TEST_DATABASE_URL;
describe.skipIf(!connectionString)("profile synchronization against PostgreSQL", () => {
  const ids: string[] = [];
  const modelIds: string[] = [];
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
    const db = getDb();
    await db.user.deleteMany({ where: { clerkId: { in: ids } } });
    if (modelIds.length > 0) {
      await db.recommendationModel.deleteMany({ where: { id: { in: modelIds } } });
    }
    await db.$disconnect();
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

  it("preserves app-customized display name across Clerk updates and clears it on terminal deletion", async () => {
    const db = getDb();
    const input = snapshot();
    const created = await syncProfile(input);

    await db.user.update({
      where: { id: created.id },
      data: { name: "Nombre Personalizado" },
    });
    await db.userPreferences.create({
      data: {
        userId: created.id,
        settings: { nameCustomized: true, username: "custom_user" },
      },
    });

    const updatedFromClerk = await syncProfile({
      ...input,
      name: "Nombre de Clerk",
      email: "updated@example.com",
      avatarUrl: "https://example.com/avatar.png",
      clerkUpdatedAt: new Date(2000),
    });

    expect(updatedFromClerk.name).toBe("Nombre Personalizado");
    expect(updatedFromClerk.email).toBe("updated@example.com");
    expect(updatedFromClerk.avatarUrl).toBe("https://example.com/avatar.png");

    const deleted = await syncProfile({
      ...input,
      email: null,
      name: null,
      avatarUrl: null,
      deletedAt: new Date(3000),
      clerkUpdatedAt: new Date(3000),
    });

    expect(deleted.name).toBeNull();
    expect(deleted.email).toBeNull();
    expect(deleted.avatarUrl).toBeNull();
    expect(deleted.deletedAt).toEqual(new Date(3000));
    expect(await db.userPreferences.findUnique({ where: { userId: created.id } })).toBeNull();
  });

  it("terminal deletion purges all child tables cleanly while retaining shared recommendation models", async () => {
    const db = getDb();
    const input = snapshot();
    const user = await syncProfile(input);

    const modelId = randomUUID();
    modelIds.push(modelId);
    await db.recommendationModel.create({
      data: { id: modelId, name: `sync-purge-${modelId}`, version: "1" },
    });

    const playlist = await db.playlist.create({
      data: { userId: user.id, name: "Mix de prueba" },
    });
    await db.playlistTrack.create({
      data: { playlistId: playlist.id, recordingId: randomUUID(), position: 0 },
    });
    await db.userPreferences.create({
      data: { userId: user.id, settings: { discoveryMode: "balanced" } },
    });
    await db.userFavoriteRecording.create({
      data: { userId: user.id, recordingId: randomUUID(), title: "Track", artistName: "Artist" },
    });
    await db.userFavoriteArtist.create({
      data: { userId: user.id, artistId: randomUUID(), name: "Artist" },
    });

    const recRequest = await db.recommendationRequest.create({
      data: { userId: user.id, modelId },
    });
    await db.recommendationSeed.create({
      data: { requestId: recRequest.id, recordingId: randomUUID(), position: 0 },
    });
    const recResult = await db.recommendationResult.create({
      data: { requestId: recRequest.id, recordingId: randomUUID(), rank: 1, score: 0.9 },
    });
    await db.recommendationEvaluation.create({
      data: { requestId: recRequest.id, metrics: { precisionAt10: 0.9 } },
    });
    await db.recommendationEvent.create({
      data: { userId: user.id, requestId: recRequest.id, resultId: recResult.id, type: "view" },
    });
    await db.userFeedback.create({
      data: { userId: user.id, requestId: recRequest.id, resultId: recResult.id, value: "LIKE" },
    });

    await syncProfile({
      ...input,
      email: null,
      name: null,
      avatarUrl: null,
      deletedAt: new Date(5000),
      clerkUpdatedAt: new Date(5000),
    });

    expect(await db.userPreferences.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.userFavoriteRecording.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.userFavoriteArtist.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.playlist.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.playlistTrack.count({ where: { playlistId: playlist.id } })).toBe(0);
    expect(await db.userFeedback.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.recommendationEvent.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.recommendationRequest.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.recommendationResult.count({ where: { requestId: recRequest.id } })).toBe(0);
    expect(await db.recommendationSeed.count({ where: { requestId: recRequest.id } })).toBe(0);
    expect(await db.recommendationEvaluation.count({ where: { requestId: recRequest.id } })).toBe(0);
    expect(await db.recommendationModel.findUnique({ where: { id: modelId } })).not.toBeNull();
  });
});
