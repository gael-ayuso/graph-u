import "server-only";

import { notFound, pageResult, pagination, readApp, resourceId, type AppQuery } from "@/lib/app-api";

type PlaylistContext = { params: Promise<{ playlistId: string }> };
type RecommendationContext = { params: Promise<{ requestId: string }> };
const modelSummary = { id: true, name: true, version: true } as const;

export function preferences(request: Request) {
  return readApp(request, async ({ db, userId }) => ({
    preferences: await db.userPreferences.findUnique({ where: { userId } }),
  }));
}

export function favoriteRecordings(request: Request) {
  return readApp(request, async ({ db, userId, searchParams }) => {
    const page = pagination(searchParams);
    const rows = await db.userFavoriteRecording.findMany({
      where: { userId }, orderBy: [{ createdAt: "desc" }, { recordingId: "asc" }],
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function favoriteArtists(request: Request) {
  return readApp(request, async ({ db, userId, searchParams }) => {
    const page = pagination(searchParams);
    const rows = await db.userFavoriteArtist.findMany({
      where: { userId }, orderBy: [{ createdAt: "desc" }, { artistId: "asc" }],
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function playlists(request: Request) {
  return readApp(request, async ({ db, userId, searchParams }) => {
    const page = pagination(searchParams);
    const rows = await db.playlist.findMany({
      where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { _count: { select: { tracks: true } } },
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function playlist(request: Request, { params }: PlaylistContext) {
  return readApp(request, async ({ db, userId }) => {
    const id = resourceId((await params).playlistId);
    const row = await db.playlist.findFirst({
      where: { id, userId }, include: { _count: { select: { tracks: true } } },
    });
    if (!row) notFound();
    return { playlist: row };
  });
}

export function playlistTracks(request: Request, { params }: PlaylistContext) {
  return readApp(request, async ({ db, userId, searchParams }) => {
    const playlistId = resourceId((await params).playlistId);
    const page = pagination(searchParams);
    const owner = await db.playlist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
    if (!owner) notFound();
    const rows = await db.playlistTrack.findMany({
      where: { playlistId, playlist: { userId } }, orderBy: { position: "asc" },
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationModels(request: Request) {
  return readApp(request, async ({ db, searchParams }) => {
    const page = pagination(searchParams);
    const rows = await db.recommendationModel.findMany({
      where: { active: true }, select: modelSummary,
      orderBy: [{ name: "asc" }, { version: "asc" }, { id: "asc" }],
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationRequests(request: Request) {
  return readApp(request, async ({ db, userId, searchParams }) => {
    const page = pagination(searchParams);
    const rows = await db.recommendationRequest.findMany({
      where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { model: { select: modelSummary }, _count: { select: { seeds: true, results: true } } },
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationRequest(request: Request, { params }: RecommendationContext) {
  return readApp(request, async ({ db, userId }) => {
    const id = resourceId((await params).requestId);
    const row = await db.recommendationRequest.findFirst({
      where: { id, userId },
      include: {
        model: { select: modelSummary },
        _count: { select: { seeds: true, results: true, events: true, feedback: true, evaluations: true } },
      },
    });
    if (!row) notFound();
    return { recommendation: row };
  });
}

async function ownedRequest({ db, userId }: AppQuery, params: RecommendationContext["params"]) {
  const requestId = resourceId((await params).requestId);
  const owner = await db.recommendationRequest.findFirst({ where: { id: requestId, userId }, select: { id: true } });
  if (!owner) notFound();
  return requestId;
}

export function recommendationSeeds(request: Request, { params }: RecommendationContext) {
  return readApp(request, async (context) => {
    const page = pagination(context.searchParams);
    const requestId = await ownedRequest(context, params);
    const rows = await context.db.recommendationSeed.findMany({
      where: { requestId, request: { userId: context.userId } }, orderBy: { position: "asc" },
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationResults(request: Request, { params }: RecommendationContext) {
  return readApp(request, async (context) => {
    const page = pagination(context.searchParams);
    const requestId = await ownedRequest(context, params);
    const rows = await context.db.recommendationResult.findMany({
      where: { requestId, request: { userId: context.userId } }, orderBy: { rank: "asc" },
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationEvents(request: Request, { params }: RecommendationContext) {
  return readApp(request, async (context) => {
    const page = pagination(context.searchParams);
    const requestId = await ownedRequest(context, params);
    const rows = await context.db.recommendationEvent.findMany({
      where: { requestId, userId: context.userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationFeedback(request: Request, { params }: RecommendationContext) {
  return readApp(request, async (context) => {
    const page = pagination(context.searchParams);
    const requestId = await ownedRequest(context, params);
    const rows = await context.db.userFeedback.findMany({
      where: { requestId, userId: context.userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}

export function recommendationEvaluations(request: Request, { params }: RecommendationContext) {
  return readApp(request, async (context) => {
    const page = pagination(context.searchParams);
    const requestId = await ownedRequest(context, params);
    const rows = await context.db.recommendationEvaluation.findMany({
      where: { requestId, request: { userId: context.userId } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: page.take, skip: page.skip,
    });
    return pageResult(rows, page);
  });
}
