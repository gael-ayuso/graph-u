import "server-only";

import { getDb } from "@/lib/db";
import {
  CatalogError,
  isCatalogConfigured,
  normalizeMbid,
  resolveArtistByMbid,
  resolveRecordingByMbid,
} from "@/lib/music-library/catalog";
import { buildCoverProxyUrl, isCoverUuid } from "@/lib/music-library/cover-url";

export interface FavoriteTrackDto {
  id: string;
  recordingMbid: string;
  title: string;
  artistName: string;
  coverReleaseMbid: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export interface FavoriteArtistDto {
  id: string;
  artistMbid: string;
  name: string;
  coverReleaseMbid: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export interface FavoritesListDto {
  tracks: FavoriteTrackDto[];
  artists: FavoriteArtistDto[];
}

const COVER_NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

interface ParsedExplanationSong {
  title?: string;
  artist?: string;
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
  coverUrl?: string | null;
}

function extractSongFromExplanation(explanation: unknown): ParsedExplanationSong | null {
  if (!explanation || typeof explanation !== "object" || Array.isArray(explanation)) {
    return null;
  }
  const song = (explanation as { song?: unknown }).song;
  if (!song || typeof song !== "object" || Array.isArray(song)) {
    return null;
  }
  const s = song as Record<string, unknown>;
  const title = typeof s.title === "string" ? s.title.trim() : undefined;
  const artist = typeof s.artist === "string" ? s.artist.trim() : undefined;
  const releaseMbid = isCoverUuid(s.releaseMbid) ? s.releaseMbid.trim().toLowerCase() : null;
  const releaseGroupMbid = isCoverUuid(s.releaseGroupMbid)
    ? s.releaseGroupMbid.trim().toLowerCase()
    : null;
  const coverUrl =
    typeof s.coverUrl === "string" && s.coverUrl.trim() ? s.coverUrl.trim() : null;

  if (!title && !artist && !releaseMbid && !releaseGroupMbid && !coverUrl) {
    return null;
  }
  return { title, artist, releaseMbid, releaseGroupMbid, coverUrl };
}

interface CoverCacheHint {
  status: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  checkedAt: Date;
}

function resolveCachedOrProxyCover(options: {
  entityType: "recording" | "artist";
  mbid: string;
  storedCoverUrl?: string | null;
  storedReleaseMbid?: string | null;
  catalogReleaseMbid?: string | null;
  catalogCoverUrl?: string | null;
  explanation?: ParsedExplanationSong | null;
  cacheHint?: CoverCacheHint;
}): { coverReleaseMbid: string | null; coverUrl: string | null } {
  const {
    entityType,
    mbid,
    storedCoverUrl,
    storedReleaseMbid,
    catalogReleaseMbid,
    catalogCoverUrl,
    explanation,
    cacheHint,
  } = options;

  const releaseMbid =
    storedReleaseMbid ??
    catalogReleaseMbid ??
    explanation?.releaseMbid ??
    cacheHint?.releaseMbid ??
    null;

  if (typeof storedCoverUrl === "string" && storedCoverUrl.trim()) {
    return { coverReleaseMbid: releaseMbid, coverUrl: storedCoverUrl };
  }
  if (typeof catalogCoverUrl === "string" && catalogCoverUrl.trim()) {
    return { coverReleaseMbid: releaseMbid, coverUrl: catalogCoverUrl };
  }
  if (explanation?.coverUrl) {
    return { coverReleaseMbid: releaseMbid, coverUrl: explanation.coverUrl };
  }

  if (cacheHint) {
    if (cacheHint.status === "FOUND") {
      return {
        coverReleaseMbid: releaseMbid,
        coverUrl: buildCoverProxyUrl({
          type: entityType,
          mbid,
          releaseMbid: cacheHint.releaseMbid ?? releaseMbid,
          releaseGroupMbid: cacheHint.releaseGroupMbid,
        }),
      };
    }
    if (
      cacheHint.status === "NOT_FOUND" &&
      Date.now() - cacheHint.checkedAt.getTime() < COVER_NOT_FOUND_TTL_MS
    ) {
      return { coverReleaseMbid: releaseMbid, coverUrl: null };
    }
  }

  return {
    coverReleaseMbid: releaseMbid,
    coverUrl: buildCoverProxyUrl({
      type: entityType,
      mbid,
      releaseMbid,
      releaseGroupMbid: explanation?.releaseGroupMbid ?? null,
    }),
  };
}

export async function listUserFavorites(userId: string): Promise<FavoritesListDto> {
  const db = getDb();

  const [recordingRows, artistRows] = await Promise.all([
    db.userFavoriteRecording.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { recordingId: "asc" }],
    }),
    db.userFavoriteArtist.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { artistId: "asc" }],
    }),
  ]);

  const missingRecIds = recordingRows
    .filter((row) => !row.title?.trim() || !row.artistName?.trim())
    .map((row) => row.recordingId);

  const explanationByRecId = new Map<string, ParsedExplanationSong>();
  if (missingRecIds.length > 0) {
    const recResults = await db.recommendationResult.findMany({
      where: {
        recordingId: { in: missingRecIds },
        request: { userId },
      },
      orderBy: { createdAt: "desc" },
      distinct: ["recordingId"],
      select: { recordingId: true, explanation: true },
    });

    for (const res of recResults) {
      const parsed = extractSongFromExplanation(res.explanation);
      if (parsed) {
        explanationByRecId.set(res.recordingId.toLowerCase(), parsed);
      }
    }
  }

  const catalogReady = isCatalogConfigured();
  const stillMissingRecIds = recordingRows
    .filter((row) => {
      const exp = explanationByRecId.get(row.recordingId.toLowerCase());
      const hasTitle = Boolean(row.title?.trim() || exp?.title);
      const hasArtist = Boolean(row.artistName?.trim() || exp?.artist);
      return !hasTitle || !hasArtist;
    })
    .map((row) => row.recordingId)
    .slice(0, 20);

  const catalogTracks = new Map<
    string,
    {
      title: string;
      artistName: string;
      coverReleaseMbid: string | null;
      coverUrl: string | null;
    }
  >();
  if (catalogReady && stillMissingRecIds.length > 0) {
    await Promise.all(
      stillMissingRecIds.map(async (mbid) => {
        try {
          const resolved = await resolveRecordingByMbid(mbid);
          catalogTracks.set(mbid.toLowerCase(), {
            title: resolved.title,
            artistName: resolved.artistName,
            coverReleaseMbid: resolved.coverReleaseMbid,
            coverUrl: resolved.coverUrl,
          });
        } catch {
          // Resiliencia offline: nunca fallar listado si MusicBrainz está caído.
        }
      })
    );
  }

  const missingArtistIds = artistRows
    .filter((row) => !row.name?.trim())
    .map((row) => row.artistId)
    .slice(0, 20);

  const catalogArtists = new Map<
    string,
    { name: string; coverReleaseMbid: string | null; coverUrl: string | null }
  >();
  if (catalogReady && missingArtistIds.length > 0) {
    await Promise.all(
      missingArtistIds.map(async (mbid) => {
        try {
          const resolved = await resolveArtistByMbid(mbid);
          catalogArtists.set(mbid.toLowerCase(), {
            name: resolved.name,
            coverReleaseMbid: resolved.coverReleaseMbid,
            coverUrl: resolved.coverUrl,
          });
        } catch {
          // Resiliencia offline: nunca fallar listado si MusicBrainz está caído.
        }
      })
    );
  }

  const uncachedRecIds = recordingRows
    .filter((row) => !row.coverUrl)
    .map((row) => row.recordingId.toLowerCase());
  const uncachedArtistIds = artistRows
    .filter((row) => !row.coverUrl)
    .map((row) => row.artistId.toLowerCase());

  const coverCacheMap = new Map<string, CoverCacheHint>();
  if ((uncachedRecIds.length > 0 || uncachedArtistIds.length > 0) && db.coverCache?.findMany) {
    try {
      const orClauses = [];
      if (uncachedRecIds.length > 0) {
        orClauses.push({ entityType: "recording", mbid: { in: uncachedRecIds } });
      }
      if (uncachedArtistIds.length > 0) {
        orClauses.push({ entityType: "artist", mbid: { in: uncachedArtistIds } });
      }
      const cacheRows = await db.coverCache.findMany({
        where: { OR: orClauses },
        select: {
          entityType: true,
          mbid: true,
          status: true,
          releaseMbid: true,
          releaseGroupMbid: true,
          checkedAt: true,
        },
      });
      for (const entry of cacheRows) {
        coverCacheMap.set(`${entry.entityType}:${entry.mbid.toLowerCase()}`, entry);
      }
    } catch {
      // Cache lookup is best-effort.
    }
  }

  const tracks: FavoriteTrackDto[] = recordingRows.map((row) => {
    const key = row.recordingId.toLowerCase();
    const exp = explanationByRecId.get(key);
    const cat = catalogTracks.get(key);
    const cover = resolveCachedOrProxyCover({
      entityType: "recording",
      mbid: key,
      storedCoverUrl: row.coverUrl,
      storedReleaseMbid: row.coverReleaseMbid,
      catalogReleaseMbid: cat?.coverReleaseMbid,
      catalogCoverUrl: cat?.coverUrl,
      explanation: exp,
      cacheHint: coverCacheMap.get(`recording:${key}`),
    });

    return {
      id: row.id,
      recordingMbid: key,
      title:
        row.title?.trim() ||
        exp?.title ||
        cat?.title ||
        `Canción ${key.slice(0, 8)}`,
      artistName:
        row.artistName?.trim() ||
        exp?.artist ||
        cat?.artistName ||
        "Artista no disponible",
      coverReleaseMbid: cover.coverReleaseMbid,
      coverUrl: cover.coverUrl,
      createdAt: row.createdAt.toISOString(),
    };
  });

  const artists: FavoriteArtistDto[] = artistRows.map((row) => {
    const key = row.artistId.toLowerCase();
    const cat = catalogArtists.get(key);
    const cover = resolveCachedOrProxyCover({
      entityType: "artist",
      mbid: key,
      storedCoverUrl: row.coverUrl,
      storedReleaseMbid: row.coverReleaseMbid,
      catalogReleaseMbid: cat?.coverReleaseMbid,
      catalogCoverUrl: cat?.coverUrl,
      cacheHint: coverCacheMap.get(`artist:${key}`),
    });

    return {
      id: row.id,
      artistMbid: key,
      name: row.name?.trim() || cat?.name || `Artista ${key.slice(0, 8)}`,
      coverReleaseMbid: cover.coverReleaseMbid,
      coverUrl: cover.coverUrl,
      createdAt: row.createdAt.toISOString(),
    };
  });

  return { tracks, artists };
}

