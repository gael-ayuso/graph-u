import "server-only";

import { getDb } from "@/lib/db";
import {
  isCatalogConfigured,
  resolveArtistCoverTarget,
  resolveRecordingCoverTarget,
  resolveReleaseGroupCoverTarget,
} from "@/lib/music-library/catalog";
import { isCoverUuid, type CoverEntityType } from "@/lib/music-library/cover-url";

export type CoverStatus = "FOUND" | "NOT_FOUND" | "ERROR";

export interface CoverMetadata {
  status: CoverStatus;
  entityType: CoverEntityType;
  mbid: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  coverUrl: string | null;
  cached: boolean;
}

export interface CoverBinaryPayload {
  bytes: Uint8Array;
  contentType: string;
  cached?: boolean;
}

export interface CoverResolution {
  metadata: CoverMetadata;
  image: CoverBinaryPayload | null;
}

const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 10 * 60 * 1000;
const FOUND_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MB_API_INTERVAL_MS = 1100;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const CAA_BASE = "https://coverartarchive.org";
const MB_API_BASE = "https://musicbrainz.org/ws/2";

const globalForCovers = globalThis as unknown as {
  graphuCoverInFlight?: Map<string, Promise<CoverResolution>>;
  graphuCoverImageInFlight?: Map<string, Promise<ProbeOutcome>>;
  graphuMbLastRequestAt?: number;
};

function getInFlightMap(): Map<string, Promise<CoverResolution>> {
  return (globalForCovers.graphuCoverInFlight ??= new Map());
}

function getUserAgent(): string {
  return (
    process.env.MUSICBRAINZ_USER_AGENT?.trim() ||
    "GraphU/0.1.0 (https://graph-u.local)"
  );
}

export function parseCoverEntityType(raw: string | null | undefined): CoverEntityType | null {
  switch (raw?.trim().toLowerCase()) {
    case "recording":
    case "artist":
    case "release":
    case "release-group":
      return raw.trim().toLowerCase() as CoverEntityType;
    default:
      return null;
  }
}

export function buildCaaCandidateUrls(
  releaseMbid: string | null,
  releaseGroupMbid: string | null
): string[] {
  const urls: string[] = [];
  if (isCoverUuid(releaseMbid)) {
    const id = releaseMbid.trim().toLowerCase();
    urls.push(`${CAA_BASE}/release/${id}/front-250`);
    urls.push(`${CAA_BASE}/release/${id}/front`);
  }
  if (isCoverUuid(releaseGroupMbid)) {
    const id = releaseGroupMbid.trim().toLowerCase();
    urls.push(`${CAA_BASE}/release-group/${id}/front-250`);
  }
  return urls;
}

export function renderFallbackCoverSvg(entityType: CoverEntityType): string {
  const accent = entityType === "artist" ? "#fe8019" : "#fabd2f";
  const glyph =
    entityType === "artist"
      ? `<circle cx="64" cy="54" r="14" fill="none" stroke="${accent}" stroke-width="2" /><path d="M40 90c0-13 10.7-22 24-22s24 9 24 22" fill="none" stroke="${accent}" stroke-width="2" />`
      : `<circle cx="64" cy="64" r="24" fill="none" stroke="#665c54" stroke-width="1.5" /><circle cx="64" cy="64" r="12" fill="none" stroke="${accent}" stroke-width="2" /><rect x="61" y="61" width="6" height="6" fill="${accent}" />`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Sin portada disponible">`,
    `<rect width="128" height="128" fill="#282828" />`,
    `<rect x="10" y="10" width="108" height="108" fill="#32302f" stroke="#665c54" stroke-width="1" />`,
    `<path d="M10 32h108M10 96h108M32 10v108M96 10v108" stroke="#665c54" stroke-opacity="0.28" stroke-width="1" />`,
    glyph,
    `</svg>`,
  ].join("");
}

