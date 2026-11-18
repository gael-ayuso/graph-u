import { unstable_rethrow } from "next/navigation";
import { removeFavoriteTrack } from "@/lib/favorites/service";
import { CatalogError } from "@/lib/music-library/catalog";
import { getCurrentUserProfile } from "@/lib/users/current-user";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

type Context = { params: Promise<{ recordingMbid: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE }
      );
    }

    const { recordingMbid } = await params;
    const result = await removeFavoriteTrack(user.id, recordingMbid);
    return Response.json(result, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CatalogError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: PRIVATE_NO_STORE }
      );
    }
    console.error("Unable to remove favorite track.");
    return Response.json(
      { error: "No se pudo quitar la canción de favoritos temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE }
    );
  }
}
