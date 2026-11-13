import "server-only";
import type { RecommendationOptions, RecommendationResponse, Song } from "./musicbrainz-types";

export class MusicBrainzError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "MusicBrainzError";
  }
}

// FastAPI (backend/) concentra el acceso a MusicBrainz y las recomendaciones.
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

async function backend<T>(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new MusicBrainzError("No se pudo conectar con el backend de GraphU. Comprueba que esté en ejecución.", 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : "El backend de GraphU no pudo completar la solicitud.";
    throw new MusicBrainzError(detail, response.status >= 500 ? 503 : response.status);
  }
  return data as T;
}

export async function searchSongs(title: string, artist: string): Promise<Song[]> {
  const params = new URLSearchParams({ q: title, artist });
  return (await backend<{ songs: Song[] }>(`/api/music/search?${params}`)).songs;
}

export async function recommendSongs(seeds: string[], excludeArtists: string[] = [], options: RecommendationOptions = {}): Promise<RecommendationResponse> {
  return backend<RecommendationResponse>("/api/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seeds, excludeArtists, ...options }),
  }, 180_000); // Presupuesto backend de 45 s + finalizar una consulta/reintento ya en curso.
}