async function waitForMbRateLimit(): Promise<void> {
  const now = Date.now();
  const last = globalForCovers.graphuMbLastRequestAt ?? 0;
  const elapsed = now - last;
  if (elapsed < MB_API_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MB_API_INTERVAL_MS - elapsed));
  }
  globalForCovers.graphuMbLastRequestAt = Date.now();
}

async function resolveTargetViaPublicMb(
  entityType: CoverEntityType,
  mbid: string
): Promise<{ releaseMbid: string | null; releaseGroupMbid: string | null; failed: boolean }> {
  if (process.env.ENABLE_PUBLIC_MB_COVER_FALLBACK === "false") {
    return { releaseMbid: null, releaseGroupMbid: null, failed: false };
  }

  try {
    await waitForMbRateLimit();
    const headers = {
      Accept: "application/json",
      "User-Agent": getUserAgent(),
    };

    if (entityType === "recording") {
      const res = await fetch(`${MB_API_BASE}/recording/${mbid}?inc=releases&fmt=json`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 404) {
        return { releaseMbid: null, releaseGroupMbid: null, failed: false };
      }
      if (!res.ok) {
        return { releaseMbid: null, releaseGroupMbid: null, failed: true };
      }
      const data = (await res.json()) as {
        releases?: Array<{ id?: string; status?: string }>;
      };
      const releases = Array.isArray(data.releases) ? data.releases : [];
      const preferred =
        releases.find((rel) => rel.status === "Official" && isCoverUuid(rel.id)) ??
        releases.find((rel) => isCoverUuid(rel.id));
      return {
        releaseMbid: preferred?.id?.toLowerCase() ?? null,
        releaseGroupMbid: null,
        failed: false,
      };
    }

    if (entityType === "artist") {
      const res = await fetch(
        `${MB_API_BASE}/release-group?artist=${mbid}&type=album|ep&limit=10&fmt=json`,
        {
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          cache: "no-store",
        }
      );
      if (res.status === 404) {
        return { releaseMbid: null, releaseGroupMbid: null, failed: false };
      }
      if (!res.ok) {
        return { releaseMbid: null, releaseGroupMbid: null, failed: true };
      }
      const data = (await res.json()) as {
        "release-groups"?: Array<{ id?: string; "primary-type"?: string }>;
      };
      const groups = Array.isArray(data["release-groups"]) ? data["release-groups"] : [];
      const preferred =
        groups.find((rg) => rg["primary-type"] === "Album" && isCoverUuid(rg.id)) ??
        groups.find((rg) => isCoverUuid(rg.id));
      return {
        releaseMbid: null,
        releaseGroupMbid: preferred?.id?.toLowerCase() ?? null,
        failed: false,
      };
    }

    return { releaseMbid: null, releaseGroupMbid: null, failed: false };
  } catch {
    return { releaseMbid: null, releaseGroupMbid: null, failed: true };
  }
}

async function resolveTargetMbids(
  entityType: CoverEntityType,
  mbid: string,
  hintReleaseMbid: string | null,
  hintReleaseGroupMbid: string | null
): Promise<{ releaseMbid: string | null; releaseGroupMbid: string | null; failed: boolean }> {
  if (entityType === "release") {
    return { releaseMbid: mbid, releaseGroupMbid: hintReleaseGroupMbid, failed: false };
  }

  if (entityType === "release-group") {
    if (hintReleaseMbid) {
      return { releaseMbid: hintReleaseMbid, releaseGroupMbid: mbid, failed: false };
    }
    if (isCatalogConfigured()) {
      try {
        const target = await resolveReleaseGroupCoverTarget(mbid);
        return {
          releaseMbid: target.releaseMbid,
          releaseGroupMbid: target.releaseGroupMbid ?? mbid,
          failed: false,
        };
      } catch {
        // Fallback directly to /release-group/{mbid}/front-250
      }
    }
    return { releaseMbid: null, releaseGroupMbid: mbid, failed: false };
  }

  if (hintReleaseMbid || hintReleaseGroupMbid) {
    return {
      releaseMbid: hintReleaseMbid,
      releaseGroupMbid: hintReleaseGroupMbid,
      failed: false,
    };
  }

  if (isCatalogConfigured()) {
    try {
      const target =
        entityType === "artist"
          ? await resolveArtistCoverTarget(mbid)
          : await resolveRecordingCoverTarget(mbid);
      return {
        releaseMbid: target.releaseMbid,
        releaseGroupMbid: target.releaseGroupMbid,
        failed: false,
      };
    } catch {
      return resolveTargetViaPublicMb(entityType, mbid);
    }
  }

  return resolveTargetViaPublicMb(entityType, mbid);
}

