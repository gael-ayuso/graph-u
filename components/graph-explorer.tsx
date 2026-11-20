"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Network, Node, Options } from "react-vis-graph-wrapper";
import dynamic from "next/dynamic";
import type { GraphNode, Song } from "@/lib/musicbrainz-types";
import { isCoverUuid, resolveSongCoverUrl } from "@/lib/music-library/cover-url";
import { CoverArt } from "@/components/shared/cover-art";
import { LoadingState } from "@/components/shared/status-states";
import { projectRecommendationGraph } from "@/lib/recommendation-graph";
import { SELECTION_CAP } from "@/lib/recommendation-exploration";
import { readSongs, snapshot, subscribe, writeSongs } from "@/lib/saved-song-list";
import { RecommendationCoverage } from "@/components/recommendation-coverage";
import { RecommendationActions, SavedRecommendationsPanel, useRecommendationLibrary } from "@/components/recommendation-library";
import { useRecommendationExploration } from "@/components/recommendation-exploration-provider";
import { BatchSelector, ExplorationBatches, ExplorationControls } from "@/components/exploration-batches";

// vis-network usa window: se carga solo en el navegador.
const VisGraph = dynamic(() => import("react-vis-graph-wrapper"), {
  ssr: false,
  loading: () => <LoadingState variant="graph" message="Cargando visualización del grafo..." />,
});

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

function formatDuration(milliseconds: number | null) {
  if (!milliseconds) return "";
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
    arrows: { to: { enabled: true, scaleFactor: 0.7 } },
    smooth: { enabled: true, type: "continuous", roundness: 0.15 },
    selectionWidth: 1.5,
  },
  interaction: { navigationButtons: true, hover: true, tooltipDelay: 80, dragNodes: true, dragView: true, zoomView: true, keyboard: { enabled: true, bindToWindow: false }, hideEdgesOnDrag: false },
} satisfies Options;

