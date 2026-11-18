BEGIN;

ALTER TABLE "app"."user_favorite_recording"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "artistName" TEXT;

ALTER TABLE "app"."user_favorite_artist"
  ADD COLUMN "name" TEXT;

ALTER TABLE "app"."playlist"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "app"."playlist_track"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "artistName" TEXT;

COMMIT;
