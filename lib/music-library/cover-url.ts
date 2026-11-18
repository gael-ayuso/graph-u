export type CoverEntityType = "recording" | "artist" | "release" | "release-group";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCoverUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function buildCoverProxyUrl(options: {
  type: CoverEntityType;
  mbid: string;
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
}): string | null {
  if (!isCoverUuid(options.mbid)) return null;
  const mbid = options.mbid.trim().toLowerCase();
  const params = new URLSearchParams({ type: options.type, mbid });
  if (isCoverUuid(options.releaseMbid)) {
    params.set("releaseMbid", options.releaseMbid.trim().toLowerCase());
  }
  if (isCoverUuid(options.releaseGroupMbid)) {
    params.set("releaseGroupMbid", options.releaseGroupMbid.trim().toLowerCase());
  }
  return `/api/music/cover?${params.toString()}`;
}

export function resolveSongCoverUrl(song: {
  id: string;
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
  coverUrl?: string | null;
}): string | null {
  if (typeof song.coverUrl === "string" && song.coverUrl.trim()) {
    return song.coverUrl;
  }
  if (song.coverUrl === null) {
    return null;
  }
  return buildCoverProxyUrl({
    type: "recording",
    mbid: song.id,
    releaseMbid: song.releaseMbid,
    releaseGroupMbid: song.releaseGroupMbid,
  });
}
