import type { SeedResult, Song } from "@/lib/musicbrainz-types";

export function RecommendationCoverage({ results, seeds }: { results: SeedResult[]; seeds: Song[] }) {
  if (!results.length) return null;
  return (
    <section className="seed-coverage" aria-label="Resultados por canción">
      <h3>Resultados por canción</h3>
      <ul className="song-results">
        {results.map((result) => {
          const seed = seeds.find((song) => song.id === result.seedId);
          return (
            <li className="seed-result" key={result.seedId}>
              <div className="song-info">
                <span className="song-title">{seed?.title ?? result.title}</span>
                <p>{seed?.artist ?? result.artist}</p>
                <p>{result.message}</p>
                {result.searchLimited && <p>La búsqueda fue limitada; podrían existir más resultados.</p>}
              </div>
              <span className="seed-result-status">{result.status === "recommended"
                ? `${result.recommendationIds.length} ${result.recommendationIds.length === 1 ? "resultado" : "resultados"}`
                : result.status === "unavailable" ? "Datos no disponibles"
                  : result.status === "limit" ? "Sin espacio en esta tanda"
                    : result.status === "search_limit" ? "Búsqueda limitada" : "Sin resultados"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
