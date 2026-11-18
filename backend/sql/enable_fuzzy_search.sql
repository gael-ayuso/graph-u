-- Run with psql against the MusicBrainz catalog, outside a transaction (-1).
-- This is independent of the application's Prisma migrations.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- CONCURRENTLY keeps the catalog readable/writable during index creation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS graphu_artist_credit_name_trgm
    ON musicbrainz.artist_credit USING gin (lower(name::text) public.gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS graphu_recording_name_trgm
    ON musicbrainz.recording USING gin (lower(name::text) public.gin_trgm_ops);

ANALYZE musicbrainz.artist_credit;
ANALYZE musicbrainz.recording;
