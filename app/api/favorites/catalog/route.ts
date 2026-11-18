import { unstable_rethrow } from "next/navigation";
import {
  CatalogError,
  searchCatalogArtists,
  searchCatalogRecordings,
} from "@/lib/music-library/catalog";
import { getCurrentUserProfile } from "@/lib/users/current-user";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return 15;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 25) return null;
  return parsed;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json(
        { error: "No autorizado." },
        { status: 401, headers: PRIVATE_NO_STORE }
      );
    }

    const params = new URL(request.url).searchParams;
    const rawType = (params.get("type") ?? "tracks").trim();
    if (rawType !== "tracks" && rawType !== "artists") {
      return Response.json(
        { error: "El parámetro type debe ser 'tracks' o 'artists'." },
        { status: 400, headers: PRIVATE_NO_STORE }
      );
    }

    const limit = parseLimit(params.get("limit"));
    if (limit === null) {
      return Response.json(
        { error: "El parámetro limit debe ser un entero entre 1 y 25." },
        { status: 400, headers: PRIVATE_NO_STORE }
      );
    }

    const query = (params.get("q") ?? "").trim();
    const artist = (params.get("artist") ?? "").trim();

    if (rawType === "artists") {
      if (query.length < 2 || query.length > 150) {
        return Response.json(
          { error: "Escribe entre 2 y 150 caracteres para buscar artistas." },
          { status: 400, headers: PRIVATE_NO_STORE }
        );
      }
      const items = await searchCatalogArtists(query, limit);
      return Response.json(
        { type: "artists", items },
        { headers: PRIVATE_NO_STORE }
      );
    }

    if (
      (!query && !artist) ||
      (query && query.length < 2) ||
      (artist && artist.length < 2) ||
      query.length > 150 ||
      artist.length > 150
    ) {
      return Response.json(
        { error: "Escribe entre 2 y 150 caracteres en canción o artista." },
        { status: 400, headers: PRIVATE_NO_STORE }
      );
    }

    const items = await searchCatalogRecordings(query, artist || undefined, limit);
    return Response.json(
      { type: "tracks", items },
      { headers: PRIVATE_NO_STORE }
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CatalogError) {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers:
            error.status === 503
              ? { ...PRIVATE_NO_STORE, "Retry-After": "3" }
              : PRIVATE_NO_STORE,
        }
      );
    }
    console.error("Unable to search favorites catalog.");
    return Response.json(
      { error: "No se pudo consultar el catálogo musical temporalmente." },
      { status: 503, headers: PRIVATE_NO_STORE }
    );
  }
}
