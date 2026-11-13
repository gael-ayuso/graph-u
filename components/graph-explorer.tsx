"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Network, Node, Options } from "react-vis-graph-wrapper";
import dynamic from "next/dynamic";
import type { GraphNode } from "@/lib/musicbrainz-types";
import { projectRecommendationGraph } from "@/lib/recommendation-graph";
import { SELECTION_CAP } from "@/lib/recommendation-exploration";
import { readSongs, snapshot, subscribe } from "@/lib/saved-song-list";
import { RecommendationCoverage } from "@/components/recommendation-coverage";
import { RecommendationActions, SavedRecommendationsPanel } from "@/components/recommendation-library";
import { useRecommendationExploration } from "@/components/recommendation-exploration-provider";
import { BatchSelector, ExplorationBatches, ExplorationControls } from "@/components/exploration-batches";

// vis-network usa window: se carga solo en el navegador.
const VisGraph = dynamic(() => import("react-vis-graph-wrapper"), { ssr: false });

export type VisNetworkLike = {
  renderer?: unknown;
  redraw?: () => unknown;
  setOptions?: (options: Options) => unknown;
};

const guardedNetworks = new WeakSet<object>();

// react-vis-graph-wrapper puede invocar redraw() o setOptions() sobre una instancia
// ya destruida (donde vis-network eliminó this.renderer) al redimensionar o recargar.
export function guardVisNetwork(network: VisNetworkLike | null | undefined) {
  if (!network || typeof network !== "object" || guardedNetworks.has(network)) return;
  guardedNetworks.add(network);

  if (typeof network.redraw === "function") {
    const originalRedraw = network.redraw.bind(network);
    network.redraw = () => {
      if (!network.renderer) return;
      return originalRedraw();
    };
  }

  if (typeof network.setOptions === "function") {
    const originalSetOptions = network.setOptions.bind(network);
    network.setOptions = (options: Options) => {
      if (!network.renderer) return;
      return originalSetOptions(options);
    };
  }
}

// Paleta Gruvbox Dark de DESIGN.md.
const COLORS = { seed: "#fabd2f", tag: "#8ec07c", signal: "#83a598", artist: "#fe8019", song: "#b8bb26", status: "#ebdbb2", ink: "#282828", cream: "#ebdbb2", olive: "#665c54" };
const LEGEND: [GraphNode["type"], string][] = [["seed", "Tu canción"], ["tag", "Etiqueta"], ["signal", "Last.fm / colaboración"], ["artist", "Artista"], ["song", "Recomendada"], ["status", "Sin resultados"]];

function percent(score?: number) {
  return score === undefined ? "" : `${Math.round(score * 100)}% parecido`;
}

type GraphView = "free" | "hierarchical";

function visNode(node: GraphNode, view: GraphView, depth?: number): Node {
  const color = COLORS[node.type];
  const box = node.type === "seed" || node.type === "song";
  if (view === "hierarchical") {
    return {
      id: node.id,
      label: node.type === "tag" ? `#${node.label}` : node.label,
      title: [node.label, node.detail, percent(node.score)].filter(Boolean).join("\n"),
      shape: box ? "box" : node.type === "artist" ? "dot" : "text",
      size: node.type === "artist" ? 6 + 20 * (node.score ?? 0) : undefined,
      shapeProperties: { borderRadius: 0 },
      color: { background: box ? color : COLORS.ink, border: color, highlight: { background: box ? color : COLORS.ink, border: COLORS.cream } },
      font: { color: box ? COLORS.ink : color, face: "Geist Mono, monospace", size: node.type === "seed" ? 16 : 13 },
      level: depth ?? { seed: 0, tag: 1, signal: 1, artist: 2, song: 3, status: 1 }[node.type],
    };
  }
  return {
    id: node.id,
    label: node.type === "tag" ? `#${node.label}` : node.label,
    title: [node.label, node.detail, percent(node.score)].filter(Boolean).join("\n"),
    shape: node.type === "artist" ? "dot" : "box",
    size: node.type === "artist" ? 12 + 14 * (node.score ?? 0) : undefined,
    shapeProperties: { borderRadius: 0 },
    color: {
      background: box || node.type === "artist" ? color : COLORS.ink,
      border: color,
      highlight: { background: box || node.type === "artist" ? color : COLORS.ink, border: COLORS.cream },
      hover: { background: box || node.type === "artist" ? color : COLORS.ink, border: COLORS.cream },
    },
    font: { color: box ? COLORS.ink : color, face: "Geist Mono, monospace", size: node.type === "seed" ? 16 : 13, strokeWidth: node.type === "artist" ? 4 : 0, strokeColor: COLORS.ink },
    margin: { top: 10, right: 14, bottom: 10, left: 14 },
    widthConstraint: { maximum: 220 },
    borderWidth: node.type === "seed" ? 2 : 1,
    borderWidthSelected: 2,
  };
}

