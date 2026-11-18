"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { CoverArt } from "@/components/shared/cover-art";
import { buildCoverProxyUrl, resolveSongCoverUrl } from "@/lib/music-library/cover-url";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/status-states";

interface PlaylistTrackItem {
  id: string;
  playlistId: string;
  recordingId: string;
  title: string | null;
  artistName: string | null;
  position: number;
  coverReleaseMbid?: string | null;
  coverUrl?: string | null;
}

interface PlaylistDetail {
  id: string;
  name: string;
  description: string | null;
  version: number;
  _count?: {
    tracks: number;
  };
}

interface TracksPageResponse {
  items: PlaylistTrackItem[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

interface CatalogSearchSong {
  id: string;
  title: string;
  artist: string;
  release: string | null;
  duration: number | null;
  comment: string | null;
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
  coverUrl?: string | null;
}

class PlaylistRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

async function fetchPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
  const res = await fetch(`/api/me/playlists/${encodeURIComponent(playlistId)}`, {
    cache: "no-store",
  });
  if (res.status === 401) {
    throw new PlaylistRequestError("Tu sesión expiró. Inicia sesión nuevamente.", 401);
  }
  if (res.status === 404) {
    throw new PlaylistRequestError("No encontramos esta playlist.", 404, "NOT_FOUND");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaylistRequestError(
      err.error || "No se pudo cargar esta playlist.",
      res.status,
      err.code
    );
  }
  const data = (await res.json()) as { playlist: PlaylistDetail };
  return data.playlist;
}

async function fetchAllPlaylistTracks(playlistId: string): Promise<PlaylistTrackItem[]> {
  const allTracks: PlaylistTrackItem[] = [];
  let offset = 0;

  while (allTracks.length < 500) {
    const res = await fetch(
      `/api/me/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&offset=${offset}`,
      { cache: "no-store" }
    );
    if (res.status === 401) {
      throw new PlaylistRequestError("Tu sesión expiró. Inicia sesión nuevamente.", 401);
    }
    if (res.status === 404) {
      throw new PlaylistRequestError("No encontramos esta playlist.", 404, "NOT_FOUND");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new PlaylistRequestError(
        err.error || "No se pudieron cargar las canciones de la playlist.",
        res.status,
        err.code
      );
    }

    const page = (await res.json()) as TracksPageResponse;
    allTracks.push(...(page.items ?? []));

    if (!page.pagination?.hasMore || page.pagination.nextOffset === null) {
      break;
    }
    offset = page.pagination.nextOffset;
  }

  return allTracks;
}

export default function PlaylistDetailPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [searchTitle, setSearchTitle] = useState("");
  const [searchArtist, setSearchArtist] = useState("");
  const [searchResults, setSearchResults] = useState<CatalogSearchSong[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingRecordingId, setAddingRecordingId] = useState<string | null>(null);
  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (searchAbortRef.current) searchAbortRef.current.abort();
    };
  }, []);

  const showTransientNotice = (message: string) => {
    setStatusNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setStatusNotice(null), 3000);
  };

  const detailQueryKey = ["playlist-detail", user?.id ?? null, playlistId] as const;
  const tracksQueryKey = ["playlist-tracks", user?.id ?? null, playlistId] as const;
  const listQueryKey = ["user-playlists", user?.id ?? null] as const;

  const {
    data: playlist,
    isLoading: isDetailLoading,
    isError: isDetailError,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<PlaylistDetail>({
    queryKey: detailQueryKey,
    queryFn: () => fetchPlaylistDetail(playlistId),
    enabled: isLoaded && !!user && !!playlistId,
    retry: (failureCount, err) => {
      if (err instanceof PlaylistRequestError && (err.status === 401 || err.status === 404)) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const {
    data: tracks = [],
    isLoading: isTracksLoading,
    isError: isTracksError,
    error: tracksError,
    refetch: refetchTracks,
  } = useQuery<PlaylistTrackItem[]>({
    queryKey: tracksQueryKey,
    queryFn: () => fetchAllPlaylistTracks(playlistId),
    enabled: isLoaded && !!user && !!playlistId,
    retry: (failureCount, err) => {
      if (err instanceof PlaylistRequestError && (err.status === 401 || err.status === 404)) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const editName = nameDraft ?? playlist?.name ?? "";
  const editDescription = descriptionDraft ?? playlist?.description ?? "";

  const reloadAll = async () => {
    setConflictMessage(null);
    setErrorMessage(null);
    setNameDraft(null);
    setDescriptionDraft(null);
    await Promise.all([refetchDetail(), refetchTracks()]);
  };

  const handleMutationError = (err: Error, fallback: string) => {
    if (err instanceof PlaylistRequestError && err.status === 409) {
      setConflictMessage(
        err.message || "Esta playlist cambió en otra sesión. Recarga los datos para continuar."
      );
      return;
    }
    setErrorMessage(err.message || fallback);
  };

  const updateInfoMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      description: string | null;
      expectedVersion?: number;
    }) => {
      setErrorMessage(null);
      setConflictMessage(null);
      const res = await fetch(`/api/me/playlists/${encodeURIComponent(playlistId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new PlaylistRequestError(
          err.error || "No se pudo actualizar la información de la playlist.",
          res.status,
          err.code
        );
      }
      return (await res.json()) as { playlist: PlaylistDetail };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(detailQueryKey, updated.playlist);
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      setIsEditing(false);
      setNameDraft(null);
      setDescriptionDraft(null);
      showTransientNotice("Información actualizada.");
    },
    onError: (err: Error) => {
      handleMutationError(err, "No se pudo actualizar la información de la playlist.");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (payload: { orderedTrackIds: string[]; expectedVersion?: number }) => {
      setErrorMessage(null);
      setConflictMessage(null);
      const res = await fetch(`/api/me/playlists/${encodeURIComponent(playlistId)}/tracks/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackIds: payload.orderedTrackIds,
          expectedVersion: payload.expectedVersion,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new PlaylistRequestError(
          err.error || "No se pudo guardar el nuevo orden.",
          res.status,
          err.code
        );
      }
      return (await res.json()) as { ok: boolean; version: number; trackIds: string[] };
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: tracksQueryKey });
      const previousTracks = queryClient.getQueryData<PlaylistTrackItem[]>(tracksQueryKey);
      if (previousTracks) {
        const byId = new Map(previousTracks.map((t) => [t.id, t]));
        const nextTracks = payload.orderedTrackIds
          .map((id, index) => {
            const item = byId.get(id);
            return item ? { ...item, position: index } : null;
          })
          .filter((item): item is PlaylistTrackItem => item !== null);
        queryClient.setQueryData(tracksQueryKey, nextTracks);
      }
      return { previousTracks };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<PlaylistDetail>(detailQueryKey, (prev) =>
        prev ? { ...prev, version: result.version } : prev
      );
      queryClient.invalidateQueries({ queryKey: tracksQueryKey });
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      showTransientNotice("Orden guardado.");
    },
    onError: (err: Error, _, context) => {
      if (context?.previousTracks) {
        queryClient.setQueryData(tracksQueryKey, context.previousTracks);
      }
      handleMutationError(err, "No se pudo guardar el nuevo orden.");
    },
  });

  const removeTrackMutation = useMutation({
    mutationFn: async (payload: { trackId: string; expectedVersion?: number }) => {
      setErrorMessage(null);
      setConflictMessage(null);
      setRemovingTrackId(payload.trackId);
      const res = await fetch(
        `/api/me/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(payload.trackId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            typeof payload.expectedVersion === "number"
              ? { expectedVersion: payload.expectedVersion }
              : {}
          ),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new PlaylistRequestError(
          err.error || "No se pudo quitar la canción de la playlist.",
          res.status,
          err.code
        );
      }
      return (await res.json()) as {
        deleted: boolean;
        trackId: string;
        version: number;
        remainingCount: number;
      };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<PlaylistDetail>(detailQueryKey, (prev) =>
        prev
          ? {
              ...prev,
              version: result.version,
              _count: { tracks: result.remainingCount },
            }
          : prev
      );
      queryClient.invalidateQueries({ queryKey: tracksQueryKey });
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      showTransientNotice("Canción quitada de la playlist.");
    },
    onError: (err: Error) => {
      handleMutationError(err, "No se pudo quitar la canción de la playlist.");
    },
    onSettled: () => {
      setRemovingTrackId(null);
    },
  });

  const addTrackMutation = useMutation({
    mutationFn: async (payload: { recordingId: string; expectedVersion?: number }) => {
      setErrorMessage(null);
      setConflictMessage(null);
      setAddingRecordingId(payload.recordingId);
      const res = await fetch(`/api/me/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new PlaylistRequestError(
          err.error || "No se pudo agregar la canción a la playlist.",
          res.status,
          err.code
        );
      }
      return (await res.json()) as {
        track: PlaylistTrackItem;
        version: number;
        trackCount: number;
      };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<PlaylistDetail>(detailQueryKey, (prev) =>
        prev
          ? {
              ...prev,
              version: result.version,
              _count: { tracks: result.trackCount },
            }
          : prev
      );
      queryClient.setQueryData<PlaylistTrackItem[]>(tracksQueryKey, (prev = []) => [
        ...prev,
        result.track,
      ]);
      queryClient.invalidateQueries({ queryKey: tracksQueryKey });
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      showTransientNotice(
        `Se agregó "${result.track.title ?? "la canción"}" a la playlist.`
      );
    },
    onError: (err: Error) => {
      handleMutationError(err, "No se pudo agregar la canción a la playlist.");
    },
    onSettled: () => {
      setAddingRecordingId(null);
    },
  });

  const handleMove = (index: number, direction: "up" | "down") => {
    if (tracks.length < 2) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tracks.length) return;

    const updated = [...tracks];
    const current = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = current;

    reorderMutation.mutate({
      orderedTrackIds: updated.map((item) => item.id),
      expectedVersion: playlist?.version,
    });
  };

  const handleCatalogSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchTitle.trim();
    const artist = searchArtist.trim();

    if ((!q && !artist) || (q && q.length < 2) || (artist && artist.length < 2)) {
      setSearchError("Escribe al menos 2 caracteres en canción o artista.");
      return;
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearchError(null);
    setIsSearching(true);
    setHasSearched(true);

    try {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (artist) qs.set("artist", artist);

      const res = await fetch(`/api/music/search?${qs.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.error || "El catálogo no está disponible temporalmente."
        );
      }
      const data = (await res.json()) as { songs?: CatalogSearchSong[] };
      setSearchResults(data.songs ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setSearchError(
        err instanceof Error ? err.message : "No se pudo consultar el catálogo."
      );
      setSearchResults([]);
    } finally {
      if (searchAbortRef.current === controller) {
        setIsSearching(false);
      }
    }
  };

  if (!isLoaded || isDetailLoading || isTracksLoading) {
    return (
      <AppShell title="Cargando playlist..." subtitle="Obteniendo canciones de la lista.">
        <LoadingState message="Cargando detalle de playlist..." />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell
        title="Detalle de playlist"
        subtitle="Colección personalizada en GraphU."
      >
        <EmptyState
          title="Inicia sesión para ver esta playlist"
          description="Necesitas una sesión activa para abrir tus listas y editar sus canciones."
          action={
            <Link
              href="/sign-in"
              className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-5 py-2 text-sm font-bold text-[var(--cream)] transition-colors hover:border-[var(--clay)] hover:bg-[var(--clay)] hover:text-[var(--forest)]"
            >
              Iniciar sesión
            </Link>
          }
        />
      </AppShell>
    );
  }

  const activeError = detailError || tracksError;
  const isNotFound =
    activeError instanceof PlaylistRequestError && activeError.status === 404;

  if (isDetailError || isTracksError) {
    return (
      <AppShell
        title={isNotFound ? "Playlist no encontrada" : "Detalle de playlist"}
        subtitle="Colección personalizada en GraphU."
        actions={
          <Link
            href="/playlists"
            className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
          >
            ← Volver a playlists
          </Link>
        }
      >
        {isNotFound ? (
          <EmptyState
            title="No encontramos esta playlist"
            description="Puede que haya sido eliminada o que pertenezca a otra cuenta."
            action={
              <Link
                href="/playlists"
                className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
              >
                Volver a mis playlists
              </Link>
            }
          />
        ) : (
          <ErrorState
            title="Error al abrir playlist"
            message={(activeError as Error)?.message || "No se pudo cargar la lista."}
            onRetry={() => void reloadAll()}
          />
        )}
      </AppShell>
    );
  }

  const existingRecordingIds = new Set(tracks.map((t) => t.recordingId.toLowerCase()));

  return (
    <AppShell
      title={playlist?.name || "Detalle de playlist"}
      subtitle={playlist?.description || "Colección personalizada en GraphU."}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            href="/playlists"
            className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
          >
            ← Volver a playlists
          </Link>
          {playlist && (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowAddPanel((prev) => !prev);
                  setSearchError(null);
                }}
                className="min-h-[44px] bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
              >
                {showAddPanel ? "Ocultar buscador" : "+ Agregar canciones"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditing((prev) => !prev);
                  setNameDraft(null);
                  setDescriptionDraft(null);
                }}
                className="min-h-[44px] border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:border-[var(--clay)] hover:bg-[var(--clay)] hover:text-[var(--forest)]"
              >
                {isEditing ? "Cerrar edición" : "Editar nombre"}
              </button>
            </>
          )}
        </div>
      }
    >
      {conflictMessage && (
        <div
          role="alert"
          className="mb-6 flex flex-col gap-3 border-2 border-[var(--copper)] bg-[#3c2d23] p-4 text-sm text-[var(--cream)] sm:flex-row sm:items-center sm:justify-between"
        >
          <span>! {conflictMessage}</span>
          <button
            type="button"
            onClick={() => void reloadAll()}
            className="min-h-[44px] shrink-0 bg-[var(--clay)] px-4 py-2 text-xs font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
          >
            Recargar lista
          </button>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="mb-6 border border-[var(--destructive)] bg-[#3c2523] p-4 text-sm text-[var(--cream)]">
          ! {errorMessage}
        </div>
      )}

      {statusNotice && (
        <div role="status" className="mb-6 border border-[var(--graph-green)] bg-[#283024] p-3 text-xs text-[var(--graph-green)]">
          ✓ {statusNotice}
        </div>
      )}

      {/* Formulario inline para editar nombre/descripción */}
      {isEditing && playlist && (
        <section className="mb-8 border border-[var(--clay)] bg-[#32302f]/60 p-6">
          <h2 className="mb-4 text-lg font-bold text-[var(--cream)]">Editar datos de la playlist</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cleanName = editName.trim();
              const cleanDesc = editDescription.trim();
              if (!cleanName) {
                setErrorMessage("El nombre de la playlist es obligatorio.");
                return;
              }
              if (cleanName.length > 200) {
                setErrorMessage("El nombre no puede superar los 200 caracteres.");
                return;
              }
              if (cleanDesc.length > 1000) {
                setErrorMessage("La descripción no puede superar los 1000 caracteres.");
                return;
              }
              updateInfoMutation.mutate({
                name: cleanName,
                description: cleanDesc ? cleanDesc : null,
                expectedVersion: playlist.version,
              });
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="editName" className="mb-1.5 block text-xs uppercase text-[var(--cream)]">
                Nombre *
              </label>
              <input
                id="editName"
                type="text"
                required
                maxLength={200}
                value={editName}
                onChange={(e) => setNameDraft(e.target.value)}
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="editDesc" className="mb-1.5 block text-xs uppercase text-[var(--cream)]">
                Descripción
              </label>
              <input
                id="editDesc"
                type="text"
                maxLength={1000}
                value={editDescription}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={updateInfoMutation.isPending || !editName.trim()}
                className="min-h-[44px] bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)] disabled:opacity-50"
              >
                {updateInfoMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setNameDraft(null);
                  setDescriptionDraft(null);
                }}
                className="min-h-[44px] border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)] hover:border-[var(--clay)]"
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Buscador inline del catálogo para agregar canciones */}
      {showAddPanel && playlist && (
        <section
          aria-labelledby="add-tracks-heading"
          className="mb-8 border border-[var(--olive)] bg-[#32302f]/60 p-6"
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="add-tracks-heading" className="text-lg font-bold text-[var(--cream)]">
                Buscar canciones para agregar
              </h2>
              <p className="text-xs text-[var(--cream)]/75">
                Consulta el catálogo local de MusicBrainz y añade canciones directo a esta lista.
              </p>
            </div>
            <Link
              href="/explorar"
              className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
            >
              Ir al explorador completo →
            </Link>
          </div>

          <form onSubmit={handleCatalogSearch} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label htmlFor="catalogSongQuery" className="mb-1 block text-xs uppercase text-[var(--cream)]/80">
                Canción
              </label>
              <input
                id="catalogSongQuery"
                type="text"
                maxLength={150}
                value={searchTitle}
                onChange={(e) => setSearchTitle(e.target.value)}
                placeholder="Ej. Karma Police, Bizarre Love Triangle..."
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="catalogArtistQuery" className="mb-1 block text-xs uppercase text-[var(--cream)]/80">
                Artista (opcional)
              </label>
              <input
                id="catalogArtistQuery"
                type="text"
                maxLength={150}
                value={searchArtist}
                onChange={(e) => setSearchArtist(e.target.value)}
                placeholder="Ej. Radiohead, New Order..."
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isSearching}
                className="min-h-[44px] w-full bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)] disabled:opacity-50 sm:w-auto"
              >
                {isSearching ? "Buscando..." : "Buscar"}
              </button>
            </div>
          </form>

          {searchError && (
            <p role="alert" className="mt-4 border border-[var(--destructive)] bg-[#3c2523] p-3 text-xs text-[var(--cream)]">
              ! {searchError}
            </p>
          )}

          {hasSearched && !isSearching && !searchError && (
            <div className="mt-4">
              {searchResults.length === 0 ? (
                <p className="border border-dashed border-[var(--olive)] p-4 text-xs text-[var(--cream)]/80">
                  No se encontraron canciones con esa búsqueda. Intenta otro título o artista.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[var(--forest)]/80">
                  {searchResults.map((song) => {
                    const alreadyInPlaylist = existingRecordingIds.has(song.id.toLowerCase());
                    const isAddingThis =
                      addingRecordingId === song.id && addTrackMutation.isPending;

                    return (
                      <li
                        key={song.id}
                        className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CoverArt
                            src={resolveSongCoverUrl(song)}
                            alt={`Portada de ${song.title}`}
                            size={44}
                            label={song.artist}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-[var(--cream)]">
                              {song.title}
                            </p>
                            <p className="truncate text-xs text-[var(--cream)]/75">
                              {song.artist}
                              {song.release ? ` · ${song.release}` : ""}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={alreadyInPlaylist || addTrackMutation.isPending}
                          onClick={() =>
                            addTrackMutation.mutate({
                              recordingId: song.id,
                              expectedVersion: playlist.version,
                            })
                          }
                          aria-label={
                            alreadyInPlaylist
                              ? `${song.title} ya está en la lista`
                              : `Agregar ${song.title}`
                          }
                          className={`min-h-[44px] shrink-0 px-4 py-2 text-xs font-bold ${
                            alreadyInPlaylist
                              ? "border border-[var(--olive)] text-[var(--olive)] cursor-not-allowed"
                              : "bg-[var(--clay)] text-[var(--forest)] hover:bg-[var(--cream)] disabled:opacity-50"
                          }`}
                        >
                          {alreadyInPlaylist
                            ? "Ya en lista"
                            : isAddingThis
                              ? "Agregando..."
                              : "+ Agregar"}
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

      {/* Lista de canciones de la playlist */}
      {playlist && (
        <>
          {tracks.length === 0 ? (
            <EmptyState
              title="Esta playlist está vacía"
              description="Agrega canciones desde el buscador inline o explora el catálogo completo para empezar a armar tu lista."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddPanel(true)}
                    className="min-h-[44px] bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
                  >
                    + Buscar canciones aquí
                  </button>
                  <Link
                    href="/explorar"
                    className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                  >
                    Ir al explorador
                  </Link>
                </div>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[#32302f]/30">
              {tracks.map((item, idx) => {
                const displayTitle =
                  item.title ?? `Grabación (${item.recordingId.slice(0, 8)}…)`;
                const displayArtist =
                  item.artistName ?? "Artista no disponible sin catálogo";
                const trackCoverSrc =
                  item.coverUrl !== undefined
                    ? item.coverUrl
                    : buildCoverProxyUrl({
                        type: "recording",
                        mbid: item.recordingId,
                        releaseMbid: item.coverReleaseMbid,
                      });
                const isRemovingThis =
                  removingTrackId === item.id && removeTrackMutation.isPending;

                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 p-4 hover:bg-[#32302f]/70 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="tabular-nums text-xs font-bold text-[var(--clay)]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <CoverArt
                        src={trackCoverSrc}
                        alt={`Portada de ${displayTitle}`}
                        size={48}
                        label={displayArtist}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-bold text-[var(--cream)]">
                          {displayTitle}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-[var(--cream)]/75">
                          {displayArtist}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                      <button
                        type="button"
                        disabled={idx === 0 || reorderMutation.isPending || removeTrackMutation.isPending}
                        onClick={() => handleMove(idx, "up")}
                        aria-label={`Subir ${displayTitle}`}
                        className="min-h-[44px] border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)] disabled:opacity-30"
                      >
                        ↑ Subir
                      </button>
                      <button
                        type="button"
                        disabled={
                          idx === tracks.length - 1 ||
                          reorderMutation.isPending ||
                          removeTrackMutation.isPending
                        }
                        onClick={() => handleMove(idx, "down")}
                        aria-label={`Bajar ${displayTitle}`}
                        className="min-h-[44px] border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)] disabled:opacity-30"
                      >
                        ↓ Bajar
                      </button>
                      <button
                        type="button"
                        disabled={removeTrackMutation.isPending || reorderMutation.isPending}
                        onClick={() =>
                          removeTrackMutation.mutate({
                            trackId: item.id,
                            expectedVersion: playlist.version,
                          })
                        }
                        aria-label={`Quitar ${displayTitle} de la playlist`}
                        className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                      >
                        {isRemovingThis ? "Quitando..." : "Quitar"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}
