export type DiscoveryMode = "conservative" | "balanced" | "adventurous";

export interface UserPreferencesData {
  discoveryMode: DiscoveryMode;
  allowExplicit: boolean;
  defaultLimit: number;
  preferredTags: string[];
}

export const DEFAULT_USER_PREFERENCES: UserPreferencesData = {
  discoveryMode: "balanced",
  allowExplicit: true,
  defaultLimit: 10,
  preferredTags: [],
};

const VALID_DISCOVERY_MODES = new Set<DiscoveryMode>([
  "conservative",
  "balanced",
  "adventurous",
]);

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,30}$/;

export function parseSettingsRecord(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return { ...(settings as Record<string, unknown>) };
}

export function extractUsername(settings: unknown): string | null {
  const record = parseSettingsRecord(settings);
  if (typeof record.username !== "string") return null;
  const trimmed = record.username.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractUserPreferences(settings: unknown): UserPreferencesData {
  const record = parseSettingsRecord(settings);

  const discoveryMode =
    typeof record.discoveryMode === "string" &&
    VALID_DISCOVERY_MODES.has(record.discoveryMode as DiscoveryMode)
      ? (record.discoveryMode as DiscoveryMode)
      : DEFAULT_USER_PREFERENCES.discoveryMode;

  const allowExplicit =
    typeof record.allowExplicit === "boolean"
      ? record.allowExplicit
      : DEFAULT_USER_PREFERENCES.allowExplicit;

  const defaultLimit =
    typeof record.defaultLimit === "number" &&
    Number.isInteger(record.defaultLimit) &&
    record.defaultLimit >= 5 &&
    record.defaultLimit <= 30
      ? record.defaultLimit
      : DEFAULT_USER_PREFERENCES.defaultLimit;

  const preferredTags = Array.isArray(record.preferredTags)
    ? normalizeTags(
        record.preferredTags.filter((tag): tag is string => typeof tag === "string"),
      )
    : [];

  return {
    discoveryMode,
    allowExplicit,
    defaultLimit,
    preferredTags,
  };
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const cleaned = raw.trim().toLowerCase();
    if (!cleaned || cleaned.length > 40 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    normalized.push(cleaned);
    if (normalized.length >= 30) break;
  }
  return normalized;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function validateProfilePatch(
  body: unknown,
): ValidationResult<{ name?: string | null; username?: string | null }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Solicitud de perfil no válida." };
  }

  const input = body as Record<string, unknown>;
  const result: { name?: string | null; username?: string | null } = {};

  if (input.name !== undefined) {
    if (input.name !== null && typeof input.name !== "string") {
      return { ok: false, error: "El nombre debe ser texto válido." };
    }
    const trimmed = input.name === null ? "" : input.name.trim();
    if (trimmed.length > 100) {
      return { ok: false, error: "El nombre no puede superar los 100 caracteres." };
    }
    result.name = trimmed.length > 0 ? trimmed : null;
  }

  if (input.username !== undefined) {
    if (input.username !== null && typeof input.username !== "string") {
      return { ok: false, error: "El nombre de usuario debe ser texto válido." };
    }
    const trimmed = input.username === null ? "" : input.username.trim();
    if (trimmed.length > 0 && !USERNAME_PATTERN.test(trimmed)) {
      return {
        ok: false,
        error:
          "El nombre de usuario debe tener entre 3 y 30 caracteres (letras, números, guion o guion bajo).",
      };
    }
    result.username = trimmed.length > 0 ? trimmed : null;
  }

  if (result.name === undefined && result.username === undefined) {
    return { ok: false, error: "No se enviaron campos válidos para actualizar." };
  }

  return { ok: true, data: result };
}

export function validatePreferencesPut(
  body: unknown,
): ValidationResult<UserPreferencesData> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Solicitud de preferencias no válida." };
  }

  const input = body as Record<string, unknown>;

  if (
    typeof input.discoveryMode !== "string" ||
    !VALID_DISCOVERY_MODES.has(input.discoveryMode as DiscoveryMode)
  ) {
    return { ok: false, error: "Modo de descubrimiento no válido." };
  }

  if (typeof input.allowExplicit !== "boolean") {
    return { ok: false, error: "El filtro de contenido explícito debe ser booleano." };
  }

  if (
    typeof input.defaultLimit !== "number" ||
    !Number.isInteger(input.defaultLimit) ||
    input.defaultLimit < 5 ||
    input.defaultLimit > 30
  ) {
    return {
      ok: false,
      error: "La cantidad de resultados debe ser un entero entre 5 y 30.",
    };
  }

  if (!Array.isArray(input.preferredTags)) {
    return { ok: false, error: "Las etiquetas preferidas deben ser una lista." };
  }

  if (input.preferredTags.length > 30) {
    return { ok: false, error: "Puedes guardar como máximo 30 etiquetas." };
  }

  const seen = new Set<string>();
  const preferredTags: string[] = [];
  for (const item of input.preferredTags) {
    if (typeof item !== "string") {
      return { ok: false, error: "Cada etiqueta debe ser texto válido." };
    }
    const cleaned = item.trim().toLowerCase();
    if (!cleaned || cleaned.length > 40) {
      return {
        ok: false,
        error: "Cada etiqueta debe tener entre 1 y 40 caracteres.",
      };
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      preferredTags.push(cleaned);
    }
  }

  return {
    ok: true,
    data: {
      discoveryMode: input.discoveryMode as DiscoveryMode,
      allowExplicit: input.allowExplicit,
      defaultLimit: input.defaultLimit,
      preferredTags,
    },
  };
}
