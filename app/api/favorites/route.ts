import { unstable_rethrow } from "next/navigation";
import { listUserFavorites } from "@/lib/favorites/service";
import { getCurrentUserProfile } from "@/lib/users/current-user";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE }
      );
    }

    const favorites = await listUserFavorites(user.id);
    return Response.json(favorites, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    console.error("Unable to load user favorites.");
    return Response.json(
      { error: "No se pudieron cargar tus favoritos temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE }
    );
  }
}