const HIERARCHICAL_OPTIONS: Options = {
  height: "100%",
  autoResize: true,
  layout: { hierarchical: { direction: "LR", sortMethod: "directed", levelSeparation: 230, nodeSpacing: 64 } },
  physics: false,
  edges: { color: { color: COLORS.olive, highlight: COLORS.seed }, arrows: { to: { enabled: true, scaleFactor: 0.7 } }, smooth: { enabled: true, type: "cubicBezier", forceDirection: "horizontal", roundness: 0.4 } },
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
  const { accountScope } = useRecommendationLibrary();
  const { state, select, start } = useRecommendationExploration();
  const networkRef = useRef<Network | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const seedHandledRef = useRef(false);
  const [view, setView] = useState<GraphView>("free");
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
  const [paused, setPaused] = useState(true);
  const motionEnabled = view === "free" && !paused && !reducedMotion;
  const options = useMemo<Options>(() => view === "hierarchical"
    ? HIERARCHICAL_OPTIONS
    : { ...OPTIONS, physics: { ...OPTIONS.physics, enabled: motionEnabled } }, [view, motionEnabled]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const saved = useMemo(() => (raw === null ? null : readSongs(raw)), [raw]);

  // Permite abrir /explorar/grafo?seed=<mbid>&title=<título>&artist=<artista> desde Favoritos.
  useEffect(() => {
    if (seedHandledRef.current || accountScope === "loading" || typeof window === "undefined" || !window.location?.search) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const seedId = params.get("seed")?.trim().toLowerCase() ?? "";
    const title = params.get("title")?.trim() ?? "";
    const artist = params.get("artist")?.trim() ?? "";
    if (!isCoverUuid(seedId) || !title || !artist) return;

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || seedHandledRef.current) return;
      seedHandledRef.current = true;
      const seedSong: Song = {
        id: seedId,
        title,
        artist,
        release: null,
        duration: null,
        comment: null,
      };
      const currentSongs = readSongs(snapshot());
      if (!currentSongs.some((song) => song.id === seedSong.id)) {
        writeSongs([seedSong, ...currentSongs]);
      }
      const alreadyExplored =
        state.batches.length > 0 &&
        state.originals.length === 1 &&
        state.originals[0].id === seedSong.id;
      if (!alreadyExplored && !state.pending) {
        void start([seedSong]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountScope, start, state.batches.length, state.originals, state.pending]);

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
  // Distribución radial suave: canción principal al centro y las demás
  // alrededor en anillos escalonados, con espacio para los títulos.
  // No se fijan los nodos: se pueden arrastrar y mover con los controles.
  const arrangedGraph = useMemo(() => {
    if (!graph || view !== "free") return graph;
    const nodes = graph.nodes;
    const seedIndex = nodes.findIndex((node) => String(node.id).startsWith("seed:"));
    const centerIndex = seedIndex >= 0 ? seedIndex : 0;
    const others = nodes.map((node, index) => ({ node, index }))
      .filter(({ index }) => index !== centerIndex);
    const positions = new Map<number, { x: number; y: number }>();
    positions.set(centerIndex, { x: 0, y: 0 });
    let placed = 0;
    let ring = 1;
    while (placed < others.length) {
      const radius = 245 * ring;
      // Espaciado generoso entre tarjetas, sin cuadrícula rígida.
      const capacity = Math.max(5, Math.floor((2 * Math.PI * radius) / 275));
      const count = Math.min(capacity, others.length - placed);
      const offset = ring % 2 === 0 ? Math.PI / count : -Math.PI / 2;
      for (let slot = 0; slot < count; slot++) {
        const angle = offset + (2 * Math.PI * slot) / count;
        positions.set(others[placed + slot].index, {
          x: Math.round(Math.cos(angle) * radius),
          y: Math.round(Math.sin(angle) * radius * 0.84),
        });
      }
      placed += count;
      ring++;
    }
    return {
      ...graph,
      nodes: nodes.map((node, index) => ({ ...node, ...positions.get(index) })),
    };
  }, [graph, view]);
  const events = useMemo(() => ({ select: ({ nodes }: { nodes: string[] }) => setSelection({ key: requestKey, id: nodes[0] ?? "" }) }), [requestKey]);
  const handleNetwork = useCallback((network: Network) => { guardVisNetwork(network); networkRef.current = network; }, []);
  // Paredes suaves: frenan gradualmente antes del borde, sin teletransportar
  // nodos ni recentrar la cámara. Solo actúan con movimiento activo.
  useEffect(() => {
    if (!motionEnabled || !arrangedGraph?.nodes.length) return;

    type MovingNetwork = Network & {
      physics?: { physicsBody?: { velocities?: Record<string, { x: number; y: number }> } };
    };

    const contain = () => {
      const network = networkRef.current as MovingNetwork | null;
      const canvas = canvasRef.current;
      const velocities = network?.physics?.physicsBody?.velocities;
      if (!network || !canvas || !velocities) return;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 240 || height < 220) return;

      const marginX = Math.min(110, width * 0.24);
      const marginY = Math.min(70, height * 0.22);
      const left = marginX;
      const right = width - marginX;
      const top = marginY;
      const bottom = height - marginY;
      // Zona de frenado: comienza antes del borde para evitar impactos bruscos.
      const slowZone = Math.min(100, (right - left) * 0.25, (bottom - top) * 0.25);
      const positions = network.getPositions(arrangedGraph.nodes.map((node) => String(node.id)));
      const scale = network.getScale();
      if (!Number.isFinite(scale) || scale <= 0) return;

      for (const [id, position] of Object.entries(positions)) {
        const velocity = velocities[id];
        if (!velocity) continue;
        const screen = network.canvasToDOM(position);

        // Las velocidades del motor están en unidades de grafo, no píxeles.
        // Aplicamos una fuerza gradual hacia dentro y amortiguamos la salida.
        const steer = (coordinate: number, low: number, high: number, speed: number) => {
          const distance = coordinate < low + slowZone
            ? coordinate - (low + slowZone)
            : coordinate > high - slowZone
              ? coordinate - (high - slowZone)
              : 0;
          if (distance === 0) return speed;
          const strength = Math.min(1, Math.abs(distance) / slowZone);
          const outward = distance < 0 ? speed < 0 : speed > 0;
          const slowed = outward ? speed * (1 - 0.85 * strength) : speed;
          // En la pared, anulamos la velocidad hacia afuera y damos
          // una pequeña velocidad hacia el interior, sin saltar de posición.
          const beyond = coordinate < low ? coordinate - low : coordinate > high ? coordinate - high : 0;
          if (beyond !== 0) {
            return -Math.sign(beyond) * Math.min(5 / scale, 1.2 + Math.abs(beyond) * 0.06 / scale);
          }
          return slowed - Math.sign(distance) * strength * 0.42 / scale;
        };

        velocity.x = steer(screen.x, left, right, velocity.x);
        velocity.y = steer(screen.y, top, bottom, velocity.y);
      }
    };

    const interval = window.setInterval(contain, 16);
    return () => window.clearInterval(interval);
  }, [motionEnabled, arrangedGraph]);

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
  const rootOptions = batch
    ? batch.inputs.filter((song) => !state.songsById[song.id]?.batchId)
    : state.originals;
  const active = selectedId ? (selectedRecommendation && selectedBatch ? { recommendation: selectedRecommendation, batch: selectedBatch } : undefined) : available[0];
  const activeOriginal = !active && selectedSongId && selectedEntry && !selectedEntry.batchId
    ? selectedEntry.song
    : !active && selectedSongId
      ? rootOptions.find((song) => song.id === selectedSongId)
      : undefined;
  const panelSong = active?.recommendation.song ?? activeOriginal;
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
  const originalDetails = activeOriginal
    ? [
        activeOriginal.release && `Álbum: ${activeOriginal.release}`,
        activeOriginal.duration ? `Duración: ${formatDuration(activeOriginal.duration)}` : "",
        activeOriginal.comment,
      ].filter(Boolean).join(" · ")
    : "";

  return <>
    <ExplorationControls saved={saved ?? []} />
    <BatchSelector />
    {state.batches.length > 0 && <section id="graph-panel" className="song-panel graph-panel" aria-labelledby="graph-title" aria-busy={!!state.pending}>
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
          {(available.length > 0 || rootOptions.length > 0) && <section className="graph-song-actions" aria-labelledby="graph-song-actions-title">
            <h3 id="graph-song-actions-title">{activeOriginal ? "Canción inicial" : "Guardar y evaluar"}</h3>
            <p className="graph-action-help">Elige una canción aquí o pulsa un nodo del grafo.</p>
            <label htmlFor="graph-action-song">Canción del grafo</label>
            <select
              id="graph-action-song"
              value={active?.recommendation.song.id ?? activeOriginal?.id ?? ""}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) {
                  setSelection({ key: requestKey, id: "" });
                  return;
                }
                const prefix = batch ? (batch.inputs.some((song) => song.id === id) ? "seed" : "song") : "recording";
                setSelection({ key: requestKey, id: `${prefix}:${id}` });
              }}
            >
              {!active && !activeOriginal && <option value="">Elige una canción</option>}
              {active && !available.some(({ recommendation }) => recommendation.song.id === active.recommendation.song.id) && <option value={active.recommendation.song.id}>{active.recommendation.song.title} · {active.recommendation.song.artist} · Tanda {state.batches.indexOf(active.batch) + 1}</option>}
              {available.length > 0 && <optgroup label="Recomendadas">
                {available.map(({ recommendation: rec, batch: owner }) => <option key={rec.song.id} value={rec.song.id}>{rec.song.title} · {rec.song.artist} · Tanda {state.batches.indexOf(owner) + 1}</option>)}
              </optgroup>}
              {rootOptions.length > 0 && <optgroup label="Lista raíz">
                {rootOptions.map((song) => <option key={`root:${song.id}`} value={song.id}>{song.title} · {song.artist} · Lista raíz</option>)}
              </optgroup>}
            </select>
            {panelSong && <>
              <div className="graph-song-header">
                <CoverArt
                  src={resolveSongCoverUrl(panelSong)}
                  alt={`Portada de ${panelSong.title}`}
                  size={76}
                  label={panelSong.artist}
                />
                <div className="song-info">
                  <h4>{panelSong.title}</h4>
                  <p className="graph-song-artist">{panelSong.artist}</p>
                  {active ? (
                    <p className="graph-song-meta">Tanda {state.batches.indexOf(active.batch) + 1}{batch && active.batch.id === batch.id ? ` · ${percent(active.recommendation.score)}` : ""}</p>
                  ) : (
                    <p className="graph-song-meta">Lista raíz · Canción inicial</p>
                  )}
                </div>
              </div>
              {active ? <>
                {originText && <p className="graph-song-origin"><strong>A partir de:</strong> {originText}</p>}
                <label className="exploration-check"><input type="checkbox" checked={checked} disabled={!!state.pending || (!checked && state.selectedIds.length >= SELECTION_CAP)} onChange={(event) => select(active.recommendation.song.id, event.target.checked)} /> <span>Elegir para ampliar</span></label>
                <RecommendationActions recommendation={active.recommendation} requestId={active.batch.requestId} showStatus />
                <p className="graph-action-help">Guardar añade la canción a tus guardadas. La evaluación se puede cambiar o quitar pulsando de nuevo.</p>
              </> : <>
                {originalDetails && <p className="graph-song-origin">{originalDetails}</p>}
                <p className="graph-song-origin"><strong>Origen:</strong> tu lista raíz. Se usó como punto de partida para generar recomendaciones.</p>
                <a className="song-title graph-song-mb-link" href={`https://musicbrainz.org/recording/${panelSong.id}`} target="_blank" rel="noreferrer">Ver en MusicBrainz<span className="sr-only"> (nueva pestaña)</span></a>
              </>}
            </>}
          </section>}
          <div ref={canvasRef} className="graph-canvas" role="group" aria-roledescription="grafo interactivo" aria-describedby="graph-help" aria-label={batch ? `Grafo de detalle de la tanda ${state.batches.indexOf(batch) + 1}` : `Grafo de la exploración completa con ${graph.nodes.length} canciones`}>
            <VisGraph key={`${requestKey}:${view}`} graph={arrangedGraph ?? graph} options={options} events={events} getNetwork={handleNetwork} />
          </div>
        </div>
      </> : <p className="song-empty">No hay nodos para mostrar.</p>}
      {data && <RecommendationCoverage results={data.seedResults} seeds={seeds} />}
      <p className="search-footnote" aria-live="polite">{selectedDetail ? <>{selectedDetail.label}{selectedDetail.detail && ` · ${selectedDetail.detail}`}{selectedDetail.score !== undefined && ` · ${percent(selectedDetail.score)}`}{reasonText.length > 0 && ` · conectado por ${reasonText.join(", ")}`}</> : selectedSummary ? <>{selectedSummary.song.title} · {selectedSummary.song.artist}{selectedSummary.batchId ? ` · Tanda ${state.batches.findIndex((entry) => entry.id === selectedSummary.batchId) + 1}` : " · canción inicial"}</> : batch ? "Sigue las flechas para explorar las razones de esta tanda." : "Selecciona un nodo en el grafo para resaltar su recorrido."}</p>
    </section>}
    <ExplorationBatches />
    <SavedRecommendationsPanel />
  </>;
}
