"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GraphNode, RecommendationResponse } from "@/lib/musicbrainz-types";
import { readSongs, snapshot, subscribe } from "@/components/song-demo";

// vis-network usa window: se carga solo en el navegador.
const VisGraph = dynamic(() => import("react-vis-graph-wrapper"), { ssr: false });

// Paleta Gruvbox Dark de DESIGN.md.
const COLORS = { seed: "#fabd2f", tag: "#8ec07c", signal: "#83a598", artist: "#fe8019", song: "#b8bb26", ink: "#282828", cream: "#ebdbb2", olive: "#665c54" };
const LEGEND: [GraphNode["type"], string][] = [["seed", "Tu canción"], ["tag", "Etiqueta"], ["signal", "Last.fm / colaboración"], ["artist", "Artista"], ["song", "Recomendada"]];

function percent(score?: number) {
  return score === undefined ? "" : `${Math.round(score * 100)}% parecido`;
}

function visNode(node: GraphNode) {
  const color = COLORS[node.type];
  const box = node.type === "seed" || node.type === "song";
  return {
    id: node.id,
    label: node.type === "tag" ? `#${node.label}` : node.label,
    title: [node.label, node.detail, percent(node.score)].filter(Boolean).join("\n"),
    shape: box ? "box" : node.type === "artist" ? "dot" : "text",
    size: node.type === "artist" ? 6 + 20 * (node.score ?? 0) : undefined,
    shapeProperties: { borderRadius: 0 },
    color: { background: box ? color : COLORS.ink, border: color, highlight: { background: COLORS.cream, border: COLORS.cream } },
    font: { color: box ? COLORS.ink : color, face: "Geist Mono, monospace", size: node.type === "seed" ? 16 : 13 },
    level: { seed: 0, tag: 1, signal: 1, artist: 2, song: 3 }[node.type],
  };
}

const OPTIONS = {
  height: "640px",
  autoResize: true,
  layout: { hierarchical: { direction: "LR", sortMethod: "directed", levelSeparation: 230, nodeSpacing: 64 } },
  physics: false,
  edges: { color: { color: COLORS.olive, highlight: COLORS.seed }, arrows: { to: { enabled: true, scaleFactor: 0.4 } }, smooth: { enabled: true, type: "cubicBezier", forceDirection: "horizontal", roundness: 0.4 } },
  interaction: { hover: true, tooltipDelay: 120 },
};

export function GraphExplorer() {
  // null en el servidor: la lista vive en el almacenamiento del navegador.
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const seeds = useMemo(() => (raw === null ? null : readSongs(raw).slice(0, 10)), [raw]);
  const seedKey = seeds?.map((song) => song.id).join(",") ?? "";
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  // Artistas ya mostrados; «Otras recomendaciones» los excluye para traer artistas nuevos.
  const [excluded, setExcluded] = useState<string[]>([]);
  const excludedKey = excluded.join(",");

  function reload(excludeArtists: string[]) {
    setData(null);
    setSelected(null);
    setError("");
    setExcluded(excludeArtists);
  }

  useEffect(() => {
    if (!seedKey) return;
    const request = new AbortController();
    fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seeds: seedKey.split(","), excludeArtists: excludedKey ? excludedKey.split(",") : [] }),
      signal: request.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo generar el grafo.");
        if (!body.graph || !Array.isArray(body.graph.nodes)) throw new Error("No se pudo leer el grafo.");
        setData(body);
      })
      .catch((failure) => { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo generar el grafo."); });
    return () => request.abort();
  }, [seedKey, excludedKey]);

  const graph = useMemo(() => data && { nodes: data.graph.nodes.map(visNode), edges: data.graph.edges.map((edge) => ({ ...edge, id: `${edge.from}>${edge.to}` })) }, [data]);
  const byId = useMemo(() => new Map(data?.graph.nodes.map((node) => [node.id, node])), [data]);
  // El "por qué" de un nodo: las etiquetas y señales que llegan hasta él.
  const reasons = useMemo(() => {
    if (!selected || !data) return [];
    const parents = (id: string) => data.graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    const artistIds = selected.type === "song" ? parents(selected.id) : selected.type === "artist" ? [selected.id] : [];
    return [...new Set(artistIds.flatMap(parents))].map((id) => byId.get(id)?.label).filter(Boolean);
  }, [selected, data, byId]);

  const exhausted = excluded.length > 0 && data?.recommendations.length === 0;

  if (seeds === null) return <p className="song-empty">Cargando tu lista…</p>;
  if (!seeds.length) return <p className="song-empty">Tu lista está vacía. <Link href="/demo">Añade canciones en la demo</Link> y vuelve para ver su grafo.</p>;

  return (
    <>
      {error && <p className="demo-error" role="alert">{error}</p>}
      <section className="song-panel graph-panel" aria-labelledby="graph-title" aria-busy={!data && !error}>
        <div className="song-panel-header">
          <h2 id="graph-title">Grafo de recomendaciones</h2>
          <ul className="graph-legend">{LEGEND.map(([type, label]) => <li key={type}><span style={{ background: COLORS[type] }} aria-hidden="true" />{label}</li>)}</ul>
        </div>
        {graph ? (
          graph.nodes.length ? (
            <div className="graph-canvas" role="img" aria-label={`Grafo con ${seeds.length} canciones semilla, ${data!.recommendations.length} recomendaciones y las etiquetas que las conectan.`}>
              <VisGraph graph={graph} options={OPTIONS} events={{ select: ({ nodes }: { nodes: string[] }) => setSelected(byId.get(nodes[0]) ?? null) }} />
            </div>
          ) : <p className="song-empty">{exhausted ? "Ya te mostramos todos los artistas parecidos que encontramos." : "No encontramos canciones parecidas. Prueba con otras canciones en tu lista."}</p>
        ) : !error && <p className="song-empty">Comparando etiquetas, Last.fm y colaboraciones… la primera vez puede tardar unos segundos.</p>}
        {data && (
          <p className="search-footnote list-actions">
            {exhausted
              ? <button type="button" className="demo-button demo-button-small" onClick={() => reload([])}>Empezar de nuevo</button>
              : <button type="button" className="demo-button demo-button-small" onClick={() => reload([...new Set([...excluded, ...data.recommendations.map((rec) => rec.artistId)])].slice(-200))}>Otras recomendaciones</button>}
            <span>¿No te convencen? Te mostramos artistas distintos con los mismos criterios.</span>
          </p>
        )}
        <p className="search-footnote" aria-live="polite">
          {selected
            ? <>{selected.label}{selected.detail && ` · ${selected.detail}`}{selected.score !== undefined && ` · ${percent(selected.score)}`}{reasons.length > 0 && ` · conectado por ${reasons.join(", ")}`}</>
            : "Lee el grafo de izquierda a derecha: tu canción → etiquetas, similitud en Last.fm o colaboraciones → artistas parecidos → canciones recomendadas. Selecciona un nodo para ver por qué aparece."}
        </p>
      </section>
    </>
  );
}
