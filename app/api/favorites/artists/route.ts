import { unstable_rethrow } from "next/navigation";
import { addFavoriteArtist } from "@/lib/favorites/service";
import { CatalogError } from "@/lib/music-library/catalog";
import { getCurrentUserProfile } from "@/lib/users/current-user";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Solicitud no válida. Se requiere artistMbid." },
        { status: 400, headers: PRIVATE_NO_STORE }
      );
    }

    const rawMbid =
      typeof (body as { artistMbid?: unknown }).artistMbid === "string"
        ? (body as { artistMbid: string }).artistMbid
        : typeof (body as { artistId?: unknown }).artistId === "string"
          ? (body as { artistId: string }).artistId
          : "";

    const result = await addFavoriteArtist(user.id, rawMbid);
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: PRIVATE_NO_STORE,
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CatalogError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: PRIVATE_NO_STORE }
      );
    }
    console.error("Unable to add favorite artist.");
    return Response.json(
      { error: "No se pudo guardar el artista en favoritos temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE }
    );
  }
}
