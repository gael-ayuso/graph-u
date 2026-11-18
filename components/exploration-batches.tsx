"use client";

import { useState } from "react";
import Link from "next/link";
import type { Song } from "@/lib/musicbrainz-types";
import { EXPLORATION_CAP, SELECTION_CAP, remainingCapacity } from "@/lib/recommendation-exploration";
import { useRecommendationExploration } from "@/components/recommendation-exploration-provider";
import { useRecommendationLibrary, RecommendationActions } from "@/components/recommendation-library";
import { RecommendationCoverage } from "@/components/recommendation-coverage";

/** Shared controls operate on the layout-scoped exploration, independently of Mi lista. */
export function ExplorationControls({ saved }: { saved: Song[] }) {
  const { state, start, expand, alternatives, cancel, reset } = useRecommendationExploration();
  const { accountScope } = useRecommendationLibrary();
  const [confirmReset, setConfirmReset] = useState(false);
  const pending = !!state.pending;
  const capacity = remainingCapacity(state);
  const blocked = pending || accountScope === "loading";
  const attempt = state.lastAttempt;
  const response = attempt?.response;
  const retryDisabled = blocked || (!capacity && attempt?.request.kind !== "start")
    || (attempt?.request.kind === "expand" && !state.selectedIds.length);
  const retry = () => {
    if (!attempt) return;
    if (attempt.request.kind === "start") void start(attempt.request.seeds);
    else if (attempt.request.kind === "expand") void expand();
    else void alternatives();
  };
  return <section className="song-panel recommendations-panel exploration-controls" aria-labelledby="exploration-title" aria-busy={pending}>
    <div className="song-panel-header"><h2 id="exploration-title">Exploración</h2><span>{Object.keys(state.songsById).length} / {EXPLORATION_CAP} canciones</span></div>
    <p className="list-note">{state.id ? `Canciones iniciales: ${state.originals.map((song) => `${song.title} · ${song.artist}`).join(", ")}.` : "Inicia con las primeras 10 canciones de Mi lista."} La exploración es temporal y se pierde al recargar.</p>
    {state.batches.length > 0 && <p className="list-note">Reemplazar desde Mi lista descarta las tandas temporales solo si encuentra nuevos resultados. Guardar o cambiar Mi lista no modifica esta exploración.</p>}
    <div className="exploration-actions">
      <button className="demo-button demo-button-small" type="button" disabled={blocked || !saved.length} onClick={() => void start(saved)}>{state.batches.length ? "Reemplazar desde Mi lista" : "Iniciar desde Mi lista"}</button>
      {state.id && <button className="demo-button demo-button-small" type="button" disabled={blocked || !capacity} onClick={() => void alternatives()}>Otras desde las canciones iniciales</button>}
      {state.batches.length > 0 && <button className="demo-button demo-button-small" type="button" disabled={blocked || !capacity || !state.selectedIds.length} onClick={() => void expand()}>Ampliar con {state.selectedIds.length} {state.selectedIds.length === 1 ? "canción" : "canciones"}</button>}
      {pending && <button className="demo-button demo-button-small" type="button" onClick={cancel}>Cancelar consulta</button>}
      {state.id && !confirmReset && <button className="demo-button demo-button-small" type="button" disabled={pending} onClick={() => setConfirmReset(true)}>Reiniciar exploración</button>}
      {confirmReset && <><span>¿Descartar las tandas temporales?</span><button className="demo-button demo-button-small" type="button" onClick={() => { reset(); setConfirmReset(false); }}>Sí, reiniciar</button><button className="demo-button demo-button-small" type="button" onClick={() => setConfirmReset(false)}>Conservar</button></>}
    </div>
    {!saved.length && <p className="list-note">Mi lista está vacía. <Link href="/demo">Busca y añade canciones</Link> para iniciar.</p>}
    {state.batches.length > 0 && <p className="list-note">Seleccionadas: {state.selectedIds.length} / {SELECTION_CAP}. {capacity ? `Quedan ${capacity} espacios en la exploración.` : "Límite alcanzado. Reinicia o reemplaza para explorar de nuevo."}</p>}
    <p className="list-note" role="status" aria-live="polite">{pending ? "Buscando recomendaciones; puedes cancelar la consulta." : attempt?.error ? "La consulta no se completó. Puedes reintentar." : response ? response.recommendations.length ? `Se añadieron ${response.recommendations.length} canciones nuevas.` : "No encontramos canciones nuevas en esta consulta." : ""}</p>
    {!pending && attempt?.error && <div className="exploration-attempt" role="alert"><p>{attempt.error}</p><button className="demo-button demo-button-small" type="button" disabled={retryDisabled} onClick={retry}>Volver a intentar</button></div>}
    {!pending && response && !response.recommendations.length && <><div className="exploration-attempt"><p>La consulta no añadió una tanda; revisa los motivos por canción.</p><button className="demo-button demo-button-small" type="button" disabled={retryDisabled} onClick={retry}>Volver a intentar</button></div><RecommendationCoverage results={response.seedResults} seeds={attempt!.request.seeds} /></>}
  </section>;
}