interface CacheRow {
  entityType: string;
  mbid: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  coverUrl: string | null;
  status: string;
  checkedAt: Date;
}

async function readCoverCache(
  entityType: CoverEntityType,
  mbid: string
): Promise<CacheRow | null> {
  if (!process.env.DATABASE_URL?.trim()) {
    return null;
  }
  try {
    const db = getDb();
    const row = await db.coverCache?.findUnique({
      where: { entityType_mbid: { entityType, mbid } },
    });
    return row ?? null;
  } catch {
    return null;
  }
}

async function writeCoverCache(entry: {
  entityType: CoverEntityType;
  mbid: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  coverUrl: string | null;
  status: CoverStatus;
}): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    return;
  }
  try {
    const db = getDb();
    const now = new Date();
    await db.coverCache?.upsert({
      where: {
        entityType_mbid: { entityType: entry.entityType, mbid: entry.mbid },
      },
      create: {
        entityType: entry.entityType,
        mbid: entry.mbid,
        releaseMbid: entry.releaseMbid,
        releaseGroupMbid: entry.releaseGroupMbid,
        coverUrl: entry.coverUrl,
        status: entry.status,
        checkedAt: now,
      },
      update: {
        releaseMbid: entry.releaseMbid,
        releaseGroupMbid: entry.releaseGroupMbid,
        coverUrl: entry.coverUrl,
        status: entry.status,
        checkedAt: now,
      },
    });
  } catch {
    // Non-fatal: cache writes must never break image serving.
  }
}

export async function recordKnownCoverStatus(entry: {
  entityType: CoverEntityType;
  mbid: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  status: "FOUND" | "NOT_FOUND";
}): Promise<void> {
  if (!isCoverUuid(entry.mbid)) return;
  const mbid = entry.mbid.trim().toLowerCase();
  const releaseMbid = isCoverUuid(entry.releaseMbid)
    ? entry.releaseMbid.trim().toLowerCase()
    : null;
  const releaseGroupMbid = isCoverUuid(entry.releaseGroupMbid)
    ? entry.releaseGroupMbid.trim().toLowerCase()
    : null;
  const coverUrl =
    entry.status === "FOUND"
      ? releaseMbid
        ? `${CAA_BASE}/release/${releaseMbid}/front-250`
        : releaseGroupMbid
          ? `${CAA_BASE}/release-group/${releaseGroupMbid}/front-250`
          : null
      : null;

  await writeCoverCache({
    entityType: entry.entityType,
    mbid,
    releaseMbid,
    releaseGroupMbid,
    coverUrl,
    status: entry.status,
  });
}

function isCacheFresh(row: CacheRow, nowMs = Date.now()): boolean {
  const ageMs = Math.max(0, nowMs - row.checkedAt.getTime());
  if (row.status === "FOUND" && row.coverUrl) {
    return ageMs < FOUND_REFRESH_TTL_MS;
  }
  if (row.status === "NOT_FOUND") {
    return ageMs < NOT_FOUND_TTL_MS;
  }
  if (row.status === "ERROR") {
    return ageMs < ERROR_TTL_MS;
  }
  return false;
}

