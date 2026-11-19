import { MusicBrainzError, recommendSongs } from "@/lib/musicbrainz";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/users/current-user";
import { getDb } from "@/lib/db";
import { extractUserPreferences } from "@/lib/users/profile-settings";
import { recordRecommendations } from "@/lib/recommendation-actions";
import type { ExcludedVersion, RecommendationOptions } from "@/lib/musicbrainz-types";

const MBID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ids = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((id) => typeof id === "string" && MBID.test(id));

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const seeds: unknown = body?.seeds;
  const excludeArtists: unknown = body?.excludeArtists === undefined ? [] : body.excludeArtists;
  const excludeRecordings: unknown = body?.excludeRecordings === undefined ? [] : body.excludeRecordings;
  const excludeVersions: unknown = body?.excludeVersions === undefined ? [] : body.excludeVersions;
  const limit: unknown = body?.limit === undefined ? 10 : body.limit;
  const maxResults: unknown = body?.maxResults === undefined ? 30 : body.maxResults;
  if (!ids(seeds, 10) || !seeds.length) {
    return Response.json({ error: "Elige entre 1 y 10 canciones." }, { status: 400 });
  }
  if (!ids(excludeArtists, 200)) {
    return Response.json({ error: "La lista de artistas ya vistos no es válida." }, { status: 400 });
  }
  if (!ids(excludeRecordings, 200)) {
    return Response.json({ error: "La lista de canciones ya vistas no es válida." }, { status: 400 });
  }
  if (!Array.isArray(excludeVersions) || excludeVersions.length > 200 || !excludeVersions.every((version: unknown) => {
    if (!version || typeof version !== "object" || Array.isArray(version)) return false;
    const { artistId, title } = version as Record<string, unknown>;
    return typeof artistId === "string" && MBID.test(artistId) && typeof title === "string" && title.trim().length > 0;
  })) {
    return Response.json({ error: "La lista de versiones ya vistas no es válida." }, { status: 400 });
  }
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 30) {
    return Response.json({ error: "El límite debe ser un entero entre 1 y 30." }, { status: 400 });
  }
  if (typeof maxResults !== "number" || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 30) {
    return Response.json({ error: "La capacidad debe ser un entero entre 1 y 30." }, { status: 400 });
  }

  const canonicalSeeds = seeds.map((id) => id.toLowerCase());
  const canonicalArtists = excludeArtists.map((id) => id.toLowerCase());
  const options: RecommendationOptions = {
    limit,
    excludeRecordings: excludeRecordings.map((id) => id.toLowerCase()),
    excludeVersions: (excludeVersions as ExcludedVersion[]).map(({ artistId, title }) => ({ artistId: artistId.toLowerCase(), title })),
  };
  const forwardedOptions: RecommendationOptions = {
    ...(body.limit !== undefined ? { limit: options.limit } : {}),
    ...(body.excludeRecordings !== undefined ? { excludeRecordings: options.excludeRecordings } : {}),
    ...(body.excludeVersions !== undefined ? { excludeVersions: options.excludeVersions } : {}),
  };
  try {
    const user = await getCurrentUserProfile();
    if (user) {
      const preferences = await getDb().userPreferences.findUnique({ where: { userId: user.id } });
      const saved = extractUserPreferences(preferences?.settings);
      options.discoveryMode = saved.discoveryMode;
      options.allowExplicit = saved.allowExplicit;
      options.preferredTags = saved.preferredTags;
      options.limit = Math.min(body.limit === undefined ? saved.defaultLimit : limit, maxResults);
      forwardedOptions.discoveryMode = options.discoveryMode;
      forwardedOptions.allowExplicit = options.allowExplicit;
      forwardedOptions.preferredTags = options.preferredTags;
      forwardedOptions.limit = options.limit;
    } else if (body.maxResults !== undefined) {
      options.limit = Math.min(limit, maxResults);
      forwardedOptions.limit = options.limit;
    }
    const data = await recommendSongs(canonicalSeeds, canonicalArtists, forwardedOptions);
    return Response.json(user ? await recordRecommendations(user.id, canonicalSeeds, canonicalArtists, data, options) : data,
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof MusicBrainzError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "No se pudieron generar recomendaciones. Inténtalo de nuevo." }, { status: 502 });
  }
}
