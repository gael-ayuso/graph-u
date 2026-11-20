"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Song } from "@/lib/musicbrainz-types";
import { resolveSongCoverUrl } from "@/lib/music-library/cover-url";
import { CoverArt } from "@/components/shared/cover-art";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { ExplorationControls } from "@/components/exploration-batches";

export { snapshot, subscribe, readSongs } from "@/lib/saved-song-list";
import { snapshot, subscribe, readSongs, writeSongs } from "@/lib/saved-song-list";

function duration(milliseconds: number | null) {
  if (!milliseconds) return "—";
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SongDemo() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [searchedWithArtist, setSearchedWithArtist] = useState(false);
  const [results, setResults] = useState<Song[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [temporary, setTemporary] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const initialSearchRun = useRef(false);
  const rawList = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const saved = useMemo(() => readSongs(rawList), [rawList]);
  const savedIds = useMemo(() => new Set(saved.map((song) => song.id)), [saved]);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const handleStartSuccess = useCallback(() => {
    router.push("/explorar/grafo");
  }, [router]);

  const executeSearch = useCallback(async (nextTitle: string, nextArtist: string) => {
    const cleanTitle = nextTitle.trim();
    const cleanArtist = nextArtist.trim();
    if (!cleanTitle && !cleanArtist) {
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
    setSearchedWithArtist(!!cleanArtist);
    try {
      const params = new URLSearchParams({ q: cleanTitle, artist: cleanArtist });
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
  }, []);

  useEffect(() => {
    if (initialSearchRun.current || typeof window === "undefined" || !window.location?.search) return;
    const params = new URLSearchParams(window.location.search);
    const initialQ = (params.get("q") ?? "").trim();
    const initialArtist = (params.get("artist") ?? "").trim();
    if (!initialQ && !initialArtist) return;

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || initialSearchRun.current) return;
      initialSearchRun.current = true;
      setTitle(initialQ);
      setArtist(initialArtist);
      void executeSearch(initialQ, initialArtist);
    });
    return () => {
      cancelled = true;
    };
  }, [executeSearch]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    await executeSearch(title, artist);
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
          {loading ? <LoadingSkeleton /> : results.length ? (
            <ul className="song-results">
              {results.map((song) => (
                <li className="song-row" key={song.id}>
                  <CoverArt
                    src={resolveSongCoverUrl(song)}
                    alt={`Portada de ${song.title}`}
                    size={48}
                    label={song.artist}
                  />
                  <div className="song-info"><a href={`https://musicbrainz.org/recording/${song.id}`} target="_blank" rel="noreferrer" className="song-title">{song.title}<span className="sr-only"> (ver en MusicBrainz, nueva pestaña)</span></a><p>{song.artist}</p>{(song.release || song.comment) && <p className="song-detail">{[song.release, song.comment].filter(Boolean).join(" · ")}</p>}</div>
                  <span className="song-duration" aria-label={song.duration ? undefined : "Duración no disponible"}>{duration(song.duration)}</span>
                  <button type="button" className="demo-button demo-button-small" disabled={savedIds.has(song.id)} onClick={() => addSong(song)} aria-label={`${savedIds.has(song.id) ? "Añadida" : "Añadir"}: ${song.title}, ${song.artist}`}>{savedIds.has(song.id) ? "Añadida" : "Añadir"}</button>
                </li>
              ))}
            </ul>
          ) : <p className="song-empty">{searched ? "No encontramos canciones. Prueba otro título o artista." : "Busca una canción para ver los resultados aquí."}</p>}
          {searched && results.length > 0 && (
            <p className="search-footnote">
              {searchedWithArtist
                ? "Hasta 20 resultados de MusicBrainz."
                : "Hasta 20 resultados. Añade un artista para afinar la búsqueda."}
            </p>
          )}
        </section>
        <section className="song-panel saved-panel" aria-labelledby="saved-title">
          <div className="song-panel-header"><h2 id="saved-title">Mi lista</h2><span>{saved.length}</span></div>
          <p className="list-note">{temporary ? "La lista se mantiene solo en esta pestaña: el almacenamiento del navegador no está disponible." : "Se guarda en este navegador, sin iniciar sesión."}</p>
          {saved.length > 10 && <p className="list-note">Las recomendaciones usan las primeras 10 canciones de tu lista. Las demás no participan en esta tanda.</p>}
          {saved.length ? <ol className="saved-songs">{saved.map((song, index) => (
            <li className="saved-song" key={song.id}>
              <span className="saved-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <CoverArt
                src={resolveSongCoverUrl(song)}
                alt={`Portada de ${song.title}`}
                size={40}
                label={song.artist}
              />
              <div className="song-info"><span className="song-title">{song.title}</span><p>{song.artist}</p></div>
              <button type="button" className="remove-song" onClick={() => removeSong(song)} aria-label={`Quitar ${song.title} de mi lista`}>Quitar</button>
            </li>
          ))}</ol> : <p className="song-empty">Tu lista está vacía.<br />Pulsa «Añadir» junto a una canción.</p>}

          <p className="sr-only" role="status">{notice}</p>
        </section>
      </div>
      <ExplorationControls saved={saved} showGraphLink onStartSuccess={handleStartSuccess} />
    </>
  );
}
