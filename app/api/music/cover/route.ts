import { unstable_rethrow } from "next/navigation";
import { isCoverUuid } from "@/lib/music-library/cover-url";
import {
  parseCoverEntityType,
  renderFallbackCoverSvg,
  resolveCover,
} from "@/lib/music-library/covers";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const entityType = parseCoverEntityType(params.get("type"));
  const rawMbid = params.get("mbid");
  const format = (params.get("format") || "image").trim().toLowerCase();

  if (!entityType) {
    return Response.json(
      { error: "El parámetro 'type' debe ser recording, artist, release o release-group." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!isCoverUuid(rawMbid)) {
    return Response.json(
      { error: "El parámetro 'mbid' debe ser un UUID válido." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (format !== "image" && format !== "json") {
    return Response.json(
      { error: "El parámetro 'format' debe ser image o json." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const mbid = rawMbid.trim().toLowerCase();
  const rawRelease = params.get("releaseMbid");
  const rawReleaseGroup = params.get("releaseGroupMbid");
  const releaseMbid = isCoverUuid(rawRelease) ? rawRelease.trim().toLowerCase() : null;
  const releaseGroupMbid = isCoverUuid(rawReleaseGroup)
    ? rawReleaseGroup.trim().toLowerCase()
    : null;

  try {
    const resolved = await resolveCover({
      entityType,
      mbid,
      releaseMbid,
      releaseGroupMbid,
      needBinary: format === "image",
    });

    if (format === "json") {
      return Response.json(resolved.metadata, {
        status: 200,
        headers: {
          "Cache-Control":
            resolved.metadata.status === "ERROR"
              ? "private, no-store"
              : "public, max-age=3600, stale-while-revalidate=86400",
        },
      });
    }

    if (resolved.image) {
      return new Response(Buffer.from(resolved.image.bytes), {
        status: 200,
        headers: {
          "Content-Type": resolved.image.contentType,
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
          "X-Cover-Status": "FOUND",
          "X-Cover-Cache": resolved.metadata.cached ? "HIT" : "MISS",
          "X-Cover-Image-Cache": resolved.image.cached ? "HIT" : "MISS",
        },
      });
    }

    const svg = renderFallbackCoverSvg(entityType);
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control":
          resolved.metadata.status === "ERROR"
            ? "public, max-age=60"
            : "public, max-age=3600, stale-while-revalidate=86400",
        "X-Cover-Status": resolved.metadata.status,
        "X-Cover-Cache": resolved.metadata.cached ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    unstable_rethrow(error);

    if (format === "json") {
      return Response.json(
        { error: "No se pudo resolver la portada temporalmente." },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }

    const svg = renderFallbackCoverSvg(entityType);
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "X-Cover-Status": "ERROR",
      },
    });
  }
}