/** Chronological results; every action uses the request that produced that card. */
export function ExplorationBatches() {
  const { state, select, focus } = useRecommendationExploration();
  if (!state.batches.length) return null;
  return <section className="song-panel recommendations-panel exploration-batches" aria-labelledby="batches-title">
    <div className="song-panel-header"><h2 id="batches-title">Recomendaciones por tanda</h2><span>{state.batches.length} {state.batches.length === 1 ? "tanda" : "tandas"}</span></div>
    <Link href="/explorar" onClick={() => focus(null)}>Ver todas las tandas en un solo grafo</Link>
    {state.batches.map((batch, index) => <section className="exploration-batch" key={batch.id} aria-labelledby={`batch-${batch.id}`}>
      <div className="exploration-batch-header"><h3 id={`batch-${batch.id}`}>Tanda {index + 1}</h3><Link href="/explorar" aria-current={state.focusedBatchId === batch.id ? "true" : undefined} onClick={() => focus(batch.id)}>Ver detalle de esta tanda</Link></div>
      <p className="list-note">Entradas: {batch.inputs.map((song) => `${song.title} · ${song.artist}`).join(", ")}</p>
      <ul className="song-results">{batch.response.recommendations.map((rec) => {
        const checked = state.selectedIds.includes(rec.song.id);
        return <li className="song-row recommendation-row" key={rec.song.id}>
          <div className="song-info"><a className="song-title" href={`https://musicbrainz.org/recording/${rec.song.id}`} target="_blank" rel="noreferrer">{rec.song.title}<span className="sr-only"> (MusicBrainz, nueva pestaña)</span></a><p>{rec.song.artist}</p>
            {rec.reasons.map((reason) => { const source = state.songsById[reason.seedId]?.song; return <p className="song-detail" key={reason.seedId}>A partir de {source ? `${source.title} · ${source.artist}` : reason.seedId}: {Math.round(reason.score * 100)}% parecido{reason.sharedTags.length ? ` · comparte ${reason.sharedTags.join(", ")}` : ""}{reason.signals.length ? ` · ${reason.signals.map((signal) => ({ songs: "canción similar en Last.fm", versions: "otra grabación similar en Last.fm", listeners: "artista similar en Last.fm", collab: "colaboraciones" })[signal]).join(", ")}` : ""}</p>; })}
          </div>
          <label className="exploration-check"><input type="checkbox" checked={checked} disabled={!!state.pending || (!checked && state.selectedIds.length >= SELECTION_CAP)} onChange={(event) => select(rec.song.id, event.target.checked)} /> <span>Elegir para ampliar<span className="sr-only">: {rec.song.title}, {rec.song.artist}</span></span></label>
          <RecommendationActions recommendation={rec} requestId={batch.requestId} showStatus />
        </li>;
      })}</ul>
      <RecommendationCoverage results={batch.response.seedResults} seeds={batch.inputs} />
    </section>)}
  </section>;
}

export function BatchSelector() {
  const { state, focus } = useRecommendationExploration();
  if (!state.batches.length) return null;
  return <div className="exploration-batch-selector"><label htmlFor="focused-batch">Tanda mostrada en el grafo</label><select id="focused-batch" value={state.focusedBatchId ?? ""} onChange={(event) => focus(event.target.value || null)}><option value="">Todas las tandas · Exploración completa</option>{state.batches.map((batch, index) => <option key={batch.id} value={batch.id}>Tanda {index + 1}</option>)}</select></div>;
}
