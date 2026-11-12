"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { Recommendation, Song } from "@/lib/musicbrainz-types";

const STORAGE_KEY = "graphu.demo.songs.v1";
const CHANGE_EVENT = "graphu-song-list-change";
let temporaryList: string | null = null;

export function snapshot() {
  if (temporaryList !== null) return temporaryList;
  try { return window.localStorage.getItem(STORAGE_KEY) || "[]"; }
  catch { return "[]"; }
}

export function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) { temporaryList = null; callback(); }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function readSongs(raw: string): Song[] {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((song): song is Song => {
      if (!song || typeof song.id !== "string" || !/^[a-f0-9-]{36}$/i.test(song.id)
        || typeof song.title !== "string" || typeof song.artist !== "string"
        || !(song.release === null || typeof song.release === "string")
        || !(song.comment === null || typeof song.comment === "string")
        || !(song.duration === null || (typeof song.duration === "number" && Number.isFinite(song.duration)))
        || seen.has(song.id)) return false;
      seen.add(song.id);
      return true;
    });
  } catch { return []; }
}

function writeSongs(songs: Song[]) {
  const raw = JSON.stringify(songs);
  let persisted = true;
  try { window.localStorage.setItem(STORAGE_KEY, raw); temporaryList = null; }
  catch { temporaryList = raw; persisted = false; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return persisted;
}

function duration(milliseconds: number | null) {
  if (!milliseconds) return "—";
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SongDemo() {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [seedTags, setSeedTags] = useState<string[]>([]);
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState("");
  // Artistas ya mostrados en esta tanda; «Otras recomendaciones» los excluye.
  const [shownArtists, setShownArtists] = useState<string[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const rawList = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const saved = useMemo(() => readSongs(rawList), [rawList]);
  const savedIds = useMemo(() => new Set(saved.map((song) => song.id)), [saved]);

  useEffect(() => () => { controller.current?.abort(); }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (!title.trim() && !artist.trim()) {
      setError("Escribe el nombre de una canción o un artista.");
      return;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError("");
    setResults([]);
    setSearched(false);
    try {
      const params = new URLSearchParams({ q: title.trim(), artist: artist.trim() });
      const response = await fetch(`/api/music/search?${params}`, { signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo realizar la búsqueda.");
      if (!Array.isArray(data.songs)) throw new Error("No se pudo leer la búsqueda. Inténtalo de nuevo.");
      setResults(data.songs);
      setSearched(true);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo realizar la búsqueda.");
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  function addSong(song: Song) {
    const current = readSongs(snapshot());
    if (current.some((entry) => entry.id === song.id)) return;
    setTemporary(!writeSongs([...current, song]));
    setNotice(`Añadida a tu lista: ${song.title}.`);
  }

  function removeSong(song: Song) {
    setTemporary(!writeSongs(readSongs(snapshot()).filter((entry) => entry.id !== song.id)));
    setNotice(`Quitada de tu lista: ${song.title}.`);
  }

  async function recommend(more = false) {
    if (recommending || !saved.length) return;
    const excludeArtists = more ? shownArtists : [];
    setRecommending(true);
    setRecommendError("");
    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seeds: saved.slice(0, 10).map((song) => song.id), excludeArtists }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron generar recomendaciones.");
      if (!Array.isArray(data.recommendations)) throw new Error("No se pudieron leer las recomendaciones.");
      const recs: Recommendation[] = data.recommendations;
      setRecommendations(recs);
      setSeedTags(Array.isArray(data.seedTags) ? data.seedTags : []);
      setShownArtists([...new Set([...excludeArtists, ...recs.map((rec) => rec.artistId)])].slice(-200));
      setExhausted(more && !recs.length);
    } catch (failure) {
      setRecommendError(failure instanceof Error ? failure.message : "No se pudieron generar recomendaciones.");
    } finally {
      setRecommending(false);
    }
  }

  return (
    <>
      <form className="song-search" onSubmit={search}>
        <label htmlFor="song-title">Canción<input id="song-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Reckoner" minLength={2} maxLength={150} type="search" /></label>
        <label htmlFor="song-artist">Artista (opcional)<input id="song-artist" value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Ej. Radiohead" minLength={2} maxLength={150} type="search" /></label>
        <button className="demo-button" type="submit" disabled={loading}>{loading ? "Buscando…" : "Buscar"}</button>
      </form>
      {error && <p className="demo-error" role="alert">{error}</p>}
      <div className="song-workspace">
        <section className="song-panel" aria-labelledby="results-title" aria-busy={loading}>
          <div className="song-panel-header"><h2 id="results-title">Resultados</h2><span>{searched ? `${results.length} ${results.length === 1 ? "canción" : "canciones"}` : "MusicBrainz"}</span></div>
          <p className="sr-only" role="status">{loading ? "Buscando canciones en MusicBrainz." : searched ? `${results.length} ${results.length === 1 ? "canción encontrada" : "canciones encontradas"}.` : ""}</p>
          {loading ? <p className="song-empty">Buscando en MusicBrainz…</p> : results.length ? (
            <ul className="song-results">
              {results.map((song) => (
                <li className="song-row" key={song.id}>
                  <div className="song-info"><a href={`https://musicbrainz.org/recording/${song.id}`} target="_blank" rel="noreferrer" className="song-title">{song.title}<span className="sr-only"> (ver en MusicBrainz, nueva pestaña)</span></a><p>{song.artist}</p>{(song.release || song.comment) && <p className="song-detail">{[song.release, song.comment].filter(Boolean).join(" · ")}</p>}</div>
                  <span className="song-duration" aria-label={song.duration ? undefined : "Duración no disponible"}>{duration(song.duration)}</span>
                  <button type="button" className="demo-button demo-button-small" disabled={savedIds.has(song.id)} onClick={() => addSong(song)} aria-label={`${savedIds.has(song.id) ? "Añadida" : "Añadir"}: ${song.title}, ${song.artist}`}>{savedIds.has(song.id) ? "Añadida" : "Añadir"}</button>
                </li>
              ))}
            </ul>
          ) : <p className="song-empty">{searched ? "No encontramos canciones. Prueba otro título o artista." : "Busca una canción para ver los resultados aquí."}</p>}
          {searched && results.length > 0 && <p className="search-footnote">Hasta 20 resultados. Añade un artista para afinar la búsqueda.</p>}
        </section>
        <section className="song-panel saved-panel" aria-labelledby="saved-title">
          <div className="song-panel-header"><h2 id="saved-title">Mi lista</h2><span>{saved.length}</span></div>
          <p className="list-note">{temporary ? "La lista se mantiene solo en esta pestaña: el almacenamiento del navegador no está disponible." : "Se guarda en este navegador, sin iniciar sesión."}</p>
          {saved.length ? <ol className="saved-songs">{saved.map((song, index) => (
            <li className="saved-song" key={song.id}><span className="saved-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div className="song-info"><span className="song-title">{song.title}</span><p>{song.artist}</p></div><button type="button" className="remove-song" onClick={() => removeSong(song)} aria-label={`Quitar ${song.title} de mi lista`}>Quitar</button></li>
          ))}</ol> : <p className="song-empty">Tu lista está vacía.<br />Pulsa «Añadir» junto a una canción.</p>}
          {saved.length > 0 && <p className="search-footnote list-actions"><button type="button" className="demo-button demo-button-small" onClick={() => recommend()} disabled={recommending}>{recommending ? "Calculando…" : "Recomendar con mi lista"}</button><Link href="/explorar">Ver en el grafo →</Link></p>}
          <p className="sr-only" role="status">{notice}</p>
        </section>
      </div>
      {recommendError && <p className="demo-error" role="alert">{recommendError}</p>}
      {(recommending || recommendations) && (
        <section className="song-panel recommendations-panel" aria-labelledby="recommendations-title" aria-busy={recommending}>
          <div className="song-panel-header"><h2 id="recommendations-title">Recomendaciones</h2><span>{seedTags.length ? `Por: ${seedTags.join(" · ")}` : "TF-IDF + coseno"}</span></div>
          {recommending ? <p className="song-empty">Comparando etiquetas, Last.fm y colaboraciones… la primera vez puede tardar unos segundos.</p> : recommendations?.length ? (
            <ul className="song-results">
              {recommendations.map(({ song, score, sharedTags, signals }) => (
                <li className="song-row" key={song.id}>
                  <div className="song-info"><a href={`https://musicbrainz.org/recording/${song.id}`} target="_blank" rel="noreferrer" className="song-title">{song.title}<span className="sr-only"> (ver en MusicBrainz, nueva pestaña)</span></a><p>{song.artist}</p><p className="song-detail">{Math.round(score * 100)}% parecido · {[sharedTags.length > 0 && `comparte ${sharedTags.join(", ")}`, signals?.includes("songs") && "canción similar en Last.fm", signals?.includes("listeners") && "artista similar en Last.fm", signals?.includes("collab") && "colaboraciones", signals?.includes("versions") && "grabó tu misma canción"].filter(Boolean).join(" · ")}</p></div>
                  <span className="song-duration" aria-label={song.duration ? undefined : "Duración no disponible"}>{duration(song.duration)}</span>
                  <button type="button" className="demo-button demo-button-small" disabled={savedIds.has(song.id)} onClick={() => addSong(song)} aria-label={`${savedIds.has(song.id) ? "Añadida" : "Añadir"}: ${song.title}, ${song.artist}`}>{savedIds.has(song.id) ? "Añadida" : "Añadir"}</button>
                </li>
              ))}
            </ul>
          ) : <p className="song-empty">{exhausted ? "Ya te mostramos todos los artistas parecidos que encontramos. Empieza de nuevo o añade otras canciones a tu lista." : "No encontramos canciones parecidas. Prueba con otras canciones en tu lista."}</p>}
          {!recommending && recommendations && (
            <p className="search-footnote list-actions">
              {exhausted
                ? <button type="button" className="demo-button demo-button-small" onClick={() => recommend()}>Empezar de nuevo</button>
                : <button type="button" className="demo-button demo-button-small" onClick={() => recommend(true)}>Otras recomendaciones</button>}
              <span>¿No te convencen? Te mostramos artistas distintos con los mismos criterios.</span>
            </p>
          )}
        </section>
      )}
    </>
  );
}
