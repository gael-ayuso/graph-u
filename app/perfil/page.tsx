"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/status-states";

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
  email: string | null;
  preferences: UserPreferences;
}

const DEFAULT_PREFS: UserPreferences = {
  discoveryMode: "balanced",
  allowExplicit: true,
  defaultLimit: 10,
  preferredTags: [],
};

export default function PerfilPage() {
  const router = useRouter();
  const { user, isLoaded: isClerkLoaded } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [prefsDraft, setPrefsDraft] = useState<UserPreferences | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);

  const [confirmDeleteText, setConfirmDeleteText] = useState("");
  const [showDeleteBox, setShowDeleteBox] = useState(false);

  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (profileTimerRef.current) clearTimeout(profileTimerRef.current);
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
    };
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery<ProfileResponse>({
    queryKey: ["user-profile", user?.id ?? null],
    queryFn: async () => {
      const res = await fetch("/api/profile", { cache: "no-store" });
      if (res.status === 401) {
        throw new Error("Tu sesión expiró o tu cuenta ya fue eliminada. Inicia sesión nuevamente.");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo obtener la información de tu perfil.");
      }
      return res.json();
    },
    enabled: isClerkLoaded && !!user,
    retry: (failureCount, err) => {
      if (err instanceof Error && err.message.includes("Inicia sesión")) return false;
      return failureCount < 1;
    },
  });

  const serverName = data ? (data.name ?? "") : (user?.fullName ?? "");
  const serverUsername = data ? (data.username ?? "") : (user?.username ?? "");
  const serverPrefs: UserPreferences = data?.preferences
    ? {
        discoveryMode: data.preferences.discoveryMode ?? "balanced",
        allowExplicit: data.preferences.allowExplicit ?? true,
        defaultLimit: data.preferences.defaultLimit ?? 10,
        preferredTags: data.preferences.preferredTags ?? [],
      }
    : DEFAULT_PREFS;

  const name = nameDraft ?? serverName;
  const username = usernameDraft ?? serverUsername;
  const prefs = prefsDraft ?? serverPrefs;

  const updatePrefs = (updater: (current: UserPreferences) => UserPreferences) => {
    setPrefsDraft((prev) => updater(prev ?? serverPrefs));
  };

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: { name?: string; username?: string }) => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al actualizar el perfil.");
      }
      return res.json() as Promise<ProfileResponse>;
    },
    onMutate: () => {
      setProfileNotice(null);
    },
    onSuccess: (updated) => {
      if (updated && typeof updated.id === "string") {
        queryClient.setQueryData(["user-profile", user?.id ?? null], updated);
      }
      queryClient.invalidateQueries({ queryKey: ["user-profile", user?.id ?? null] });
      setNameDraft(null);
      setUsernameDraft(null);
      setProfileNotice("Perfil actualizado correctamente.");
      if (profileTimerRef.current) clearTimeout(profileTimerRef.current);
      profileTimerRef.current = setTimeout(() => setProfileNotice(null), 4000);
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
      return res.json() as Promise<{ preferences: UserPreferences }>;
    },
    onMutate: () => {
      setPrefsNotice(null);
    },
    onSuccess: (updated) => {
      if (updated?.preferences) {
        queryClient.setQueryData<ProfileResponse>(
          ["user-profile", user?.id ?? null],
          (prev) => (prev ? { ...prev, preferences: updated.preferences } : prev)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["user-profile", user?.id ?? null] });
      setPrefsDraft(null);
      setPrefsNotice("Preferencias de recomendación guardadas.");
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => setPrefsNotice(null), 4000);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo eliminar la cuenta. Intenta de nuevo.");
      }
      return res.json();
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["user-profile"] });
      queryClient.clear();
      try {
        await signOut({ redirectUrl: "/" });
      } catch {
        router.replace("/");
      }
    },
  });

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: { name?: string; username?: string } = {};
    if (nameDraft !== null) {
      payload.name = nameDraft;
    }
    if (usernameDraft !== null || nameDraft === null) {
      payload.username = username;
    }
    updateProfileMutation.mutate(payload);
  };

  const handleAddTag = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    const cleaned = tagInput.trim().toLowerCase();
    if (!cleaned || prefs.preferredTags.includes(cleaned)) return;
    updatePrefs((prev) => ({
      ...prev,
      preferredTags: [...prev.preferredTags, cleaned],
    }));
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    updatePrefs((prev) => ({
      ...prev,
      preferredTags: prev.preferredTags.filter((t) => t !== tagToRemove),
    }));
  };

  if (!isClerkLoaded || isLoading) {
    return (
      <AppShell
        title="Perfil y preferencias"
        subtitle="Administra tu identidad en GraphU y ajusta cómo se generan tus recomendaciones."
      >
        <LoadingState variant="profile" message="Cargando configuración de cuenta..." />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell
        title="Perfil y preferencias"
        subtitle="Administra tu identidad en GraphU y ajusta cómo se generan tus recomendaciones."
      >
        <EmptyState
          eyebrow="[ SESIÓN REQUERIDA ]"
          title="Inicia sesión para ver tu perfil"
          description="Necesitas una sesión activa para editar tus datos de perfil, guardar preferencias de recomendación o administrar tu cuenta."
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
      <AppShell
        title="Perfil y preferencias"
        subtitle="Administra tu identidad en GraphU y ajusta cómo se generan tus recomendaciones."
      >
        <ErrorState
          title="Error al cargar perfil"
          message={(error as Error)?.message || "No se pudo conectar con el servidor."}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Perfil y preferencias"
      subtitle="Administra tu identidad en GraphU y ajusta cómo se generan tus recomendaciones."
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* SECCIÓN 1: DATOS DE PERFIL */}
        <section className="border border-[var(--olive)] bg-[#32302f]/40 p-6">
          <div className="mb-5 border-b border-[var(--olive)] pb-3">
            <span className="text-xs uppercase tracking-widest text-[var(--clay)]">
              [ 01 / IDENTIDAD ]
            </span>
            <h2 id="profile-section-heading" className="mt-1 text-xl font-bold text-[var(--cream)]">
              Información del perfil
            </h2>
          </div>

          <form
            aria-labelledby="profile-section-heading"
            onSubmit={handleProfileSubmit}
            className="space-y-5"
          >
            <div>
              <label htmlFor="email" className="block text-xs uppercase text-[var(--cream)]/80 mb-1.5">
                Correo electrónico (gestionado por Clerk)
              </label>
              <input
                id="email"
                name="email"
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
                name="name"
                type="text"
                autoComplete="name"
                maxLength={100}
                value={name}
                onChange={(e) => setNameDraft(e.target.value)}
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
                name="username"
                type="text"
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                aria-describedby="username-help"
                value={username}
                onChange={(e) => setUsernameDraft(e.target.value)}
                placeholder="usuario_graphu"
                className="min-h-[44px] w-full border border-[var(--olive)] bg-[var(--forest)] px-3 py-2 text-sm text-[var(--cream)] focus:border-[var(--clay)] focus:outline-none"
              />
              <p id="username-help" className="mt-1 text-xs text-[var(--cream)]/60">
                Entre 3 y 30 caracteres: letras, números, guion o guion bajo.
              </p>
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
            <h2 id="preferences-section-heading" className="mt-1 text-xl font-bold text-[var(--cream)]">
              Preferencias de recomendación
            </h2>
          </div>

          <form
            aria-labelledby="preferences-section-heading"
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
                name="discoveryMode"
                value={prefs.discoveryMode}
                onChange={(e) =>
                  updatePrefs((prev) => ({
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
                name="defaultLimit"
                type="range"
                min={5}
                max={30}
                step={5}
                value={prefs.defaultLimit}
                onChange={(e) =>
                  updatePrefs((prev) => ({ ...prev, defaultLimit: Number(e.target.value) }))
                }
                className="w-full accent-[var(--clay)]"
              />
              <div className="flex justify-between text-xs text-[var(--cream)]/60">
                <span>5</span>
                <span>15</span>
                <span>30</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border border-[var(--olive)] bg-[var(--forest)] p-3">
              <div>
                <label
                  htmlFor="allowExplicit"
                  className="block cursor-pointer text-sm font-bold text-[var(--cream)]"
                >
                  Permitir contenido explícito
                </label>
                <p id="allowExplicit-desc" className="text-xs text-[var(--cream)]/70">
                  Incluir grabaciones marcadas como explícitas en MusicBrainz.
                </p>
              </div>
              <input
                id="allowExplicit"
                name="allowExplicit"
                type="checkbox"
                aria-describedby="allowExplicit-desc"
                checked={prefs.allowExplicit}
                onChange={(e) =>
                  updatePrefs((prev) => ({ ...prev, allowExplicit: e.target.checked }))
                }
                className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--clay)]"
              />
            </div>

            <div>
              <label htmlFor="tagInput" className="block text-xs uppercase text-[var(--cream)] mb-1.5">
                Géneros o etiquetas afines
              </label>
              <div className="flex gap-2">
                <input
                  id="tagInput"
                  name="tagInput"
                  type="text"
                  maxLength={40}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
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
                name="confirmDelete"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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
