import { MusicBrainzError, searchSongs } from "@/lib/musicbrainz";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = (params.get("q") || "").trim();
  const artist = (params.get("artist") || "").trim();
  if ((!title && !artist) || (title && title.length < 2) || (artist && artist.length < 2)
    || title.length > 150 || artist.length > 150) {
    return Response.json({ error: "Escribe entre 2 y 150 caracteres en canción o artista." }, { status: 400 });
  }

  try {
    return Response.json({ songs: await searchSongs(title, artist) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof MusicBrainzError) {
      return Response.json({ error: error.message }, {
        status: error.status,
        headers: error.status === 503 ? { "Retry-After": "3" } : undefined,
      });
    }
    return Response.json({ error: "No se pudo leer la base local de MusicBrainz. Inténtalo de nuevo." }, { status: 502 });
  }
}
