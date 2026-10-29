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

export async function syncProfile(profile: ProfileSnapshot): Promise<User> {
  // One PostgreSQL statement serializes concurrent webhook/first-access writes.
  // A deletion is terminal even if an older update arrives afterwards.
  const rows = await getDb().$queryRaw<User[]>`
    INSERT INTO "User" (
      "id", "clerkId", "email", "name", "avatarUrl", "clerkUpdatedAt",
      "deletedAt", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${profile.clerkId}, ${profile.email}, ${profile.name},
      ${profile.avatarUrl}, ${profile.clerkUpdatedAt}, ${profile.deletedAt}, NOW(), NOW()
    )
    ON CONFLICT ("clerkId") DO UPDATE SET
      "email" = EXCLUDED."email",
      "name" = EXCLUDED."name",
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
  return rows[0] ?? getDb().user.findUniqueOrThrow({
    where: { clerkId: profile.clerkId },
  });
}
