import "server-only";

import { unstable_rethrow } from "next/navigation";
import { notFound, pageResult, pagination, readApp, resourceId } from "@/lib/app-api";
import { getDb } from "@/lib/db";
import { CatalogError, resolveRecordingByMbid } from "@/lib/music-library/catalog";
import { buildCoverProxyUrl, isCoverUuid } from "@/lib/music-library/cover-url";
import { getCurrentUserProfile } from "@/lib/users/current-user";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_PLAYLIST_NAME_LENGTH = 200;
export const MAX_PLAYLIST_DESCRIPTION_LENGTH = 1000;

export type PlaylistErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "DUPLICATE_TRACK"
  | "TRACK_SET_MISMATCH"
  | "CATALOG_UNAVAILABLE"
  | "CATALOG_TIMEOUT";

export class PlaylistActionError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 503,
    public readonly code: PlaylistErrorCode = "INVALID_INPUT"
  ) {
    super(message);
    this.name = "PlaylistActionError";
  }
}

type PlaylistContext = { params: Promise<{ playlistId: string }> };
type PlaylistTrackContext = { params: Promise<{ playlistId: string; trackId: string }> };

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status, headers: NO_STORE_HEADERS });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!isPlainObject(body)) {
    throw new PlaylistActionError("El cuerpo de la solicitud debe ser un JSON válido.", 400, "INVALID_INPUT");
  }
  return body;
}

async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => "");
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PlaylistActionError("El cuerpo de la solicitud debe ser un JSON válido.", 400, "INVALID_INPUT");
  }
  if (!isPlainObject(parsed)) {
    throw new PlaylistActionError("El cuerpo de la solicitud debe ser un JSON válido.", 400, "INVALID_INPUT");
  }
  return parsed;
}

export function parseUuid(value: unknown, label = "identificador"): string {
  if (typeof value !== "string" || !UUID_REGEX.test(value.trim())) {
    throw new PlaylistActionError(`El ${label} debe ser un UUID válido.`, 400, "INVALID_INPUT");
  }
  return value.trim().toLowerCase();
}

export function validatePlaylistName(value: unknown): string {
  if (typeof value !== "string") {
    throw new PlaylistActionError("El nombre de la playlist es obligatorio.", 400, "INVALID_INPUT");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PlaylistActionError("El nombre de la playlist no puede estar vacío.", 400, "INVALID_INPUT");
  }
  if (trimmed.length > MAX_PLAYLIST_NAME_LENGTH) {
    throw new PlaylistActionError(
      `El nombre de la playlist no puede superar los ${MAX_PLAYLIST_NAME_LENGTH} caracteres.`,
      400,
      "INVALID_INPUT"
    );
  }
  return trimmed;
}

export function validatePlaylistDescription(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PlaylistActionError("La descripción debe ser texto.", 400, "INVALID_INPUT");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > MAX_PLAYLIST_DESCRIPTION_LENGTH) {
    throw new PlaylistActionError(
      `La descripción no puede superar los ${MAX_PLAYLIST_DESCRIPTION_LENGTH} caracteres.`,
      400,
      "INVALID_INPUT"
    );
  }
  return trimmed;
}

export function parseExpectedVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PlaylistActionError("La versión esperada debe ser un entero positivo.", 400, "INVALID_INPUT");
  }
  return value;
}

export function parseExpectedVersionQuery(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("expectedVersion");
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new PlaylistActionError("La versión esperada debe ser un entero positivo.", 400, "INVALID_INPUT");
  }
  return parseExpectedVersion(Number(raw));
}

