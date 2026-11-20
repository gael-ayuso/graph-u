"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Song } from "@/lib/musicbrainz-types";
import { resolveSongCoverUrl } from "@/lib/music-library/cover-url";
import { CoverArt } from "@/components/shared/cover-art";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EXPLORATION_CAP, SELECTION_CAP, remainingCapacity } from "@/lib/recommendation-exploration";
import { useRecommendationExploration } from "@/components/recommendation-exploration-provider";
import { useRecommendationLibrary, RecommendationActions } from "@/components/recommendation-library";
import { RecommendationCoverage } from "@/components/recommendation-coverage";

const SIGNAL_LABELS = {
  songs: "canción similar en Last.fm",
  versions: "otra grabación similar en Last.fm",
  listeners: "artista similar en Last.fm",
  collab: "colaboraciones",
} as const;

function GraphIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M7.3 10.9 15.7 7.1M7.3 13.1l8.4 3.8" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
      className={expanded ? "batch-chevron batch-chevron-expanded" : "batch-chevron"}
    >
      <path d="M5.5 3.5 10.5 8l-5 4.5" />
    </svg>
  );
}

function scrollToGraphPanelIfPresent(event?: { preventDefault?: () => void }) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window.location?.pathname !== "/explorar/grafo") return;
  const panel = document.getElementById("graph-panel");
  if (!panel) return;
  event?.preventDefault?.();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Shared controls operate on the layout-scoped exploration, independently of Mi lista. */
