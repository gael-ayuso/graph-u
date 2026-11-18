import "server-only";

import { randomUUID } from "node:crypto";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import { getDb } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";

export type ProfileSnapshot = {
  clerkId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  clerkUpdatedAt: Date;
  deletedAt: Date | null;
};

export type PurgeTx = {
  userPreferences: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  userFavoriteRecording: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  userFavoriteArtist: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  playlist: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  userFeedback: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  recommendationEvent: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  recommendationRequest: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
};

export async function purgeUserData(tx: PurgeTx, userId: string): Promise<void> {
  await tx.userPreferences.deleteMany({ where: { userId } });
  await tx.userFavoriteRecording.deleteMany({ where: { userId } });
  await tx.userFavoriteArtist.deleteMany({ where: { userId } });
  await tx.playlist.deleteMany({ where: { userId } });
  await tx.userFeedback.deleteMany({ where: { userId } });
  await tx.recommendationEvent.deleteMany({ where: { userId } });
  await tx.recommendationRequest.deleteMany({ where: { userId } });
}

export function profileFromEvent(event: WebhookEvent): ProfileSnapshot | null {
  if (event.type === "user.deleted") {
    if (!event.data.id) throw new Error("Missing Clerk user ID.");
    return {
      clerkId: event.data.id,
      email: null,
      name: null,
      avatarUrl: null,
      clerkUpdatedAt: new Date(event.timestamp),
      deletedAt: new Date(event.timestamp),
    };
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    return null;
  }

  const user = event.data;
  return {
    clerkId: user.id,
    email: user.email_addresses.find(
      (email) => email.id === user.primary_email_address_id,
    )?.email_address ?? null,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
    avatarUrl: user.has_image ? user.image_url : null,
    clerkUpdatedAt: new Date(user.updated_at),
    deletedAt: null,
  };
}

async function upsertSyncedUser(
  executor: Pick<ReturnType<typeof getDb>, "$queryRaw" | "user">,
  profile: ProfileSnapshot,
): Promise<User> {
  const rows = await executor.$queryRaw<User[]>`
    INSERT INTO "app"."users" AS "User" (
      "id", "clerkId", "email", "name", "avatarUrl", "clerkUpdatedAt",
      "deletedAt", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${profile.clerkId}, ${profile.email}, ${profile.name},
      ${profile.avatarUrl}, ${profile.clerkUpdatedAt}, ${profile.deletedAt}, NOW(), NOW()
    )
    ON CONFLICT ("clerkId") DO UPDATE SET
      "email" = EXCLUDED."email",
      "name" = CASE
        WHEN EXCLUDED."deletedAt" IS NOT NULL THEN EXCLUDED."name"
        WHEN EXISTS (
          SELECT 1 FROM "app"."user_preferences" AS "pref"
          WHERE "pref"."userId" = "User"."id"
            AND COALESCE("pref"."settings"->>'nameCustomized', 'false') = 'true'
        ) THEN "User"."name"
        ELSE EXCLUDED."name"
      END,
      "avatarUrl" = EXCLUDED."avatarUrl",
      "clerkUpdatedAt" = EXCLUDED."clerkUpdatedAt",
      "deletedAt" = EXCLUDED."deletedAt",
      "updatedAt" = NOW()
    WHERE "User"."deletedAt" IS NULL
      AND (EXCLUDED."deletedAt" IS NOT NULL
        OR EXCLUDED."clerkUpdatedAt" > "User"."clerkUpdatedAt")
    RETURNING *
  `;

  // An ignored duplicate or stale write does not return a row.
  return rows[0] ?? executor.user.findUniqueOrThrow({
    where: { clerkId: profile.clerkId },
  });
}

export async function syncProfile(profile: ProfileSnapshot): Promise<User> {
  // One PostgreSQL statement serializes concurrent webhook/first-access writes.
  // A deletion is terminal even if an older update arrives afterwards.
  // Preserve app-customized display names across subsequent Clerk updates,
  // while still clearing name and purging child rows on terminal deletion.
  if (profile.deletedAt !== null) {
    return getDb().$transaction(async (tx) => {
      const deletedUser = await upsertSyncedUser(tx, profile);
      await purgeUserData(tx, deletedUser.id);
      return deletedUser;
    });
  }

  return upsertSyncedUser(getDb(), profile);
}