export function validateReorderIds(body: Record<string, unknown>): string[] {
  const rawList = body.trackIds ?? body.itemIds;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new PlaylistActionError(
      "Debes enviar un arreglo no vacío de canciones para reordenar.",
      400,
      "INVALID_INPUT"
    );
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const id = parseUuid(item, "identificador de canción");
    if (seen.has(id)) {
      throw new PlaylistActionError("La lista de canciones contiene identificadores duplicados.", 400, "INVALID_INPUT");
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function extractSongFallback(
  explanation: unknown
): {
  title: string | null;
  artistName: string | null;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  coverUrl: string | null;
} | null {
  if (!isPlainObject(explanation) || !isPlainObject(explanation.song)) {
    return null;
  }
  const title =
    typeof explanation.song.title === "string" && explanation.song.title.trim()
      ? explanation.song.title.trim()
      : null;
  const artistName =
    typeof explanation.song.artist === "string" && explanation.song.artist.trim()
      ? explanation.song.artist.trim()
      : null;
  const releaseMbid = isCoverUuid(explanation.song.releaseMbid)
    ? explanation.song.releaseMbid.trim().toLowerCase()
    : null;
  const releaseGroupMbid = isCoverUuid(explanation.song.releaseGroupMbid)
    ? explanation.song.releaseGroupMbid.trim().toLowerCase()
    : null;
  const coverUrl =
    typeof explanation.song.coverUrl === "string" && explanation.song.coverUrl.trim()
      ? explanation.song.coverUrl.trim()
      : null;
  if (!title && !artistName && !releaseMbid && !releaseGroupMbid && !coverUrl) {
    return null;
  }
  return { title, artistName, releaseMbid, releaseGroupMbid, coverUrl };
}

type DbClient = ReturnType<typeof getDb>;
type TxClient = Parameters<Parameters<DbClient["$transaction"]>[0]>[0];

async function bumpPlaylistVersionOrThrow(
  tx: TxClient,
  playlistId: string,
  userId: string,
  expectedVersion?: number,
  extraData: { name?: string; description?: string | null } = {}
): Promise<number> {
  const where =
    expectedVersion !== undefined
      ? { id: playlistId, userId, version: expectedVersion }
      : { id: playlistId, userId };

  const updated = await tx.playlist.updateMany({
    where,
    data: {
      ...extraData,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    const existing = await tx.playlist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true, version: true },
    });
    if (!existing) {
      throw new PlaylistActionError("Recurso no encontrado.", 404, "NOT_FOUND");
    }
    throw new PlaylistActionError(
      "La playlist fue modificada en otra sesión. Recarga la lista para continuar.",
      409,
      "VERSION_CONFLICT"
    );
  }

  const refreshed = await tx.playlist.findFirst({
    where: { id: playlistId, userId },
    select: { version: true },
  });
  if (!refreshed) {
    throw new PlaylistActionError("Recurso no encontrado.", 404, "NOT_FOUND");
  }
  return refreshed.version;
}

async function runAuthenticatedAction(action: (context: { db: DbClient; userId: string }) => Promise<Response>) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return jsonResponse({ error: "No autorizado." }, 401);
    }
    const db = getDb();
    return await action({ db, userId: user.id });
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof PlaylistActionError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }

    if (error instanceof CatalogError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }

    if (isPrismaUniqueError(error)) {
      return jsonResponse(
        { error: "Esta canción ya existe en la playlist.", code: "DUPLICATE_TRACK" },
        409
      );
    }

    console.error("Unable to complete playlist operation.");
    return jsonResponse({ error: "Los datos no están disponibles temporalmente." }, 503);
  }
}

export function getPlaylistTracksHandler(request: Request, { params }: PlaylistContext) {
  return readApp(request, async ({ db, userId, searchParams }) => {
    const playlistId = resourceId((await params).playlistId);
    const page = pagination(searchParams);
    const owner = await db.playlist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
    if (!owner) notFound();

    const rows = await db.playlistTrack.findMany({
      where: { playlistId, playlist: { userId } },
      orderBy: { position: "asc" },
      take: page.take,
      skip: page.skip,
    });

    const result = pageResult(rows, page);
    const missingIds = [
      ...new Set(
        result.items
          .filter((row) => row.title == null || row.artistName == null)
          .map((row) => row.recordingId)
      ),
    ];

    const fallbackMap = new Map<string, ReturnType<typeof extractSongFallback>>();
    if (missingIds.length > 0) {
      const recommendations = await db.recommendationResult.findMany({
        where: {
          recordingId: { in: missingIds },
          request: { userId },
        },
        orderBy: { createdAt: "desc" },
        distinct: ["recordingId"],
        select: { recordingId: true, explanation: true },
      });

      for (const rec of recommendations) {
        const parsed = extractSongFallback(rec.explanation);
        if (parsed) {
          fallbackMap.set(rec.recordingId, parsed);
        }
      }
    }

    return {
      ...result,
      items: result.items.map((row) => {
        const fallback = fallbackMap.get(row.recordingId) ?? null;
        const releaseMbid = row.coverReleaseMbid ?? fallback?.releaseMbid ?? null;
        const coverUrl =
          row.coverUrl ??
          fallback?.coverUrl ??
          buildCoverProxyUrl({
            type: "recording",
            mbid: row.recordingId,
            releaseMbid,
            releaseGroupMbid: fallback?.releaseGroupMbid ?? null,
          });

        return {
          ...row,
          title: row.title ?? fallback?.title ?? null,
          artistName: row.artistName ?? fallback?.artistName ?? null,
          coverReleaseMbid: releaseMbid,
          coverUrl,
        };
      }),
    };
  });
}

