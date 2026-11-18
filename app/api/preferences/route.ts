import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCurrentUserProfile } from "@/lib/users/current-user";
import {
  extractUserPreferences,
  parseSettingsRecord,
  validatePreferencesPut,
} from "@/lib/users/profile-settings";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

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
      { preferences: extractUserPreferences(prefRow?.settings) },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Unable to load user preferences.");
    return Response.json(
      { error: "No se pudieron cargar tus preferencias temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE },
      );
    }

    const body = await request.json().catch(() => null);
    const validation = validatePreferencesPut(body);
    if (!validation.ok) {
      return Response.json(
        { error: validation.error },
        { status: 400, headers: PRIVATE_NO_STORE },
      );
    }

    const db = getDb();
    const saved = await db.$transaction(async (tx) => {
      const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "app"."users"
        WHERE "id" = ${user.id} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (lockedUsers.length === 0) {
        return null;
      }

      const existing = await tx.userPreferences.findUnique({
        where: { userId: user.id },
      });
      const nextSettings = {
        ...parseSettingsRecord(existing?.settings),
        ...validation.data,
      };
      const serializedSettings = JSON.parse(JSON.stringify(nextSettings));
      return tx.userPreferences.upsert({
        where: { userId: user.id },
        create: { userId: user.id, settings: serializedSettings },
        update: { settings: serializedSettings },
      });
    });

    if (!saved) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE },
      );
    }

    return Response.json(
      { preferences: extractUserPreferences(saved.settings) },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Unable to save user preferences.");
    return Response.json(
      { error: "No se pudieron guardar tus preferencias temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
}
