"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Recommendation, Song } from "@/lib/musicbrainz-types";

type Vote = "LIKE" | "DISLIKE" | null;
type ActionSong = Pick<Recommendation, "song" | "resultId">;
type Library = {
  songs: Song[]; votes: Record<string, Vote>; busy: Set<string>; ready: boolean;
  accountScope: string; account: string | null | undefined; error: string; notice: string;
  retryLoad: () => void;
  act: (rec: ActionSong, requestId: string | undefined, action: "save" | "LIKE" | "DISLIKE") => void;
};
const Context = createContext<Library | null>(null);
const STORAGE = "graphu.recommendations.v1";

function localLibrary(): { songs: Song[]; votes: Record<string, Vote> } {
  const data = JSON.parse(localStorage.getItem(STORAGE) || "{}");
  return {
    songs: Array.isArray(data?.songs) ? data.songs.filter((song: Song) => song && typeof song.id === "string" && typeof song.title === "string" && typeof song.artist === "string") : [],
    votes: data?.votes && typeof data.votes === "object" && !Array.isArray(data.votes)
      ? Object.fromEntries(Object.entries(data.votes).filter(([, value]) => value === "LIKE" || value === "DISLIKE" || value === null)) as Record<string, Vote> : {},
  };
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "No se pudo guardar el cambio. Inténtalo de nuevo.");
  return data;
}