export async function addFavoriteTrack(userId: string, rawRecordingMbid: string) {
  const normalized = normalizeMbid(rawRecordingMbid);
  const resolved = await resolveRecordingByMbid(normalized);
  const db = getDb();

  const coverReleaseMbid = resolved.coverReleaseMbid ?? null;
  const coverUrl =
    resolved.coverUrl ??
    buildCoverProxyUrl({
      type: "recording",
      mbid: resolved.recordingMbid,
      releaseMbid: coverReleaseMbid,
      releaseGroupMbid: resolved.coverReleaseGroupMbid ?? null,
    });

  const existing = await db.userFavoriteRecording.findUnique({
    where: {
      userId_recordingId: { userId, recordingId: resolved.recordingMbid },
    },
  });

  let row;
  let created = !existing;
  try {
    row = await db.userFavoriteRecording.upsert({
      where: {
        userId_recordingId: { userId, recordingId: resolved.recordingMbid },
      },
      create: {
        userId,
        recordingId: resolved.recordingMbid,
        title: resolved.title,
        artistName: resolved.artistName,
        coverReleaseMbid,
        coverUrl,
      },
      update: {
        title: resolved.title,
        artistName: resolved.artistName,
        coverReleaseMbid,
        coverUrl,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    created = false;
    row = await db.userFavoriteRecording.update({
      where: {
        userId_recordingId: { userId, recordingId: resolved.recordingMbid },
      },
      data: {
        title: resolved.title,
        artistName: resolved.artistName,
        coverReleaseMbid,
        coverUrl,
      },
    });
  }

  const track: FavoriteTrackDto = {
    id: row.id,
    recordingMbid: row.recordingId.toLowerCase(),
    title: row.title ?? resolved.title,
    artistName: row.artistName ?? resolved.artistName,
    coverReleaseMbid: row.coverReleaseMbid ?? coverReleaseMbid,
    coverUrl: row.coverUrl ?? coverUrl,
    createdAt: row.createdAt.toISOString(),
  };

  return {
    track,
    created,
    alreadyExists: !created,
  };
}

export async function removeFavoriteTrack(userId: string, rawRecordingMbid: string) {
  const mbid = normalizeMbid(rawRecordingMbid);
  const db = getDb();

  const deleted = await db.userFavoriteRecording.deleteMany({
    where: { userId, recordingId: mbid },
  });

  if (deleted.count === 0) {
    throw new CatalogError(
      "La canción no está guardada en tus favoritos.",
      404,
      "NOT_FOUND"
    );
  }

  return { deleted: true, recordingMbid: mbid };
}

export async function addFavoriteArtist(userId: string, rawArtistMbid: string) {
  const normalized = normalizeMbid(rawArtistMbid);
  const resolved = await resolveArtistByMbid(normalized);
  const db = getDb();

  const coverReleaseMbid = resolved.coverReleaseMbid ?? null;
  const coverUrl =
    resolved.coverUrl ??
    buildCoverProxyUrl({
      type: "artist",
      mbid: resolved.artistMbid,
      releaseMbid: coverReleaseMbid,
      releaseGroupMbid: resolved.coverReleaseGroupMbid ?? null,
    });

  const existing = await db.userFavoriteArtist.findUnique({
    where: {
      userId_artistId: { userId, artistId: resolved.artistMbid },
    },
  });

  let row;
  let created = !existing;
  try {
    row = await db.userFavoriteArtist.upsert({
      where: {
        userId_artistId: { userId, artistId: resolved.artistMbid },
      },
      create: {
        userId,
        artistId: resolved.artistMbid,
        name: resolved.name,
        coverReleaseMbid,
        coverUrl,
      },
      update: {
        name: resolved.name,
        coverReleaseMbid,
        coverUrl,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    created = false;
    row = await db.userFavoriteArtist.update({
      where: {
        userId_artistId: { userId, artistId: resolved.artistMbid },
      },
      data: {
        name: resolved.name,
        coverReleaseMbid,
        coverUrl,
      },
    });
  }

  const artist: FavoriteArtistDto = {
    id: row.id,
    artistMbid: row.artistId.toLowerCase(),
    name: row.name ?? resolved.name,
    coverReleaseMbid: row.coverReleaseMbid ?? coverReleaseMbid,
    coverUrl: row.coverUrl ?? coverUrl,
    createdAt: row.createdAt.toISOString(),
  };

  return {
    artist,
    created,
    alreadyExists: !created,
  };
}

export async function removeFavoriteArtist(userId: string, rawArtistMbid: string) {
  const mbid = normalizeMbid(rawArtistMbid);
  const db = getDb();

  const deleted = await db.userFavoriteArtist.deleteMany({
    where: { userId, artistId: mbid },
  });

  if (deleted.count === 0) {
    throw new CatalogError(
      "El artista no está guardado en tus favoritos.",
      404,
      "NOT_FOUND"
    );
  }

  return { deleted: true, artistMbid: mbid };
}