type ProbeOutcome =
  | { kind: "found"; url: string; image: CoverBinaryPayload | null }
  | { kind: "not_found" }
  | { kind: "error" };

async function fetchCandidate(url: string, needBinary: boolean): Promise<ProbeOutcome> {
  if (!needBinary) return fetchCandidateUncached(url, false);

  // Different recordings/artists can resolve to the same album image.
  const inFlight = (globalForCovers.graphuCoverImageInFlight ??= new Map());
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = fetchPersistentImage(url).finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise;
}

async function fetchPersistentImage(url: string): Promise<ProbeOutcome> {
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const row = await getDb().coverImageCache.findUnique({ where: { url } });
      if (
        row &&
        Date.now() - row.fetchedAt.getTime() < FOUND_REFRESH_TTL_MS &&
        row.bytes.byteLength > 0 &&
        row.bytes.byteLength <= MAX_COVER_BYTES &&
        row.contentType.startsWith("image/")
      ) {
        return {
          kind: "found",
          url,
          image: { bytes: row.bytes, contentType: row.contentType, cached: true },
        };
      }
    } catch {
      // Missing migrations or unavailable storage must not prevent image serving.
    }
  }

  const outcome = await fetchCandidateUncached(url, true);
  if (outcome.kind === "found" && outcome.image && process.env.DATABASE_URL?.trim()) {
    try {
      const data = {
        bytes: Buffer.from(outcome.image.bytes),
        contentType: outcome.image.contentType,
        fetchedAt: new Date(),
      };
      await getDb().coverImageCache.upsert({
        where: { url },
        create: { url, ...data },
        update: data,
      });
    } catch {
      // Still return the downloaded image if persistence is temporarily unavailable.
    }
  }
  return outcome;
}

async function fetchCandidateUncached(url: string, needBinary: boolean): Promise<ProbeOutcome> {
  try {
    const method = needBinary ? "GET" : "HEAD";
    let res = await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        "User-Agent": getUserAgent(),
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!needBinary && res.status === 405) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": getUserAgent(),
          Accept: "image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
    }

    if (res.status === 404 || res.status === 410) {
      return { kind: "not_found" };
    }
    if (!res.ok) {
      return { kind: "error" };
    }

    const contentType = (res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/")) {
      return { kind: "error" };
    }

    if (!needBinary) {
      return { kind: "found", url, image: null };
    }

    const contentLengthHeader = res.headers.get("content-length");
    if (contentLengthHeader) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) {
        return { kind: "error" };
      }
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_COVER_BYTES) {
      return { kind: "error" };
    }

    return {
      kind: "found",
      url,
      image: {
        bytes: new Uint8Array(buffer),
        contentType,
      },
    };
  } catch {
    return { kind: "error" };
  }
}