export async function createPlaylistHandler(request: Request) {
  return runAuthenticatedAction(async ({ db, userId }) => {
    const body = await readJsonObject(request);
    const name = validatePlaylistName(body.name);
    const description = validatePlaylistDescription(body.description);

    const created = await db.playlist.create({
      data: {
        userId,
        name,
        description,
      },
      include: {
        _count: { select: { tracks: true } },
      },
    });

    return jsonResponse({ playlist: created }, 201);
  });
}

export async function updatePlaylistHandler(request: Request, { params }: PlaylistContext) {
  return runAuthenticatedAction(async ({ db, userId }) => {
    const playlistId = parseUuid((await params).playlistId, "identificador de playlist");
    const body = await readJsonObject(request);

    const hasName = "name" in body;
    const hasDescription = "description" in body;
    if (!hasName && !hasDescription) {
      throw new PlaylistActionError("Debes enviar al menos el nombre o la descripción.", 400, "INVALID_INPUT");
    }

    const extraData: { name?: string; description?: string | null } = {};
    if (hasName) {
      extraData.name = validatePlaylistName(body.name);
    }
    if (hasDescription) {
      extraData.description = validatePlaylistDescription(body.description);
    }

    const expectedVersion = parseExpectedVersion(body.expectedVersion);

    const updatedPlaylist = await db.$transaction(async (tx) => {
      await bumpPlaylistVersionOrThrow(tx, playlistId, userId, expectedVersion, extraData);
      const row = await tx.playlist.findFirst({
        where: { id: playlistId, userId },
        include: { _count: { select: { tracks: true } } },
      });
      if (!row) {
        throw new PlaylistActionError("Recurso no encontrado.", 404, "NOT_FOUND");
      }
      return row;
    });

    return jsonResponse({ playlist: updatedPlaylist }, 200);
  });
}

export async function deletePlaylistHandler(request: Request, { params }: PlaylistContext) {
  return runAuthenticatedAction(async ({ db, userId }) => {
    const playlistId = parseUuid((await params).playlistId, "identificador de playlist");
    const body = await readOptionalJsonObject(request);
    const expectedVersion = parseExpectedVersion(body?.expectedVersion) ?? parseExpectedVersionQuery(request);

    await db.$transaction(async (tx) => {
      const deleted = await tx.playlist.deleteMany({
        where:
          expectedVersion !== undefined
            ? { id: playlistId, userId, version: expectedVersion }
            : { id: playlistId, userId },
      });

      if (deleted.count === 0) {
        const existing = await tx.playlist.findFirst({
          where: { id: playlistId, userId },
          select: { id: true },
        });
        if (!existing) {
          throw new PlaylistActionError("Recurso no encontrado.", 404, "NOT_FOUND");
        }
        throw new PlaylistActionError(
          "La playlist fue modificada en otra sesión. Recarga antes de eliminarla.",
          409,
          "VERSION_CONFLICT"
        );
      }
    });

    return jsonResponse({ deleted: true, id: playlistId }, 200);
  });
}

