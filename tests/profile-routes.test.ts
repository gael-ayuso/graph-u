import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import {
  DEFAULT_USER_PREFERENCES,
  extractUserPreferences,
  extractUsername,
  parseSettingsRecord,
  validatePreferencesPut,
  validateProfilePatch,
} from "@/lib/users/profile-settings";
import {
  DELETE as deleteProfile,
  GET as getProfile,
  PATCH as patchProfile,
} from "@/app/api/profile/route";
import {
  GET as getPreferences,
  PUT as putPreferences,
} from "@/app/api/preferences/route";
import { profileFromEvent, purgeUserData, syncProfile } from "@/lib/users/sync";

const {
  auth,
  getCurrentUserProfile,
  getDb,
  deleteUser,
  clerkClient,
  db,
  tx,
} = vi.hoisted(() => {
  const txMock = {
    $queryRaw: vi.fn(),
    user: {
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    userPreferences: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    userFavoriteRecording: { deleteMany: vi.fn() },
    userFavoriteArtist: { deleteMany: vi.fn() },
    playlist: { deleteMany: vi.fn() },
    userFeedback: { deleteMany: vi.fn() },
    recommendationEvent: { deleteMany: vi.fn() },
    recommendationRequest: { deleteMany: vi.fn() },
  };

  const dbMock = {
    userPreferences: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  const deleteUserMock = vi.fn();

  return {
    auth: vi.fn(),
    getCurrentUserProfile: vi.fn(),
    getDb: vi.fn(),
    deleteUser: deleteUserMock,
    clerkClient: vi.fn(async () => ({
      users: {
        deleteUser: deleteUserMock,
      },
    })),
    db: dbMock,
    tx: txMock,
  };
});

vi.mock("@/lib/users/current-user", () => ({ getCurrentUserProfile }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@clerk/nextjs/server", () => ({ auth, clerkClient }));

const baseUser = {
  id: "user-internal-1",
  clerkId: "user_clerk_1",
  email: "ana@example.com",
  name: "Ana López",
  avatarUrl: "https://example.com/ana.png",
  deletedAt: null,
  clerkUpdatedAt: new Date("2025-01-01T00:00:00.000Z"),
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("lib/users/profile-settings", () => {
  describe("parseSettingsRecord", () => {
    it("returns an empty object for null, primitives, and arrays", () => {
      expect(parseSettingsRecord(null)).toEqual({});
      expect(parseSettingsRecord(undefined)).toEqual({});
      expect(parseSettingsRecord("settings")).toEqual({});
      expect(parseSettingsRecord(42)).toEqual({});
      expect(parseSettingsRecord(true)).toEqual({});
      expect(parseSettingsRecord(["a", "b"])).toEqual({});
    });

    it("returns a shallow copy for plain record objects", () => {
      const original = { username: "ana", theme: "dark" };
      const parsed = parseSettingsRecord(original);
      expect(parsed).toEqual(original);
      expect(parsed).not.toBe(original);
      parsed.theme = "light";
      expect(original.theme).toBe("dark");
    });
  });

  describe("extractUsername", () => {
    it("extracts and trims valid non-empty usernames and returns null otherwise", () => {
      expect(extractUsername(null)).toBeNull();
      expect(extractUsername([])).toBeNull();
      expect(extractUsername({ username: 123 })).toBeNull();
      expect(extractUsername({ username: "   " })).toBeNull();
      expect(extractUsername({ username: "  ana_music-1  " })).toBe("ana_music-1");
    });
  });

  describe("extractUserPreferences", () => {
    it("returns defaults for missing or invalid settings", () => {
      expect(extractUserPreferences(null)).toEqual(DEFAULT_USER_PREFERENCES);
      expect(extractUserPreferences("invalid")).toEqual(DEFAULT_USER_PREFERENCES);
      expect(
        extractUserPreferences({
          discoveryMode: "extreme",
          allowExplicit: "false",
          defaultLimit: 4,
          preferredTags: "rock",
        }),
      ).toEqual(DEFAULT_USER_PREFERENCES);
    });

    it("rejects out-of-range or non-integer limits and normalizes, deduplicates, and caps tags at 30", () => {
      expect(
        extractUserPreferences({
          discoveryMode: "conservative",
          allowExplicit: false,
          defaultLimit: 31,
          preferredTags: ["rock"],
        }),
      ).toEqual({
        discoveryMode: "conservative",
        allowExplicit: false,
        defaultLimit: 10,
        preferredTags: ["rock"],
      });

      expect(
        extractUserPreferences({
          defaultLimit: 12.5,
        }).defaultLimit,
      ).toBe(10);

      expect(
        extractUserPreferences({
          defaultLimit: 30,
        }).defaultLimit,
      ).toBe(30);

      const overLimitTags = [
        "  Indie Rock ",
        "",
        "   ",
        123 as unknown as string,
        "indie rock",
        "a".repeat(41),
        ...Array.from({ length: 35 }, (_, i) => `Tag-${i}`),
      ];

      const extracted = extractUserPreferences({
        discoveryMode: "adventurous",
        allowExplicit: false,
        defaultLimit: 5,
        preferredTags: overLimitTags,
      });

      expect(extracted.discoveryMode).toBe("adventurous");
      expect(extracted.allowExplicit).toBe(false);
      expect(extracted.defaultLimit).toBe(5);
      expect(extracted.preferredTags).toHaveLength(30);
      expect(extracted.preferredTags[0]).toBe("indie rock");
      expect(extracted.preferredTags[1]).toBe("tag-0");
      expect(extracted.preferredTags).not.toContain("a".repeat(41));
    });
  });

  describe("validateProfilePatch", () => {
    it("accepts valid partial or full profile updates and trims values", () => {
      expect(
        validateProfilePatch({ name: "  Ana López  ", username: "  ana_99  " }),
      ).toEqual({
        ok: true,
        data: { name: "Ana López", username: "ana_99" },
      });

      expect(validateProfilePatch({ name: "a".repeat(100) })).toEqual({
        ok: true,
        data: { name: "a".repeat(100) },
      });

      expect(validateProfilePatch({ username: "a-1" })).toEqual({
        ok: true,
        data: { username: "a-1" },
      });

      expect(validateProfilePatch({ username: "a".repeat(30) })).toEqual({
        ok: true,
        data: { username: "a".repeat(30) },
      });
    });

    it("normalizes null or whitespace-only name and username to null", () => {
      expect(validateProfilePatch({ name: null, username: "" })).toEqual({
        ok: true,
        data: { name: null, username: null },
      });

      expect(validateProfilePatch({ name: "   ", username: "   " })).toEqual({
        ok: true,
        data: { name: null, username: null },
      });

      expect(validateProfilePatch({ username: null })).toEqual({
        ok: true,
        data: { username: null },
      });
    });

    it("rejects empty/non-object bodies, invalid types, overlong names, and invalid username patterns", () => {
      expect(validateProfilePatch(null).ok).toBe(false);
      expect(validateProfilePatch([]).ok).toBe(false);
      expect(validateProfilePatch("bad").ok).toBe(false);
      expect(validateProfilePatch({}).ok).toBe(false);
      expect(validateProfilePatch({ extra: "ignored" }).ok).toBe(false);

      expect(validateProfilePatch({ name: 123 }).ok).toBe(false);
      expect(validateProfilePatch({ name: "a".repeat(101) }).ok).toBe(false);
      expect(validateProfilePatch({ username: 123 }).ok).toBe(false);
      expect(validateProfilePatch({ username: "ab" }).ok).toBe(false);
      expect(validateProfilePatch({ username: "a".repeat(31) }).ok).toBe(false);
      expect(validateProfilePatch({ username: "ana.lopez" }).ok).toBe(false);
      expect(validateProfilePatch({ username: "ana lopez" }).ok).toBe(false);
      expect(validateProfilePatch({ username: "ana@graphu" }).ok).toBe(false);
    });
  });

  describe("validatePreferencesPut", () => {
    it("accepts valid preferences and normalizes/deduplicates tags", () => {
      expect(
        validatePreferencesPut({
          discoveryMode: "adventurous",
          allowExplicit: false,
          defaultLimit: 25,
          preferredTags: ["  SynthPop ", "JAZZ", "synthpop", "a".repeat(40)],
        }),
      ).toEqual({
        ok: true,
        data: {
          discoveryMode: "adventurous",
          allowExplicit: false,
          defaultLimit: 25,
          preferredTags: ["synthpop", "jazz", "a".repeat(40)],
        },
      });

      expect(
        validatePreferencesPut({
          discoveryMode: "conservative",
          allowExplicit: true,
          defaultLimit: 5,
          preferredTags: [],
        }).ok,
      ).toBe(true);

      expect(
        validatePreferencesPut({
          discoveryMode: "balanced",
          allowExplicit: true,
          defaultLimit: 30,
          preferredTags: [],
        }).ok,
      ).toBe(true);
    });

    it("rejects invalid body, discoveryMode, non-boolean allowExplicit, invalid limits, and invalid tags", () => {
      const validBase = {
        discoveryMode: "balanced",
        allowExplicit: true,
        defaultLimit: 10,
        preferredTags: ["rock"],
      };

      expect(validatePreferencesPut(null).ok).toBe(false);
      expect(validatePreferencesPut([]).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, discoveryMode: "wild" }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, allowExplicit: "true" }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, allowExplicit: 1 }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, defaultLimit: 4 }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, defaultLimit: 31 }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, defaultLimit: 10.5 }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, defaultLimit: "10" }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, preferredTags: "rock" }).ok).toBe(false);
      expect(
        validatePreferencesPut({
          ...validBase,
          preferredTags: Array.from({ length: 31 }, (_, i) => `tag-${i}`),
        }).ok,
      ).toBe(false);
      expect(validatePreferencesPut({ ...validBase, preferredTags: [""] }).ok).toBe(false);
      expect(validatePreferencesPut({ ...validBase, preferredTags: ["   "] }).ok).toBe(false);
      expect(
        validatePreferencesPut({ ...validBase, preferredTags: ["a".repeat(41)] }).ok,
      ).toBe(false);
      expect(
        validatePreferencesPut({ ...validBase, preferredTags: [123] }).ok,
      ).toBe(false);
    });
  });
});

