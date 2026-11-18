import { describe, expect, it } from "vitest";
import { projectRecommendationGraph } from "@/lib/recommendation-graph";
import type { ExplorationBatch, ExplorationState } from "@/lib/recommendation-exploration";
import {
  buildExplorationResponse,
  createMultiBatchFixtures,
  makeSong,
  makeSongs,
  makeUuid,
} from "./fixtures/recommendation-exploration";

function makeBatch(
  id: string,
  inputs: ExplorationBatch["inputs"],
  response: ExplorationBatch["response"],
  originBatchIds: string[] = [],
): ExplorationBatch {
  return {
    id,
    inputs,
    originBatchIds,
    newSongIds: response.recommendations.map((rec) => rec.song.id),
    response,
    requestId: response.requestId,
  };
}

describe("T5 projectRecommendationGraph", () => {
  it("uses recording:<MBID> global node ids instead of resultId, avoids node duplication, and keeps selective expansion provenance", () => {
    const fixtures = createMultiBatchFixtures("user");
    const { originals, recommendations, responses } = fixtures;

    const batch1 = makeBatch("batch-1", originals, responses.batch1);
    const batch2 = makeBatch("batch-2", [recommendations.rec1], responses.batch2, ["batch-1"]);

    const graph = projectRecommendationGraph({
      originals,
      batches: [batch1, batch2],
    });

    // 2 originals + 3 from batch 1 + 2 from batch 2 = 7 unique recording nodes
    expect(graph.nodes).toHaveLength(7);
    const nodeIds = graph.nodes.map((node) => node.id);
    expect(new Set(nodeIds).size).toBe(7);
    for (const node of graph.nodes) {
      expect(node.id).toBe(`recording:${node.song.id}`);
      if (node.recommendation?.resultId) {
        expect(node.id).not.toContain(node.recommendation.resultId);
      }
    }

    // rec1 was discovered in batch-1 and reused as seed in batch-2: appears once with batch-1 provenance.
    const rec1Node = graph.nodes.find((node) => node.song.id === recommendations.rec1.id);
    expect(rec1Node).toMatchObject({
      id: `recording:${recommendations.rec1.id}`,
      depth: 1,
      batchId: "batch-1",
    });

    // Originals stay depth 0 with batchId: null and no recommendation metadata.
    for (const orig of originals) {
      const origNode = graph.nodes.find((node) => node.song.id === orig.id);
      expect(origNode).toMatchObject({
        id: `recording:${orig.id}`,
        depth: 0,
        batchId: null,
      });
      expect(origNode?.recommendation).toBeUndefined();
    }

    // Only rec1 was selected for batch-2; rec2 and rec3 acquire no outgoing edges.
    const outEdgesFrom = (songId: string) =>
      graph.edges.filter((edge) => edge.from === `recording:${songId}`);
    expect(outEdgesFrom(recommendations.rec1.id).map((edge) => edge.to)).toEqual([
      `recording:${recommendations.rec4.id}`,
      `recording:${recommendations.rec5.id}`,
    ]);
    expect(outEdgesFrom(recommendations.rec2.id)).toEqual([]);
    expect(outEdgesFrom(recommendations.rec3.id)).toEqual([]);

    // Edge ids follow batchId:seedId:recordingIdResultado (not resultId).
    const rec4Edge = graph.edges.find((edge) => edge.to === `recording:${recommendations.rec4.id}`);
    expect(rec4Edge).toMatchObject({
      id: `batch-2:${recommendations.rec1.id}:${recommendations.rec4.id}`,
      from: `recording:${recommendations.rec1.id}`,
      to: `recording:${recommendations.rec4.id}`,
      batchId: "batch-2",
    });
    expect(rec4Edge?.id).not.toContain(responses.batch2.recommendations[0].resultId!);
  });

  it("computes topological depth (1 + max origin depth) across multiple origins and mixed depths without equating depth to batch index", () => {
    const fixtures = createMultiBatchFixtures("user");
    const { originals, recommendations, responses, artists } = fixtures;

    // Batch 1 (orig -> rec1, rec2, rec3): depth 1
    // Batch 2 (rec1 [d=1] -> rec4, rec5): depth 2
    // Batch 3 (rec2 [d=1] + rec5 [d=2] -> rec6): depth 1 + max(1, 2) = 3
    // Batch 4 (later batch from shallower rec2 [d=1] -> rec7): depth 1 + 1 = 2 (NOT 4)
    // Batch 5 (alternatives from originals [d=0] -> alt1): depth 1 + 0 = 1 (NOT 5)
    const rec7 = makeSong(108, { title: "Shallow Later", artist: "Artist 108" }, 3);
    const batch4Response = buildExplorationResponse({
      requestId: makeUuid(9, 6),
      seeds: [recommendations.rec2],
      seedArtistIds: { [recommendations.rec2.id]: artists.unkle },
      recommendations: [
        {
          resultId: makeUuid(8, 8),
          song: rec7,
          artistId: makeUuid(4, 7),
          reasons: [
            {
              seedId: recommendations.rec2.id,
              score: 0.77,
              sharedTags: ["downtempo"],
              signals: ["songs"],
            },
          ],
        },
      ],
    });

    const graph = projectRecommendationGraph({
      originals,
      batches: [
        makeBatch("batch-1", originals, responses.batch1),
        makeBatch("batch-2", [recommendations.rec1], responses.batch2, ["batch-1"]),
        makeBatch(
          "batch-3",
          [recommendations.rec2, recommendations.rec5],
          responses.batch3Combined,
          ["batch-1", "batch-2"],
        ),
        makeBatch("batch-4", [recommendations.rec2], batch4Response, ["batch-1"]),
        makeBatch("batch-5", originals, responses.alternatives),
      ],
    });

    const depthOf = (songId: string) =>
      graph.nodes.find((node) => node.song.id === songId)?.depth;

    expect(depthOf(originals[0].id)).toBe(0);
    expect(depthOf(originals[1].id)).toBe(0);
    expect(depthOf(recommendations.rec1.id)).toBe(1);
    expect(depthOf(recommendations.rec2.id)).toBe(1);
    expect(depthOf(recommendations.rec3.id)).toBe(1);
    expect(depthOf(recommendations.rec4.id)).toBe(2);
    expect(depthOf(recommendations.rec5.id)).toBe(2);
    expect(depthOf(recommendations.rec6.id)).toBe(3);
    expect(depthOf(rec7.id)).toBe(2);
    expect(depthOf(recommendations.alt1.id)).toBe(1);

    // Multi-origin song rec3 (from both originals) and rec6 (from rec2 + rec5) retain exact per-origin reasons.
    const rec3Edges = graph.edges.filter((edge) => edge.to === `recording:${recommendations.rec3.id}`);
    expect(rec3Edges).toHaveLength(2);
    expect(rec3Edges.map((edge) => ({ id: edge.id, from: edge.from, score: edge.reason.score }))).toEqual([
      {
        id: `batch-1:${originals[0].id}:${recommendations.rec3.id}`,
        from: `recording:${originals[0].id}`,
        score: 0.88,
      },
      {
        id: `batch-1:${originals[1].id}:${recommendations.rec3.id}`,
        from: `recording:${originals[1].id}`,
        score: 0.75,
      },
    ]);

    const rec6Edges = graph.edges.filter((edge) => edge.to === `recording:${recommendations.rec6.id}`);
    expect(rec6Edges).toHaveLength(2);
    expect(rec6Edges.map((edge) => ({ id: edge.id, from: edge.from, batchId: edge.batchId, tags: edge.reason.sharedTags }))).toEqual([
      {
        id: `batch-3:${recommendations.rec2.id}:${recommendations.rec6.id}`,
        from: `recording:${recommendations.rec2.id}`,
        batchId: "batch-3",
        tags: ["downtempo"],
      },
      {
        id: `batch-3:${recommendations.rec5.id}:${recommendations.rec6.id}`,
        from: `recording:${recommendations.rec5.id}`,
        batchId: "batch-3",
        tags: ["art rock"],
      },
    ]);
  });

  it("never infers edges across unrelated branches that share tags, signals, or artistId", () => {
    const origA = makeSong(1, { title: "Seed A", artist: "Artist A" }, 1);
    const origB = makeSong(2, { title: "Seed B", artist: "Artist B" }, 1);
    const sharedArtistId = makeUuid(4, 1);
    const recA = makeSong(101, { title: "Branch A Track", artist: "Same Artist" }, 3);
    const recB = makeSong(102, { title: "Branch B Track", artist: "Same Artist" }, 3);
    const recA2 = makeSong(103, { title: "Branch A Followup", artist: "Same Artist" }, 3);

    const resp1 = buildExplorationResponse({
      seeds: [origA],
      recommendations: [
        {
          song: recA,
          artistId: sharedArtistId,
          reasons: [{ seedId: origA.id, score: 0.9, sharedTags: ["shoegaze", "dream pop"], signals: ["songs", "listeners"] }],
        },
      ],
    });
    const resp2 = buildExplorationResponse({
      seeds: [origB],
      recommendations: [
        {
          song: recB,
          artistId: sharedArtistId,
          reasons: [{ seedId: origB.id, score: 0.9, sharedTags: ["shoegaze", "dream pop"], signals: ["songs", "listeners"] }],
        },
      ],
    });
    const resp3 = buildExplorationResponse({
      seeds: [recA],
      recommendations: [
        {
          song: recA2,
          artistId: sharedArtistId,
          reasons: [{ seedId: recA.id, score: 0.85, sharedTags: ["shoegaze"], signals: ["songs"] }],
        },
      ],
    });

    const graph = projectRecommendationGraph({
      originals: [origA, origB],
      batches: [
        makeBatch("b1", [origA], resp1),
        makeBatch("b2", [origB], resp2),
        makeBatch("b3", [recA], resp3, ["b1"]),
      ],
    });

    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      [`recording:${origA.id}`, `recording:${recA.id}`],
      [`recording:${origB.id}`, `recording:${recB.id}`],
      [`recording:${recA.id}`, `recording:${recA2.id}`],
    ]);

    // Reachability check: origB's branch has zero connection to origA, recA, or recA2.
    const branchBEdges = graph.edges.filter(
      (edge) => edge.from === `recording:${origB.id}` || edge.from === `recording:${recB.id}` || edge.to === `recording:${recB.id}`,
    );
    expect(branchBEdges).toHaveLength(1);
    expect(branchBEdges[0]).toMatchObject({
      from: `recording:${origB.id}`,
      to: `recording:${recB.id}`,
    });
  });

  it("throws on invalid histories and cycles instead of emitting partial or cyclic edges", () => {
    const orig1 = makeSong(1, {}, 1);
    const orig2 = makeSong(2, {}, 1);
    const rec1 = makeSong(101, {}, 3);
    const rec2 = makeSong(102, {}, 3);
    const artist1 = makeUuid(4, 1);

    const validBatch1 = makeBatch(
      "b1",
      [orig1],
      buildExplorationResponse({
        seeds: [orig1],
        recommendations: [
          { song: rec1, artistId: artist1, reasons: [{ seedId: orig1.id, score: 0.9, sharedTags: ["rock"], signals: [] }] },
        ],
      }),
    );

    const cases: { name: string; state: Pick<ExplorationState, "originals" | "batches"> }[] = [
      {
        name: "duplicate original id",
        state: { originals: [orig1, orig1], batches: [] },
      },
      {
        name: "empty original id",
        state: { originals: [{ ...orig1, id: "" }], batches: [] },
      },
      {
        name: "empty batch inputs",
        state: {
          originals: [orig1],
          batches: [
            makeBatch(
              "b1-empty-inputs",
              [],
              buildExplorationResponse({
                seeds: [orig1],
                recommendations: [
                  { song: rec1, artistId: artist1, reasons: [{ seedId: orig1.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "duplicate song inside batch inputs",
        state: {
          originals: [orig1],
          batches: [
            makeBatch(
              "b1-dup-inputs",
              [orig1, orig1],
              buildExplorationResponse({
                seeds: [orig1],
                recommendations: [
                  { song: rec1, artistId: artist1, reasons: [{ seedId: orig1.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "duplicate batch id",
        state: {
          originals: [orig1],
          batches: [
            validBatch1,
            makeBatch(
              "b1",
              [rec1],
              buildExplorationResponse({
                seeds: [rec1],
                recommendations: [
                  { song: rec2, artistId: artist1, reasons: [{ seedId: rec1.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "empty recommendations in batch",
        state: {
          originals: [orig1],
          batches: [
            makeBatch("b1", [orig1], buildExplorationResponse({ seeds: [orig1], recommendations: [] })),
          ],
        },
      },
      {
        name: "unknown input seed not in prior nodes",
        state: {
          originals: [orig1],
          batches: [
            makeBatch(
              "b1",
              [orig2],
              buildExplorationResponse({
                seeds: [orig2],
                recommendations: [
                  { song: rec1, artistId: artist1, reasons: [{ seedId: orig2.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "batches out of chronological order (uses future batch discovery as input)",
        state: {
          originals: [orig1],
          batches: [
            makeBatch(
              "b2-early",
              [rec1],
              buildExplorationResponse({
                seeds: [rec1],
                recommendations: [
                  { song: rec2, artistId: artist1, reasons: [{ seedId: rec1.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
            validBatch1,
          ],
        },
      },
      {
        name: "cycle back to an original song",
        state: {
          originals: [orig1],
          batches: [
            validBatch1,
            makeBatch(
              "b2-cycle-orig",
              [rec1],
              buildExplorationResponse({
                seeds: [rec1],
                recommendations: [
                  { song: orig1, artistId: artist1, reasons: [{ seedId: rec1.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "cycle back to an already-discovered recommendation",
        state: {
          originals: [orig1, orig2],
          batches: [
            validBatch1,
            makeBatch(
              "b2-cycle-rec",
              [orig2],
              buildExplorationResponse({
                seeds: [orig2],
                recommendations: [
                  { song: rec1, artistId: artist1, reasons: [{ seedId: orig2.id, score: 0.8, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "duplicate recommendation song inside same batch",
        state: {
          originals: [orig1],
          batches: [
            {
              id: "b1-dup-rec",
              inputs: [orig1],
              originBatchIds: [],
              newSongIds: [rec1.id, rec2.id],
              response: {
                seedTags: [],
                recommendations: [
                  {
                    song: rec1,
                    artistId: artist1,
                    score: 0.9,
                    sharedTags: [],
                    signals: ["songs"],
                    seedIds: [orig1.id],
                    reasons: [{ seedId: orig1.id, score: 0.9, sharedTags: [], signals: ["songs"] }],
                  },
                  {
                    song: rec1,
                    artistId: artist1,
                    score: 0.8,
                    sharedTags: [],
                    signals: ["songs"],
                    seedIds: [orig1.id],
                    reasons: [{ seedId: orig1.id, score: 0.8, sharedTags: [], signals: ["songs"] }],
                  },
                ],
                seedResults: [],
                graph: { nodes: [], edges: [] },
              },
            },
          ],
        },
      },
      {
        name: "intra-batch self-cycle (recommendation references itself as seedId)",
        state: {
          originals: [orig1],
          batches: [
            {
              id: "b1-self",
              inputs: [orig1],
              originBatchIds: [],
              newSongIds: [rec1.id],
              response: {
                seedTags: [],
                recommendations: [
                  {
                    song: rec1,
                    artistId: artist1,
                    score: 0.9,
                    sharedTags: [],
                    signals: ["songs"],
                    seedIds: [rec1.id],
                    reasons: [{ seedId: rec1.id, score: 0.9, sharedTags: [], signals: ["songs"] }],
                  },
                ],
                seedResults: [],
                graph: { nodes: [], edges: [] },
              },
            },
          ],
        },
      },
      {
        name: "reason points to existing original omitted from batch.inputs",
        state: {
          originals: [orig1, orig2],
          batches: [
            makeBatch(
              "b1-unlisted-seed",
              [orig1],
              buildExplorationResponse({
                seeds: [orig1, orig2],
                recommendations: [
                  { song: rec1, artistId: artist1, reasons: [{ seedId: orig2.id, score: 0.9, sharedTags: [], signals: ["songs"] }] },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "duplicate seedId inside recommendation reasons",
        state: {
          originals: [orig1],
          batches: [
            makeBatch(
              "b1-dup-reason",
              [orig1],
              buildExplorationResponse({
                seeds: [orig1],
                recommendations: [
                  {
                    song: rec1,
                    artistId: artist1,
                    reasons: [
                      { seedId: orig1.id, score: 0.9, sharedTags: ["rock"], signals: [] },
                      { seedId: orig1.id, score: 0.8, sharedTags: ["indie"], signals: [] },
                    ],
                  },
                ],
              }),
            ),
          ],
        },
      },
      {
        name: "newSongIds mismatch with response recommendations",
        state: {
          originals: [orig1],
          batches: [
            {
              ...validBatch1,
              newSongIds: [rec1.id, rec2.id],
            },
          ],
        },
      },
      {
        name: "recommendation with zero reasons",
        state: {
          originals: [orig1],
          batches: [
            {
              id: "b1-no-reasons",
              inputs: [orig1],
              originBatchIds: [],
              newSongIds: [rec1.id],
              response: {
                seedTags: [],
                recommendations: [
                  {
                    song: rec1,
                    artistId: artist1,
                    score: 0.9,
                    sharedTags: [],
                    signals: [],
                    seedIds: [],
                    reasons: [],
                  },
                ],
                seedResults: [],
                graph: { nodes: [], edges: [] },
              },
            },
          ],
        },
      },
    ];

    for (const testCase of cases) {
      expect(() => projectRecommendationGraph(testCase.state), testCase.name).toThrow(
        "Historial de exploración inválido",
      );
    }
  });

  it("projects a 200-song multi-batch exploration with only recording nodes and exact provenance edges", () => {
    const originals = makeSongs(4, 1, 1);
    const batches: ExplorationBatch[] = [];
    let nextRecIndex = 1;
    let seedForNext = originals;

    // 4 originals + 20 batches = 200 unique songs
    const batchSizes = [10, ...Array.from({ length: 18 }, () => 10), 6]; // 10 + 180 + 6 = 196 recs (+ 4 originals = 200)
    for (let idx = 0; idx < batchSizes.length; idx++) {
      const size = batchSizes[idx];
      const recs = makeSongs(size, nextRecIndex, 3);
      nextRecIndex += size;
      const response = buildExplorationResponse({
        seeds: seedForNext,
        recommendations: recs.map((song, offset) => ({
          song,
          artistId: makeUuid(4, nextRecIndex + offset),
          reasons: [
            {
              seedId: seedForNext[offset % seedForNext.length].id,
              score: 0.85,
              sharedTags: ["electronic", "ambient"],
              signals: ["songs", "listeners"],
            },
          ],
        })),
      });
      batches.push(makeBatch(`batch-${idx + 1}`, seedForNext, response));
      seedForNext = [recs[0]];
    }

    const graph = projectRecommendationGraph({ originals, batches });
    expect(graph.nodes).toHaveLength(200);
    expect(graph.edges).toHaveLength(196);
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(200);
    expect(graph.nodes.every((node) => node.id.startsWith("recording:"))).toBe(true);
    expect(graph.nodes.find((node) => node.song.id === batches[19].newSongIds[0])?.depth).toBe(20);
  });
});
