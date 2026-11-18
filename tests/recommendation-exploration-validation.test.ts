import { describe, expect, it } from "vitest";
import type { ExplorationRequest } from "@/lib/recommendation-exploration";
import {
  canonicalId,
  canonicalSong,
  validateExplorationResponse,
} from "@/lib/recommendation-exploration-validation";
import {
  buildExplorationResponse,
  createMultiBatchFixtures,
  makeSong,
  makeUuid,
} from "./fixtures/recommendation-exploration";

function makeRequest(overrides: Partial<ExplorationRequest> = {}): ExplorationRequest {
  const seeds = overrides.seeds ?? [makeSong(1)];
  return {
    kind: "start",
    seeds,
    excludeArtists: [],
    excludeRecordings: seeds.map((s) => s.id),
    excludeVersions: [],
    limit: 10,
    ...overrides,
  };
}

describe("T3 recommendation-exploration-validation", () => {
  it("canonicalizes valid UUIDs and songs and rejects malformed values", () => {
    const upper = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    expect(canonicalId(upper)).toBe(upper.toLowerCase());

    expect(() => canonicalId("not-a-uuid")).toThrow("Identificador de canción o artista inválido.");
    expect(() => canonicalId(123)).toThrow("Identificador de canción o artista inválido.");
    expect(() => canonicalId(null)).toThrow("Identificador de canción o artista inválido.");

    const song = canonicalSong({
      id: upper,
      title: "Reckoner",
      artist: "Radiohead",
      release: null,
      comment: "live",
      duration: 290000,
    });
    expect(song.id).toBe(upper.toLowerCase());

    expect(() => canonicalSong(null)).toThrow("Canción inválida.");
    expect(() => canonicalSong({ ...song, title: "   " })).toThrow("Canción inválida.");
    expect(() => canonicalSong({ ...song, artist: "" })).toThrow("Canción inválida.");
    expect(() => canonicalSong({ ...song, release: 42 })).toThrow("Canción inválida.");
    expect(() => canonicalSong({ ...song, comment: {} })).toThrow("Canción inválida.");
    expect(() => canonicalSong({ ...song, duration: Number.NaN })).toThrow("Canción inválida.");
    expect(() => canonicalSong({ ...song, duration: Number.POSITIVE_INFINITY })).toThrow(
      "Canción inválida.",
    );
    expect(() => canonicalSong({ ...song, id: "bad-id" })).toThrow(
      "Identificador de canción o artista inválido.",
    );
  });

  it("validates and canonicalizes multi-seed responses, uppercase graph UUIDs, and colon tags", () => {
    const fixtures = createMultiBatchFixtures("user");
    const seedA = fixtures.originals[0];
    const seedB = fixtures.originals[1];
    const recSong = fixtures.recommendations.rec3;
    const artistId = fixtures.artists.bjork;
    const requestIdUpper = makeUuid(9, 99).toUpperCase();
    const resultIdUpper = makeUuid(8, 99).toUpperCase();

    const raw = buildExplorationResponse({
      requestId: requestIdUpper,
      seeds: [seedA, seedB],
      seedArtistIds: {
        [seedA.id]: fixtures.seedArtistIds[seedA.id].toUpperCase(),
        [seedB.id]: null,
      },
      seedTags: ["post-rock:90s", "electronic"],
      recommendations: [
        {
          resultId: resultIdUpper,
          song: { ...recSong, id: recSong.id.toUpperCase() },
          artistId: artistId.toUpperCase(),
          reasons: [
            {
              seedId: seedA.id.toUpperCase(),
              score: 0.91,
              sharedTags: ["post-rock:90s"],
              signals: ["versions", "collab"],
            },
            {
              seedId: seedB.id.toUpperCase(),
              score: 0.72,
              sharedTags: ["electronic"],
              signals: ["songs", "listeners"],
            },
          ],
        },
      ],
    });

    // Uppercase the graph node/edge UUID parts while keeping colon-containing tag and signal suffixes intact.
    const uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;
    raw.graph.nodes = raw.graph.nodes.map((node) => ({
      ...node,
      id: node.id.replace(uuidRegex, (m) => m.toUpperCase()),
    }));
    raw.graph.edges = raw.graph.edges.map((edge) => ({
      from: edge.from.replace(uuidRegex, (m) => m.toUpperCase()),
      to: edge.to.replace(uuidRegex, (m) => m.toUpperCase()),
    }));

    const request = makeRequest({ seeds: [seedA, seedB], limit: 10 });
    const validated = validateExplorationResponse(raw, request);

    expect(validated.requestId).toBe(requestIdUpper.toLowerCase());
    expect(validated.recommendations[0].resultId).toBe(resultIdUpper.toLowerCase());
    expect(validated.recommendations[0].song.id).toBe(recSong.id);
    expect(validated.recommendations[0].artistId).toBe(artistId);
    expect(validated.recommendations[0].seedIds).toEqual([seedA.id, seedB.id]);
    expect(validated.seedResults[0].artistId).toBe(fixtures.seedArtistIds[seedA.id]);
    expect(validated.seedResults[1].artistId).toBeNull();
    expect(validated.graph.nodes.some((n) => n.id === `tag:${seedA.id}:post-rock:90s`)).toBe(true);
    expect(
      validated.graph.nodes.some(
        (n) => n.id === `artist:${seedA.id}:${artistId}:${recSong.id}`,
      ),
    ).toBe(true);
  });

  it("validates empty responses across all non-recommended seed statuses and status graph nodes", () => {
    const seeds = [
      makeSong(1),
      makeSong(2),
      makeSong(3),
      makeSong(4),
      makeSong(5),
    ];
    const response = buildExplorationResponse({
      seeds,
      recommendations: [],
      seedTags: [],
      seedStatuses: {
        [seeds[0].id]: { status: "no_candidates" },
        [seeds[1].id]: { status: "no_tracks" },
        [seeds[2].id]: { status: "limit" },
        [seeds[3].id]: { status: "search_limit", searchLimited: true },
        [seeds[4].id]: { status: "unavailable", title: "Canción no disponible", artist: "" },
      },
    });

    const validated = validateExplorationResponse(response, makeRequest({ seeds }));
    expect(validated.recommendations).toEqual([]);
    expect(validated.seedResults.map((r) => r.status)).toEqual([
      "no_candidates",
      "no_tracks",
      "limit",
      "search_limit",
      "unavailable",
    ]);
    expect(validated.graph.nodes.filter((n) => n.type === "status")).toHaveLength(5);
    expect(validated.graph.edges).toHaveLength(5);
  });

  it("leaves excludeVersions casefold/version authority to Python without rejecting in JS", () => {
    const seed = makeSong(1, { title: "Reckoner" });
    const knownArtistId = makeUuid(4, 77);
    const sameTitleDifferentCaseSong = makeSong(2, { title: "reckoner (live)" });
    const response = buildExplorationResponse({
      seeds: [seed],
      recommendations: [
        {
          song: sameTitleDifferentCaseSong,
          artistId: knownArtistId,
          reasons: [{ seedId: seed.id, score: 0.8, sharedTags: ["rock"], signals: [] }],
        },
      ],
    });

    const request = makeRequest({
      seeds: [seed],
      excludeVersions: [{ artistId: knownArtistId, title: "RECKONER (LIVE)" }],
    });

    expect(() => validateExplorationResponse(response, request)).not.toThrow();
  });

  it("rejects malformed top-level shapes, over-limit payloads, excluded songs/artists, and duplicates", () => {
    const fixtures = createMultiBatchFixtures("guest");
    const base = fixtures.responses.batch1;
    const request = makeRequest({
      seeds: fixtures.originals,
      excludeRecordings: [fixtures.originals[0].id, fixtures.originals[1].id, makeUuid(3, 999)],
      excludeArtists: [makeUuid(4, 999)],
      limit: 3,
    });

    expect(() => validateExplorationResponse(null, request)).toThrow();
    expect(() => validateExplorationResponse([], request)).toThrow();
    expect(() => validateExplorationResponse({ ...base, seedTags: ["  "] }, request)).toThrow();

    // More recommendations than request.limit
    expect(() =>
      validateExplorationResponse(base, { ...request, limit: 2 }),
    ).toThrow();

    // Excluded recording returned
    const excludedRec = buildExplorationResponse({
      seeds: fixtures.originals,
      recommendations: [
        {
          song: makeSong(999, {}, 3),
          artistId: fixtures.artists.portishead,
          reasons: [{ seedId: fixtures.originals[0].id, score: 0.7, sharedTags: ["rock"], signals: [] }],
        },
      ],
    });
    expect(() => validateExplorationResponse(excludedRec, request)).toThrow();

    // Excluded artist returned
    const excludedArtist = buildExplorationResponse({
      seeds: fixtures.originals,
      recommendations: [
        {
          song: makeSong(500, {}, 3),
          artistId: makeUuid(4, 999),
          reasons: [{ seedId: fixtures.originals[0].id, score: 0.7, sharedTags: ["rock"], signals: [] }],
        },
      ],
    });
    expect(() => validateExplorationResponse(excludedArtist, request)).toThrow();

    // Seed song returned as recommendation
    const seedAsRec = buildExplorationResponse({
      seeds: fixtures.originals,
      recommendations: [
        {
          song: fixtures.originals[0],
          artistId: fixtures.artists.portishead,
          reasons: [{ seedId: fixtures.originals[1].id, score: 0.7, sharedTags: ["rock"], signals: [] }],
        },
      ],
    });
    expect(() => validateExplorationResponse(seedAsRec, request)).toThrow();

    // Duplicate recommendation song ID
    const dupSong = structuredClone(base);
    dupSong.recommendations[1] = structuredClone(dupSong.recommendations[0]);
    expect(() => validateExplorationResponse(dupSong, request)).toThrow();

    // Duplicate resultId across recommendations
    const userFixtures = createMultiBatchFixtures("user");
    const dupResultId = structuredClone(userFixtures.responses.batch1);
    dupResultId.recommendations[1].resultId = dupResultId.recommendations[0].resultId;
    expect(() => validateExplorationResponse(dupResultId, request)).toThrow();
  });

  it("rejects known-but-unselected origins, invalid signals, empty reasons, and score/tag/seedIds mismatches", () => {
    const fixtures = createMultiBatchFixtures("guest");
    const selectedFromBatch1 = fixtures.recommendations.rec1;
    const unselectedFromBatch1 = fixtures.recommendations.rec2; // known in exploration, NOT in request.seeds
    const newRec = fixtures.recommendations.rec4;
    const request = makeRequest({
      kind: "expand",
      seeds: [selectedFromBatch1],
      excludeRecordings: [
        fixtures.originals[0].id,
        fixtures.originals[1].id,
        selectedFromBatch1.id,
        unselectedFromBatch1.id,
      ],
    });

    // Known song from earlier batch that was NOT selected as a seed for this request
    const knownUnselectedOrigin = buildExplorationResponse({
      seeds: [selectedFromBatch1, unselectedFromBatch1],
      recommendations: [
        {
          song: newRec,
          artistId: fixtures.artists.portishead,
          reasons: [
            { seedId: unselectedFromBatch1.id, score: 0.85, sharedTags: ["trip hop"], signals: ["songs"] },
          ],
        },
      ],
    });
    expect(() => validateExplorationResponse(knownUnselectedOrigin, request)).toThrow();

    const validExpand = buildExplorationResponse({
      seeds: [selectedFromBatch1],
      recommendations: [
        {
          song: newRec,
          artistId: fixtures.artists.portishead,
          reasons: [
            { seedId: selectedFromBatch1.id, score: 0.85, sharedTags: ["trip hop"], signals: ["songs"] },
          ],
        },
      ],
    });

    // Empty reasons
    const emptyReasons = structuredClone(validExpand);
    emptyReasons.recommendations[0].reasons = [];
    expect(() => validateExplorationResponse(emptyReasons, request)).toThrow();

    // Reason with neither sharedTags nor signals
    const emptyJustification = structuredClone(validExpand);
    emptyJustification.recommendations[0].reasons[0].sharedTags = [];
    emptyJustification.recommendations[0].reasons[0].signals = [];
    emptyJustification.recommendations[0].sharedTags = [];
    emptyJustification.recommendations[0].signals = [];
    expect(() => validateExplorationResponse(emptyJustification, request)).toThrow();

    // Unknown signal name
    const badSignal = structuredClone(validExpand) as unknown as Record<string, unknown>;
    (badSignal.recommendations as Array<Record<string, unknown>>)[0].signals = ["tags"];
    expect(() => validateExplorationResponse(badSignal, request)).toThrow();

    // Score mismatch vs max(reasons.score)
    const badScore = structuredClone(validExpand);
    badScore.recommendations[0].score = 0.99;
    expect(() => validateExplorationResponse(badScore, request)).toThrow();

    // sharedTags mismatch vs reasons union
    const badTags = structuredClone(validExpand);
    badTags.recommendations[0].sharedTags = ["trip hop", "extra"];
    expect(() => validateExplorationResponse(badTags, request)).toThrow();

    // seedIds mismatch vs reasons
    const badSeedIds = structuredClone(validExpand);
    badSeedIds.recommendations[0].seedIds = [selectedFromBatch1.id, unselectedFromBatch1.id];
    expect(() => validateExplorationResponse(badSeedIds, request)).toThrow();
  });

  it("rejects inconsistent seedResults coverage and corrupted graph nodes or edges", () => {
    const fixtures = createMultiBatchFixtures("guest");
    const request = makeRequest({ seeds: fixtures.originals });
    const base = fixtures.responses.batch1;

    // Missing seedResult
    const missingSeedResult = structuredClone(base);
    missingSeedResult.seedResults.pop();
    expect(() => validateExplorationResponse(missingSeedResult, request)).toThrow();

    // seedResult with wrong recommendationIds
    const badCoverageIds = structuredClone(base);
    badCoverageIds.seedResults[0].recommendationIds = [fixtures.recommendations.rec1.id];
    expect(() => validateExplorationResponse(badCoverageIds, request)).toThrow();

    // status === "recommended" with empty recommendationIds (and vice versa)
    const statusMismatch = structuredClone(fixtures.responses.emptyOriginals);
    statusMismatch.seedResults[0].status = "recommended";
    expect(() => validateExplorationResponse(statusMismatch, request)).toThrow();

    // Extra graph node
    const extraNode = structuredClone(base);
    extraNode.graph.nodes.push({ id: `tag:${fixtures.originals[0].id}:orphan`, type: "tag", label: "orphan" });
    expect(() => validateExplorationResponse(extraNode, request)).toThrow();

    // Wrong node type
    const wrongType = structuredClone(base);
    const tagIdx = wrongType.graph.nodes.findIndex((n) => n.type === "tag");
    wrongType.graph.nodes[tagIdx].type = "signal";
    expect(() => validateExplorationResponse(wrongType, request)).toThrow();

    // Missing graph edge
    const missingEdge = structuredClone(base);
    missingEdge.graph.edges.pop();
    expect(() => validateExplorationResponse(missingEdge, request)).toThrow();

    // Dangling / cross-branch graph edge
    const danglingEdge = structuredClone(base);
    danglingEdge.graph.edges[0] = {
      from: `seed:${fixtures.originals[0].id}`,
      to: `song:${fixtures.recommendations.rec1.id}`,
    };
    expect(() => validateExplorationResponse(danglingEdge, request)).toThrow();

    // Duplicate graph edge
    const duplicateEdge = structuredClone(base);
    duplicateEdge.graph.edges.push({ ...duplicateEdge.graph.edges[0] });
    expect(() => validateExplorationResponse(duplicateEdge, request)).toThrow();

    // Missing status node on empty seedResult
    const missingStatusNode = structuredClone(fixtures.responses.emptyOriginals);
    missingStatusNode.graph.nodes = missingStatusNode.graph.nodes.filter((n) => n.type !== "status");
    missingStatusNode.graph.edges = [];
    expect(() => validateExplorationResponse(missingStatusNode, request)).toThrow();
  });
});
