"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { PlaylistCoverMosaic } from "@/components/shared/cover-art";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/status-states";

interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  version?: number;
  previewCovers?: string[];
  _count?: {
    tracks: number;
  };
}

interface PlaylistsPageResponse {
  items: PlaylistSummary[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

class PlaylistHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

async function fetchAllUserPlaylists(): Promise<PlaylistSummary[]> {
  const allItems: PlaylistSummary[] = [];
  let offset = 0;

  while (allItems.length < 500) {
    const res = await fetch(`/api/me/playlists?limit=100&offset=${offset}`, {
      cache: "no-store",
    });

    if (res.status === 401) {
      throw new PlaylistHttpError(
        "Tu sesión expiró. Inicia sesión nuevamente para ver tus playlists.",
        401
      );
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new PlaylistHttpError(
        err.error || "No se pudieron cargar tus playlists.",
        res.status,
        err.code
      );
    }

    const page = (await res.json()) as PlaylistsPageResponse;
    allItems.push(...(page.items ?? []));

    if (!page.pagination?.hasMore || page.pagination.nextOffset === null) {
      break;
    }
    offset = page.pagination.nextOffset;
  }

  return allItems;
}

export default function PlaylistsPage() {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showTransientNotice = (message: string) => {
    setStatusNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setStatusNotice(null), 3500);
  };

  const playlistsQueryKey = ["user-playlists", user?.id ?? null] as const;

  const {
    data: playlists = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<PlaylistSummary[]>({
    queryKey: playlistsQueryKey,
    queryFn: fetchAllUserPlaylists,
    enabled: isLoaded && !!user,
    retry: (failureCount, err) => {
      if (err instanceof PlaylistHttpError && err.status === 401) return false;
      return failureCount < 1;
    },
  });

  const createPlaylistMutation = useMutation({
    mutationFn: async (payload: { name: string; description: string | null }) => {
      setErrorMessage(null);
      const res = await fetch("/api/me/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new PlaylistHttpError(
          err.error || "No se pudo crear la playlist.",
          res.status,
          err.code
        );
      }
      return (await res.json()) as { playlist: PlaylistSummary };
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: playlistsQueryKey });
      setName("");
      setDescription("");
      setShowCreateForm(false);
      showTransientNotice(`Playlist "${created.playlist.name}" creada.`);
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: async (playlist: PlaylistSummary) => {
      setErrorMessage(null);
      setDeletingId(playlist.id);
      const res = await fetch(`/api/me/playlists/${encodeURIComponent(playlist.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          typeof playlist.version === "number" ? { expectedVersion: playlist.version } : {}
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new PlaylistHttpError(
          err.error || "No se pudo eliminar la playlist.",
          res.status,
          err.code
        );
      }
      return (await res.json()) as { deleted: boolean; id: string };
    },
    onSuccess: (_, deletedPlaylist) => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: playlistsQueryKey });
      showTransientNotice(`Playlist "${deletedPlaylist.name}" eliminada.`);
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
      if (err instanceof PlaylistHttpError && err.status === 409) {
        setConfirmDeleteId(null);
        queryClient.invalidateQueries({ queryKey: playlistsQueryKey });
      }
    },
    onSettled: () => {
      setDeletingId(null);
    },
  });

  if (!isLoaded || isLoading) {
    return (
      <AppShell title="Playlists" subtitle="Organiza tus descubrimientos en listas personalizadas.">
        <LoadingState message="Cargando tus playlists..." />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell
        title="Playlists"
        subtitle="Crea, organiza y reordena colecciones con las canciones que descubres en GraphU."
      >
        <EmptyState
          title="Inicia sesión para ver tus playlists"
          description="Necesitas una sesión activa para crear listas personalizadas, agregar canciones del catálogo y conservar tu orden."
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

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();

  return (
    <AppShell
      title="Playlists"
      subtitle="Crea, organiza y reordena colecciones con las canciones que descubres en GraphU."
      actions={
        <button
          type="button"
          onClick={() => {
            setErrorMessage(null);
            setShowCreateForm((prev) => !prev);
          }}
          className="min-h-[44px] bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clay)]"
        >
          {showCreateForm ? "Cancelar" : "+ Nueva playlist"}
        </button>
      }
    >
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

      {showCreateForm && (
        <section className="mb-8 border border-[var(--clay)] bg-[#32302f]/60 p-6">
          <h2 className="mb-4 text-lg font-bold text-[var(--cream)]">Crear nueva playlist</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!trimmedName) {
                setErrorMessage("El nombre de la playlist es obligatorio.");
                return;
              }
              if (trimmedName.length > 200) {
                setErrorMessage("El nombre de la playlist no puede superar los 200 caracteres.");
                return;
              }
              if (trimmedDescription.length > 1000) {
                setErrorMessage("La descripción no puede superar los 1000 caracteres.");
                return;
              }
              createPlaylistMutation.mutate({
                name: trimmedName,
                description: trimmedDescription ? trimmedDescription : null,
              });
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="playlistName" className="mb-1.5 block text-xs uppercase text-[var(--cream)]">
                Nombre de la playlist *
              </label>
              <input
                id="playlistName"
                type="text"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Noche de estudio, Joyas ocultas..."
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="playlistDesc" className="mb-1.5 block text-xs uppercase text-[var(--cream)]">
                Descripción (opcional)
              </label>
              <input
                id="playlistDesc"
                type="text"
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="De qué trata esta selección..."
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={createPlaylistMutation.isPending || !trimmedName}
              className="min-h-[44px] bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)] disabled:opacity-50"
            >
              {createPlaylistMutation.isPending ? "Creando..." : "Guardar playlist"}
            </button>
          </form>
        </section>
      )}

      {isError ? (
        <ErrorState
          title="Error al cargar playlists"
          message={(error as Error)?.message || "No se pudo conectar con el servidor."}
          onRetry={() => refetch()}
        />
      ) : playlists.length === 0 ? (
        <EmptyState
          title="Aún no has creado playlists"
          description="Crea tu primera playlist para reunir las canciones que encuentres en el explorador o en tus recomendaciones."
          action={
            !showCreateForm && (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="min-h-[44px] border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:border-[var(--clay)] hover:bg-[var(--clay)] hover:text-[var(--forest)]"
              >
                + Crear mi primera playlist
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {playlists.map((pl) => {
            const count = pl._count?.tracks ?? 0;
            const isConfirming = confirmDeleteId === pl.id;
            const isDeletingThis = deletingId === pl.id && deletePlaylistMutation.isPending;

            return (
              <article
                key={pl.id}
                className="flex flex-col justify-between border border-[var(--olive)] bg-[#32302f]/40 p-5"
              >
                <div className="flex items-start gap-4">
                  <PlaylistCoverMosaic covers={pl.previewCovers} name={pl.name} size={68} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-xs text-[var(--clay)]">
                      <span>[ PLAYLIST ]</span>
                      <span className="tabular-nums">
                        {count} {count === 1 ? "canción" : "canciones"}
                      </span>
                    </div>
                    <h2 className="mt-2 truncate text-xl font-bold text-[var(--cream)]">{pl.name}</h2>
                    {pl.description && (
                      <p className="mt-2 text-sm text-[var(--cream)]/75">{pl.description}</p>
                    )}
                  </div>
                </div>

                <div className="mt-6 border-t border-[var(--olive)]/50 pt-4">
                  {isConfirming ? (
                    <div className="space-y-3" role="group" aria-label={`Confirmar eliminación de ${pl.name}`}>
                      <p className="text-xs text-[var(--cream)]/90">
                        ¿Eliminar <strong>{pl.name}</strong> y sus {count} {count === 1 ? "canción" : "canciones"}?
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isDeletingThis}
                          onClick={() => deletePlaylistMutation.mutate(pl)}
                          className="min-h-[44px] bg-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--forest)] hover:opacity-90 disabled:opacity-50"
                        >
                          {isDeletingThis ? "Eliminando..." : "Confirmar"}
                        </button>
                        <button
                          type="button"
                          disabled={isDeletingThis}
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[44px] border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/playlists/${encodeURIComponent(pl.id)}`}
                        className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-4 py-2 text-xs font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
                      >
                        Abrir lista
                      </Link>
                      <button
                        type="button"
                        disabled={deletePlaylistMutation.isPending}
                        onClick={() => setConfirmDeleteId(pl.id)}
                        aria-label={`Eliminar ${pl.name}`}
                        className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
