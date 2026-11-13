BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."RecommendationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "app"."FeedbackValue" AS ENUM ('LIKE', 'DISLIKE');

-- Preserve profiles and their IDs; never recreate the populated User table.
ALTER TABLE "public"."User" SET SCHEMA "app";
ALTER TABLE "app"."User" RENAME TO "users";
ALTER TABLE "app"."users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
ALTER INDEX "app"."User_clerkId_key" RENAME TO "users_clerkId_key";

-- CreateTable
CREATE TABLE "app"."user_preferences" (
    "userId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "app"."user_favorite_recording" (
    "userId" TEXT NOT NULL,
    "recordingId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_recording_pkey" PRIMARY KEY ("userId","recordingId")
);

-- CreateTable
CREATE TABLE "app"."user_favorite_artist" (
    "userId" TEXT NOT NULL,
    "artistId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_artist_pkey" PRIMARY KEY ("userId","artistId")
);

-- CreateTable
CREATE TABLE "app"."playlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."playlist_track" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "recordingId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."recommendation_model" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."recommendation_request" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" "app"."RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "recommendation_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."recommendation_seed" (
    "requestId" TEXT NOT NULL,
    "recordingId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "recommendation_seed_pkey" PRIMARY KEY ("requestId","recordingId")
);

-- CreateTable
CREATE TABLE "app"."recommendation_result" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "recordingId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "explanation" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."recommendation_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "resultId" TEXT,
    "type" VARCHAR(50) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."user_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "value" "app"."FeedbackValue" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."recommendation_evaluation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "playlist_userId_createdAt_idx" ON "app"."playlist"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_track_playlistId_recordingId_key" ON "app"."playlist_track"("playlistId", "recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_track_playlistId_position_key" ON "app"."playlist_track"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_model_name_version_key" ON "app"."recommendation_model"("name", "version");

-- CreateIndex
CREATE INDEX "recommendation_request_userId_createdAt_idx" ON "app"."recommendation_request"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "recommendation_request_modelId_createdAt_idx" ON "app"."recommendation_request"("modelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_request_id_userId_key" ON "app"."recommendation_request"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_seed_requestId_position_key" ON "app"."recommendation_seed"("requestId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_result_requestId_recordingId_key" ON "app"."recommendation_result"("requestId", "recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_result_requestId_rank_key" ON "app"."recommendation_result"("requestId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_result_id_requestId_key" ON "app"."recommendation_result"("id", "requestId");

-- CreateIndex
CREATE INDEX "recommendation_event_requestId_createdAt_idx" ON "app"."recommendation_event"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "recommendation_event_resultId_requestId_idx" ON "app"."recommendation_event"("resultId", "requestId");

-- CreateIndex
CREATE INDEX "recommendation_event_userId_createdAt_idx" ON "app"."recommendation_event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_feedback_requestId_userId_idx" ON "app"."user_feedback"("requestId", "userId");

-- CreateIndex
CREATE INDEX "user_feedback_resultId_requestId_idx" ON "app"."user_feedback"("resultId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "user_feedback_userId_resultId_key" ON "app"."user_feedback"("userId", "resultId");

-- CreateIndex
CREATE INDEX "recommendation_evaluation_requestId_createdAt_idx" ON "app"."recommendation_evaluation"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "app"."user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."user_favorite_recording" ADD CONSTRAINT "user_favorite_recording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."user_favorite_artist" ADD CONSTRAINT "user_favorite_artist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."playlist" ADD CONSTRAINT "playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."playlist_track" ADD CONSTRAINT "playlist_track_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "app"."playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_request" ADD CONSTRAINT "recommendation_request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_request" ADD CONSTRAINT "recommendation_request_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "app"."recommendation_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_seed" ADD CONSTRAINT "recommendation_seed_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "app"."recommendation_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_result" ADD CONSTRAINT "recommendation_result_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "app"."recommendation_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_event" ADD CONSTRAINT "recommendation_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_event" ADD CONSTRAINT "recommendation_event_requestId_userId_fkey" FOREIGN KEY ("requestId", "userId") REFERENCES "app"."recommendation_request"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_event" ADD CONSTRAINT "recommendation_event_resultId_requestId_fkey" FOREIGN KEY ("resultId", "requestId") REFERENCES "app"."recommendation_result"("id", "requestId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."user_feedback" ADD CONSTRAINT "user_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."user_feedback" ADD CONSTRAINT "user_feedback_requestId_userId_fkey" FOREIGN KEY ("requestId", "userId") REFERENCES "app"."recommendation_request"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."user_feedback" ADD CONSTRAINT "user_feedback_resultId_requestId_fkey" FOREIGN KEY ("resultId", "requestId") REFERENCES "app"."recommendation_result"("id", "requestId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."recommendation_evaluation" ADD CONSTRAINT "recommendation_evaluation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "app"."recommendation_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain constraints not expressible in the Prisma schema.
ALTER TABLE "app"."playlist" ADD CONSTRAINT "playlist_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "app"."playlist_track" ADD CONSTRAINT "playlist_track_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "app"."recommendation_seed" ADD CONSTRAINT "recommendation_seed_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "app"."recommendation_result" ADD CONSTRAINT "recommendation_result_rank_positive" CHECK ("rank" > 0);
ALTER TABLE "app"."recommendation_result" ADD CONSTRAINT "recommendation_result_score_valid" CHECK ("score" >= 0 AND "score" < 'Infinity'::double precision);
ALTER TABLE "app"."recommendation_model" ADD CONSTRAINT "recommendation_model_identity_not_blank" CHECK (length(btrim("name")) > 0 AND length(btrim("version")) > 0);
ALTER TABLE "app"."recommendation_event" ADD CONSTRAINT "recommendation_event_type_not_blank" CHECK (length(btrim("type")) > 0);
ALTER TABLE "app"."user_preferences" ADD CONSTRAINT "user_preferences_settings_object" CHECK (jsonb_typeof("settings") = 'object');
ALTER TABLE "app"."recommendation_model" ADD CONSTRAINT "recommendation_model_parameters_object" CHECK (jsonb_typeof("parameters") = 'object');
ALTER TABLE "app"."recommendation_request" ADD CONSTRAINT "recommendation_request_parameters_object" CHECK (jsonb_typeof("parameters") = 'object');
ALTER TABLE "app"."recommendation_result" ADD CONSTRAINT "recommendation_result_explanation_object" CHECK (jsonb_typeof("explanation") = 'object');
ALTER TABLE "app"."recommendation_event" ADD CONSTRAINT "recommendation_event_metadata_object" CHECK (jsonb_typeof("metadata") = 'object');
ALTER TABLE "app"."recommendation_evaluation" ADD CONSTRAINT "recommendation_evaluation_metrics_object" CHECK (jsonb_typeof("metrics") = 'object');

COMMIT;
