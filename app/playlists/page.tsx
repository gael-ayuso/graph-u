"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/status-states";

interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  _count?: {
    items: number;
  };
}

export default function PlaylistsPage() {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Consultar las playlists del usuario
  const { data, isLoading, isError, error, refetch } = useQuery<{ playlists: PlaylistSummary[] }>({
    queryKey: ["user-playlists"],
    queryFn: async () => {
      const res = await fetch("/api/playlists");
      if (!res.ok) {
        throw new Error("No se pudieron cargar tus playlists.");
      }
      return res.json();
    },
    enabled: isLoaded && !!user,
  });

  // 2. Crear una nueva playlist
  const createPlaylistMutation = useMutation({
    mutationFn: async (payload: { name: string; description: string }) => {
      setErrorMessage(null);
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo crear la playlist.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-playlists"] });
      setName("");
      setDescription("");
      setShowCreateForm(false);
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  // 3. Eliminar una playlist completa
  const deletePlaylistMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      setErrorMessage(null);
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("No se pudo eliminar la playlist.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-playlists"] });
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  const playlists = data?.playlists ?? [];

  if (!isLoaded || isLoading) {
    return (
      <AppShell title="Playlists" subtitle="Organiza tus descubrimientos en listas personalizadas.">
        <LoadingState message="Cargando tus playlists..." />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Playlists"
      subtitle="Crea, organiza y reordena colecciones con las canciones que descubres en GraphU."
      actions={
        <button
          type="button"
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="min-h-[44px] bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)]"
        >
          {showCreateForm ? "Cancelar" : "+ Nueva playlist"}
        </button>
      }
    >
      {isError && (
        <div className="mb-6">
          <ErrorState
            title="Error al cargar playlists"
            message={(error as Error)?.message || "No se pudo conectar con el servidor."}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="mb-6 border border-[var(--destructive)] bg-[#3c2523] p-4 text-sm text-[var(--cream)]">
          ! {errorMessage}
        </div>
      )}

      {/* Formulario para crear playlist */}
      {showCreateForm && (
        <section className="mb-8 border border-[var(--clay)] bg-[#32302f]/60 p-6">
          <h2 className="mb-4 text-lg font-bold text-[var(--cream)]">Crear nueva playlist</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              createPlaylistMutation.mutate({ name: name.trim(), description: description.trim() });
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="playlistName" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Nombre de la playlist *
              </label>
              <input
                id="playlistName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Noche de estudio, Joyas ocultas..."
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="playlistDesc" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Descripción (opcional)
              </label>
              <input
                id="playlistDesc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="De qué trata esta selección..."
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={createPlaylistMutation.isPending || !name.trim()}
              className="min-h-[44px] bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)] disabled:opacity-50"
            >
              {createPlaylistMutation.isPending ? "Creando..." : "Guardar playlist"}
            </button>
          </form>
        </section>
      )}

      {/* Listado de playlists */}
      {playlists.length === 0 ? (
        <EmptyState
          title="Aún no has creado playlists"
          description="Crea tu primera playlist para reunir las canciones que encuentres en el explorador o en tus recomendaciones."
          action={
            !showCreateForm && (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="min-h-[44px] border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
              >
                + Crear mi primera playlist
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {playlists.map((pl) => {
            const count = pl._count?.items ?? 0;
            return (
              <article
                key={pl.id}
                className="flex flex-col justify-between border border-[var(--olive)] bg-[#32302f]/40 p-5"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-[var(--clay)]">
                    <span>[ PLAYLIST ]</span>
                    <span>{count} {count === 1 ? "canción" : "canciones"}</span>
                  </div>
                  <h2 className="mt-2 text-xl font-bold text-[var(--cream)]">{pl.name}</h2>
                  {pl.description && (
                    <p className="mt-2 text-sm text-[var(--cream)]/75">{pl.description}</p>
                  )}
                </div>

                <div className="mt-6 flex items-center justify-between gap-2 border-t border-[var(--olive)]/50 pt-4">
                  <Link
                    href={`/playlists/${encodeURIComponent(pl.id)}`}
                    className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-4 py-2 text-xs font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
                  >
                    Abrir lista
                  </Link>
                  <button
                    type="button"
                    disabled={deletePlaylistMutation.isPending}
                    onClick={() => deletePlaylistMutation.mutate(pl.id)}
                    className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}