describe("app/api/profile/route.ts", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ userId: null });
    getCurrentUserProfile.mockResolvedValue(baseUser);
    getDb.mockReturnValue(db);
    db.userPreferences.findUnique.mockResolvedValue(null);
    db.userPreferences.upsert.mockResolvedValue({ userId: baseUser.id, settings: {} });
    db.user.findUnique.mockResolvedValue(null);
    db.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));
    tx.$queryRaw.mockResolvedValue([baseUser]);
    tx.user.update.mockResolvedValue(baseUser);
    tx.user.findUniqueOrThrow.mockResolvedValue(baseUser);
    tx.userPreferences.findUnique.mockResolvedValue(null);
    tx.userPreferences.upsert.mockResolvedValue({ userId: baseUser.id, settings: {} });
    tx.userPreferences.deleteMany.mockResolvedValue({ count: 1 });
    tx.userFavoriteRecording.deleteMany.mockResolvedValue({ count: 0 });
    tx.userFavoriteArtist.deleteMany.mockResolvedValue({ count: 0 });
    tx.playlist.deleteMany.mockResolvedValue({ count: 0 });
    tx.userFeedback.deleteMany.mockResolvedValue({ count: 0 });
    tx.recommendationEvent.deleteMany.mockResolvedValue({ count: 0 });
    tx.recommendationRequest.deleteMany.mockResolvedValue({ count: 0 });
    deleteUser.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("GET /api/profile", () => {
    it("returns 401 with private no-store without touching DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await getProfile();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 200 with profile, username, and extracted preferences from UserPreferences.settings", async () => {
      db.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: {
          username: "ana_music",
          discoveryMode: "adventurous",
          allowExplicit: false,
          defaultLimit: 20,
          preferredTags: ["Jazz", "Synthpop"],
        },
      });

      const response = await getProfile();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(db.userPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId: baseUser.id },
      });
      expect(await response.json()).toEqual({
        id: baseUser.id,
        username: "ana_music",
        name: baseUser.name,
        email: baseUser.email,
        avatarUrl: baseUser.avatarUrl,
        preferences: {
          discoveryMode: "adventurous",
          allowExplicit: false,
          defaultLimit: 20,
          preferredTags: ["jazz", "synthpop"],
        },
      });
    });

    it("returns 503 without leaking internal DB errors", async () => {
      db.userPreferences.findUnique.mockRejectedValueOnce(
        new Error("postgres://secret:password@db.internal:5432"),
      );

      const response = await getProfile();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain("postgres://secret");
    });

    it("rethrows Next.js redirect signals via unstable_rethrow", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(getProfile()).rejects.toBe(redirect);
    });
  });

  describe("PATCH /api/profile", () => {
    it("returns 401 without touching DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", { name: "Nuevo" }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 400 on invalid payload without touching DB", async () => {
      const response = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", { username: "x" }),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("executes SELECT ... FOR UPDATE before reading preferences and returns 401 if user was concurrently deleted", async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);

      const response = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", { name: "Ana Nueva" }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sql = strings.join("?");
      expect(sql).toContain('FROM "app"."users"');
      expect(sql).toContain('WHERE "id" = ? AND "deletedAt" IS NULL');
      expect(sql).toContain("FOR UPDATE");
      expect(values).toEqual([baseUser.id]);
      expect(tx.userPreferences.findUnique).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("locks active user before reading prefs, updates user.name, sets nameCustomized: true, preserves previous keys, and deletes username when empty", async () => {
      const previousSettings = {
        theme: "gruvbox",
        discoveryMode: "conservative",
        allowExplicit: false,
        defaultLimit: 15,
        preferredTags: ["indie"],
        username: "old_name",
      };
      tx.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: previousSettings,
      });
      tx.user.update.mockResolvedValueOnce({
        ...baseUser,
        name: "Ana Editada",
      });
      tx.userPreferences.upsert.mockImplementationOnce(
        async ({ update }: { update: { settings: Record<string, unknown> } }) => ({
          userId: baseUser.id,
          settings: update.settings,
        }),
      );

      const response = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", {
          name: "  Ana Editada ",
          username: "",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.userPreferences.findUnique.mock.invocationCallOrder[0],
      );
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: { name: "Ana Editada" },
      });

      const upsertCall = tx.userPreferences.upsert.mock.calls[0][0] as {
        where: { userId: string };
        create: { userId: string; settings: Record<string, unknown> };
        update: { settings: Record<string, unknown> };
      };
      expect(upsertCall.where).toEqual({ userId: baseUser.id });
      expect(upsertCall.update.settings).toEqual({
        theme: "gruvbox",
        discoveryMode: "conservative",
        allowExplicit: false,
        defaultLimit: 15,
        preferredTags: ["indie"],
        nameCustomized: true,
      });
      expect("username" in upsertCall.update.settings).toBe(false);

      expect(await response.json()).toEqual({
        id: baseUser.id,
        username: null,
        name: "Ana Editada",
        email: baseUser.email,
        avatarUrl: baseUser.avatarUrl,
        preferences: {
          discoveryMode: "conservative",
          allowExplicit: false,
          defaultLimit: 15,
          preferredTags: ["indie"],
        },
      });
    });

    it("clears User.name to null and resets nameCustomized to false when name is empty string or null", async () => {
      tx.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: { username: "ana_music", nameCustomized: true },
      });
      tx.user.update.mockResolvedValueOnce({ ...baseUser, name: null });
      tx.userPreferences.upsert.mockImplementationOnce(
        async ({ update }: { update: { settings: Record<string, unknown> } }) => ({
          userId: baseUser.id,
          settings: update.settings,
        }),
      );

      const emptyRes = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", { name: "" }),
      );

      expect(emptyRes.status).toBe(200);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: { name: null },
      });
      expect(
        (
          tx.userPreferences.upsert.mock.calls[0][0] as {
            update: { settings: Record<string, unknown> };
          }
        ).update.settings,
      ).toEqual({
        username: "ana_music",
        nameCustomized: false,
      });

      tx.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: { username: "ana_music", nameCustomized: true },
      });
      tx.user.update.mockResolvedValueOnce({ ...baseUser, name: null });
      tx.userPreferences.upsert.mockImplementationOnce(
        async ({ update }: { update: { settings: Record<string, unknown> } }) => ({
          userId: baseUser.id,
          settings: update.settings,
        }),
      );

      const nullRes = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", { name: null }),
      );
      expect(nullRes.status).toBe(200);
      expect(
        (
          tx.userPreferences.upsert.mock.calls[1][0] as {
            update: { settings: Record<string, unknown> };
          }
        ).update.settings.nameCustomized,
      ).toBe(false);
    });

    it("does not update User.name or mark nameCustomized when name equals lockedUser.name", async () => {
      tx.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: { theme: "dark" },
      });

      const response = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", {
          name: baseUser.name,
        }),
      );

      expect(response.status).toBe(200);
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.userPreferences.upsert).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({
        id: baseUser.id,
        name: baseUser.name,
      });
    });

    it("deletes username key when username: null is sent and updates username without touching user.name when name is omitted", async () => {
      tx.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: { username: "ana_old", theme: "dark" },
      });
      tx.userPreferences.upsert.mockImplementationOnce(
        async ({ update }: { update: { settings: Record<string, unknown> } }) => ({
          userId: baseUser.id,
          settings: update.settings,
        }),
      );

      const response = await patchProfile(
        jsonRequest("http://localhost/api/profile", "PATCH", { username: null }),
      );

      expect(response.status).toBe(200);
      expect(tx.user.update).not.toHaveBeenCalled();
      const upsertCall = tx.userPreferences.upsert.mock.calls[0][0] as {
        update: { settings: Record<string, unknown> };
      };
      expect(upsertCall.update.settings).toEqual({ theme: "dark" });
      expect("username" in upsertCall.update.settings).toBe(false);
    });
  });

  describe("DELETE /api/profile", () => {
    it("returns 401 without calling Clerk or DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);
      auth.mockResolvedValueOnce({ userId: null });

      const response = await deleteProfile();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(clerkClient).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 401 without calling Clerk when auth has userId but no soft-deleted user exists", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);
      auth.mockResolvedValueOnce({ userId: baseUser.clerkId });
      db.user.findUnique.mockResolvedValueOnce(null);

      const response = await deleteProfile();

      expect(response.status).toBe(401);
      expect(clerkClient).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("runs DB purge/soft-delete transaction BEFORE calling Clerk deleteUser, and skips Clerk if DB transaction fails", async () => {
      db.$transaction.mockRejectedValueOnce(new Error("db lock timeout"));

      const response = await deleteProfile();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(clerkClient).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    });

    it("returns 503 when DB transaction succeeds but Clerk deleteUser fails with a non-404 error", async () => {
      deleteUser.mockRejectedValueOnce(Object.assign(new Error("Clerk 500"), { status: 500 }));

      const response = await deleteProfile();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(deleteUser).toHaveBeenCalledWith(baseUser.clerkId);
      expect(db.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        deleteUser.mock.invocationCallOrder[0],
      );
    });

    it("tolerates Clerk 404 after purging user data and soft-deleting the user", async () => {
      deleteUser.mockRejectedValueOnce(Object.assign(new Error("Not found"), { status: 404 }));

      const response = await deleteProfile();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ deleted: true });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        deleteUser.mock.invocationCallOrder[0],
      );
    });

    it("locks user, purges all 7 child tables, soft-deletes user, and then deletes Clerk user", async () => {
      const response = await deleteProfile();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ deleted: true });
      expect(db.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        deleteUser.mock.invocationCallOrder[0],
      );
      expect(deleteUser).toHaveBeenCalledWith(baseUser.clerkId);

      const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sql = strings.join("?");
      expect(sql).toContain('SELECT "id" FROM "app"."users"');
      expect(sql).toContain('WHERE "id" = ?');
      expect(sql).toContain("FOR UPDATE");
      expect(values).toEqual([baseUser.id]);

      const expectedWhere = { where: { userId: baseUser.id } };
      expect(tx.userPreferences.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.userFavoriteRecording.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.userFavoriteArtist.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.playlist.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.userFeedback.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.recommendationEvent.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.recommendationRequest.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: {
          deletedAt: expect.any(Date),
          email: null,
          name: null,
          avatarUrl: null,
        },
      });
    });

    it("supports idempotent retry when user is already soft-deleted in DB and Clerk retry completes", async () => {
      const softDeletedUser = {
        ...baseUser,
        deletedAt: new Date("2025-03-01T00:00:00.000Z"),
        email: null,
        name: null,
        avatarUrl: null,
      };
      getCurrentUserProfile.mockResolvedValueOnce(null);
      auth.mockResolvedValueOnce({ userId: baseUser.clerkId });
      db.user.findUnique.mockResolvedValueOnce(softDeletedUser);

      const response = await deleteProfile();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted: true });
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { clerkId: baseUser.clerkId },
      });
      expect(tx.userPreferences.deleteMany).toHaveBeenCalledWith({
        where: { userId: softDeletedUser.id },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(deleteUser).toHaveBeenCalledWith(baseUser.clerkId);
    });

    it("rethrows Next.js redirect signals via unstable_rethrow", async () => {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);

      await expect(deleteProfile()).rejects.toBe(redirect);
    });
  });
});

