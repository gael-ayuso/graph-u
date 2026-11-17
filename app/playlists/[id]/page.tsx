"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/status-states";

interface PlaylistItem {
  id: string;
  recordingMbid: string;
  title: string;
  artistName: string;
  position: number;
}

interface PlaylistDetail {
  id: string;
  name: string;
  description: string | null;
  items: PlaylistItem[];
}

export default function PlaylistDetailPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // 1. Obtener el detalle y las canciones de esta playlist
  const { data, isLoading, isError, error, refetch } = useQuery<{ playlist: PlaylistDetail }>({
    queryKey: ["playlist-detail", playlistId],
    queryFn: async () => {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`);
      if (!res.ok) {
        throw new Error("No se pudo cargar esta playlist.");
      }
      return res.json();
    },
    enabled: isLoaded && !!user && !!playlistId,
  });

  const playlist = data?.playlist;

  useEffect(() => {
    if (playlist) {
      setName(playlist.name);
      setDescription(playlist.description ?? "");
    }
  }, [playlist]);

  // 2. Actualizar nombre y descripción de la playlist
  const updateInfoMutation = useMutation({
    mutationFn: async (payload: { name: string; description: string }) => {
      setErrorMessage(null);
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error("No se pudo actualizar la información de la playlist.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist-detail", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["user-playlists"] });
      setIsEditing(false);
      setStatusNotice("Información actualizada.");
      setTimeout(() => setStatusNotice(null), 3000);
    },
    onError: (err: Error) => setErrorMessage(err.message),
  });

  // 3. Guardar el nuevo orden de las canciones en el servidor
  const reorderMutation = useMutation({
    mutationFn: async (orderedItemIds: string[]) => {
      setErrorMessage(null);
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: orderedItemIds }),
      });
      if (!res.ok) {
        throw new Error("No se pudo guardar el nuevo orden.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist-detail", playlistId] });
      setStatusNotice("Orden guardado.");
      setTimeout(() => setStatusNotice(null), 2000);
    },
    onError: (err: Error) => setErrorMessage(err.message),
  });

  // 4. Quitar una canción de esta playlist
  const removeItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      setErrorMessage(null);
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error("No se pudo quitar la canción de la playlist.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist-detail", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["user-playlists"] });
    },
    onError: (err: Error) => setErrorMessage(err.message),
  });

  // Función sencilla para mover una canción arriba o abajo
  const handleMove = (index: number, direction: "up" | "down") => {
    if (!playlist?.items) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= playlist.items.length) return;

    const updatedItems = [...playlist.items];
    const temp = updatedItems[index];
    updatedItems[index] = updatedItems[targetIndex];
    updatedItems[targetIndex] = temp;

    const orderedIds = updatedItems.map((item) => item.id);
    reorderMutation.mutate(orderedIds);
  };

  if (!isLoaded || isLoading) {
    return (
      <AppShell title="Cargando playlist..." subtitle="Obteniendo canciones de la lista.">
        <LoadingState message="Cargando detalle de playlist..." />
      </AppShell>
    );
  }

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
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="min-h-[44px] border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
            >
              {isEditing ? "Cerrar edición" : "Editar nombre"}
            </button>
          )}
        </div>
      }
    >
      {isError && (
        <div className="mb-6">
          <ErrorState
            title="Error al abrir playlist"
            message={(error as Error)?.message || "No se pudo cargar la lista."}
            onRetry={() => refetch()}
          />
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

      {/* Formulario para editar nombre/descripción */}
      {isEditing && playlist && (
        <section className="mb-8 border border-[var(--clay)] bg-[#32302f]/60 p-6">
          <h2 className="mb-4 text-lg font-bold text-[var(--cream)]">Editar datos de la playlist</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              updateInfoMutation.mutate({ name: name.trim(), description: description.trim() });
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="editName" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Nombre *
              </label>
              <input
                id="editName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="editDesc" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Descripción
              </label>
              <input
                id="editDesc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={updateInfoMutation.isPending || !name.trim()}
              className="min-h-[44px] bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)] disabled:opacity-50"
            >
              {updateInfoMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </button>
          </form>
        </section>
      )}

      {/* Lista de canciones de la playlist */}
      {playlist && (
        <>
          {playlist.items.length === 0 ? (
            <EmptyState
              title="Esta playlist está vacía"
              description="Agrega canciones desde el explorador o desde tus recomendaciones para empezar a armar tu lista."
              action={
                <Link
                  href="/explorar"
                  className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-4 py-2 text-sm font-bold text-[var(--forest)] hover:bg-[var(--cream)]"
                >
                  + Buscar canciones para agregar
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--olive)] border border-[var(--olive)] bg-[#32302f]/30">
              {playlist.items.map((item, idx) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-[#32302f]/70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-[var(--clay)]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <p className="truncate text-base font-bold text-[var(--cream)]">
                        {item.title}
                      </p>
                    </div>
                    <p className="mt-1 pl-7 text-sm text-[var(--cream)]/75">{item.artistName}</p>
                  </div>

                  {/* Controles de reordenamiento y eliminación */}
                  <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                    <button
                      type="button"
                      disabled={idx === 0 || reorderMutation.isPending}
                      onClick={() => handleMove(idx, "up")}
                      aria-label={`Subir ${item.title}`}
                      className="min-h-[44px] border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)] disabled:opacity-30"
                    >
                      ↑ Subir
                    </button>
                    <button
                      type="button"
                      disabled={idx === playlist.items.length - 1 || reorderMutation.isPending}
                      onClick={() => handleMove(idx, "down")}
                      aria-label={`Bajar ${item.title}`}
                      className="min-h-[44px] border border-[var(--olive)] px-3 py-2 text-xs text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)] disabled:opacity-30"
                    >
                      ↓ Bajar
                    </button>
                    <button
                      type="button"
                      disabled={removeItemMutation.isPending}
                      onClick={() => removeItemMutation.mutate(item.id)}
                      aria-label={`Quitar ${item.title} de la playlist`}
                      className="min-h-[44px] border border-[var(--destructive)] px-3 py-2 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--forest)] disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}