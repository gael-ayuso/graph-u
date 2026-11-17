"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/status-states";

interface FavoriteTrack {
  id: string;
  recordingMbid: string;
  title: string;
  artistName: string;
}

interface FavoriteArtist {
  id: string;
  artistMbid: string;
  name: string;
}

interface FavoritesResponse {
  tracks: FavoriteTrack[];
  artists: FavoriteArtist[];
}

export default function FavoritosPage() {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"tracks" | "artists">("tracks");
  const [searchFilter, setSearchFilter] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Obtener canciones y artistas favoritos desde nuestra API
  const { data, isLoading, isError, error, refetch } = useQuery<FavoritesResponse>({
    queryKey: ["user-favorites"],
    queryFn: async () => {
      const res = await fetch("/api/favorites");
      if (!res.ok) {
        throw new Error("No se pudieron cargar tus favoritos.");
      }
      return res.json();
    },
    enabled: isLoaded && !!user,
  });

  // 2. Eliminar una canción favorita
  const removeTrackMutation = useMutation({
    mutationFn: async (recordingMbid: string) => {
      setErrorMessage(null);
      const res = await fetch(`/api/favorites/tracks/${encodeURIComponent(recordingMbid)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("No se pudo quitar la canción de favoritos.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-favorites"] });
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  // 3. Eliminar un artista favorito
  const removeArtistMutation = useMutation({
    mutationFn: async (artistMbid: string) => {
      setErrorMessage(null);
      const res = await fetch(`/api/favorites/artists/${encodeURIComponent(artistMbid)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("No se pudo quitar el artista de favoritos.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-favorites"] });
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  const tracks = data?.tracks ?? [];
  const artists = data?.artists ?? [];

  const filteredTracks = tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      t.artistName.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const filteredArtists = artists.filter((a) =>
    a.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  if (!isLoaded || isLoading) {
    return (
      <AppShell title="Favoritos" subtitle="Tu colección guardada de canciones y artistas.">
        <LoadingState message="Cargando biblioteca de favoritos..." />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Favoritos"
      subtitle="Canciones y artistas guardados en tu cuenta."
      actions={
        <Link
          href="/explorar"
          className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)]"
        >
          + Explorar catálogo
        </Link>
      }
    >
      {isError && (
        <div className="mb-6">
          <ErrorState
            title="Error al cargar favoritos"
            message={(error as Error)?.message || "No se pudo consultar tu biblioteca."}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="mb-6 border border-[var(--destructive)] bg-[#3c2523] p-4 text-sm text-[var(--cream)]">
          ! {errorMessage}
        </div>
      )}

      {/* Pestañas y buscador local */}
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--olive)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Categorías de favoritos" className="flex gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tracks"}
            onClick={() => setActiveTab("tracks")}
            className={`min-h-[44px] border px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === "tracks"
                ? "border-[var(--clay)] bg-[var(--clay)] text-[var(--forest)]"
                : "border-[var(--olive)] bg-transparent text-[var(--cream)] hover:border-[var(--clay)]"
            }`}
          >
            Canciones ({tracks.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "artists"}
            onClick={() => setActiveTab("artists")}
            className={`min-h-[44px] border px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === "artists"
                ? "border-[var(--clay)] bg-[var(--clay)] text-[var(--forest)]"
                : "border-[var(--olive)] bg-transparent text-[var(--cream)] hover:border-[var(--clay)]"
            }`}
          >
            Artistas ({artists.length})
          </button>
        </div>

        <input
          type="text"
          aria-label="Filtrar en favoritos"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Filtrar en tu lista..."
          className="min-h-[44px] w-full sm:w-72 border border-[var(--olive)] bg-[#1d2021] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
        />
      </div>

      {/* Lista de Canciones */}
      {activeTab === "tracks" && (
        <div>
          {filteredTracks.length === 0 ? (
            <EmptyState
              title={searchFilter ? "Sin coincidencias" : "Aún no tienes canciones favoritas"}
              description={
                searchFilter
                  ? "Prueba con otro término de búsqueda."
                  : "Explora el catálogo para guardar tus primeras canciones."
              }
              action={
                !searchFilter && (
                  <Link
                    href="/explorar"
                    className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
                  >
                    Ir a explorar canciones
                  </Link>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[#32302f]/30">
              {filteredTracks.map((track, idx) => (
                <li
                  key={track.id || track.recordingMbid}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-[#32302f]/70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--olive)]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <p className="truncate text-base font-bold text-[var(--cream)]">
                        {track.title}
                      </p>
                    </div>
                    <p className="mt-1 pl-7 text-sm text-[var(--cream)]/75">
                      {track.artistName}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pl-7 sm:pl-0">
                    <Link
                      href={`/recomendaciones?seed=${encodeURIComponent(track.recordingMbid)}`}
                      className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                    >
                      Similares
                    </Link>
                    <button
                      type="button"
                      disabled={removeTrackMutation.isPending}
                      onClick={() => removeTrackMutation.mutate(track.recordingMbid)}
                      className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Lista de Artistas */}
      {activeTab === "artists" && (
        <div>
          {filteredArtists.length === 0 ? (
            <EmptyState
              title={searchFilter ? "Sin coincidencias" : "Aún no tienes artistas favoritos"}
              description={
                searchFilter
                  ? "Prueba con otro término de búsqueda."
                  : "Guarda tus artistas preferidos desde el explorador."
              }
              action={
                !searchFilter && (
                  <Link
                    href="/explorar"
                    className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
                  >
                    Buscar artistas
                  </Link>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredArtists.map((artist) => (
                <article
                  key={artist.id || artist.artistMbid}
                  className="flex flex-col justify-between border border-[var(--olive)] bg-[#32302f]/40 p-5"
                >
                  <div>
                    <span className="text-xs uppercase tracking-wider text-[var(--graph-aqua)]">
                      [ ARTISTA ]
                    </span>
                    <h2 className="mt-1 text-lg font-bold text-[var(--cream)]">
                      {artist.name}
                    </h2>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-2 border-t border-[var(--olive)]/50 pt-4">
                    <Link
                      href={`/explorar?q=${encodeURIComponent(artist.name)}`}
                      className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)]"
                    >
                      Ver en catálogo
                    </Link>
                    <button
                      type="button"
                      disabled={removeArtistMutation.isPending}
                      onClick={() => removeArtistMutation.mutate(artist.artistMbid)}
                      className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}