BEGIN;

-- AlterTable
ALTER TABLE "app"."user_favorite_artist" ADD COLUMN "id" TEXT;
UPDATE "app"."user_favorite_artist" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "app"."user_favorite_artist" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app"."user_favorite_artist" DROP CONSTRAINT "user_favorite_artist_pkey";
ALTER TABLE "app"."user_favorite_artist" ADD CONSTRAINT "user_favorite_artist_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "app"."user_favorite_recording" ADD COLUMN "id" TEXT;
UPDATE "app"."user_favorite_recording" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "app"."user_favorite_recording" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app"."user_favorite_recording" DROP CONSTRAINT "user_favorite_recording_pkey";
ALTER TABLE "app"."user_favorite_recording" ADD CONSTRAINT "user_favorite_recording_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "user_favorite_artist_userId_artistId_key" ON "app"."user_favorite_artist"("userId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "user_favorite_recording_userId_recordingId_key" ON "app"."user_favorite_recording"("userId", "recordingId");

COMMIT;