async function resolveCoverUncached(options: {
  entityType: CoverEntityType;
  mbid: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  needBinary: boolean;
}): Promise<CoverResolution> {
  const { entityType, mbid, needBinary } = options;
  const cached = await readCoverCache(entityType, mbid);

  if (cached && isCacheFresh(cached)) {
    if (cached.status === "FOUND" && cached.coverUrl) {
      if (!needBinary) {
        return {
          metadata: {
            status: "FOUND",
            entityType,
            mbid,
            releaseMbid: cached.releaseMbid,
            releaseGroupMbid: cached.releaseGroupMbid,
            coverUrl: cached.coverUrl,
            cached: true,
          },
          image: null,
        };
      }

      const cachedFetch = await fetchCandidate(cached.coverUrl, true);
      if (cachedFetch.kind === "found") {
        return {
          metadata: {
            status: "FOUND",
            entityType,
            mbid,
            releaseMbid: cached.releaseMbid,
            releaseGroupMbid: cached.releaseGroupMbid,
            coverUrl: cached.coverUrl,
            cached: true,
          },
          image: cachedFetch.image,
        };
      }
      if (cachedFetch.kind === "error") {
        return {
          metadata: {
            status: "ERROR",
            entityType,
            mbid,
            releaseMbid: cached.releaseMbid,
            releaseGroupMbid: cached.releaseGroupMbid,
            coverUrl: cached.coverUrl,
            cached: true,
          },
          image: null,
        };
      }
      // If cached URL returned 404, fall through to re-resolve once.
    } else if (cached.status === "NOT_FOUND" || cached.status === "ERROR") {
      return {
        metadata: {
          status: cached.status,
          entityType,
          mbid,
          releaseMbid: cached.releaseMbid,
          releaseGroupMbid: cached.releaseGroupMbid,
          coverUrl: null,
          cached: true,
        },
        image: null,
      };
    }
  }

  const target = await resolveTargetMbids(
    entityType,
    mbid,
    options.releaseMbid,
    options.releaseGroupMbid
  );

  const candidates = buildCaaCandidateUrls(target.releaseMbid, target.releaseGroupMbid);
  if (candidates.length === 0) {
    const status: CoverStatus = target.failed ? "ERROR" : "NOT_FOUND";
    await writeCoverCache({
      entityType,
      mbid,
      releaseMbid: target.releaseMbid,
      releaseGroupMbid: target.releaseGroupMbid,
      coverUrl: null,
      status,
    });
    return {
      metadata: {
        status,
        entityType,
        mbid,
        releaseMbid: target.releaseMbid,
        releaseGroupMbid: target.releaseGroupMbid,
        coverUrl: null,
        cached: false,
      },
      image: null,
    };
  }

  let sawError = false;
  for (const url of candidates) {
    const outcome = await fetchCandidate(url, needBinary);
    if (outcome.kind === "found") {
      await writeCoverCache({
        entityType,
        mbid,
        releaseMbid: target.releaseMbid,
        releaseGroupMbid: target.releaseGroupMbid,
        coverUrl: outcome.url,
        status: "FOUND",
      });
      return {
        metadata: {
          status: "FOUND",
          entityType,
          mbid,
          releaseMbid: target.releaseMbid,
          releaseGroupMbid: target.releaseGroupMbid,
          coverUrl: outcome.url,
          cached: false,
        },
        image: outcome.image,
      };
    }
    if (outcome.kind === "error") {
      sawError = true;
    }
  }

  const finalStatus: CoverStatus = sawError ? "ERROR" : "NOT_FOUND";
  await writeCoverCache({
    entityType,
    mbid,
    releaseMbid: target.releaseMbid,
    releaseGroupMbid: target.releaseGroupMbid,
    coverUrl: null,
    status: finalStatus,
  });

  return {
    metadata: {
      status: finalStatus,
      entityType,
      mbid,
      releaseMbid: target.releaseMbid,
      releaseGroupMbid: target.releaseGroupMbid,
      coverUrl: null,
      cached: false,
    },
    image: null,
  };
}

export async function resolveCover(options: {
  entityType: CoverEntityType;
  mbid: string;
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
  needBinary?: boolean;
}): Promise<CoverResolution> {
  const mbid = options.mbid.trim().toLowerCase();
  const releaseMbid = isCoverUuid(options.releaseMbid)
    ? options.releaseMbid.trim().toLowerCase()
    : null;
  const releaseGroupMbid = isCoverUuid(options.releaseGroupMbid)
    ? options.releaseGroupMbid.trim().toLowerCase()
    : null;
  const needBinary = options.needBinary ?? true;

  const key = `${options.entityType}:${mbid}:${releaseMbid ?? ""}:${releaseGroupMbid ?? ""}:${needBinary ? "bin" : "meta"}`;
  const inFlight = getInFlightMap();
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = resolveCoverUncached({
    entityType: options.entityType,
    mbid,
    releaseMbid,
    releaseGroupMbid,
    needBinary,
  }).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}
