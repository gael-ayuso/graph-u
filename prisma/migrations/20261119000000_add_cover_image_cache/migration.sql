CREATE TABLE "app"."cover_image_cache" (
    "url" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cover_image_cache_pkey" PRIMARY KEY ("url"),
    CONSTRAINT "cover_image_cache_size_check" CHECK (octet_length("bytes") BETWEEN 1 AND 5242880),
    CONSTRAINT "cover_image_cache_type_check" CHECK ("contentType" LIKE 'image/%')
);

CREATE INDEX "cover_image_cache_fetchedAt_idx" ON "app"."cover_image_cache"("fetchedAt");
