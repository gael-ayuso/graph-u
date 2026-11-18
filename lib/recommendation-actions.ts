import "server-only";

import { AppQueryError, notFound, readApp, resourceId } from "@/lib/app-api";
import { getDb } from "@/lib/db";
import type { RecommendationOptions, RecommendationResponse } from "@/lib/musicbrainz-types";

type Context = { params: Promise<{ requestId: string }> };

async function bodyOf(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppQueryError("Solicitud no válida.", 400);
  return body;
}

export async function recordRecommendations(userId: string, seeds: string[], excludeArtists: string[], data: RecommendationResponse, options: RecommendationOptions = {}) {
  const db = getDb();
  const model = await db.recommendationModel.upsert({
    where: { name_version: { name: "hybrid-tags-lastfm", version: "1" } },
    create: { name: "hybrid-tags-lastfm", version: "1" }, update: {},
  });
  const row = await db.recommendationRequest.create({
    data: {
      userId, modelId: model.id, status: "COMPLETED", completedAt: new Date(),
      parameters: { excludeArtists, ...options },
      seeds: { create: [...new Set(seeds)].map((recordingId, position) => ({ recordingId, position })) },
      results: { create: data.recommendations.map((rec, index) => ({
        recordingId: rec.song.id, rank: index + 1, score: rec.score,
        explanation: JSON.parse(JSON.stringify(rec)),
      })) },
      events: { create: { user: { connect: { id: userId } }, type: "GENERATED", metadata: { count: data.recommendations.length } } },
    },
    include: { results: { select: { id: true, recordingId: true } } },
  });
  return { ...data, requestId: row.id, recommendations: data.recommendations.map((rec) => ({
    ...rec, resultId: row.results.find((result) => result.recordingId === rec.song.id)!.id,
  })) };
}

export function setRecommendationFeedback(request: Request, { params }: Context) {
  return readApp(request, async ({ db, userId }) => {
    const requestId = resourceId((await params).requestId);
    const body = await bodyOf(request);
    const resultId = resourceId(typeof body.resultId === "string" ? body.resultId : "");
    if (body.value !== "LIKE" && body.value !== "DISLIKE" && body.value !== null) throw new AppQueryError("Elige Me gusta o No me interesa.", 400);
    const value = body.value as "LIKE" | "DISLIKE" | null;
    const result = await db.recommendationResult.findFirst({ where: { id: resultId, requestId, request: { userId } }, select: { id: true } });
    if (!result) notFound();
    await db.$transaction(async (tx) => {
      if (value === null) await tx.userFeedback.deleteMany({ where: { userId, resultId, requestId } });
      else await tx.userFeedback.upsert({ where: { userId_resultId: { userId, resultId } },
        create: { userId, requestId, resultId, value }, update: { value } });
      await tx.recommendationEvent.create({ data: { userId, requestId, resultId, type: "FEEDBACK", metadata: { value } } });
    });
    return { value };
  });
}

export function setSavedRecommendation(request: Request, { params }: Context) {
  return readApp(request, async ({ db, userId }) => {
    const requestId = resourceId((await params).requestId);
    const body = await bodyOf(request);
    const resultId = resourceId(typeof body.resultId === "string" ? body.resultId : "");
    if (typeof body.saved !== "boolean") throw new AppQueryError("Indica si quieres guardar la canción.", 400);
    const result = await db.recommendationResult.findFirst({ where: { id: resultId, requestId, request: { userId } }, select: { recordingId: true } });
    if (!result) notFound();
    await db.$transaction(async (tx) => {
      if (body.saved) await tx.userFavoriteRecording.upsert({
        where: { userId_recordingId: { userId, recordingId: result.recordingId } },
        create: { userId, recordingId: result.recordingId }, update: {},
      });
      else await tx.userFavoriteRecording.deleteMany({ where: { userId, recordingId: result.recordingId } });
      await tx.recommendationEvent.create({ data: { userId, requestId, resultId, type: body.saved ? "SAVE" : "UNSAVE" } });
    });
    return { saved: body.saved };
  });
}

export function savedRecommendations(request: Request) {
  return readApp(request, async ({ db, userId }) => {
    const favorites = await db.userFavoriteRecording.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    const results = await db.recommendationResult.findMany({
      where: { recordingId: { in: favorites.map((favorite) => favorite.recordingId) }, request: { userId } },
      orderBy: { createdAt: "desc" }, distinct: ["recordingId"], select: { recordingId: true, explanation: true },
    });
    return { songs: favorites.flatMap((favorite) => {
      const explanation = results.find((result) => result.recordingId === favorite.recordingId)?.explanation;
      return explanation && typeof explanation === "object" && !Array.isArray(explanation) && explanation.song ? [explanation.song] : [];
    }) };
  });
}

export function removeSavedRecording(request: Request) {
  return readApp(request, async ({ db, userId }) => {
    const body = await bodyOf(request);
    const recordingId = resourceId(typeof body.recordingId === "string" ? body.recordingId : "");
    await db.userFavoriteRecording.deleteMany({ where: { userId, recordingId } });
    return { saved: false };
  });
}
