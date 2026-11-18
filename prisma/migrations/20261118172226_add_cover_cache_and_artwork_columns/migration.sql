-- AlterTable
ALTER TABLE "app"."playlist_track" ADD COLUMN     "coverReleaseMbid" UUID,
ADD COLUMN     "coverUrl" TEXT;

-- AlterTable
ALTER TABLE "app"."user_favorite_artist" ADD COLUMN     "coverReleaseMbid" UUID,
ADD COLUMN     "coverUrl" TEXT;

-- AlterTable
ALTER TABLE "app"."user_favorite_recording" ADD COLUMN     "coverReleaseMbid" UUID,
ADD COLUMN     "coverUrl" TEXT;

-- CreateTable
CREATE TABLE "app"."cover_cache" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(20) NOT NULL,
    "mbid" UUID NOT NULL,
    "releaseMbid" UUID,
    "releaseGroupMbid" UUID,
    "coverUrl" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cover_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cover_cache_status_checkedAt_idx" ON "app"."cover_cache"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cover_cache_entityType_mbid_key" ON "app"."cover_cache"("entityType", "mbid");
