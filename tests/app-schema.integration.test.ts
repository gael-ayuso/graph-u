import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Explicit opt-in; never write fixtures to DATABASE_URL.
const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)("application schema against PostgreSQL", () => {
  const db = new Client({ connectionString });
  let userId: string;
  let otherUserId: string;
  let modelId: string;
  let requestId: string;
  let resultId: string;

  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => {
    await db.query("BEGIN");
    userId = randomUUID();
    otherUserId = randomUUID();
    modelId = randomUUID();
    requestId = randomUUID();
    resultId = randomUUID();
    await db.query(`INSERT INTO app.users (id, "clerkId", "clerkUpdatedAt", "updatedAt")
      VALUES ($1, $1, now(), now()), ($2, $2, now(), now())`, [userId, otherUserId]);
    await db.query(`INSERT INTO app.recommendation_model (id, name, version)
      VALUES ($1, $2, '1')`, [modelId, modelId]);
    await db.query(`INSERT INTO app.recommendation_request (id, "userId", "modelId")
      VALUES ($1, $2, $3)`, [requestId, userId, modelId]);
    await db.query(`INSERT INTO app.recommendation_result (id, "requestId", "recordingId", rank, score)
      VALUES ($1, $2, $3, 1, 0.8)`, [resultId, requestId, randomUUID()]);
  });
  afterEach(async () => { await db.query("ROLLBACK"); });

  it("stores library data and a complete recommendation history", async () => {
    await db.query(`INSERT INTO app.user_preferences ("userId", "updatedAt") VALUES ($1, now())`, [userId]);
    await db.query(`INSERT INTO app.user_favorite_recording (id, "userId", "recordingId") VALUES ($1, $2, $3), ($4, $2, $5)`, [randomUUID(), userId, randomUUID(), randomUUID(), randomUUID()]);
    await db.query(`INSERT INTO app.user_favorite_artist (id, "userId", "artistId") VALUES ($1, $2, $3), ($4, $2, $5)`, [randomUUID(), userId, randomUUID(), randomUUID(), randomUUID()]);
    const playlistId = randomUUID();
    await db.query(`INSERT INTO app.playlist (id, "userId", name, "updatedAt") VALUES ($1, $2, 'Favorites', now())`, [playlistId, userId]);
    await db.query(`INSERT INTO app.playlist_track (id, "playlistId", "recordingId", position) VALUES ($1, $2, $3, 0)`, [randomUUID(), playlistId, randomUUID()]);
    await db.query(`INSERT INTO app.recommendation_seed ("requestId", "recordingId", position) VALUES ($1, $2, 0)`, [requestId, randomUUID()]);
    // Request-level events may omit a result.
    await db.query(`INSERT INTO app.recommendation_event (id, "userId", "requestId", type) VALUES ($1, $2, $3, 'view')`, [randomUUID(), userId, requestId]);
    await db.query(`INSERT INTO app.user_feedback (id, "userId", "requestId", "resultId", value, "updatedAt") VALUES ($1, $2, $3, $4, 'LIKE', now())`, [randomUUID(), userId, requestId, resultId]);
    await db.query(`INSERT INTO app.recommendation_evaluation (id, "requestId", metrics) VALUES ($1, $2, '{"precisionAt10":0.8}')`, [randomUUID(), requestId]);
    const { rows } = await db.query(`SELECT status FROM app.recommendation_request WHERE id = $1`, [requestId]);
    expect(rows[0].status).toBe("PENDING");
  });

  it("rejects duplicate favorites for one user but permits another user", async () => {
    const recordingId = randomUUID();
    await db.query(`INSERT INTO app.user_favorite_recording (id, "userId", "recordingId") VALUES ($1, $3, $5), ($2, $4, $5)`, [randomUUID(), randomUUID(), userId, otherUserId, recordingId]);
    await expect(db.query(`INSERT INTO app.user_favorite_recording (id, "userId", "recordingId") VALUES ($1, $2, $3)`, [randomUUID(), userId, recordingId])).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects feedback by a user who does not own the request", async () => {
    await expect(db.query(`INSERT INTO app.user_feedback (id, "userId", "requestId", "resultId", value, "updatedAt") VALUES ($1, $2, $3, $4, 'LIKE', now())`, [randomUUID(), otherUserId, requestId, resultId])).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects an event attaching a result from a different request", async () => {
    const otherRequestId = randomUUID();
    await db.query(`INSERT INTO app.recommendation_request (id, "userId", "modelId") VALUES ($1, $2, $3)`, [otherRequestId, userId, modelId]);
    await expect(db.query(`INSERT INTO app.recommendation_event (id, "userId", "requestId", "resultId", type) VALUES ($1, $2, $3, $4, 'play')`, [randomUUID(), userId, otherRequestId, resultId])).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects negative positions and rolls back a failed reorder", async () => {
    const playlistId = randomUUID();
    await db.query(`INSERT INTO app.playlist (id, "userId", name, "updatedAt") VALUES ($1, $2, 'Favorites', now())`, [playlistId, userId]);
    const trackIds = [randomUUID(), randomUUID()];
    await db.query(`INSERT INTO app.playlist_track (id, "playlistId", "recordingId", position) VALUES ($1, $2, $3, 0), ($4, $2, $5, 1)`, [trackIds[0], playlistId, randomUUID(), trackIds[1], randomUUID()]);
    await db.query("SAVEPOINT reorder");
    await expect(db.query(`UPDATE app.playlist_track SET position = 1 WHERE id = $1`, [trackIds[0]])).rejects.toMatchObject({ code: "23505" });
    await db.query("ROLLBACK TO SAVEPOINT reorder");
    const { rows } = await db.query(`SELECT position FROM app.playlist_track WHERE "playlistId" = $1 ORDER BY position`, [playlistId]);
    expect(rows.map(row => row.position)).toEqual([0, 1]);
    await expect(db.query(`UPDATE app.playlist_track SET position = -1 WHERE id = $1`, [trackIds[0]])).rejects.toMatchObject({ code: "23514" });
  });

  it("allows an atomic successful playlist reorder", async () => {
    const playlistId = randomUUID();
    await db.query(`INSERT INTO app.playlist (id, "userId", name, "updatedAt") VALUES ($1, $2, 'Favorites', now())`, [playlistId, userId]);
    const trackIds = [randomUUID(), randomUUID()];
    await db.query(`INSERT INTO app.playlist_track (id, "playlistId", "recordingId", position) VALUES ($1, $3, $4, 0), ($2, $3, $5, 1)`, [trackIds[0], trackIds[1], playlistId, randomUUID(), randomUUID()]);

    await db.query("SAVEPOINT reorder_success");
    // Move both tracks out of the occupied range before assigning the swapped positions.
    await db.query(`UPDATE app.playlist_track SET position = position + 2 WHERE "playlistId" = $1`, [playlistId]);
    await db.query(`UPDATE app.playlist_track SET position = CASE id WHEN $1 THEN 1 ELSE 0 END WHERE "playlistId" = $2`, [trackIds[0], playlistId]);
    await db.query("RELEASE SAVEPOINT reorder_success");

    const { rows } = await db.query(`SELECT id, position FROM app.playlist_track WHERE "playlistId" = $1 ORDER BY position`, [playlistId]);
    expect(rows).toEqual([{ id: trackIds[1], position: 0 }, { id: trackIds[0], position: 1 }]);
  });

  it("cascades user data deletion and retains the shared model", async () => {
    await db.query(`INSERT INTO app.recommendation_event (id, "userId", "requestId", "resultId", type) VALUES ($1, $2, $3, $4, 'view')`, [randomUUID(), userId, requestId, resultId]);
    await db.query(`INSERT INTO app.user_feedback (id, "userId", "requestId", "resultId", value, "updatedAt") VALUES ($1, $2, $3, $4, 'DISLIKE', now())`, [randomUUID(), userId, requestId, resultId]);
    await db.query(`INSERT INTO app.recommendation_evaluation (id, "requestId", metrics) VALUES ($1, $2, '{}')`, [randomUUID(), requestId]);
    await db.query("DELETE FROM app.users WHERE id = $1", [userId]);
    for (const table of ["recommendation_request", "recommendation_result", "recommendation_event", "user_feedback", "recommendation_evaluation"]) {
      const column = table === "recommendation_request" ? "id" : '"requestId"';
      const { rows } = await db.query(`SELECT count(*)::int AS count FROM app.${table} WHERE ${column} = $1`, [requestId]);
      expect(rows[0].count).toBe(0);
    }
    expect((await db.query("SELECT id FROM app.recommendation_model WHERE id = $1", [modelId])).rows).toHaveLength(1);
  });
});