export function ExplorationControls({
  saved,
  onStartSuccess,
  showGraphLink = false,
}: {
  saved: Song[];
  onStartSuccess?: () => void;
  showGraphLink?: boolean;
}) {
  const { state, start, expand, alternatives, cancel, reset } = useRecommendationExploration();
  const { accountScope } = useRecommendationLibrary();
  const [confirmReset, setConfirmReset] = useState(false);
  const [elapsed, setElapsed] = useState<{ request: unknown; seconds: number }>({
    request: null,
    seconds: 0,
  });
  const startRequestedRef = useRef(false);
  const pending = !!state.pending;
  const elapsedSeconds = pending && elapsed.request === state.pending ? elapsed.seconds : 0;
  const capacity = remainingCapacity(state);
  const blocked = pending || accountScope === "loading";
  const attempt = state.lastAttempt;
  const response = attempt?.response;
  const retryDisabled = blocked || (!capacity && attempt?.request.kind !== "start")
    || (attempt?.request.kind === "expand" && !state.selectedIds.length);

  useEffect(() => {
    if (!state.pending) return;
    const currentRequest = state.pending;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed({
        request: currentRequest,
        seconds: Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state.pending]);

  const handleStart = async (seeds: Song[]) => {
    startRequestedRef.current = !!onStartSuccess;
    const ok = await start(seeds);
    if (!ok) {
      startRequestedRef.current = false;
    }
  };

  useEffect(() => {
    if (!startRequestedRef.current || state.pending) return;
    startRequestedRef.current = false;
    if (
      state.lastAttempt?.request.kind === "start" &&
      !state.lastAttempt.error &&
      (state.lastAttempt.response?.recommendations.length ?? 0) > 0
    ) {
      onStartSuccess?.();
    }
  }, [state.pending, state.lastAttempt, onStartSuccess]);

  const retry = () => {
    if (!attempt) return;
    if (attempt.request.kind === "start") void handleStart(attempt.request.seeds);
    else if (attempt.request.kind === "expand") void expand();
    else void alternatives();
  };

  const pendingStatusText = elapsedSeconds > 0
    ? `Buscando recomendaciones en MusicBrainz y Last.fm… (${elapsedSeconds} s). Puedes cancelar la consulta.`
    : "Buscando recomendaciones; puedes cancelar la consulta.";

  return <section className="song-panel recommendations-panel exploration-controls" aria-labelledby="exploration-title" aria-busy={pending}>
    <div className="song-panel-header"><h2 id="exploration-title">Exploración</h2><span>{Object.keys(state.songsById).length} / {EXPLORATION_CAP} canciones</span></div>
    <p className="list-note">{state.id ? `Canciones iniciales: ${state.originals.map((song) => `${song.title} · ${song.artist}`).join(", ")}.` : "Inicia con las primeras 10 canciones de Mi lista."} La exploración se conserva en esta pestaña hasta que la reinicies.</p>
    {state.batches.length > 0 && <p className="list-note">Reemplazar desde Mi lista descarta las tandas temporales solo si encuentra nuevos resultados. Guardar o cambiar Mi lista no modifica esta exploración.</p>}
    <div className="exploration-actions">
      {showGraphLink && state.batches.length > 0 && (
        <Link href="/explorar/grafo" className="batch-graph-cta">
          <GraphIcon />
          <span>Ver grafo</span>
        </Link>
      )}
      <button className="demo-button demo-button-small" type="button" disabled={blocked || !saved.length} onClick={() => void handleStart(saved)}>{state.batches.length ? "Reemplazar desde Mi lista" : "Iniciar desde Mi lista"}</button>
      {!showGraphLink && state.id && <button className="demo-button demo-button-small" type="button" disabled={blocked || !capacity} onClick={() => void alternatives()}>Otras desde las canciones iniciales</button>}
      {!showGraphLink && state.batches.length > 0 && <button className="demo-button demo-button-small" type="button" disabled={blocked || !capacity || !state.selectedIds.length} onClick={() => void expand()}>Ampliar con {state.selectedIds.length} {state.selectedIds.length === 1 ? "canción" : "canciones"}</button>}
      {pending && <button className="demo-button demo-button-small" type="button" onClick={cancel}>Cancelar consulta</button>}
      {state.id && !confirmReset && <button className="demo-button demo-button-small" type="button" disabled={pending} onClick={() => setConfirmReset(true)}>Reiniciar exploración</button>}
      {confirmReset && <><span>¿Descartar las tandas temporales?</span><button className="demo-button demo-button-small" type="button" onClick={() => { reset(); setConfirmReset(false); }}>Sí, reiniciar</button><button className="demo-button demo-button-small" type="button" onClick={() => setConfirmReset(false)}>Conservar</button></>}
    </div>
    {!saved.length && (
      showGraphLink
        ? <p className="list-note">Mi lista está vacía. Busca y añade canciones arriba para iniciar.</p>
        : <p className="list-note">Mi lista está vacía. <Link href="/explorar">Busca y añade canciones</Link> para iniciar.</p>
    )}
    {state.batches.length > 0 && <p className="list-note">Seleccionadas: {state.selectedIds.length} / {SELECTION_CAP}. {capacity ? `Quedan ${capacity} espacios en la exploración.` : "Límite alcanzado. Reinicia o reemplaza para explorar de nuevo."}</p>}
    <p className={`list-note${pending ? " exploration-status-pending" : ""}`} role="status" aria-live="polite">
      {pending && <span className="exploration-pending-indicator" aria-hidden="true" />}
      {pending ? pendingStatusText : attempt?.error ? "La consulta no se completó. Puedes reintentar." : response ? response.recommendations.length ? `Se añadieron ${response.recommendations.length} canciones nuevas.` : "No encontramos canciones nuevas en esta consulta." : ""}
    </p>
    {pending && state.batches.length === 0 && <LoadingSkeleton rows={3} />}
    {!pending && attempt?.error && <div className="exploration-attempt" role="alert"><p>{attempt.error}</p><button className="demo-button demo-button-small" type="button" disabled={retryDisabled} onClick={retry}>Volver a intentar</button></div>}
    {!pending && response && !response.recommendations.length && <><div className="exploration-attempt"><p>La consulta no añadió una tanda; revisa los motivos por canción.</p><button className="demo-button demo-button-small" type="button" disabled={retryDisabled} onClick={retry}>Volver a intentar</button></div><RecommendationCoverage results={response.seedResults} seeds={attempt!.request.seeds} /></>}
  </section>;
}

/** Chronological results; every action uses the request that produced that card. */
export function ExplorationBatches() {
  const { state, select, focus } = useRecommendationExploration();
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({});

  if (!state.batches.length) return null;

  const totalRecommendations = state.batches.reduce(
    (sum, batch) => sum + batch.response.recommendations.length,
    0,
  );
  const allCollapsed = state.batches.every((batch) => !!collapsedById[batch.id]);

  function toggleBatch(batchId: string) {
    setCollapsedById((prev) => ({ ...prev, [batchId]: !prev[batchId] }));
  }

  function toggleAllBatches() {
    const nextState = !allCollapsed;
    const next: Record<string, boolean> = {};
    for (const batch of state.batches) {
      next[batch.id] = nextState;
    }
    setCollapsedById(next);
  }

  return (
    <section className="song-panel recommendations-panel exploration-batches" aria-labelledby="batches-title">
      <div className="song-panel-header">
        <h2 id="batches-title">Recomendaciones por tanda</h2>
        <span className="batch-summary-counter">
          {state.batches.length} {state.batches.length === 1 ? "tanda" : "tandas"} · {totalRecommendations}{" "}
          {totalRecommendations === 1 ? "canción" : "canciones"}
        </span>
      </div>

      <div className="exploration-batches-toolbar">
        <div className="exploration-batches-toolbar-left">
          <Link
            href="/explorar/grafo"
            className="batch-graph-cta"
            onClick={(event) => {
              focus(null);
              scrollToGraphPanelIfPresent(event);
            }}
          >
            <GraphIcon />
            <span>Ver grafo</span>
          </Link>
          {state.batches.length > 1 && (
            <button
              type="button"
              className="batch-collapse-all-btn"
              aria-pressed={allCollapsed}
              onClick={toggleAllBatches}
            >
              <ChevronIcon expanded={!allCollapsed} />
              <span>{allCollapsed ? "Expandir todas" : "Contraer todas"}</span>
            </button>
          )}
        </div>
        <p className="exploration-batches-hint">
          Marca canciones para ampliar o abre el grafo de conexiones.
        </p>
      </div>

      {state.batches.map((batch, index) => {
        const isCollapsed = !!collapsedById[batch.id];
        const recs = batch.response.recommendations;
        const selectedCount = recs.filter((rec) => state.selectedIds.includes(rec.song.id)).length;
        const recommendedSeedCount = batch.response.seedResults.filter(
          (seed) => seed.status === "recommended",
        ).length;
        const isFocused = state.focusedBatchId === batch.id;

        return (
          <section
            className={`exploration-batch${isCollapsed ? " is-collapsed" : ""}${isFocused ? " is-focused" : ""}`}
            key={batch.id}
            aria-labelledby={`batch-${batch.id}`}
          >
            <div className="exploration-batch-header">
              <div className="exploration-batch-title-group">
                <button
                  type="button"
                  className="batch-toggle-btn"
                  aria-expanded={!isCollapsed}
                  aria-controls={`batch-body-${batch.id}`}
                  aria-label={`${isCollapsed ? "Expandir" : "Contraer"} Tanda ${index + 1}`}
                  onClick={() => toggleBatch(batch.id)}
                >
                  <ChevronIcon expanded={!isCollapsed} />
                  <span>{isCollapsed ? "Expandir" : "Contraer"}</span>
                </button>
                <h3 id={`batch-${batch.id}`}>Tanda {index + 1}</h3>
                <span className="batch-count-badge">
                  {recs.length} {recs.length === 1 ? "canción" : "canciones"}
                </span>
                {selectedCount > 0 && (
                  <span className="batch-selected-badge">
                    {selectedCount} {selectedCount === 1 ? "elegida" : "elegidas"}
                  </span>
                )}
              </div>

              <div className="exploration-batch-actions">
                <Link
                  href="/explorar/grafo"
                  className="batch-graph-link"
                  aria-current={isFocused ? "true" : undefined}
                  onClick={(event) => {
                    focus(batch.id);
                    scrollToGraphPanelIfPresent(event);
                  }}
                >
                  <GraphIcon />
                  <span>Ver grafo de esta tanda</span>
                </Link>
              </div>
            </div>

            <div className="exploration-batch-seeds">
              <span className="batch-seeds-label">Basada en:</span>
              <span className="batch-seeds-list">
                {batch.inputs.map((song) => `${song.title} · ${song.artist}`).join(", ")}
              </span>
            </div>

            {!isCollapsed && (
              <div id={`batch-body-${batch.id}`} className="exploration-batch-body">
                <ul className="song-results batch-song-list">
                  {recs.map((rec) => {
                    const checked = state.selectedIds.includes(rec.song.id);
                    const topScore = rec.reasons.reduce(
                      (best, reason) => Math.max(best, reason.score),
                      0,
                    );
                    return (
                      <li
                        className={`song-row recommendation-row batch-rec-card${checked ? " is-selected" : ""}`}
                        key={rec.song.id}
                      >
                        <CoverArt
                          src={resolveSongCoverUrl(rec.song)}
                          alt={`Portada de ${rec.song.title}`}
                          size={48}
                          label={rec.song.artist}
                        />
                        <div className="song-info">
                          <div className="batch-rec-heading">
                            <div className="batch-rec-identity">
                              <a
                                className="song-title"
                                href={`https://musicbrainz.org/recording/${rec.song.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {rec.song.title}
                                <span className="sr-only"> (MusicBrainz, nueva pestaña)</span>
                              </a>
                              <p className="batch-rec-artist">{rec.song.artist}</p>
                            </div>
                            <span className="batch-rec-score">
                              {Math.round(topScore * 100)}% parecido
                            </span>
                          </div>

                          {rec.reasons.length > 0 && (
                            <div className="recommendation-reasons">
                              {rec.reasons.map((reason) => {
                                const source = state.songsById[reason.seedId]?.song;
                                const sourceLabel = source
                                  ? `${source.title} · ${source.artist}`
                                  : reason.seedId;
                                const signalTexts = reason.signals.map(
                                  (signal) => SIGNAL_LABELS[signal],
                                );
                                return (
                                  <div className="recommendation-reason" key={reason.seedId}>
                                    <p className="reason-origin">
                                      A partir de <strong>{sourceLabel}</strong>:{" "}
                                      <span className="reason-score">
                                        {Math.round(reason.score * 100)}% parecido
                                      </span>
                                    </p>
                                    {(reason.sharedTags.length > 0 || signalTexts.length > 0) && (
                                      <div className="reason-chips">
                                        {reason.sharedTags.map((tag) => (
                                          <span className="reason-chip reason-chip-tag" key={`t:${tag}`}>
                                            #{tag}
                                          </span>
                                        ))}
                                        {signalTexts.map((signalText) => (
                                          <span
                                            className="reason-chip reason-chip-signal"
                                            key={`s:${signalText}`}
                                          >
                                            {signalText}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <label className="exploration-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!!state.pending || (!checked && state.selectedIds.length >= SELECTION_CAP)}
                            onChange={(event) => select(rec.song.id, event.target.checked)}
                          />
                          <span>
                            Elegir para ampliar
                            <span className="sr-only">
                              : {rec.song.title}, {rec.song.artist}
                            </span>
                          </span>
                        </label>

                        <RecommendationActions recommendation={rec} requestId={batch.requestId} showStatus />
                      </li>
                    );
                  })}
                </ul>

                {batch.response.seedResults.length > 0 && (
                  <details className="batch-coverage-details">
                    <summary className="batch-coverage-summary">
                      Detalle por canción inicial ({recommendedSeedCount}/
                      {batch.response.seedResults.length} con resultados)
                    </summary>
                    <RecommendationCoverage results={batch.response.seedResults} seeds={batch.inputs} />
                  </details>
                )}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}

export function BatchSelector() {
  const { state, focus } = useRecommendationExploration();
  if (!state.batches.length) return null;
  return <div className="exploration-batch-selector"><label htmlFor="focused-batch">Tanda mostrada en el grafo</label><select id="focused-batch" value={state.focusedBatchId ?? ""} onChange={(event) => focus(event.target.value || null)}><option value="">Todas las tandas · Exploración completa</option>{state.batches.map((batch, index) => <option key={batch.id} value={batch.id}>Tanda {index + 1}</option>)}</select></div>;
}