export function RecommendationLibraryProvider({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const accountScope = !isLoaded ? "loading" : userId ? `user:${userId}` : "guest";
  return <LibrarySession key={accountScope} accountScope={accountScope} account={userId} loaded={isLoaded}>{children}</LibrarySession>;
}

export function useRecommendationLibrary() {
  const library = useContext(Context);
  if (!library) throw new Error("useRecommendationLibrary requires RecommendationLibraryProvider");
  return library;
}

function LibrarySession({ account, accountScope, loaded, children }: { account: string | null | undefined; accountScope: string; loaded: boolean; children: ReactNode }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [busy, setBusy] = useState(new Set<string>());
  const pending = useRef(new Set<string>());
  const actions = useRef(new Set<AbortController>());
  const active = useRef(true);
  const localUnavailable = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const state = useRef({ songs, votes });
  useEffect(() => { state.current = { songs, votes }; }, [songs, votes]);
  useEffect(() => {
    active.current = true;
    const controllers = actions.current;
    return () => { active.current = false; controllers.forEach((controller) => controller.abort()); };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    async function load() {
      try {
        if (account) {
          const data = await readResponse(await fetch("/api/me/saved-recommendations", { signal: controller.signal }));
          if (controller.signal.aborted) return;
          setSongs(data.songs);
        } else {
          try {
            const data = localLibrary();
            state.current = data;
            setSongs(data.songs);
            setVotes(data.votes);
          } catch { localUnavailable.current = true; setNotice("El almacenamiento local no está disponible. Los cambios durarán mientras permanezcas en esta página."); }
        }
        setReady(true);
        setError("");
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudieron cargar tus canciones guardadas.");
      }
    }
    void load();
    return () => controller.abort();
  }, [loaded, account, retry]);

  useEffect(() => {
    if (account || !loaded) return;
    const sync = (event: StorageEvent) => {
      if (localUnavailable.current || (event.key !== STORAGE && event.key !== null)) return;
      try {
        const next = localLibrary();
        state.current = next;
        setSongs(next.songs);
        setVotes(next.votes);
      } catch { /* Keep the last usable state if storage becomes unavailable. */ }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [account, loaded]);

  async function act(rec: ActionSong, requestId: string | undefined, action: "save" | "LIKE" | "DISLIKE") {
    const key = `${requestId ?? "local"}:${rec.resultId ?? rec.song.id}`;
    if (!ready || pending.current.has(rec.song.id)) return;
    pending.current.add(rec.song.id);
    setBusy(new Set(pending.current));
    setError("");
    if (!account && !localUnavailable.current) {
      try { state.current = localLibrary(); } catch { localUnavailable.current = true; }
    }
    const saved = state.current.songs.some((song) => song.id === rec.song.id);
    const voteKey = account ? key : rec.song.id;
    const value = state.current.votes[voteKey] === action ? null : action as Vote;
    const controller = new AbortController();
    actions.current.add(controller);
    try {
      if (account) {
        if (action === "save" && saved && !rec.resultId) {
          await readResponse(await fetch("/api/me/favorites/recordings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: rec.song.id }), signal: controller.signal }));
        } else {
          if (!requestId || !rec.resultId) throw new Error("Genera otra tanda para guardar o evaluar recomendaciones con tu cuenta.");
          await readResponse(await fetch(`/api/me/recommendations/${requestId}/${action === "save" ? "saved" : "feedback"}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "save" ? { resultId: rec.resultId, saved: !saved } : { resultId: rec.resultId, value }),
          signal: controller.signal,
          }));
        }
      }
      if (!active.current || controller.signal.aborted) return;
      const next = {
        songs: action === "save" ? saved ? state.current.songs.filter((song) => song.id !== rec.song.id) : [...state.current.songs, rec.song] : state.current.songs,
        votes: action === "save" ? state.current.votes : { ...state.current.votes, [voteKey]: value },
      };
      state.current = next;
      setSongs(next.songs);
      setVotes(next.votes);
      let persistent = true;
      if (!account) {
        try { localStorage.setItem(STORAGE, JSON.stringify(next)); localUnavailable.current = false; }
        catch { persistent = false; localUnavailable.current = true; }
      }
      setNotice(`${action === "save" ? saved ? "Canción quitada de guardadas" : "Canción guardada" : value === null ? "Evaluación quitada" : "Evaluación guardada"}: ${rec.song.title}.${persistent ? "" : " Solo en esta página: el almacenamiento local no está disponible."}`);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo guardar el cambio. Inténtalo de nuevo.");
    } finally {
      actions.current.delete(controller);
      pending.current.delete(rec.song.id);
      if (active.current && !controller.signal.aborted) setBusy(new Set(pending.current));
    }
  }

  return <Context.Provider value={{ songs, votes, busy, ready, accountScope, account, error, notice, retryLoad: () => setRetry((value) => value + 1), act }}>{children}</Context.Provider>;
}

export function SavedRecommendationsPanel() {
  const { songs, busy, ready, account, error, notice, retryLoad, act } = useRecommendationLibrary();
  return (
    <section className="song-panel recommendations-panel" aria-labelledby="saved-recommendations-title" aria-busy={!ready && !error}>
      <div className="song-panel-header"><h2 id="saved-recommendations-title">Canciones guardadas</h2><span>{songs.length}</span></div>
      <p className="list-note">{account ? "Guardadas en tu cuenta." : "Guardadas en este navegador, sin iniciar sesión."} Guardar no cambia las canciones usadas para recomendar.</p>
      {error && <p className="list-note" role="alert">{error} {!ready && <button type="button" className="demo-button demo-button-small" onClick={retryLoad}>Reintentar</button>}</p>}
      <p className="list-note" role="status">{notice || "Evalúa cada recomendación con Me gusta o No me interesa. Puedes cambiar tu respuesta."}</p>
      {songs.length ? <ul className="saved-songs">{songs.map((song) => <li key={song.id} className="saved-recommendation"><div className="song-info"><a className="song-title" href={`https://musicbrainz.org/recording/${song.id}`} target="_blank" rel="noreferrer">{song.title}<span className="sr-only"> (MusicBrainz, nueva pestaña)</span></a><p>{song.artist}</p></div><button type="button" className="remove-song" disabled={busy.size > 0} onClick={() => act({ song }, undefined, "save")} aria-label={`Quitar ${song.title} de guardadas`}>Quitar</button></li>)}</ul>
        : <p className="song-empty">{ready ? "Aún no guardas canciones. Pulsa Guardar en una recomendación." : error ? "Tus canciones no están disponibles. Reintenta la carga." : "Cargando canciones guardadas…"}</p>}
    </section>
  );
}

function RecommendationActionIcon({ action }: { action: "save" | "like" | "dislike" }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {action === "save" ? <path d="M6 4h12v17l-6-4-6 4V4Z" /> : <g transform={action === "dislike" ? "rotate(180 12 12)" : undefined}><path d="M8 10v10H4V10h4Zm0 0 5-7c2 0 2 2 1 6h4a2 2 0 0 1 2 2l-2 7a3 3 0 0 1-3 2H8" /></g>}
  </svg>;
}

export function RecommendationActions({ recommendation: rec, requestId, showStatus = false }: { recommendation: Recommendation; requestId?: string; showStatus?: boolean }) {
  const library = useContext(Context);
  if (!library) return null;
  const key = `${requestId ?? "local"}:${rec.resultId ?? rec.song.id}`;
  const saved = library.songs.some((song) => song.id === rec.song.id);
  const vote = library.votes[library.account ? key : rec.song.id];
  const disabled = !library.ready || library.busy.has(rec.song.id);
  return <div className="recommendation-controls">
    <div className="recommendation-actions" role="group" aria-label={`Guardar o evaluar ${rec.song.title}, ${rec.song.artist}`} aria-busy={library.busy.has(rec.song.id)}>
      <button type="button" className="demo-button demo-button-small" aria-pressed={saved} disabled={disabled} onClick={() => library.act(rec, requestId, "save")}><RecommendationActionIcon action="save" />{saved ? "Guardada · Quitar" : "Guardar"}</button>
      <button type="button" className="feedback-button" aria-pressed={vote === "LIKE"} disabled={disabled} title={vote === "LIKE" ? "Quitar Me gusta" : "Me gusta esta recomendación"} onClick={() => library.act(rec, requestId, "LIKE")}><RecommendationActionIcon action="like" />Me gusta</button>
      <button type="button" className="feedback-button" aria-pressed={vote === "DISLIKE"} disabled={disabled} title={vote === "DISLIKE" ? "Quitar No me interesa" : "No me interesa esta recomendación"} onClick={() => library.act(rec, requestId, "DISLIKE")}><RecommendationActionIcon action="dislike" />No me interesa</button>
    </div>
    {showStatus && !library.ready && <p className="recommendation-action-status" role="status">{library.error || "Cargando controles…"}</p>}
    {showStatus && library.ready && library.error && <p className="recommendation-action-status" role="alert">{library.error}</p>}
    {showStatus && !library.error && library.notice.includes(`: ${rec.song.title}.`) && <p className="recommendation-action-status" role="status">{library.notice}</p>}
  </div>;
}
