"use client";

import React, { useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { LoadingState, ErrorState } from "@/components/shared/status-states";

interface UserPreferences {
  discoveryMode: "balanced" | "conservative" | "adventurous";
  allowExplicit: boolean;
  defaultLimit: number;
  preferredTags: string[];
}

interface ProfileResponse {
  id: string;
  username: string | null;
  name: string | null;
  email: string;
  preferences: UserPreferences;
}

const DEFAULT_PREFS: UserPreferences = {
  discoveryMode: "balanced",
  allowExplicit: true,
  defaultLimit: 10,
  preferredTags: [],
};

export default function PerfilPage() {
  const { user, isLoaded: isClerkLoaded } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [tagInput, setTagInput] = useState("");
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);

  const [confirmDeleteText, setConfirmDeleteText] = useState("");
  const [showDeleteBox, setShowDeleteBox] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<ProfileResponse>({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) {
        throw new Error("No se pudo obtener la información de tu perfil.");
      }
      return res.json();
    },
    enabled: isClerkLoaded && !!user,
  });

  useEffect(() => {
    if (data) {
      setName(data.name ?? user?.fullName ?? "");
      setUsername(data.username ?? user?.username ?? "");
      setPrefs({
        discoveryMode: data.preferences?.discoveryMode ?? "balanced",
        allowExplicit: data.preferences?.allowExplicit ?? true,
        defaultLimit: data.preferences?.defaultLimit ?? 10,
        preferredTags: data.preferences?.preferredTags ?? [],
      });
    } else if (user) {
      setName(user.fullName ?? "");
      setUsername(user.username ?? "");
    }
  }, [data, user]);

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: { name: string; username: string }) => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al actualizar el perfil.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      setProfileNotice("Perfil actualizado correctamente.");
      setTimeout(() => setProfileNotice(null), 4000);
    },
  });

  const updatePrefsMutation = useMutation({
    mutationFn: async (payload: UserPreferences) => {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al guardar preferencias.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      setPrefsNotice("Preferencias de recomendación guardadas.");
      setTimeout(() => setPrefsNotice(null), 4000);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) {
        throw new Error("No se pudo eliminar la cuenta. Intenta de nuevo.");
      }
      return res.json();
    },
    onSuccess: async () => {
      await signOut({ redirectUrl: "/" });
    },
  });

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = tagInput.trim().toLowerCase();
    if (!cleaned || prefs.preferredTags.includes(cleaned)) return;
    setPrefs((prev) => ({
      ...prev,
      preferredTags: [...prev.preferredTags, cleaned],
    }));
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setPrefs((prev) => ({
      ...prev,
      preferredTags: prev.preferredTags.filter((t) => t !== tagToRemove),
    }));
  };

  if (!isClerkLoaded || isLoading) {
    return (
      <AppShell title="Perfil y preferencias" subtitle="Gestiona tu cuenta y parámetros del motor musical.">
        <LoadingState message="Cargando configuración de cuenta..." />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Perfil y preferencias"
      subtitle="Administra tu identidad en GraphU y ajusta cómo se generan tus recomendaciones."
    >
      {isError && (
        <div className="mb-6">
          <ErrorState
            title="Error al cargar perfil"
            message={(error as Error)?.message || "No se pudo conectar con el servidor."}
            onRetry={() => refetch()}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* SECCIÓN 1: DATOS DE PERFIL */}
        <section className="border border-[var(--olive)] bg-[#32302f]/40 p-6">
          <div className="mb-5 border-b border-[var(--olive)] pb-3">
            <span className="text-xs uppercase tracking-widest text-[var(--clay)]">
              [ 01 / IDENTIDAD ]
            </span>
            <h2 className="mt-1 text-xl font-bold text-[var(--cream)]">
              Información del perfil
            </h2>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateProfileMutation.mutate({ name, username });
            }}
            className="space-y-5"
          >
            <div>
              <label htmlFor="email" className="block text-xs uppercase text-[var(--cream)]/80 mb-1.5">
                Correo electrónico (gestionado por Clerk)
              </label>
              <input
                id="email"
                type="email"
                disabled
                value={data?.email ?? user?.primaryEmailAddress?.emailAddress ?? ""}
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[#1d2021] px-3 py-2 text-sm text-[var(--cream)]/60 cursor-not-allowed"
              />
            </div>

            <div>
              <label htmlFor="name" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Nombre para mostrar
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre"
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="username" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Nombre de usuario
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="usuario_graphu"
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
            </div>

            {updateProfileMutation.isError && (
              <p role="alert" className="text-xs text-[var(--destructive)]">
                ! {(updateProfileMutation.error as Error).message}
              </p>
            )}

            {profileNotice && (
              <p role="status" className="text-xs text-[var(--graph-green)]">
                ✓ {profileNotice}
              </p>
            )}

            <button
              type="submit"
              disabled={updateProfileMutation.isPending}
              className="min-h-[49px] w-full bg-[var(--clay)] px-5 py-3 text-sm font-bold text-[var(--forest)] transition-colors duration-150 hover:bg-[var(--cream)] disabled:opacity-50"
            >
              {updateProfileMutation.isPending ? "Guardando..." : "Guardar cambios de perfil"}
            </button>
          </form>
        </section>

        {/* SECCIÓN 2: PREFERENCIAS MUSICALES Y RECOMENDACIÓN */}
        <section className="border border-[var(--olive)] bg-[#32302f]/40 p-6">
          <div className="mb-5 border-b border-[var(--olive)] pb-3">
            <span className="text-xs uppercase tracking-widest text-[var(--copper)]">
              [ 02 / MOTOR MUSICAL ]
            </span>
            <h2 className="mt-1 text-xl font-bold text-[var(--cream)]">
              Preferencias de recomendación
            </h2>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              updatePrefsMutation.mutate(prefs);
            }}
            className="space-y-5"
          >
            <div>
              <label htmlFor="discoveryMode" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Modo de descubrimiento
              </label>
              <select
                id="discoveryMode"
                value={prefs.discoveryMode}
                onChange={(e) =>
                  setPrefs((prev) => ({
                    ...prev,
                    discoveryMode: e.target.value as UserPreferences["discoveryMode"],
                  }))
                }
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              >
                <option value="conservative">Conservador (muy cercano a tus favoritos)</option>
                <option value="balanced">Equilibrado (similitud + exploración)</option>
                <option value="adventurous">Explorador (descubrir artistas y nodos lejanos)</option>
              </select>
            </div>

            <div>
              <label htmlFor="defaultLimit" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Cantidad de resultados por recomendación ({prefs.defaultLimit})
              </label>
              <input
                id="defaultLimit"
                type="range"
                min={5}
                max={30}
                step={5}
                value={prefs.defaultLimit}
                onChange={(e) =>
                  setPrefs((prev) => ({ ...prev, defaultLimit: Number(e.target.value) }))
                }
                className="w-full accent-[var(--clay)]"
              />
              <div className="flex justify-between text-xs text-[var(--cream)]/60">
                <span>5</span>
                <span>15</span>
                <span>30</span>
              </div>
            </div>

            <div className="flex items-center justify-between border border-[var(--olive)] bg-[var(--forest)] p-3">
              <div>
                <p className="text-sm font-bold text-[var(--cream)]">Permitir contenido explícito</p>
                <p className="text-xs text-[var(--cream)]/70">
                  Incluir grabaciones marcadas como explícitas en MusicBrainz.
                </p>
              </div>
              <input
                type="checkbox"
                checked={prefs.allowExplicit}
                onChange={(e) =>
                  setPrefs((prev) => ({ ...prev, allowExplicit: e.target.checked }))
                }
                className="h-5 w-5 accent-[var(--clay)]"
              />
            </div>

            <div>
              <label htmlFor="tagInput" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Géneros o etiquetas afines
              </label>
              <div className="flex gap-2">
                <input
                  id="tagInput"
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddTag(e);
                    }
                  }}
                  placeholder="ej. indie rock, synthpop, jazz..."
                  className="min-h-[44px] flex-1 border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="min-h-[44px] border-2 border-[var(--copper)] px-4 text-sm font-bold text-[var(--cream)] hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
                >
                  Agregar
                </button>
              </div>

              {prefs.preferredTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {prefs.preferredTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-2 border border-[var(--olive)] bg-[var(--forest)] px-2.5 py-1 text-xs text-[var(--cream)]"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        aria-label={`Quitar etiqueta ${tag}`}
                        className="text-[var(--destructive)] hover:font-bold"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {updatePrefsMutation.isError && (
              <p role="alert" className="text-xs text-[var(--destructive)]">
                ! {(updatePrefsMutation.error as Error).message}
              </p>
            )}

            {prefsNotice && (
              <p role="status" className="text-xs text-[var(--graph-green)]">
                ✓ {prefsNotice}
              </p>
            )}

            <button
              type="submit"
              disabled={updatePrefsMutation.isPending}
              className="min-h-[49px] w-full bg-[var(--clay)] px-5 py-3 text-sm font-bold text-[var(--forest)] transition-colors duration-150 hover:bg-[var(--cream)] disabled:opacity-50"
            >
              {updatePrefsMutation.isPending ? "Guardando..." : "Guardar preferencias"}
            </button>
          </form>
        </section>
      </div>

      {/* SECCIÓN 3: ZONA DE PELIGRO / ELIMINAR CUENTA */}
      <section className="mt-10 border-2 border-[var(--destructive)] bg-[#3c2523]/40 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--destructive)]">
              [ ZONA DE PELIGRO ]
            </span>
            <h2 className="mt-1 text-lg font-bold text-[var(--cream)]">
              Eliminar cuenta permanentemente
            </h2>
            <p className="mt-1 text-sm text-[var(--cream)]/80">
              Se eliminarán tu perfil, preferencias, canciones/artistas favoritos y playlists de GraphU.
            </p>
          </div>
          {!showDeleteBox && (
            <button
              type="button"
              onClick={() => setShowDeleteBox(true)}
              className="min-h-[44px] border-2 border-[var(--destructive)] px-4 py-2 text-sm font-bold text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)] hover:text-[var(--forest)]"
            >
              Eliminar mi cuenta
            </button>
          )}
        </div>

        {showDeleteBox && (
          <div className="mt-5 border-t border-[var(--destructive)]/50 pt-5">
            <label htmlFor="confirmDelete" className="block text-xs text-[var(--cream)] mb-2">
              Escribe <strong className="text-[var(--destructive)]">ELIMINAR</strong> para confirmar esta acción irreversible:
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="confirmDelete"
                type="text"
                value={confirmDeleteText}
                onChange={(e) => setConfirmDeleteText(e.target.value)}
                placeholder="ELIMINAR"
                className="min-h-[44px] border border-[var(--destructive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:outline-none"
              />
              <button
                type="button"
                disabled={confirmDeleteText !== "ELIMINAR" || deleteAccountMutation.isPending}
                onClick={() => deleteAccountMutation.mutate()}
                className="min-h-[44px] bg-[var(--destructive)] px-5 py-2 text-sm font-bold text-[var(--forest)] disabled:opacity-40"
              >
                {deleteAccountMutation.isPending ? "Eliminando..." : "Confirmar eliminación"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteBox(false);
                  setConfirmDeleteText("");
                }}
                className="min-h-[44px] border border-[var(--olive)] px-4 py-2 text-sm text-[var(--cream)]"
              >
                Cancelar
              </button>
            </div>
            {deleteAccountMutation.isError && (
              <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">
                ! {(deleteAccountMutation.error as Error).message}
              </p>
            )}
          </div>
        )}
      </section>
    </AppShell>
  );
}