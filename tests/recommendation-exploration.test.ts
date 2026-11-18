import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPLORATION_CAP,
  ExplorationCoordinator,
  explorationReducer,
  fetchExploration,
  initialExplorationState,
  remainingCapacity,
  SELECTION_CAP,
  selectedSongs,
  type ExplorationRequest,
} from "@/lib/recommendation-exploration";
import {
  buildExplorationResponse,
  createDeferredExplorationTransport,
  createMultiBatchFixtures,
  makeSong,
  makeSongs,
  makeUuid,
} from "./fixtures/recommendation-exploration";

function makeRawRequest(
  kind: ExplorationRequest["kind"],
  seeds: ReturnType<typeof makeSongs>,
  overrides: Partial<ExplorationRequest> = {},
): ExplorationRequest {
  return {
    kind,
    seeds,
    excludeArtists: [],
    excludeRecordings: seeds.map((s) => s.id),
    excludeVersions: [],
    limit: 10,
    ...overrides,
  };
}

describe("T3 explorationReducer and ExplorationCoordinator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("enforces selection rules (discovered only, 0/1/10/11, pending lock, canonical UUID, focus)", async () => {
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);
    const originals = makeSongs(2, 1, 1);
    const recs = makeSongs(12, 101, 3);
    const artistId = makeUuid(4, 1);

    const startPromise = coordinator.start(originals);
    expect(coordinator.getSnapshot().pending).not.toBeNull();

    // Selecting while pending is ignored.
    coordinator.select(recs[0].id, true);
    expect(coordinator.getSnapshot().selectedIds).toEqual([]);

    calls[0].resolve(
      buildExplorationResponse({
        seeds: originals,
        recommendations: recs.slice(0, 10).map((song, i) => ({
          song,
          artistId,
          reasons: [{ seedId: originals[i % 2].id, score: 0.9 - i * 0.01, sharedTags: ["rock"], signals: [] }],
        })),
      }),
    );
    await expect(startPromise).resolves.toBe(true);

    // Originals (batchId === null) and unknown/invalid IDs are never selectable.
    coordinator.select(originals[0].id, true);
    coordinator.select(makeUuid(7, 777), true);
    coordinator.select("not-a-uuid", true);
    expect(coordinator.getSnapshot().selectedIds).toEqual([]);

    // 0 selected -> expand refuses without hitting transport.
    await expect(coordinator.expand()).resolves.toBe(false);
    expect(calls).toHaveLength(1);

    // Selecting 1 with uppercase UUID canonicalizes and allows expand.
    coordinator.select(recs[0].id.toUpperCase(), true);
    expect(coordinator.getSnapshot().selectedIds).toEqual([recs[0].id]);
    expect(selectedSongs(coordinator.getSnapshot()).map((s) => s.song.id)).toEqual([recs[0].id]);

    // Select 10 total; 11th recommendation is ignored (SELECTION_CAP = 10).
    // First start a second batch to have >= 11 recommendations in songsById.
    const expand1Promise = coordinator.expand();
    expect(calls[1].request.seeds.map((s) => s.id)).toEqual([recs[0].id]);
    calls[1].resolve(
      buildExplorationResponse({
        seeds: [recs[0]],
        recommendations: recs.slice(10, 12).map((song) => ({
          song,
          artistId: makeUuid(4, 2),
          reasons: [{ seedId: recs[0].id, score: 0.85, sharedTags: ["indie"], signals: ["songs"] }],
        })),
      }),
    );
    await expect(expand1Promise).resolves.toBe(true);
    expect(coordinator.getSnapshot().selectedIds).toEqual([]);

    for (let i = 0; i < 10; i++) {
      coordinator.select(recs[i].id, true);
    }
    expect(coordinator.getSnapshot().selectedIds).toHaveLength(SELECTION_CAP);

    // 11th selection is rejected.
    coordinator.select(recs[10].id, true);
    expect(coordinator.getSnapshot().selectedIds).toHaveLength(SELECTION_CAP);
    expect(coordinator.getSnapshot().selectedIds).not.toContain(recs[10].id);

    // Deselecting and re-selecting another works.
    coordinator.select(recs[9].id, false);
    coordinator.select(recs[10].id, true);
    expect(coordinator.getSnapshot().selectedIds).toHaveLength(10);
    expect(coordinator.getSnapshot().selectedIds).toContain(recs[10].id);

    // Expanding with 10 selected songs succeeds and clears selection.
    const expand10Promise = coordinator.expand();
    expect(calls[2].request.seeds).toHaveLength(10);
    const rec13 = makeSong(113, {}, 3);
    calls[2].resolve(
      buildExplorationResponse({
        seeds: recs.slice(0, 9).concat([recs[10]]),
        recommendations: [
          {
            song: rec13,
            artistId: makeUuid(4, 3),
            reasons: [{ seedId: recs[0].id, score: 0.8, sharedTags: ["indie"], signals: [] }],
          },
        ],
      }),
    );
    await expect(expand10Promise).resolves.toBe(true);
    expect(coordinator.getSnapshot().selectedIds).toEqual([]);

    // Focus switches only to known batches or null.
    const firstBatchId = coordinator.getSnapshot().batches[0].id;
    coordinator.focus(firstBatchId);
    expect(coordinator.getSnapshot().focusedBatchId).toBe(firstBatchId);
    coordinator.focus("batch-does-not-exist");
    expect(coordinator.getSnapshot().focusedBatchId).toBe(firstBatchId);
    coordinator.focus(null);
    expect(coordinator.getSnapshot().focusedBatchId).toBeNull();
  });

  it("caps start seeds to first 10 when given 11 songs and rejects empty, duplicate, or invalid start seeds", async () => {
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);

    await expect(coordinator.start([])).resolves.toBe(false);
    const dup = makeSong(1);
    await expect(coordinator.start([dup, dup])).resolves.toBe(false);
    await expect(coordinator.start([makeSong(1, { title: "   " })])).resolves.toBe(false);
    expect(calls).toHaveLength(0);

    const eleven = makeSongs(11, 1, 1).map((s) => ({ ...s, id: s.id.toUpperCase() }));
    const startPromise = coordinator.start(eleven);
    expect(calls).toHaveLength(1);
    expect(calls[0].request.seeds).toHaveLength(10);
    expect(calls[0].request.seeds.map((s) => s.id)).toEqual(
      eleven.slice(0, 10).map((s) => s.id.toLowerCase()),
    );

    calls[0].resolve(
      buildExplorationResponse({
        seeds: eleven.slice(0, 10).map((s) => ({ ...s, id: s.id.toLowerCase() })),
        recommendations: [
          {
            song: makeSong(200, {}, 3),
            artistId: makeUuid(4, 1),
            reasons: [{ seedId: eleven[0].id.toLowerCase(), score: 0.8, sharedTags: ["rock"], signals: [] }],
          },
        ],
      }),
    );
    await expect(startPromise).resolves.toBe(true);
    expect(coordinator.getSnapshot().originals).toHaveLength(10);
  });

  it("tracks multi-batch provenance (originBatchIds), expand exclusions, and alternatives exclusions", async () => {
    const fixtures = createMultiBatchFixtures("user");
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("user:u-1", transport);

    // Batch 1: start with originals -> 3 recs (rec1, rec2, rec3)
    const p1 = coordinator.start(fixtures.originals);
    calls[0].resolve(fixtures.responses.batch1);
    await expect(p1).resolves.toBe(true);

    let state = coordinator.getSnapshot();
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].originBatchIds).toEqual([]);
    expect(state.batches[0].requestId).toBe(fixtures.responses.batch1.requestId);
    expect(state.focusedBatchId).toBeNull();

    // Batch 2: expand from rec1 -> rec4, rec5
    coordinator.focus(state.batches[0].id);
    coordinator.select(fixtures.recommendations.rec1.id, true);
    const p2 = coordinator.expand();
    const req2 = calls[1].request;
    expect(req2.kind).toBe("expand");
    expect(req2.seeds.map((s) => s.id)).toEqual([fixtures.recommendations.rec1.id]);
    // expand does NOT automatically exclude shown artists
    expect(req2.excludeArtists).toEqual([]);
    // expand excludes all seen recordings (2 originals + 3 recs = 5)
    expect(req2.excludeRecordings).toHaveLength(5);
    // expand builds excludeVersions only for entries with known artistId
    expect(req2.excludeVersions).toHaveLength(5);
    calls[1].resolve(fixtures.responses.batch2);
    await expect(p2).resolves.toBe(true);

    state = coordinator.getSnapshot();
    expect(state.batches).toHaveLength(2);
    const batch1Id = state.batches[0].id;
    const batch2Id = state.batches[1].id;
    expect(state.batches[1].originBatchIds).toEqual([batch1Id]);
    expect(state.focusedBatchId).toBeNull();

    // Batch 3: select rec2 (Batch 1) + rec5 (Batch 2) -> combined provenance
    coordinator.select(fixtures.recommendations.rec2.id, true);
    coordinator.select(fixtures.recommendations.rec5.id, true);
    const p3 = coordinator.expand();
    calls[2].resolve(fixtures.responses.batch3Combined);
    await expect(p3).resolves.toBe(true);

    state = coordinator.getSnapshot();
    expect(state.batches).toHaveLength(3);
    expect(state.batches[2].originBatchIds).toEqual([batch1Id, batch2Id]);
    expect(state.batches[2].inputs.map((s) => s.id)).toEqual([
      fixtures.recommendations.rec2.id,
      fixtures.recommendations.rec5.id,
    ]);
    expect(state.batches[2].newSongIds).toEqual([fixtures.recommendations.rec6.id]);

    // Alternatives: uses originals, excludes ONLY artists of shown recommendations (batchId !== null) + seen recordings
    coordinator.focus(batch2Id);
    const p4 = coordinator.alternatives();
    const req4 = calls[3].request;
    expect(req4.kind).toBe("alternatives");
    expect(req4.seeds.map((s) => s.id)).toEqual(fixtures.originals.map((s) => s.id));
    expect(req4.excludeArtists).toEqual([
      fixtures.artists.portishead,
      fixtures.artists.unkle,
      fixtures.artists.bjork,
      fixtures.artists.mulatu,
      fixtures.artists.beck,
    ]);
    expect(req4.excludeArtists).not.toContain(fixtures.seedArtistIds[fixtures.originals[0].id]);
    expect(req4.excludeRecordings).toHaveLength(8);
    calls[3].resolve(fixtures.responses.alternatives);
    await expect(p4).resolves.toBe(true);

    state = coordinator.getSnapshot();
    expect(state.batches).toHaveLength(4);
    expect(state.batches[3].originBatchIds).toEqual([]);
    expect(state.focusedBatchId).toBeNull();
  });

  it("enforces EXPLORATION_CAP = 200 with trailing min(10, remaining) limit and does not truncate history or exclusions", async () => {
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);
    const originals = makeSongs(4, 1, 1);

    // Start with 4 originals + 10 recs = 14 songs
    const startRecs = makeSongs(10, 1, 3);
    const pStart = coordinator.start(originals);
    calls[0].resolve(
      buildExplorationResponse({
        seeds: originals,
        seedArtistIds: Object.fromEntries(originals.map((s) => [s.id, null])),
        recommendations: startRecs.map((song, idx) => ({
          song,
          artistId: makeUuid(4, idx + 1),
          reasons: [{ seedId: originals[idx % 4].id, score: 0.9, sharedTags: ["rock"], signals: [] }],
        })),
      }),
    );
    await expect(pStart).resolves.toBe(true);

    // Expand 18 more times (18 * 10 = 180 songs -> 194 total songs in songsById)
    let lastRec = startRecs[0];
    for (let step = 0; step < 18; step++) {
      coordinator.select(lastRec.id, true);
      const p = coordinator.expand();
      const batchRecs = makeSongs(10, 100 + step * 10, 3);
      const call = calls[calls.length - 1];
      expect(call.request.limit).toBe(10);
      call.resolve(
        buildExplorationResponse({
          seeds: [lastRec],
          recommendations: batchRecs.map((song, idx) => ({
            song,
            artistId: makeUuid(4, 20 + step * 10 + idx),
            reasons: [{ seedId: lastRec.id, score: 0.85, sharedTags: ["indie"], signals: [] }],
          })),
        }),
      );
      await expect(p).resolves.toBe(true);
      lastRec = batchRecs[0];
    }

    expect(Object.keys(coordinator.getSnapshot().songsById)).toHaveLength(194);
    expect(remainingCapacity(coordinator.getSnapshot())).toBe(6);

    // At 194 songs, expand asks for limit = min(10, 6) = 6 and keeps all 194 exclusions (no truncation).
    coordinator.select(lastRec.id, true);
    const pFinal = coordinator.expand();
    const finalCall = calls[calls.length - 1];
    expect(finalCall.request.limit).toBe(6);
    expect(finalCall.request.excludeRecordings).toHaveLength(194);
    // 4 originals had artistId: null, 190 recs had artistId -> 190 excludeVersions
    expect(finalCall.request.excludeVersions).toHaveLength(190);

    const finalSix = makeSongs(6, 500, 3);
    finalCall.resolve(
      buildExplorationResponse({
        seeds: [lastRec],
        recommendations: finalSix.map((song, idx) => ({
          song,
          artistId: makeUuid(4, 500 + idx),
          reasons: [{ seedId: lastRec.id, score: 0.8, sharedTags: ["indie"], signals: [] }],
        })),
      }),
    );
    await expect(pFinal).resolves.toBe(true);

    const fullState = coordinator.getSnapshot();
    expect(Object.keys(fullState.songsById)).toHaveLength(EXPLORATION_CAP);
    expect(remainingCapacity(fullState)).toBe(0);
    expect(fullState.batches).toHaveLength(20);

    // At 200 songs, expand and alternatives return false without calling transport.
    coordinator.select(finalSix[0].id, true);
    await expect(coordinator.expand()).resolves.toBe(false);
    await expect(coordinator.alternatives()).resolves.toBe(false);
    expect(calls).toHaveLength(20);

    // Starting a brand-new exploration is still permitted because it resets capacity.
    const freshOriginals = makeSongs(2, 900, 1);
    const pFresh = coordinator.start(freshOriginals);
    expect(calls).toHaveLength(21);
    expect(calls[20].request.limit).toBe(10);
    calls[20].reject(new Error("Temporary error"));
    await expect(pFresh).resolves.toBe(false);
    // Failed new start preserves the 20-batch exploration.
    expect(coordinator.getSnapshot().batches).toHaveLength(20);
  });

  it("freezes request snapshots and originals so external mutations cannot corrupt them", async () => {
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);
    const mutableSeed = makeSong(1, { title: "Original Title" });
    const mutableInput = [mutableSeed];

    const p = coordinator.start(mutableInput);
    const req = calls[0].request;

    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.seeds)).toBe(true);
    expect(Object.isFrozen(req.seeds[0])).toBe(true);
    expect(Object.isFrozen(req.excludeArtists)).toBe(true);
    expect(Object.isFrozen(req.excludeRecordings)).toBe(true);
    expect(Object.isFrozen(req.excludeVersions)).toBe(true);

    // Mutate caller's input after pulsing start.
    mutableSeed.title = "Mutated Later";
    mutableInput.push(makeSong(2));
    expect(req.seeds).toHaveLength(1);
    expect(req.seeds[0].title).toBe("Original Title");

    calls[0].resolve(
      buildExplorationResponse({
        seeds: [{ ...mutableSeed, title: "Original Title" }],
        recommendations: [
          {
            song: makeSong(101, {}, 3),
            artistId: makeUuid(4, 1),
            reasons: [{ seedId: mutableSeed.id, score: 0.9, sharedTags: ["rock"], signals: [] }],
          },
        ],
      }),
    );
    await expect(p).resolves.toBe(true);

    const state = coordinator.getSnapshot();
    expect(Object.isFrozen(state.originals)).toBe(true);
    expect(Object.isFrozen(state.originals[0])).toBe(true);
    expect(state.originals[0].title).toBe("Original Title");
  });

  it("preserves useful exploration on empty/error replacement, while empty/failed starts without batches capture new originals", async () => {
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);
    const seedsA = makeSongs(1, 1, 1);
    const seedsB = makeSongs(1, 2, 1);
    const seedsC = makeSongs(1, 3, 1);
    const seedsD = makeSongs(1, 4, 1);

    // 1) Initial failed start captures seedsA and exploration id, batches = []
    const p1 = coordinator.start(seedsA);
    calls[0].reject(new Error("Fallo inicial"));
    await expect(p1).resolves.toBe(false);
    let state = coordinator.getSnapshot();
    const id1 = state.id;
    expect(id1).toBeTruthy();
    expect(state.batches).toHaveLength(0);
    expect(state.originals.map((s) => s.id)).toEqual([seedsA[0].id]);
    expect(state.lastAttempt?.error).toBe("Fallo inicial");

    // 2) No useful batches yet -> new empty start captures seedsB as new originals & new id
    const p2 = coordinator.start(seedsB);
    calls[1].resolve(
      buildExplorationResponse({
        seeds: seedsB,
        seedArtistIds: { [seedsB[0].id]: makeUuid(2, 2) },
        recommendations: [],
        seedStatuses: { [seedsB[0].id]: { status: "no_candidates" } },
      }),
    );
    await expect(p2).resolves.toBe(true);
    state = coordinator.getSnapshot();
    const id2 = state.id;
    expect(id2).not.toBe(id1);
    expect(state.batches).toHaveLength(0);
    expect(state.originals.map((s) => s.id)).toEqual([seedsB[0].id]);
    expect(state.songsById[seedsB[0].id]?.artistId).toBe(makeUuid(2, 2));
    expect(state.songsById[seedsA[0].id]).toBeUndefined();
    expect(state.lastAttempt?.response?.recommendations).toEqual([]);

    // 3) Still no batches -> new failed start captures seedsC as new originals
    const p3 = coordinator.start(seedsC);
    calls[2].reject(new Error("Segundo fallo"));
    await expect(p3).resolves.toBe(false);
    state = coordinator.getSnapshot();
    expect(state.batches).toHaveLength(0);
    expect(state.originals.map((s) => s.id)).toEqual([seedsC[0].id]);
    expect(state.lastAttempt?.error).toBe("Segundo fallo");

    // 4) Non-empty start with seedsC creates batch-1
    const recC = makeSong(101, {}, 3);
    const p4 = coordinator.start(seedsC);
    calls[3].resolve(
      buildExplorationResponse({
        seeds: seedsC,
        recommendations: [
          {
            song: recC,
            artistId: makeUuid(4, 1),
            reasons: [{ seedId: seedsC[0].id, score: 0.9, sharedTags: ["rock"], signals: [] }],
          },
        ],
      }),
    );
    await expect(p4).resolves.toBe(true);
    coordinator.select(recC.id, true);
    const usefulId = coordinator.getSnapshot().id;
    const usefulBatchId = coordinator.getSnapshot().batches[0].id;

    // 5) With useful exploration, an empty start with seedsD preserves seedsC, batches, and selection
    const p5 = coordinator.start(seedsD);
    calls[4].resolve(
      buildExplorationResponse({
        seeds: seedsD,
        recommendations: [],
        seedStatuses: { [seedsD[0].id]: { status: "no_tracks" } },
      }),
    );
    await expect(p5).resolves.toBe(true);
    state = coordinator.getSnapshot();
    expect(state.id).toBe(usefulId);
    expect(state.originals.map((s) => s.id)).toEqual([seedsC[0].id]);
    expect(state.batches.map((b) => b.id)).toEqual([usefulBatchId]);
    expect(state.selectedIds).toEqual([recC.id]);
    expect(state.lastAttempt?.request.seeds.map((s) => s.id)).toEqual([seedsD[0].id]);
    expect(state.lastAttempt?.response?.recommendations).toEqual([]);

    // 6) With useful exploration, a failed/invalid start with seedsD also preserves everything
    const p6 = coordinator.start(seedsD);
    calls[5].resolve({ broken: true });
    await expect(p6).resolves.toBe(false);
    state = coordinator.getSnapshot();
    expect(state.id).toBe(usefulId);
    expect(state.originals.map((s) => s.id)).toEqual([seedsC[0].id]);
    expect(state.batches.map((b) => b.id)).toEqual([usefulBatchId]);
    expect(state.selectedIds).toEqual([recC.id]);
    expect(state.lastAttempt?.error).toBeTruthy();

    // 7) Non-empty valid start with seedsD replaces the useful exploration atomically
    const recD = makeSong(102, {}, 3);
    const p7 = coordinator.start(seedsD);
    calls[6].resolve(
      buildExplorationResponse({
        seeds: seedsD,
        recommendations: [
          {
            song: recD,
            artistId: makeUuid(4, 2),
            reasons: [{ seedId: seedsD[0].id, score: 0.88, sharedTags: ["jazz"], signals: [] }],
          },
        ],
      }),
    );
    await expect(p7).resolves.toBe(true);
    state = coordinator.getSnapshot();
    expect(state.id).not.toBe(usefulId);
    expect(state.originals.map((s) => s.id)).toEqual([seedsD[0].id]);
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].newSongIds).toEqual([recD.id]);
    expect(state.selectedIds).toEqual([]);
  });

  it("recovers missing seed artistId on valid empty alternatives(), feeds excludeVersions on next expand(), and keeps useful catalog clean across empty/failed/invalid/stale replacement", async () => {
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);

    const songA = makeSong(1, { title: "Versioned Song A", artist: "Artist A" }, 1);
    const songB = makeSong(2, { title: "Seed Song B", artist: "Artist B" }, 1);
    const songR = makeSong(101, { title: "Recommended R", artist: "Artist R" }, 3);
    const songR2 = makeSong(102, { title: "Expanded R2", artist: "Artist R2" }, 3);
    const foreignC = makeSong(3, { title: "Foreign C", artist: "Foreign Artist C" }, 5);
    const foreignD = makeSong(4, { title: "Foreign D", artist: "Foreign Artist D" }, 5);
    const foreignRec = makeSong(103, { title: "Foreign Rec", artist: "Artist Foreign" }, 6);

    const artistB = makeUuid(2, 2);
    const artistR = makeUuid(4, 1);
    const artistR2 = makeUuid(4, 2);
    const artistX = makeUuid(2, 10);
    const artistY = makeUuid(2, 11);
    const artistC = makeUuid(2, 12);
    const artistD = makeUuid(2, 13);

    // 1) Start with A/B: A resolves without artist (artistId: null), B produces R.
    const pStart = coordinator.start([songA, songB]);
    calls[0].resolve(
      buildExplorationResponse({
        seeds: [songA, songB],
        seedArtistIds: { [songA.id]: null, [songB.id]: artistB },
        seedStatuses: { [songA.id]: { status: "unavailable" } },
        recommendations: [
          {
            song: songR,
            artistId: artistR,
            reasons: [{ seedId: songB.id, score: 0.91, sharedTags: ["indie"], signals: ["songs"] }],
          },
        ],
      }),
    );
    await expect(pStart).resolves.toBe(true);

    let state = coordinator.getSnapshot();
    const usefulId = state.id;
    const batch1Id = state.batches[0].id;
    expect(state.batches).toHaveLength(1);
    expect(state.songsById[songA.id]?.artistId).toBeNull();
    expect(state.songsById[songB.id]?.artistId).toBe(artistB);
    expect(state.songsById[songR.id]?.artistId).toBe(artistR);

    // 2) Invalid empty alternatives() response carrying artistY for A must NOT mutate songsById[A.id].
    const pInvalidAlt = coordinator.alternatives();
    const invalidAltPayload = buildExplorationResponse({
      seeds: [songA, songB],
      seedArtistIds: { [songA.id]: artistY, [songB.id]: artistB },
      recommendations: [],
      seedStatuses: {
        [songA.id]: { status: "no_candidates" },
        [songB.id]: { status: "no_candidates" },
      },
    });
    invalidAltPayload.graph.edges = []; // Fails validation.
    calls[1].resolve(invalidAltPayload);
    await expect(pInvalidAlt).resolves.toBe(false);
    state = coordinator.getSnapshot();
    expect(state.songsById[songA.id]?.artistId).toBeNull();
    expect(state.batches).toHaveLength(1);
    expect(state.lastAttempt?.error).toBeTruthy();

    // 3) Cancelled/stale empty alternatives() resolving late with artistY must NOT mutate songsById[A.id].
    const pStaleAlt = coordinator.alternatives();
    coordinator.cancel();
    calls[2].resolve(
      buildExplorationResponse({
        seeds: [songA, songB],
        seedArtistIds: { [songA.id]: artistY, [songB.id]: artistB },
        recommendations: [],
        seedStatuses: {
          [songA.id]: { status: "no_candidates" },
          [songB.id]: { status: "no_candidates" },
        },
      }),
    );
    await expect(pStaleAlt).resolves.toBe(false);
    expect(coordinator.getSnapshot().songsById[songA.id]?.artistId).toBeNull();

    // 4) Valid empty alternatives() recovers artistId = artistX for A without adding an empty batch.
    const pValidEmptyAlt = coordinator.alternatives();
    calls[3].resolve(
      buildExplorationResponse({
        seeds: [songA, songB],
        seedArtistIds: { [songA.id]: artistX, [songB.id]: artistB },
        recommendations: [],
        seedStatuses: {
          [songA.id]: { status: "no_candidates" },
          [songB.id]: { status: "no_candidates" },
        },
      }),
    );
    await expect(pValidEmptyAlt).resolves.toBe(true);

    state = coordinator.getSnapshot();
    expect(state.id).toBe(usefulId);
    expect(state.batches.map((b) => b.id)).toEqual([batch1Id]);
    expect(state.originals.map((s) => s.id)).toEqual([songA.id, songB.id]);
    expect(state.songsById[songA.id]?.artistId).toBe(artistX);
    expect(state.lastAttempt?.response?.recommendations).toEqual([]);

    // 5) Subsequent expand() of R sends excludeVersions containing A's recovered artistId + title.
    coordinator.select(songR.id, true);
    const pExpand = coordinator.expand();
    const expandReq = calls[4].request;
    expect(expandReq.kind).toBe("expand");
    expect(expandReq.seeds.map((s) => s.id)).toEqual([songR.id]);
    expect(expandReq.excludeRecordings).toEqual([songA.id, songB.id, songR.id]);
    expect(expandReq.excludeVersions).toEqual([
      { artistId: artistX, title: songA.title },
      { artistId: artistB, title: songB.title },
      { artistId: artistR, title: songR.title },
    ]);

    calls[4].resolve(
      buildExplorationResponse({
        seeds: [songR],
        seedArtistIds: { [songR.id]: artistR },
        recommendations: [
          {
            song: songR2,
            artistId: artistR2,
            reasons: [{ seedId: songR.id, score: 0.87, sharedTags: ["indie"], signals: ["collab"] }],
          },
        ],
      }),
    );
    await expect(pExpand).resolves.toBe(true);
    coordinator.select(songR2.id, true);
    const batchIdsBeforeForeign = coordinator.getSnapshot().batches.map((b) => b.id);
    expect(batchIdsBeforeForeign).toHaveLength(2);

    // 6) Empty replacement start([foreignC, foreignD]) does NOT add foreign entries to useful catalog.
    const pEmptyForeignStart = coordinator.start([foreignC, foreignD]);
    calls[5].resolve(
      buildExplorationResponse({
        seeds: [foreignC, foreignD],
        seedArtistIds: { [foreignC.id]: artistC, [foreignD.id]: artistD },
        recommendations: [],
        seedStatuses: {
          [foreignC.id]: { status: "no_candidates" },
          [foreignD.id]: { status: "no_tracks" },
        },
      }),
    );
    await expect(pEmptyForeignStart).resolves.toBe(true);

    state = coordinator.getSnapshot();
    expect(state.id).toBe(usefulId);
    expect(state.originals.map((s) => s.id)).toEqual([songA.id, songB.id]);
    expect(state.batches.map((b) => b.id)).toEqual(batchIdsBeforeForeign);
    expect(state.selectedIds).toEqual([songR2.id]);
    expect(state.songsById[songA.id]?.artistId).toBe(artistX);
    expect(state.songsById[foreignC.id]).toBeUndefined();
    expect(state.songsById[foreignD.id]).toBeUndefined();

    // 7) Failed/invalid replacement start([foreignC, foreignD]) preserves useful catalog cleanly.
    const pFailedForeignStart = coordinator.start([foreignC, foreignD]);
    calls[6].resolve({ broken: true });
    await expect(pFailedForeignStart).resolves.toBe(false);

    state = coordinator.getSnapshot();
    expect(state.id).toBe(usefulId);
    expect(state.originals.map((s) => s.id)).toEqual([songA.id, songB.id]);
    expect(state.batches.map((b) => b.id)).toEqual(batchIdsBeforeForeign);
    expect(state.selectedIds).toEqual([songR2.id]);
    expect(state.songsById[foreignC.id]).toBeUndefined();
    expect(state.songsById[foreignD.id]).toBeUndefined();

    // 8) Stale/cancelled non-empty replacement start([foreignC, foreignD]) does NOT pollute useful catalog.
    const pStaleForeignStart = coordinator.start([foreignC, foreignD]);
    coordinator.cancel();
    calls[7].resolve(
      buildExplorationResponse({
        seeds: [foreignC, foreignD],
        seedArtistIds: { [foreignC.id]: artistC, [foreignD.id]: artistD },
        recommendations: [
          {
            song: foreignRec,
            artistId: makeUuid(4, 99),
            reasons: [{ seedId: foreignC.id, score: 0.85, sharedTags: ["rock"], signals: [] }],
          },
        ],
      }),
    );
    await expect(pStaleForeignStart).resolves.toBe(false);

    state = coordinator.getSnapshot();
    expect(state.id).toBe(usefulId);
    expect(state.originals.map((s) => s.id)).toEqual([songA.id, songB.id]);
    expect(state.batches.map((b) => b.id)).toEqual(batchIdsBeforeForeign);
    expect(state.selectedIds).toEqual([songR2.id]);
    expect(state.songsById[foreignC.id]).toBeUndefined();
    expect(state.songsById[foreignD.id]).toBeUndefined();
    expect(state.songsById[foreignRec.id]).toBeUndefined();
  });

  it("handles double-click mutual exclusion, cancel + immediate re-request race, reset, dispose, and loading scope", async () => {
    const { transport, calls } = createDeferredExplorationTransport();

    // Loading scope blocks requests.
    const loadingCoordinator = new ExplorationCoordinator("loading", transport);
    await expect(loadingCoordinator.start(makeSongs(1))).resolves.toBe(false);
    expect(calls).toHaveLength(0);

    const coordinator = new ExplorationCoordinator("guest", transport);
    const seeds1 = makeSongs(1, 1, 1);
    const seeds2 = makeSongs(1, 2, 1);

    // Double-click: second synchronous start returns false with only 1 transport call.
    const p1 = coordinator.start(seeds1);
    const p1Dup = coordinator.start(seeds2);
    await expect(p1Dup).resolves.toBe(false);
    expect(calls).toHaveLength(1);

    // Cancel aborts signal, increments revision, clears pending.
    coordinator.cancel();
    expect(calls[0].signal.aborted).toBe(true);
    expect(coordinator.getSnapshot().pending).toBeNull();
    expect(coordinator.getSnapshot().revision).toBe(1);

    // Immediately start request 2 while request 1's promise has not yet settled.
    const p2 = coordinator.start(seeds2);
    expect(calls).toHaveLength(2);
    expect(coordinator.getSnapshot().pending?.seeds.map((s) => s.id)).toEqual([seeds2[0].id]);

    // Late resolution of cancelled request 1 must NOT disturb request 2 or state.
    calls[0].resolve(
      buildExplorationResponse({
        seeds: seeds1,
        recommendations: [
          {
            song: makeSong(101, {}, 3),
            artistId: makeUuid(4, 1),
            reasons: [{ seedId: seeds1[0].id, score: 0.9, sharedTags: ["rock"], signals: [] }],
          },
        ],
      }),
    );
    await expect(p1).resolves.toBe(false);
    expect(coordinator.getSnapshot().batches).toHaveLength(0);
    expect(coordinator.getSnapshot().pending?.seeds.map((s) => s.id)).toEqual([seeds2[0].id]);

    // Resolve request 2 -> commits cleanly.
    const rec2 = makeSong(102, {}, 3);
    calls[1].resolve(
      buildExplorationResponse({
        seeds: seeds2,
        recommendations: [
          {
            song: rec2,
            artistId: makeUuid(4, 2),
            reasons: [{ seedId: seeds2[0].id, score: 0.87, sharedTags: ["pop"], signals: [] }],
          },
        ],
      }),
    );
    await expect(p2).resolves.toBe(true);
    expect(coordinator.getSnapshot().batches).toHaveLength(1);

    // Reset aborts any in-flight request, clears state, increments revision, and ignores late rejection.
    coordinator.select(rec2.id, true);
    const p3 = coordinator.expand();
    coordinator.reset();
    expect(calls[2].signal.aborted).toBe(true);
    expect(coordinator.getSnapshot()).toEqual({
      ...initialExplorationState(),
      revision: 2,
    });
    calls[2].reject(new Error("Aborted late failure"));
    await expect(p3).resolves.toBe(false);
    expect(coordinator.getSnapshot().lastAttempt).toBeNull();

    // Dispose aborts in-flight request without notifying listeners, blocks new runs until activate().
    const listener = vi.fn();
    coordinator.subscribe(listener);
    const p4 = coordinator.start(seeds1);
    listener.mockClear();
    coordinator.dispose();
    expect(calls[3].signal.aborted).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    calls[3].resolve(
      buildExplorationResponse({
        seeds: seeds1,
        recommendations: [
          {
            song: makeSong(103, {}, 3),
            artistId: makeUuid(4, 3),
            reasons: [{ seedId: seeds1[0].id, score: 0.8, sharedTags: ["rock"], signals: [] }],
          },
        ],
      }),
    );
    await expect(p4).resolves.toBe(false);
    expect(listener).not.toHaveBeenCalled();
    await expect(coordinator.start(seeds1)).resolves.toBe(false);
    expect(calls).toHaveLength(4);
  });

  it("clears pending silently on dispose() while in-flight, allows selection and new operation after activate(), and ignores stale response", async () => {
    const fixtures = createMultiBatchFixtures("guest");
    const { transport, calls } = createDeferredExplorationTransport();
    const coordinator = new ExplorationCoordinator("guest", transport);
    const listener = vi.fn();
    coordinator.subscribe(listener);

    // Establish batch 1 so rec1 and rec2 are selectable.
    const pStart = coordinator.start(fixtures.originals);
    calls[0].resolve(fixtures.responses.batch1);
    await expect(pStart).resolves.toBe(true);

    // Select rec1 and start expand -> pending is active.
    coordinator.select(fixtures.recommendations.rec1.id, true);
    const pStaleExpand = coordinator.expand();
    const staleCall = calls[1];
    expect(coordinator.getSnapshot().pending).not.toBeNull();
    expect(staleCall.signal.aborted).toBe(false);
    const revisionBeforeDispose = coordinator.getSnapshot().revision;

    // Dispose during unmount while request is pending: aborts silently and clears pending.
    listener.mockClear();
    coordinator.dispose();
    expect(staleCall.signal.aborted).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().pending).toBeNull();
    expect(coordinator.getSnapshot().revision).toBe(revisionBeforeDispose + 1);
    expect(coordinator.getSnapshot().selectedIds).toEqual([fixtures.recommendations.rec1.id]);

    // Reactivate instance (e.g., StrictMode double-mount or remount): pending is null, selection & new ops work.
    coordinator.activate();
    expect(coordinator.getSnapshot().pending).toBeNull();

    coordinator.select(fixtures.recommendations.rec1.id, false);
    coordinator.select(fixtures.recommendations.rec2.id, true);
    expect(coordinator.getSnapshot().selectedIds).toEqual([fixtures.recommendations.rec2.id]);

    const pFreshAlternatives = coordinator.alternatives();
    expect(calls).toHaveLength(3);
    expect(coordinator.getSnapshot().pending?.kind).toBe("alternatives");

    // Stale expand from before dispose resolves late -> returns false and does NOT touch batches or pending.
    staleCall.resolve(fixtures.responses.batch2);
    await expect(pStaleExpand).resolves.toBe(false);
    expect(coordinator.getSnapshot().batches).toHaveLength(1);
    expect(coordinator.getSnapshot().pending?.kind).toBe("alternatives");

    // Fresh operation after activate commits cleanly.
    calls[2].resolve(fixtures.responses.alternatives);
    await expect(pFreshAlternatives).resolves.toBe(true);
    expect(coordinator.getSnapshot().pending).toBeNull();
    expect(coordinator.getSnapshot().batches).toHaveLength(2);
    expect(coordinator.getSnapshot().batches[1].newSongIds).toEqual([
      fixtures.recommendations.alt1.id,
    ]);
  });

  it("requires requestId and every resultId for user:* scopes while allowing guest without them", async () => {
    const guestFixtures = createMultiBatchFixtures("guest");
    const { transport: guestTransport, calls: guestCalls } = createDeferredExplorationTransport();
    const guestCoordinator = new ExplorationCoordinator("guest", guestTransport);

    const guestPromise = guestCoordinator.start(guestFixtures.originals);
    guestCalls[0].resolve(guestFixtures.responses.batch1);
    await expect(guestPromise).resolves.toBe(true);
    expect(guestCoordinator.getSnapshot().batches).toHaveLength(1);

    // user:* rejects missing requestId
    const { transport: userTransport, calls: userCalls } = createDeferredExplorationTransport();
    const userCoordinator = new ExplorationCoordinator("user:user_123", userTransport);

    const pMissingReqId = userCoordinator.start(guestFixtures.originals);
    userCalls[0].resolve(guestFixtures.responses.batch1);
    await expect(pMissingReqId).resolves.toBe(false);
    expect(userCoordinator.getSnapshot().batches).toHaveLength(0);
    expect(userCoordinator.getSnapshot().lastAttempt?.error).toBe(
      "Faltan los identificadores de la tanda para tu cuenta.",
    );

    // user:* rejects missing resultId on one recommendation
    const userFixtures = createMultiBatchFixtures("user");
    const partialResultIds = structuredClone(userFixtures.responses.batch1);
    delete partialResultIds.recommendations[1].resultId;
    const pMissingResId = userCoordinator.start(userFixtures.originals);
    userCalls[1].resolve(partialResultIds);
    await expect(pMissingResId).resolves.toBe(false);
    expect(userCoordinator.getSnapshot().batches).toHaveLength(0);

    // user:* accepts complete requestId + resultIds
    const pValidUser = userCoordinator.start(userFixtures.originals);
    userCalls[2].resolve(userFixtures.responses.batch1);
    await expect(pValidUser).resolves.toBe(true);
    expect(userCoordinator.getSnapshot().batches[0].requestId).toBe(
      userFixtures.responses.batch1.requestId,
    );
  });

  it("fetchExploration posts expected payload, passes AbortSignal, and surfaces server or fallback errors", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const seeds = makeSongs(2);
    const req = makeRawRequest("alternatives", seeds, {
      excludeArtists: [makeUuid(4, 1)],
      excludeRecordings: [seeds[0].id, seeds[1].id],
      excludeVersions: [{ artistId: makeUuid(4, 1), title: "Song 1" }],
      limit: 8,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const data = await fetchExploration(req, controller.signal);
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        seeds: seeds.map((s) => s.id),
        excludeArtists: req.excludeArtists,
        excludeRecordings: req.excludeRecordings,
        excludeVersions: req.excludeVersions,
        limit: 8,
      }),
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Límite alcanzado" }), { status: 429 }),
    );
    await expect(fetchExploration(req, controller.signal)).rejects.toThrow("Límite alcanzado");

    fetchMock.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));
    await expect(fetchExploration(req, controller.signal)).rejects.toThrow(
      "No se pudieron generar recomendaciones.",
    );
  });

  it("explorationReducer pure transitions cover cancel, reset, and empty expand/alternatives preservation", () => {
    const fixtures = createMultiBatchFixtures("guest");
    const req = makeRawRequest("start", fixtures.originals);
    let state = explorationReducer(initialExplorationState(), { type: "begin", request: req });
    expect(state.pending).toBe(req);

    state = explorationReducer(state, {
      type: "complete",
      request: req,
      response: fixtures.responses.batch1,
      id: "exp-1",
      batchId: "b-1",
    });
    expect(state.pending).toBeNull();
    expect(state.batches).toHaveLength(1);

    state = explorationReducer(state, { type: "select", id: fixtures.recommendations.rec1.id, selected: true });
    const expandReq = makeRawRequest("expand", [fixtures.recommendations.rec1]);
    state = explorationReducer(state, { type: "begin", request: expandReq });
    state = explorationReducer(state, { type: "cancel" });
    expect(state.pending).toBeNull();
    expect(state.revision).toBe(1);
    expect(state.selectedIds).toEqual([fixtures.recommendations.rec1.id]);

    state = explorationReducer(state, { type: "reset" });
    expect(state).toEqual({ ...initialExplorationState(), revision: 2 });
  });
});
