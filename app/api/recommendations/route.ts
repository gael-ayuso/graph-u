import { MusicBrainzError, recommendSongs } from "@/lib/musicbrainz";

const MBID = /^[a-f0-9-]{36}$/i;
const ids = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((id) => typeof id === "string" && MBID.test(id));

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const seeds: unknown = body?.seeds;
  const excludeArtists: unknown = body?.excludeArtists ?? [];
  if (!ids(seeds, 10) || !seeds.length) {
    return Response.json({ error: "Elige entre 1 y 10 canciones de tu lista." }, { status: 400 });
  }
  if (!ids(excludeArtists, 200)) {
    return Response.json({ error: "La lista de artistas ya vistos no es válida." }, { status: 400 });
  }

  try {
    return Response.json(await recommendSongs(seeds, excludeArtists), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MusicBrainzError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "No se pudieron generar recomendaciones. Inténtalo de nuevo." }, { status: 502 });
  }
}