export async function addPlaylistTrackHandler(request: Request, { params }: PlaylistContext) {
  return runAuthenticatedAction(async ({ db, userId }) => {
    const playlistId = parseUuid((await params).playlistId, "identificador de playlist");
    const body = await readJsonObject(request);
    const recordingMbid = parseUuid(
      body.recordingId ?? body.recordingMbid,
      "identificador de canción"
    );
    const expectedVersion = parseExpectedVersion(body.expectedVersion);

    const existingOwner = await db.playlist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true, version: true },
    });
    if (!existingOwner) {
      throw new PlaylistActionError("Recurso no encontrado.", 404, "NOT_FOUND");
    }
    if (expectedVersion !== undefined && existingOwner.version !== expectedVersion) {
      throw new PlaylistActionError(
        "La playlist fue modificada en otra sesión. Recarga la lista para continuar.",
        409,
        "VERSION_CONFLICT"
      );
    }

    const catalogRecording = await resolveRecordingByMbid(recordingMbid);
    const coverReleaseMbid = catalogRecording.coverReleaseMbid ?? null;
    const coverUrl =
      catalogRecording.coverUrl ??
      buildCoverProxyUrl({
        type: "recording",
        mbid: catalogRecording.recordingMbid,
        releaseMbid: coverReleaseMbid,
        releaseGroupMbid: catalogRecording.coverReleaseGroupMbid ?? null,
      });

    const outcome = await db.$transaction(async (tx) => {
      const nextVersion = await bumpPlaylistVersionOrThrow(tx, playlistId, userId, expectedVersion);

      const duplicate = await tx.playlistTrack.findUnique({
        where: {
          playlistId_recordingId: {
            playlistId,
            recordingId: catalogRecording.recordingMbid,
          },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new PlaylistActionError("Esta canción ya está en la playlist.", 409, "DUPLICATE_TRACK");
      }

      const lastTrack = await tx.playlistTrack.findFirst({
        where: { playlistId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const nextPosition = lastTrack ? lastTrack.position + 1 : 0;

      const track = await tx.playlistTrack.create({
        data: {
          playlistId,
          recordingId: catalogRecording.recordingMbid,
          title: catalogRecording.title,
          artistName: catalogRecording.artistName,
          coverReleaseMbid,
          coverUrl,
          position: nextPosition,
        },
      });

      const trackCount = await tx.playlistTrack.count({
        where: { playlistId },
      });

      return { track, version: nextVersion, trackCount };
    });

    return jsonResponse(outcome, 201);
  });
}

export async function removePlaylistTrackHandler(request: Request, { params }: PlaylistTrackContext) {
  return runAuthenticatedAction(async ({ db, userId }) => {
    const resolved = await params;
    const playlistId = parseUuid(resolved.playlistId, "identificador de playlist");
    const trackId = parseUuid(resolved.trackId, "identificador de canción");
    const body = await readOptionalJsonObject(request);
    const expectedVersion = parseExpectedVersion(body?.expectedVersion) ?? parseExpectedVersionQuery(request);

    const outcome = await db.$transaction(async (tx) => {
      const nextVersion = await bumpPlaylistVersionOrThrow(tx, playlistId, userId, expectedVersion);

      const deleted = await tx.playlistTrack.deleteMany({
        where: { id: trackId, playlistId },
      });
      if (deleted.count === 0) {
        throw new PlaylistActionError("La canción no existe en esta playlist.", 404, "NOT_FOUND");
      }

      const remaining = await tx.playlistTrack.findMany({
        where: { playlistId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });

      const needsCompaction = remaining.some((row, index) => row.position !== index);
      if (remaining.length > 0 && needsCompaction) {
        const maxPosition = remaining[remaining.length - 1].position;
        const shift = Math.max(maxPosition, remaining.length) + 1;
        await tx.playlistTrack.updateMany({
          where: { playlistId },
          data: { position: { increment: shift } },
        });
        for (let index = 0; index < remaining.length; index += 1) {
          await tx.playlistTrack.update({
            where: { id: remaining[index].id },
            data: { position: index },
          });
        }
      }

      return {
        deleted: true,
        trackId,
        version: nextVersion,
        remainingCount: remaining.length,
      };
    });

    return jsonResponse(outcome, 200);
  });
}

export async function reorderPlaylistTracksHandler(request: Request, { params }: PlaylistContext) {
  return runAuthenticatedAction(async ({ db, userId }) => {
    const playlistId = parseUuid((await params).playlistId, "identificador de playlist");
    const body = await readJsonObject(request);
    const orderedIds = validateReorderIds(body);
    const expectedVersion = parseExpectedVersion(body.expectedVersion);

    const outcome = await db.$transaction(async (tx) => {
      const nextVersion = await bumpPlaylistVersionOrThrow(tx, playlistId, userId, expectedVersion);

      const currentTracks = await tx.playlistTrack.findMany({
        where: { playlistId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });

      const currentIds = new Set(currentTracks.map((row) => row.id));
      const exactMatch =
        currentTracks.length === orderedIds.length &&
        orderedIds.every((id) => currentIds.has(id));

      if (!exactMatch) {
        throw new PlaylistActionError(
          "Las canciones de la playlist cambiaron en otra sesión. Recarga antes de reordenar.",
          409,
          "TRACK_SET_MISMATCH"
        );
      }

      const maxPosition = currentTracks.reduce((max, row) => Math.max(max, row.position), 0);
      const shift = Math.max(maxPosition, currentTracks.length) + 1;

      await tx.playlistTrack.updateMany({
        where: { playlistId },
        data: { position: { increment: shift } },
      });

      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.playlistTrack.update({
          where: { id: orderedIds[index] },
          data: { position: index },
        });
      }

      return {
        ok: true,
        version: nextVersion,
        trackIds: orderedIds,
      };
    });

    return jsonResponse(outcome, 200);
  });
}
