import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { syncProfile } from "@/lib/users/sync";

export async function getCurrentUserProfile() {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await getDb().user.findUnique({ where: { clerkId: userId } });
  if (existing) return existing.deletedAt ? null : existing;

  // Webhook delivery may lag behind the first authenticated request.
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const profile = await syncProfile({
    clerkId: userId,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    avatarUrl: user.hasImage ? user.imageUrl : null,
    clerkUpdatedAt: new Date(user.updatedAt),
    deletedAt: null,
  });

  return profile.deletedAt ? null : profile;
}
