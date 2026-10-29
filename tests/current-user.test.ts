import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUserProfile } from "@/lib/users/current-user";
import { GET } from "@/app/api/me/route";

const { auth, getUser, findUnique, syncProfile } = vi.hoisted(() => ({
  auth: vi.fn(), getUser: vi.fn(), findUnique: vi.fn(), syncProfile: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth,
  clerkClient: async () => ({ users: { getUser } }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ user: { findUnique } }) }));
vi.mock("@/lib/users/sync", () => ({ syncProfile }));

const profile = {
  id: "internal-id", clerkId: "user_alice", name: "Alice", email: null,
  avatarUrl: null, deletedAt: null, clerkUpdatedAt: new Date(1000),
  createdAt: new Date(1000), updatedAt: new Date(1000),
};

describe("authenticated profile", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ userId: "user_alice" });
    findUnique.mockResolvedValue(profile);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 401 without accessing PostgreSQL for an anonymous visitor", async () => {
    auth.mockResolvedValue({ userId: null });
    expect((await GET()).status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("looks up only the authenticated identity and does not cache the response", async () => {
    const response = await GET();
    expect(findUnique).toHaveBeenCalledWith({ where: { clerkId: "user_alice" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ user: {
      id: profile.id, clerkId: profile.clerkId, email: null, name: "Alice",
      avatarUrl: null, createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    } });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("isolates profiles for different authenticated users", async () => {
    await getCurrentUserProfile();
    auth.mockResolvedValue({ userId: "user_bob" });
    findUnique.mockResolvedValue({ ...profile, clerkId: "user_bob", id: "bob-id" });
    const result = await getCurrentUserProfile();
    expect(findUnique).toHaveBeenLastCalledWith({ where: { clerkId: "user_bob" } });
    expect(result?.id).toBe("bob-id");
  });

  it("creates a missing profile from Clerk before the webhook arrives", async () => {
    findUnique.mockResolvedValue(null);
    getUser.mockResolvedValue({
      firstName: "Alice", lastName: null, primaryEmailAddress: null,
      hasImage: false, updatedAt: 1000,
    });
    syncProfile.mockResolvedValue(profile);
    expect(await getCurrentUserProfile()).toEqual(profile);
    expect(getUser).toHaveBeenCalledWith("user_alice");
    expect(syncProfile).toHaveBeenCalledWith({
      clerkId: "user_alice", name: "Alice", email: null, avatarUrl: null,
      clerkUpdatedAt: new Date(1000), deletedAt: null,
    });
  });

  it("does not restore a deleted profile", async () => {
    findUnique.mockResolvedValue({ ...profile, deletedAt: new Date() });
    expect((await GET()).status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("denies access when a deletion wins the first-access race", async () => {
    findUnique.mockResolvedValue(null);
    getUser.mockResolvedValue({ firstName: "Alice", updatedAt: 1000 });
    syncProfile.mockResolvedValue({ ...profile, deletedAt: new Date() });
    expect((await GET()).status).toBe(401);
  });

  it("returns a generic retryable error when PostgreSQL is down", async () => {
    findUnique.mockRejectedValueOnce(new Error("private connection details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private connection details");
  });

  it("preserves Next.js control flow instead of treating it as a database error", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/sign-in;307;",
    });
    auth.mockRejectedValueOnce(redirect);
    await expect(GET()).rejects.toBe(redirect);
  });
});