describe("app/api/preferences/route.ts", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue(baseUser);
    getDb.mockReturnValue(db);
    db.userPreferences.findUnique.mockResolvedValue(null);
    db.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));
    tx.$queryRaw.mockResolvedValue([{ id: baseUser.id }]);
    tx.userPreferences.findUnique.mockResolvedValue(null);
    tx.userPreferences.upsert.mockResolvedValue({ userId: baseUser.id, settings: {} });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("GET /api/preferences", () => {
    it("returns 401 without calling DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await getPreferences();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 200 with defaults when no preferences exist and saved values when present", async () => {
      db.userPreferences.findUnique.mockResolvedValueOnce(null);
      const defaultRes = await getPreferences();
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.headers.get("cache-control")).toBe("private, no-store");
      expect(await defaultRes.json()).toEqual({
        preferences: DEFAULT_USER_PREFERENCES,
      });

      db.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: {
          discoveryMode: "conservative",
          allowExplicit: false,
          defaultLimit: 15,
          preferredTags: ["Ambient", "ambient", "IDM"],
        },
      });
      const savedRes = await getPreferences();
      expect(savedRes.status).toBe(200);
      expect(await savedRes.json()).toEqual({
        preferences: {
          discoveryMode: "conservative",
          allowExplicit: false,
          defaultLimit: 15,
          preferredTags: ["ambient", "idm"],
        },
      });
    });

    it("returns 503 without leaking DB errors", async () => {
      db.userPreferences.findUnique.mockRejectedValueOnce(new Error("internal pg password"));

      const response = await getPreferences();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain("internal pg password");
    });
  });

  describe("PUT /api/preferences", () => {
    it("returns 401 without calling DB when unauthenticated", async () => {
      getCurrentUserProfile.mockResolvedValueOnce(null);

      const response = await putPreferences(
        jsonRequest("http://localhost/api/preferences", "PUT", DEFAULT_USER_PREFERENCES),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("returns 400 on invalid payload without calling DB", async () => {
      const response = await putPreferences(
        jsonRequest("http://localhost/api/preferences", "PUT", {
          discoveryMode: "invalid",
          allowExplicit: true,
          defaultLimit: 10,
          preferredTags: [],
        }),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("executes SELECT ... FOR UPDATE before reading preferences and returns 401 if active user is not found", async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);

      const response = await putPreferences(
        jsonRequest("http://localhost/api/preferences", "PUT", DEFAULT_USER_PREFERENCES),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sql = strings.join("?");
      expect(sql).toContain('SELECT "id" FROM "app"."users"');
      expect(sql).toContain('WHERE "id" = ? AND "deletedAt" IS NULL');
      expect(sql).toContain("FOR UPDATE");
      expect(values).toEqual([baseUser.id]);
      expect(tx.userPreferences.findUnique).not.toHaveBeenCalled();
      expect(tx.userPreferences.upsert).not.toHaveBeenCalled();
    });

    it("returns 200 preserving username, nameCustomized, and unknown keys inside UserPreferences.settings", async () => {
      tx.userPreferences.findUnique.mockResolvedValueOnce({
        userId: baseUser.id,
        settings: {
          username: "ana_music",
          nameCustomized: true,
          customUiFlag: "compact",
          discoveryMode: "balanced",
        },
      });
      tx.userPreferences.upsert.mockImplementationOnce(
        async ({ update }: { update: { settings: Record<string, unknown> } }) => ({
          userId: baseUser.id,
          settings: update.settings,
        }),
      );

      const response = await putPreferences(
        jsonRequest("http://localhost/api/preferences", "PUT", {
          discoveryMode: "adventurous",
          allowExplicit: false,
          defaultLimit: 25,
          preferredTags: ["  Dream Pop ", "Shoegaze", "dream pop"],
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.userPreferences.findUnique.mock.invocationCallOrder[0],
      );

      const upsertCall = tx.userPreferences.upsert.mock.calls[0][0] as {
        where: { userId: string };
        create: { userId: string; settings: Record<string, unknown> };
        update: { settings: Record<string, unknown> };
      };
      expect(upsertCall.where).toEqual({ userId: baseUser.id });
      expect(upsertCall.update.settings).toEqual({
        username: "ana_music",
        nameCustomized: true,
        customUiFlag: "compact",
        discoveryMode: "adventurous",
        allowExplicit: false,
        defaultLimit: 25,
        preferredTags: ["dream pop", "shoegaze"],
      });

      expect(await response.json()).toEqual({
        preferences: {
          discoveryMode: "adventurous",
          allowExplicit: false,
          defaultLimit: 25,
          preferredTags: ["dream pop", "shoegaze"],
        },
      });
    });

    it("returns 503 on DB failure and rethrows NEXT_REDIRECT", async () => {
      db.$transaction.mockRejectedValueOnce(new Error("db timeout secret"));
      const errRes = await putPreferences(
        jsonRequest("http://localhost/api/preferences", "PUT", DEFAULT_USER_PREFERENCES),
      );
      expect(errRes.status).toBe(503);
      expect(await errRes.text()).not.toContain("db timeout secret");

      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307;",
      });
      getCurrentUserProfile.mockRejectedValueOnce(redirect);
      await expect(
        putPreferences(
          jsonRequest("http://localhost/api/preferences", "PUT", DEFAULT_USER_PREFERENCES),
        ),
      ).rejects.toBe(redirect);
    });
  });
});

describe("lib/users/sync.ts (syncProfile & purgeUserData)", () => {
  beforeEach(() => {
    getDb.mockReturnValue(db);
    db.$queryRaw.mockReset();
    db.user.findUniqueOrThrow.mockReset();
    db.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));
    tx.$queryRaw.mockReset();
    tx.user.findUniqueOrThrow.mockReset();
    tx.userPreferences.deleteMany.mockResolvedValue({ count: 1 });
    tx.userFavoriteRecording.deleteMany.mockResolvedValue({ count: 0 });
    tx.userFavoriteArtist.deleteMany.mockResolvedValue({ count: 0 });
    tx.playlist.deleteMany.mockResolvedValue({ count: 0 });
    tx.userFeedback.deleteMany.mockResolvedValue({ count: 0 });
    tx.recommendationEvent.deleteMany.mockResolvedValue({ count: 0 });
    tx.recommendationRequest.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("executes atomic upsert SQL protecting deleted users and preserving customized names when deletedAt is null", async () => {
    db.$queryRaw.mockResolvedValueOnce([baseUser]);

    const snapshot = {
      clerkId: baseUser.clerkId,
      email: "new@example.com",
      name: "Clerk Name",
      avatarUrl: "https://example.com/new.png",
      clerkUpdatedAt: new Date("2025-02-01T00:00:00.000Z"),
      deletedAt: null,
    };

    const result = await syncProfile(snapshot);

    expect(result).toEqual(baseUser);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);

    const [strings, ...values] = db.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join("?");

    expect(sql).toContain('WHERE "User"."deletedAt" IS NULL');
    expect(sql).toContain('WHEN EXCLUDED."deletedAt" IS NOT NULL THEN EXCLUDED."name"');
    expect(sql).toContain(
      `COALESCE("pref"."settings"->>'nameCustomized', 'false') = 'true'`,
    );
    expect(sql).toContain('THEN "User"."name"');
    expect(sql).toContain('ELSE EXCLUDED."name"');
    expect(sql).toContain('EXCLUDED."deletedAt" IS NOT NULL');
    expect(sql).toContain('EXCLUDED."clerkUpdatedAt" > "User"."clerkUpdatedAt"');

    expect(values).toEqual([
      expect.any(String),
      snapshot.clerkId,
      snapshot.email,
      snapshot.name,
      snapshot.avatarUrl,
      snapshot.clerkUpdatedAt,
      null,
    ]);
  });

  it("runs inside $transaction and purges all 7 child tables on user.deleted snapshots", async () => {
    const deletedRow = {
      ...baseUser,
      email: null,
      name: null,
      avatarUrl: null,
      deletedAt: new Date(5000),
    };
    tx.$queryRaw.mockResolvedValueOnce([deletedRow]);

    const snapshot = profileFromEvent({
      type: "user.deleted",
      timestamp: 5000,
      data: { id: baseUser.clerkId },
    } as WebhookEvent)!;

    const result = await syncProfile(snapshot);

    expect(result).toEqual(deletedRow);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    const [, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values).toEqual([
      expect.any(String),
      baseUser.clerkId,
      null,
      null,
      null,
      new Date(5000),
      new Date(5000),
    ]);

    const expectedWhere = { where: { userId: deletedRow.id } };
    expect(tx.userPreferences.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.userFavoriteRecording.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.userFavoriteArtist.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.playlist.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.userFeedback.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.recommendationEvent.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.recommendationRequest.deleteMany).toHaveBeenCalledWith(expectedWhere);
  });

  it("purgeUserData deletes all 7 child tables scoped by userId", async () => {
    await purgeUserData(tx, "target-user-id");

    const expectedWhere = { where: { userId: "target-user-id" } };
    expect(tx.userPreferences.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.userFavoriteRecording.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.userFavoriteArtist.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.playlist.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.userFeedback.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.recommendationEvent.deleteMany).toHaveBeenCalledWith(expectedWhere);
    expect(tx.recommendationRequest.deleteMany).toHaveBeenCalledWith(expectedWhere);
  });

  it("falls back to user.findUniqueOrThrow when $queryRaw returns an empty array", async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    db.user.findUniqueOrThrow.mockResolvedValueOnce(baseUser);

    const result = await syncProfile({
      clerkId: baseUser.clerkId,
      email: baseUser.email,
      name: baseUser.name,
      avatarUrl: baseUser.avatarUrl,
      clerkUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
      deletedAt: null,
    });

    expect(result).toEqual(baseUser);
    expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { clerkId: baseUser.clerkId },
    });
  });
});
