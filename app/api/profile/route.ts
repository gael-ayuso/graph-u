import { auth, clerkClient } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCurrentUserProfile } from "@/lib/users/current-user";
import {
  extractUserPreferences,
  extractUsername,
  parseSettingsRecord,
  validateProfilePatch,
} from "@/lib/users/profile-settings";
import { purgeUserData } from "@/lib/users/sync";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function isClerkNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { status?: unknown }).status === 404;
}

export async function GET() {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE },
      );
    }

    const prefRow = await getDb().userPreferences.findUnique({
      where: { userId: user.id },
    });

    return Response.json(
      {
        id: user.id,
        username: extractUsername(prefRow?.settings),
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        preferences: extractUserPreferences(prefRow?.settings),
      },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Unable to load user profile.");
    return Response.json(
      { error: "No se pudo cargar tu perfil temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE },
      );
    }

    const body = await request.json().catch(() => null);
    const validation = validateProfilePatch(body);
    if (!validation.ok) {
      return Response.json(
        { error: validation.error },
        { status: 400, headers: PRIVATE_NO_STORE },
      );
    }

    const { name, username } = validation.data;
    const db = getDb();

    const updated = await db.$transaction(async (tx) => {
      const lockedUsers = await tx.$queryRaw<
        Array<{
          id: string;
          clerkId: string;
          email: string | null;
          name: string | null;
          avatarUrl: string | null;
        }>
      >`
        SELECT "id", "clerkId", "email", "name", "avatarUrl"
        FROM "app"."users"
        WHERE "id" = ${user.id} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const lockedUser = lockedUsers[0];
      if (!lockedUser) return null;

      const nameChanged = name !== undefined && name !== lockedUser.name;
      const updatedUser = nameChanged
        ? await tx.user.update({
            where: { id: user.id },
            data: { name },
          })
        : lockedUser;

      let prefRow = await tx.userPreferences.findUnique({
        where: { userId: user.id },
      });

      const nextSettings = parseSettingsRecord(prefRow?.settings);
      let shouldUpsertPrefs = false;

      if (username !== undefined) {
        if (username === null) {
          if ("username" in nextSettings) {
            delete nextSettings.username;
            shouldUpsertPrefs = true;
          }
        } else if (nextSettings.username !== username) {
          nextSettings.username = username;
          shouldUpsertPrefs = true;
        }
      }

      if (name !== undefined) {
        if (name === null) {
          if (nextSettings.nameCustomized !== false) {
            nextSettings.nameCustomized = false;
            shouldUpsertPrefs = true;
          }
        } else if (nameChanged && nextSettings.nameCustomized !== true) {
          nextSettings.nameCustomized = true;
          shouldUpsertPrefs = true;
        }
      }

      if (shouldUpsertPrefs) {
        const serializedSettings = JSON.parse(JSON.stringify(nextSettings));
        prefRow = await tx.userPreferences.upsert({
          where: { userId: user.id },
          create: { userId: user.id, settings: serializedSettings },
          update: { settings: serializedSettings },
        });
      }

      return { updatedUser, prefRow };
    });

    if (!updated) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE },
      );
    }

    return Response.json(
      {
        id: updated.updatedUser.id,
        username: extractUsername(updated.prefRow?.settings),
        name: updated.updatedUser.name,
        email: updated.updatedUser.email,
        avatarUrl: updated.updatedUser.avatarUrl,
        preferences: extractUserPreferences(updated.prefRow?.settings),
      },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Unable to update user profile.");
    return Response.json(
      { error: "No se pudo actualizar el perfil temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
}

export async function DELETE() {
  try {
    let targetUser = await getCurrentUserProfile();

    if (!targetUser) {
      const { userId } = await auth();
      if (!userId) {
        return Response.json(
          { error: "No autorizado." },
          { status: 401, headers: PRIVATE_NO_STORE },
        );
      }

      const existingDeleted = await getDb().user.findUnique({
        where: { clerkId: userId },
      });
      if (!existingDeleted || !existingDeleted.deletedAt) {
        return Response.json(
          { error: "No autorizado." },
          { status: 401, headers: PRIVATE_NO_STORE },
        );
      }

      targetUser = existingDeleted;
    }

    const db = getDb();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "app"."users"
        WHERE "id" = ${targetUser.id}
        FOR UPDATE
      `;
      await purgeUserData(tx, targetUser.id);
      if (!targetUser.deletedAt) {
        await tx.user.update({
          where: { id: targetUser.id },
          data: {
            deletedAt: new Date(),
            email: null,
            name: null,
            avatarUrl: null,
          },
        });
      }
    });

    try {
      const client = await clerkClient();
      await client.users.deleteUser(targetUser.clerkId);
    } catch (error) {
      if (!isClerkNotFoundError(error)) {
        console.error("Unable to delete Clerk user account.");
        return Response.json(
          { error: "No se pudo eliminar la cuenta en este momento." },
          { status: 503, headers: PRIVATE_NO_STORE },
        );
      }
    }

    return Response.json({ deleted: true }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    console.error("Unable to delete user profile.");
    return Response.json(
      { error: "No se pudo eliminar la cuenta temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
}