/** Nodos alcanzables desde `start` siguiendo las aristas hacia delante o hacia atrás. */
function reach(edges: { from: string; to: string }[], start: string, forward: boolean) {
  const seen = new Set([start]);
  const queue = [start];
  for (const id of queue) {
    for (const edge of edges) {
      const [from, to] = forward ? [edge.from, edge.to] : [edge.to, edge.from];
      if (from === id && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

const OPTIONS = {
  height: "100%",
  autoResize: true,
  layout: { hierarchical: false, improvedLayout: true, randomSeed: 24 },
  physics: {
    enabled: true,
    solver: "barnesHut",
    barnesHut: { gravitationalConstant: -6000, centralGravity: 0.08, springLength: 180, springConstant: 0.025, damping: 0.35, avoidOverlap: 0.6 },
    maxVelocity: 22,
    minVelocity: 0.3,
    stabilization: { enabled: true, iterations: 200, fit: true },
  },
  edges: {
    width: 1.2,
    color: { color: COLORS.cream, highlight: COLORS.seed, hover: COLORS.cream, inherit: false, opacity: 0.35 },
    arrows: { to: { enabled: true, scaleFactor: 0.35 } },
    smooth: { enabled: true, type: "continuous", roundness: 0.15 },
    selectionWidth: 1.5,
  },
  interaction: { hover: true, tooltipDelay: 80, dragNodes: true, dragView: true, zoomView: true, keyboard: { enabled: true, bindToWindow: false }, hideEdgesOnDrag: false },
} satisfies Options;

const HIERARCHICAL_OPTIONS: Options = {
  height: "100%",
  autoResize: true,
  layout: { hierarchical: { direction: "LR", sortMethod: "directed", levelSeparation: 230, nodeSpacing: 64 } },
  physics: false,
  edges: { color: { color: COLORS.olive, highlight: COLORS.seed }, arrows: { to: { enabled: true, scaleFactor: 0.4 } }, smooth: { enabled: true, type: "cubicBezier", forceDirection: "horizontal", roundness: 0.4 } },
  interaction: OPTIONS.interaction,
};

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function motionSnapshot() { return window.matchMedia(reducedMotionQuery).matches; }
function serverMotionSnapshot() { return true; }

export function GraphExplorer() {
  const { state, select } = useRecommendationExploration();
  const networkRef = useRef<Network | null>(null);
  const [view, setView] = useState<GraphView>("free");
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
  const [paused, setPaused] = useState(false);
  const motionEnabled = view === "free" && !paused && !reducedMotion;
  const options = useMemo<Options>(() => view === "hierarchical"
    ? HIERARCHICAL_OPTIONS
    : { ...OPTIONS, physics: { ...OPTIONS.physics, enabled: motionEnabled } }, [view, motionEnabled]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const saved = useMemo(() => (raw === null ? null : readSongs(raw)), [raw]);
  const batch = state.batches.find((entry) => entry.id === state.focusedBatchId);
  const requestKey = batch?.id ?? "all";
  const seeds = useMemo(() => batch?.inputs ?? [], [batch]);
  const data = batch?.response;
  const { originals, batches } = state;
  const projection = useMemo(() => {
    try { return { graph: projectRecommendationGraph({ originals, batches }), error: false }; }
    catch { return { graph: null, error: true }; }
  }, [originals, batches]);
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const selectedId = selection?.key === requestKey ? selection.id : null;
  const detailById = useMemo(() => new Map(data?.graph.nodes.map((node) => [node.id, node])), [data]);
  const summaryById = useMemo(() => new Map(projection.graph?.nodes.map((node) => [node.id, node])), [projection.graph]);
  const graph = useMemo(() => {
    const edges = batch && data ? data.graph.edges : projection.graph?.edges;
    const nodeExists = batch && data ? detailById.has(selectedId ?? "") : summaryById.has(selectedId ?? "");
    const ancestors = selectedId && edges && nodeExists ? reach(edges, selectedId, false) : null;
    const descendants = selectedId && edges && nodeExists ? reach(edges, selectedId, true) : null;
    const onPath = (id: string) => !!ancestors?.has(id) || !!descendants?.has(id);
    const styleNode = (node: Node) => ({ ...node, opacity: ancestors && !onPath(String(node.id)) ? 0.2 : 1 });
    const styleEdge = <T extends { from: string; to: string }>(edge: T) => {
      const normal = view === "free"
        ? { width: OPTIONS.edges.width, color: OPTIONS.edges.color }
        : { width: 1, color: { color: COLORS.olive, highlight: COLORS.seed, opacity: 1 } };
      if (!ancestors || !descendants) return { ...edge, ...normal };
      const highlighted = (ancestors.has(edge.from) && ancestors.has(edge.to)) || (descendants.has(edge.from) && descendants.has(edge.to));
      return { ...edge, width: highlighted ? 2 : 1, color: { ...normal.color, color: highlighted ? COLORS.seed : COLORS.olive, opacity: highlighted ? 1 : 0.15 } };
    };
    if (batch && data) return {
      nodes: data.graph.nodes.map((node) => {
        const seed = node.type === "seed" ? seeds.find((song) => `seed:${song.id}` === node.id) : null;
        return styleNode(visNode(seed ? { ...node, label: seed.title, detail: seed.artist } : node, view));
      }),
      edges: data.graph.edges.map((edge) => styleEdge({ ...edge, id: `${edge.from}>${edge.to}` })),
    };
    if (!projection.graph) return null;
    return {
      nodes: projection.graph.nodes.map((node) => styleNode(visNode({ id: node.id, type: node.batchId ? "song" : "seed", label: node.song.title, detail: node.song.artist }, view, node.depth))),
      edges: projection.graph.edges.map(({ id, from, to }) => styleEdge({ id, from, to })),
    };
  }, [batch, data, seeds, projection.graph, view, selectedId, detailById, summaryById]);
  const events = useMemo(() => ({ select: ({ nodes }: { nodes: string[] }) => setSelection({ key: requestKey, id: nodes[0] ?? "" }) }), [requestKey]);
  const handleNetwork = useCallback((network: Network) => { guardVisNetwork(network); networkRef.current = network; }, []);
  function centerGraph() {
    const network = networkRef.current;
    if (!network || !(network as Network & VisNetworkLike).renderer) return;
    network.fit({ animation: false });
  }
  const selectedDetail = selectedId && batch ? detailById.get(selectedId) : undefined;
  const selectedSummary = selectedId && !batch ? summaryById.get(selectedId) : undefined;
  const selectedSongId = selectedSummary?.song.id ?? (selectedDetail && (selectedDetail.type === "song" || selectedDetail.type === "seed") ? selectedDetail.id.slice(selectedDetail.id.indexOf(":") + 1) : undefined);
  const selectedEntry = selectedSongId ? state.songsById[selectedSongId] : undefined;
  const selectedBatch = selectedEntry?.batchId ? state.batches.find((entry) => entry.id === selectedEntry.batchId) : undefined;
  const selectedRecommendation = selectedBatch?.response.recommendations.find((rec) => rec.song.id === selectedSongId);
  const available = batch
    ? batch.response.recommendations.map((rec) => ({ recommendation: rec, batch }))
    : state.batches.flatMap((entry) => entry.response.recommendations.map((rec) => ({ recommendation: rec, batch: entry })));
  const active = selectedId ? (selectedRecommendation && selectedBatch ? { recommendation: selectedRecommendation, batch: selectedBatch } : undefined) : available[0];
  const checked = !!active && state.selectedIds.includes(active.recommendation.song.id);
  const reasonText = selectedDetail && data ? (() => {
    const parents = (id: string) => data.graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    const artists = selectedDetail.type === "song" ? parents(selectedDetail.id) : selectedDetail.type === "artist" ? [selectedDetail.id] : [];
    return [...new Set(artists.flatMap(parents))].map((id) => detailById.get(id)?.label).filter(Boolean);
  })() : [];
  const originText = active?.recommendation.reasons.map((reason) => {
    const song = state.songsById[reason.seedId]?.song;
    return song ? `${song.title} · ${song.artist}` : reason.seedId;
  }).join(", ");

  return <>
    <ExplorationControls saved={saved ?? []} />
    <BatchSelector />
    {state.batches.length > 0 && <section className="song-panel graph-panel" aria-labelledby="graph-title" aria-busy={!!state.pending}>
      <div className="song-panel-header">
        <h2 id="graph-title">{batch ? "Detalle de tanda" : "Exploración completa"}</h2>
        <ul className="graph-legend">{LEGEND.filter(([type]) => batch || type === "seed" || type === "song").map(([type, label]) => <li key={type}><span style={{ background: COLORS[type] }} aria-hidden="true" />{label}</li>)}</ul>
      </div>
      <p className="list-note">{batch ? `Tanda ${state.batches.indexOf(batch) + 1}. Entradas: ${seeds.map((song) => `${song.title} · ${song.artist}`).join(", ")}.` : "Cada flecha indica qué canción dio lugar a una recomendación. Selecciona una tanda para ver sus razones completas."}</p>
      {projection.error ? <p role="alert">No se puede mostrar el grafo: el historial de exploración contiene referencias inválidas.</p> : graph?.nodes.length ? <>
        <div className="graph-toolbar" role="group" aria-label="Controles del grafo">
          <div className="graph-actions">
            <div className="graph-view-switch" role="group" aria-label="Distribución del grafo">
              <button type="button" aria-pressed={view === "free"} onClick={() => setView("free")}>Libre</button>
              <button type="button" aria-pressed={view === "hierarchical"} onClick={() => setView("hierarchical")}>Por niveles</button>
            </div>
            <button type="button" className="demo-button demo-button-small" onClick={centerGraph}>Centrar grafo</button>
            {view === "free" && <button type="button" className="demo-button demo-button-small" aria-pressed={!motionEnabled} disabled={reducedMotion} onClick={() => setPaused((value) => !value)}>{motionEnabled ? "Pausar movimiento" : "Activar movimiento"}</button>}
          </div>
          <p id="graph-help">{view === "hierarchical" ? "Conexiones de izquierda a derecha, sin repulsión." : reducedMotion ? "Movimiento reducido activo. Puedes mover cada nodo manualmente." : "Arrastra los nodos para separarlos. Desplaza el fondo y usa el zoom para explorar."}</p>
        </div>
        <div className="graph-interactive">
          {available.length > 0 && <section className="graph-song-actions" aria-labelledby="graph-song-actions-title">
            <h3 id="graph-song-actions-title">Guardar y evaluar</h3>
            <p className="graph-action-help">Elige una canción aquí o pulsa un nodo del grafo.</p>
            <label htmlFor="graph-action-song">Canción recomendada</label>
            <select id="graph-action-song" value={active?.recommendation.song.id ?? ""} onChange={(event) => setSelection({ key: requestKey, id: `${batch ? (batch.inputs.some((song) => song.id === event.target.value) ? "seed" : "song") : "recording"}:${event.target.value}` })}>
              {!active && <option value="">Elige una canción</option>}
              {active && !available.some(({ recommendation }) => recommendation.song.id === active.recommendation.song.id) && <option value={active.recommendation.song.id}>{active.recommendation.song.title} · {active.recommendation.song.artist} · Tanda {state.batches.indexOf(active.batch) + 1}</option>}
              {available.map(({ recommendation: rec, batch: owner }) => <option key={rec.song.id} value={rec.song.id}>{rec.song.title} · {rec.song.artist} · Tanda {state.batches.indexOf(owner) + 1}</option>)}
            </select>
            {active && <>
              <div className="song-info"><h4>{active.recommendation.song.title}</h4><p>{active.recommendation.song.artist} · Tanda {state.batches.indexOf(active.batch) + 1}{batch && active.batch.id === batch.id ? ` · ${percent(active.recommendation.score)}` : ""}</p><p className="song-detail">A partir de: {originText}</p></div>
              <label className="exploration-check"><input type="checkbox" checked={checked} disabled={!!state.pending || (!checked && state.selectedIds.length >= SELECTION_CAP)} onChange={(event) => select(active.recommendation.song.id, event.target.checked)} /> <span>Elegir para ampliar</span></label>
              <RecommendationActions recommendation={active.recommendation} requestId={active.batch.requestId} showStatus />
              <p className="graph-action-help">Guardar añade la canción a tus guardadas. La evaluación se puede cambiar o quitar pulsando de nuevo.</p>
            </>}
          </section>}
          <div className="graph-canvas" role="group" aria-roledescription="grafo interactivo" aria-describedby="graph-help" aria-label={batch ? `Grafo de detalle de la tanda ${state.batches.indexOf(batch) + 1}` : `Grafo de la exploración completa con ${graph.nodes.length} canciones`}>
            <VisGraph key={`${requestKey}:${view}`} graph={graph} options={options} events={events} getNetwork={handleNetwork} />
          </div>
        </div>
      </> : <p className="song-empty">No hay nodos para mostrar.</p>}
      {data && <RecommendationCoverage results={data.seedResults} seeds={seeds} />}
      <p className="search-footnote" aria-live="polite">{selectedDetail ? <>{selectedDetail.label}{selectedDetail.detail && ` · ${selectedDetail.detail}`}{selectedDetail.score !== undefined && ` · ${percent(selectedDetail.score)}`}{reasonText.length > 0 && ` · conectado por ${reasonText.join(", ")}`}</> : selectedSummary ? <>{selectedSummary.song.title} · {selectedSummary.song.artist}{selectedSummary.batchId ? ` · Tanda ${state.batches.findIndex((entry) => entry.id === selectedSummary.batchId) + 1}` : " · canción inicial"}</> : batch ? "Sigue las flechas para explorar las razones de esta tanda." : "Selecciona una canción para consultar su origen."}</p>
    </section>}
    <ExplorationBatches />
    <SavedRecommendationsPanel />
  </>;
}
