"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { CoverArt } from "@/components/shared/cover-art";
import { buildCoverProxyUrl } from "@/lib/music-library/cover-url";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/status-states";

interface FavoriteTrack {
  id: string;
  recordingMbid: string;
  title: string;
  artistName: string;
  coverReleaseMbid?: string | null;
  coverUrl?: string | null;
  createdAt?: string;
}

interface FavoriteArtist {
  id: string;
  artistMbid: string;
  name: string;
  coverReleaseMbid?: string | null;
  coverUrl?: string | null;
  createdAt?: string;
}

interface FavoritesResponse {
  tracks: FavoriteTrack[];
  artists: FavoriteArtist[];
}

interface CatalogRecordingItem {
  recordingMbid: string;
  title: string;
  artistName: string;
  artistMbid: string | null;
  durationMs: number | null;
  comment: string | null;
  coverReleaseMbid?: string | null;
  coverReleaseGroupMbid?: string | null;
  coverUrl?: string | null;
}

interface CatalogArtistItem {
  artistMbid: string;
  name: string;
  sortName: string | null;
  comment: string | null;
  coverReleaseMbid?: string | null;
  coverReleaseGroupMbid?: string | null;
  coverUrl?: string | null;
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const payload = await res.json().catch(() => null);
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export default function FavoritosPage() {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"tracks" | "artists">("tracks");
  const [searchFilter, setSearchFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [showCatalogPanel, setShowCatalogPanel] = useState(false);
  const [catalogType, setCatalogType] = useState<"tracks" | "artists">("tracks");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogArtistFilter, setCatalogArtistFilter] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearched, setCatalogSearched] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogTrackResults, setCatalogTrackResults] = useState<CatalogRecordingItem[]>([]);
  const [catalogArtistResults, setCatalogArtistResults] = useState<CatalogArtistItem[]>([]);

  const [pendingTrackMbids, setPendingTrackMbids] = useState<Set<string>>(() => new Set());
  const [pendingArtistMbids, setPendingArtistMbids] = useState<Set<string>>(() => new Set());

  const tracksTabRef = useRef<HTMLButtonElement | null>(null);
  const artistsTabRef = useRef<HTMLButtonElement | null>(null);
  const catalogInputRef = useRef<HTMLInputElement | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      catalogAbortRef.current?.abort();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showNotice = (message: string) => {
    setActionNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setActionNotice(null), 4500);
  };

  const favoritesQueryKey = ["user-favorites", user?.id ?? null] as const;

  const { data, isLoading, isError, error, refetch } = useQuery<FavoritesResponse>({
    queryKey: favoritesQueryKey,
    queryFn: async () => {
      const res = await fetch("/api/favorites", { cache: "no-store" });
      if (res.status === 401) {
        throw new Error("Tu sesión expiró o no está activa. Inicia sesión nuevamente.");
      }
      if (!res.ok) {
        throw new Error(await readJsonError(res, "No se pudieron cargar tus favoritos."));
      }
      return res.json();
    },
    enabled: isLoaded && !!user,
    retry: (failureCount, err) => {
      if (err instanceof Error && err.message.includes("Inicia sesión")) return false;
      return failureCount < 1;
    },
  });

  const addTrackMutation = useMutation({
    mutationFn: async (recordingMbid: string) => {
      setActionError(null);
      setActionNotice(null);
      setPendingTrackMbids((prev) => new Set(prev).add(recordingMbid));
      try {
        const res = await fetch("/api/favorites/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordingMbid }),
        });
        if (!res.ok) {
          throw new Error(await readJsonError(res, "No se pudo guardar la canción en favoritos."));
        }
        return res.json() as Promise<{ track: FavoriteTrack; created: boolean; alreadyExists: boolean }>;
      } finally {
        setPendingTrackMbids((prev) => {
          const next = new Set(prev);
          next.delete(recordingMbid);
          return next;
        });
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<FavoritesResponse>(favoritesQueryKey, (prev) => {
        if (!prev) return { tracks: [result.track], artists: [] };
        const exists = prev.tracks.some((t) => t.recordingMbid === result.track.recordingMbid);
        return {
          ...prev,
          tracks: exists
            ? prev.tracks.map((t) => (t.recordingMbid === result.track.recordingMbid ? result.track : t))
            : [result.track, ...prev.tracks],
        };
      });
      void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
      showNotice(
        result.alreadyExists
          ? `"${result.track.title}" ya estaba en tus favoritos.`
          : `"${result.track.title}" agregada a canciones favoritas.`
      );
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const removeTrackMutation = useMutation({
    mutationFn: async (recordingMbid: string) => {
      setActionError(null);
      setActionNotice(null);
      setPendingTrackMbids((prev) => new Set(prev).add(recordingMbid));
      try {
        const res = await fetch(`/api/favorites/tracks/${encodeURIComponent(recordingMbid)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          if (res.status === 404) {
            void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
          }
          throw new Error(await readJsonError(res, "No se pudo quitar la canción de favoritos."));
        }
        return res.json();
      } finally {
        setPendingTrackMbids((prev) => {
          const next = new Set(prev);
          next.delete(recordingMbid);
          return next;
        });
      }
    },
    onSuccess: (_result, recordingMbid) => {
      queryClient.setQueryData<FavoritesResponse>(favoritesQueryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tracks: prev.tracks.filter((t) => t.recordingMbid !== recordingMbid),
        };
      });
      void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
      showNotice("Canción eliminada de tus favoritos.");
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const addArtistMutation = useMutation({
    mutationFn: async (artistMbid: string) => {
      setActionError(null);
      setActionNotice(null);
      setPendingArtistMbids((prev) => new Set(prev).add(artistMbid));
      try {
        const res = await fetch("/api/favorites/artists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistMbid }),
        });
        if (!res.ok) {
          throw new Error(await readJsonError(res, "No se pudo guardar el artista en favoritos."));
        }
        return res.json() as Promise<{ artist: FavoriteArtist; created: boolean; alreadyExists: boolean }>;
      } finally {
        setPendingArtistMbids((prev) => {
          const next = new Set(prev);
          next.delete(artistMbid);
          return next;
        });
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<FavoritesResponse>(favoritesQueryKey, (prev) => {
        if (!prev) return { tracks: [], artists: [result.artist] };
        const exists = prev.artists.some((a) => a.artistMbid === result.artist.artistMbid);
        return {
          ...prev,
          artists: exists
            ? prev.artists.map((a) => (a.artistMbid === result.artist.artistMbid ? result.artist : a))
            : [result.artist, ...prev.artists],
        };
      });
      void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
      showNotice(
        result.alreadyExists
          ? `"${result.artist.name}" ya estaba en tus artistas favoritos.`
          : `"${result.artist.name}" agregado a artistas favoritos.`
      );
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const removeArtistMutation = useMutation({
    mutationFn: async (artistMbid: string) => {
      setActionError(null);
      setActionNotice(null);
      setPendingArtistMbids((prev) => new Set(prev).add(artistMbid));
      try {
        const res = await fetch(`/api/favorites/artists/${encodeURIComponent(artistMbid)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          if (res.status === 404) {
            void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
          }
          throw new Error(await readJsonError(res, "No se pudo quitar el artista de favoritos."));
        }
        return res.json();
      } finally {
        setPendingArtistMbids((prev) => {
          const next = new Set(prev);
          next.delete(artistMbid);
          return next;
        });
      }
    },
    onSuccess: (_result, artistMbid) => {
      queryClient.setQueryData<FavoritesResponse>(favoritesQueryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          artists: prev.artists.filter((a) => a.artistMbid !== artistMbid),
        };
      });
      void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
      showNotice("Artista eliminado de tus favoritos.");
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const tracks = useMemo(() => data?.tracks ?? [], [data?.tracks]);
  const artists = useMemo(() => data?.artists ?? [], [data?.artists]);

  const savedTrackMbids = useMemo(
    () => new Set(tracks.map((t) => t.recordingMbid.toLowerCase())),
    [tracks]
  );
  const savedArtistMbids = useMemo(
    () => new Set(artists.map((a) => a.artistMbid.toLowerCase())),
    [artists]
  );

  const normalizedFilter = searchFilter.trim().toLowerCase();
  const filteredTracks = tracks.filter(
    (t) =>
      !normalizedFilter ||
      t.title.toLowerCase().includes(normalizedFilter) ||
      t.artistName.toLowerCase().includes(normalizedFilter)
  );
  const filteredArtists = artists.filter(
    (a) => !normalizedFilter || a.name.toLowerCase().includes(normalizedFilter)
  );

  const executeCatalogSearch = async (
    nextType: "tracks" | "artists",
    nextQuery: string,
    nextArtist: string
  ) => {
    const q = nextQuery.trim();
    const artist = nextType === "tracks" ? nextArtist.trim() : "";

    if (nextType === "artists") {
      if (q.length < 2 || q.length > 150) {
        setCatalogError("Escribe entre 2 y 150 caracteres para buscar artistas.");
        return;
      }
    } else if ((!q && !artist) || (q && q.length < 2) || (artist && artist.length < 2) || q.length > 150 || artist.length > 150) {
      setCatalogError("Escribe entre 2 y 150 caracteres en canción o artista.");
      return;
    }

    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;

    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogSearched(false);

    try {
      const params = new URLSearchParams({ type: nextType, limit: "15" });
      if (q) params.set("q", q);
      if (artist) params.set("artist", artist);

      const res = await fetch(`/api/favorites/catalog?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await readJsonError(res, "No se pudo consultar el catálogo musical."));
      }
      const payload = (await res.json()) as
        | { type: "tracks"; items: CatalogRecordingItem[] }
        | { type: "artists"; items: CatalogArtistItem[] };

      if (controller.signal.aborted) return;
      if (payload.type === "artists") {
        setCatalogArtistResults(Array.isArray(payload.items) ? payload.items : []);
        setCatalogTrackResults([]);
      } else {
        setCatalogTrackResults(Array.isArray(payload.items) ? payload.items : []);
        setCatalogArtistResults([]);
      }
      setCatalogSearched(true);
    } catch (err) {
      if (!controller.signal.aborted) {
        setCatalogError(err instanceof Error ? err.message : "No se pudo consultar el catálogo.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setCatalogLoading(false);
      }
    }
  };

  const openCatalogFor = (type: "tracks" | "artists", prefillArtist = "") => {
    setShowCatalogPanel(true);
    setCatalogType(type);
    setCatalogError(null);
    setCatalogSearched(false);
    setCatalogTrackResults([]);
    setCatalogArtistResults([]);
    if (prefillArtist) {
      setCatalogQuery("");
      setCatalogArtistFilter(prefillArtist);
      void executeCatalogSearch("tracks", "", prefillArtist);
    }
    requestAnimationFrame(() => catalogInputRef.current?.focus());
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "tracks"
          : event.key === "End"
            ? "artists"
            : activeTab === "tracks"
              ? "artists"
              : "tracks";
      setActiveTab(next);
      if (next === "tracks") tracksTabRef.current?.focus();
      else artistsTabRef.current?.focus();
    }
  };

  const pageSubtitle = "Canciones y artistas guardados en tu cuenta.";

  if (!isLoaded || (user && isLoading)) {
    return (
      <AppShell title="Favoritos" subtitle={pageSubtitle}>
        <LoadingState variant="favorites" message="Cargando biblioteca de favoritos..." />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell title="Favoritos" subtitle={pageSubtitle}>
        <EmptyState
          eyebrow="[ SESIÓN REQUERIDA ]"
          title="Inicia sesión para ver tus favoritos"
          description="Necesitas una sesión activa para guardar, consultar y administrar tus canciones y artistas favoritos."
          action={
            <Link
              href="/sign-in"
              className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-5 py-2 text-sm font-bold text-[var(--cream)] transition-colors hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
            >
              Iniciar sesión
            </Link>
          }
        />
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell title="Favoritos" subtitle={pageSubtitle}>
        <ErrorState
          title="Error al cargar favoritos"
          message={(error as Error)?.message || "No se pudo consultar tu biblioteca."}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Favoritos"
      subtitle={pageSubtitle}
      actions={
        <>
          <button
            type="button"
            aria-expanded={showCatalogPanel}
            aria-controls="favorites-catalog-panel"
            onClick={() => {
              if (showCatalogPanel) {
                catalogAbortRef.current?.abort();
                setShowCatalogPanel(false);
              } else {
                openCatalogFor(activeTab);
              }
            }}
            className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)]"
          >
            {showCatalogPanel ? "Cerrar buscador" : "+ Agregar favorito"}
          </button>
          <Link
            href="/explorar"
            className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)] transition-colors hover:border-[var(--clay)] hover:text-[var(--clay)]"
          >
            Ir a Explorar
          </Link>
        </>
      }
    >
      {actionError && (
        <div
          role="alert"
          className="mb-6 border border-[var(--destructive)] bg-[#3c2523] p-4 text-sm text-[var(--cream)]"
        >
          ! {actionError}
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 border border-[var(--graph-green)] bg-[#2f3626] p-4 text-sm text-[var(--cream)]"
        >
          ✓ {actionNotice}
        </div>
      )}

      {/* Panel inline para buscar y agregar favoritos del catálogo MusicBrainz */}
      {showCatalogPanel && (
        <section
          id="favorites-catalog-panel"
          aria-labelledby="catalog-panel-heading"
          className="mb-8 border border-[var(--clay)] bg-[#32302f]/60 p-6"
        >
          <div className="mb-4 flex flex-col gap-3 border-b border-[var(--olive)] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-xs uppercase tracking-widest text-[var(--clay)]">
                [ CATÁLOGO MUSICBRAINZ ]
              </span>
              <h2 id="catalog-panel-heading" className="mt-1 text-lg font-bold text-[var(--cream)]">
                Buscar y agregar a favoritos
              </h2>
            </div>
            <div className="flex border border-[var(--olive)]" role="group" aria-label="Tipo de búsqueda en catálogo">
              <button
                type="button"
                aria-pressed={catalogType === "tracks"}
                onClick={() => {
                  setCatalogType("tracks");
                  setCatalogError(null);
                  setCatalogSearched(false);
                  setCatalogArtistResults([]);
                }}
                className={`min-h-[44px] px-4 py-2 text-xs font-bold transition-colors ${
                  catalogType === "tracks"
                    ? "bg-[var(--clay)] text-[var(--forest)]"
                    : "bg-transparent text-[var(--cream)] hover:text-[var(--clay)]"
                }`}
              >
                Canciones
              </button>
              <button
                type="button"
                aria-pressed={catalogType === "artists"}
                onClick={() => {
                  setCatalogType("artists");
                  setCatalogError(null);
                  setCatalogSearched(false);
                  setCatalogTrackResults([]);
                }}
                className={`min-h-[44px] border-l border-[var(--olive)] px-4 py-2 text-xs font-bold transition-colors ${
                  catalogType === "artists"
                    ? "bg-[var(--clay)] text-[var(--forest)]"
                    : "bg-transparent text-[var(--cream)] hover:text-[var(--clay)]"
                }`}
              >
                Artistas
              </button>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void executeCatalogSearch(catalogType, catalogQuery, catalogArtistFilter);
            }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] md:grid-cols-[1.2fr_1fr_auto] md:items-end"
          >
            <div>
              <label htmlFor="catalog-query" className="mb-1.5 block text-xs uppercase text-[var(--cream)]">
                {catalogType === "tracks" ? "Título de canción" : "Nombre del artista"}
              </label>
              <input
                ref={catalogInputRef}
                id="catalog-query"
                type="search"
                maxLength={150}
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder={catalogType === "tracks" ? "Ej. Reckoner" : "Ej. Radiohead"}
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            {catalogType === "tracks" && (
              <div>
                <label htmlFor="catalog-artist" className="mb-1.5 block text-xs uppercase text-[var(--cream)]">
                  Artista (opcional)
                </label>
                <input
                  id="catalog-artist"
                  type="search"
                  maxLength={150}
                  value={catalogArtistFilter}
                  onChange={(e) => setCatalogArtistFilter(e.target.value)}
                  placeholder="Ej. Radiohead"
                  className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={catalogLoading}
              className="min-h-[44px] bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)] disabled:opacity-50"
            >
              {catalogLoading ? "Buscando..." : "Buscar"}
            </button>
          </form>

          {catalogError && (
            <p role="alert" className="mt-4 border border-[var(--destructive)] bg-[#3c2523] p-3 text-xs text-[var(--cream)]">
              ! {catalogError}
            </p>
          )}

          {catalogLoading && (
            <div className="mt-5">
              <LoadingState rows={3} message="Consultando catálogo MusicBrainz..." />
            </div>
          )}

          {!catalogLoading && catalogSearched && catalogType === "tracks" && (
            <div className="mt-5">
              {catalogTrackResults.length === 0 ? (
                <p className="border border-dashed border-[var(--olive)] p-4 text-center text-xs text-[var(--cream)]/80">
                  No se encontraron canciones con ese criterio.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[var(--forest)]">
                  {catalogTrackResults.map((item) => {
                    const isSaved = savedTrackMbids.has(item.recordingMbid.toLowerCase());
                    const isBusy = pendingTrackMbids.has(item.recordingMbid.toLowerCase());
                    const duration = formatDuration(item.durationMs);
                    const coverSrc =
                      item.coverUrl !== undefined
                        ? item.coverUrl
                        : buildCoverProxyUrl({
                            type: "recording",
                            mbid: item.recordingMbid,
                            releaseMbid: item.coverReleaseMbid,
                            releaseGroupMbid: item.coverReleaseGroupMbid,
                          });
                    return (
                      <li
                        key={item.recordingMbid}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CoverArt
                            src={coverSrc}
                            alt={`Portada de ${item.title}`}
                            size={44}
                            label={item.artistName}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-[var(--cream)]">{item.title}</p>
                            <p className="mt-0.5 text-xs text-[var(--cream)]/75">
                              {item.artistName}
                              {duration ? ` · ${duration}` : ""}
                              {item.comment ? ` · ${item.comment}` : ""}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isSaved || isBusy}
                          aria-pressed={isSaved}
                          onClick={() => addTrackMutation.mutate(item.recordingMbid)}
                          className={`min-h-[44px] shrink-0 border px-4 py-2 text-xs font-bold transition-colors ${
                            isSaved
                              ? "border-[var(--graph-green)] text-[var(--graph-green)] cursor-default"
                              : "border-[var(--clay)] bg-[var(--clay)] text-[var(--forest)] hover:bg-[var(--cream)] hover:border-[var(--cream)]"
                          } disabled:opacity-75`}
                        >
                          {isBusy ? "Guardando..." : isSaved ? "✓ En favoritos" : "+ Agregar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!catalogLoading && catalogSearched && catalogType === "artists" && (
            <div className="mt-5">
              {catalogArtistResults.length === 0 ? (
                <p className="border border-dashed border-[var(--olive)] p-4 text-center text-xs text-[var(--cream)]/80">
                  No se encontraron artistas con ese criterio.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[var(--forest)]">
                  {catalogArtistResults.map((item) => {
                    const isSaved = savedArtistMbids.has(item.artistMbid.toLowerCase());
                    const isBusy = pendingArtistMbids.has(item.artistMbid.toLowerCase());
                    const artistCoverSrc =
                      item.coverUrl !== undefined
                        ? item.coverUrl
                        : buildCoverProxyUrl({
                            type: "artist",
                            mbid: item.artistMbid,
                            releaseMbid: item.coverReleaseMbid,
                            releaseGroupMbid: item.coverReleaseGroupMbid,
                          });
                    return (
                      <li
                        key={item.artistMbid}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CoverArt
                            src={artistCoverSrc}
                            alt={`Álbum representativo de ${item.name}`}
                            size={44}
                            entityType="artist"
                            label={item.name}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-[var(--cream)]">{item.name}</p>
                            {(item.sortName || item.comment) && (
                              <p className="mt-0.5 text-xs text-[var(--cream)]/75">
                                {[item.sortName, item.comment].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isSaved || isBusy}
                          aria-pressed={isSaved}
                          onClick={() => addArtistMutation.mutate(item.artistMbid)}
                          className={`min-h-[44px] shrink-0 border px-4 py-2 text-xs font-bold transition-colors ${
                            isSaved
                              ? "border-[var(--graph-green)] text-[var(--graph-green)] cursor-default"
                              : "border-[var(--clay)] bg-[var(--clay)] text-[var(--forest)] hover:bg-[var(--cream)] hover:border-[var(--cream)]"
                          } disabled:opacity-75`}
                        >
                          {isBusy ? "Guardando..." : isSaved ? "✓ En favoritos" : "+ Agregar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* Pestañas y buscador local */}
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--olive)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Categorías de favoritos" className="flex gap-2">
          <button
            ref={tracksTabRef}
            id="tab-tracks"
            type="button"
            role="tab"
            aria-selected={activeTab === "tracks"}
            tabIndex={activeTab === "tracks" ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTab("tracks")}
            className={`min-h-[44px] border px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === "tracks"
                ? "border-[var(--clay)] border-b-4 bg-[var(--clay)] text-[var(--forest)]"
                : "border-[var(--olive)] bg-transparent text-[var(--cream)] hover:border-[var(--clay)]"
            }`}
          >
            Canciones ({tracks.length})
          </button>
          <button
            ref={artistsTabRef}
            id="tab-artists"
            type="button"
            role="tab"
            aria-selected={activeTab === "artists"}
            tabIndex={activeTab === "artists" ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTab("artists")}
            className={`min-h-[44px] border px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === "artists"
                ? "border-[var(--clay)] border-b-4 bg-[var(--clay)] text-[var(--forest)]"
                : "border-[var(--olive)] bg-transparent text-[var(--cream)] hover:border-[var(--clay)]"
            }`}
          >
            Artistas ({artists.length})
          </button>
        </div>

        <input
          type="search"
          aria-label="Filtrar en favoritos"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Filtrar en tu lista..."
          className="min-h-[44px] w-full sm:w-72 border border-[var(--olive)] bg-[#1d2021] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
        />
      </div>

      {/* Lista de Canciones */}
      <div
        id="panel-tracks"
        role="tabpanel"
        aria-labelledby="tab-tracks"
        hidden={activeTab !== "tracks"}
      >
        {filteredTracks.length === 0 ? (
          <EmptyState
            title={searchFilter ? "Sin coincidencias" : "Aún no tienes canciones favoritas"}
            description={
              searchFilter
                ? "Prueba con otro término de búsqueda."
                : "Busca canciones en el catálogo o guarda recomendaciones desde Explorar."
            }
            action={
              !searchFilter && (
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => openCatalogFor("tracks")}
                    className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
                  >
                    + Buscar canciones
                  </button>
                  <Link
                    href="/explorar"
                    className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                  >
                    Ir a Explorar
                  </Link>
                </div>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[#32302f]/30">
            {filteredTracks.map((track, idx) => {
              const isRemoving = pendingTrackMbids.has(track.recordingMbid.toLowerCase());
              const trackCoverSrc =
                track.coverUrl !== undefined
                  ? track.coverUrl
                  : buildCoverProxyUrl({
                      type: "recording",
                      mbid: track.recordingMbid,
                      releaseMbid: track.coverReleaseMbid,
                    });
              const searchHref = `/explorar?${new URLSearchParams({
                q: track.title,
                artist: track.artistName,
              }).toString()}`;
              const graphHref = `/explorar/grafo?${new URLSearchParams({
                seed: track.recordingMbid,
                title: track.title,
                artist: track.artistName,
              }).toString()}`;
              return (
                <li
                  key={track.id || track.recordingMbid}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-[#32302f]/70"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="text-xs text-[var(--olive)]">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <CoverArt
                      src={trackCoverSrc}
                      alt={`Portada de ${track.title}`}
                      size={48}
                      label={track.artistName}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-[var(--cream)]">
                        {track.title}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-[var(--cream)]/75">
                        {track.artistName}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                    <Link
                      href={searchHref}
                      className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                    >
                      Buscar similares
                    </Link>
                    <Link
                      href={graphHref}
                      className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                    >
                      Explorar grafo
                    </Link>
                    <button
                      type="button"
                      disabled={isRemoving}
                      onClick={() => removeTrackMutation.mutate(track.recordingMbid)}
                      aria-label={`Quitar ${track.title} de favoritos`}
                      className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                    >
                      {isRemoving ? "Quitando..." : "Quitar"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Lista de Artistas */}
      <div
        id="panel-artists"
        role="tabpanel"
        aria-labelledby="tab-artists"
        hidden={activeTab !== "artists"}
      >
        {filteredArtists.length === 0 ? (
          <EmptyState
            title={searchFilter ? "Sin coincidencias" : "Aún no tienes artistas favoritos"}
            description={
              searchFilter
                ? "Prueba con otro término de búsqueda."
                : "Busca y guarda tus artistas preferidos del catálogo MusicBrainz."
            }
            action={
              !searchFilter && (
                <button
                  type="button"
                  onClick={() => openCatalogFor("artists")}
                  className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
                >
                  + Buscar artistas
                </button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredArtists.map((artist) => {
              const isRemoving = pendingArtistMbids.has(artist.artistMbid.toLowerCase());
              const artistCoverSrc =
                artist.coverUrl !== undefined
                  ? artist.coverUrl
                  : buildCoverProxyUrl({
                      type: "artist",
                      mbid: artist.artistMbid,
                      releaseMbid: artist.coverReleaseMbid,
                    });
              return (
                <article
                  key={artist.id || artist.artistMbid}
                  className="flex flex-col justify-between border border-[var(--olive)] bg-[#32302f]/40 p-5"
                >
                  <div className="flex items-start gap-4">
                    <CoverArt
                      src={artistCoverSrc}
                      alt={`Álbum representativo de ${artist.name}`}
                      size={64}
                      entityType="artist"
                      label={artist.name}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs uppercase tracking-wider text-[var(--graph-aqua)]">
                        [ ARTISTA ]
                      </span>
                      <h2 className="mt-1 truncate text-lg font-bold text-[var(--cream)]">
                        {artist.name}
                      </h2>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-2 border-t border-[var(--olive)]/50 pt-4">
                    <button
                      type="button"
                      onClick={() => openCatalogFor("tracks", artist.name)}
                      className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                    >
                      Ver canciones
                    </button>
                    <button
                      type="button"
                      disabled={isRemoving}
                      onClick={() => removeArtistMutation.mutate(artist.artistMbid)}
                      aria-label={`Quitar ${artist.name} de favoritos`}
                      className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                    >
                      {isRemoving ? "Quitando..." : "Quitar"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
