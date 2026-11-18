import type {
  GraphNode,
  Recommendation,
  RecommendationGraph,
  RecommendationReason,
  RecommendationResponse,
  SeedResult,
  Song,
} from "@/lib/musicbrainz-types";
import type { ExplorationRequest, ExplorationTransport } from "@/lib/recommendation-exploration";

export const SIGNAL_LABELS: Record<Recommendation["signals"][number], string> = {
  songs: "Canciones similares (Last.fm)",
  versions: "Otra grabación de una canción similar (Last.fm)",
  listeners: "Artistas similares (Last.fm)",
  collab: "Colaboraciones",
};

/** Deterministic UUID v4-shaped identifier for fixtures (1-indexed friendly). */
export function makeUuid(group: number, index: number): string {
  const g = Math.max(0, group).toString(16).padStart(8, "0").slice(-8);
  const tail = Math.max(0, index).toString(16).padStart(12, "0").slice(-12);
  return `${g}-0000-4000-8000-${tail}`;
}

export function makeSong(
  index: number,
  overrides: Partial<Song> = {},
  group = 1,
): Song {
  return {
    id: makeUuid(group, index),
    title: `Song ${index}`,
    artist: `Artist ${index}`,
    release: `Release ${index}`,
    duration: 180_000 + index * 1_000,
    comment: null,
    ...overrides,
  };
}

export function makeSongs(count: number, startIndex = 1, group = 1): Song[] {
  return Array.from({ length: count }, (_, offset) =>
    makeSong(startIndex + offset, {}, group),
  );
}

export type RecommendationSpec = {
  song: Song;
  artistId: string;
  reasons: RecommendationReason[];
  resultId?: string;
};

/** Mirrors backend/app/recommender.py build_graph() exactly. */
export function buildBackendGraph(
  seeds: Song[],
  recommendations: Recommendation[],
  seedResults: SeedResult[],
): RecommendationGraph {
  const nodes = new Map<string, GraphNode>();
  const edgeSet = new Map<string, { from: string; to: string }>();

  const addNode = (node: GraphNode) => {
    nodes.set(node.id, node);
  };
  const addEdge = (from: string, to: string) => {
    edgeSet.set(`${from}\0${to}`, { from, to });
  };

  for (const seed of seeds) {
    const seedId = seed.id.toLowerCase();
    addNode({
      id: `seed:${seedId}`,
      type: "seed",
      label: seed.title,
      detail: seed.artist,
    });
  }

  for (const rec of recommendations) {
    const songId = rec.song.id.toLowerCase();
    const songNode = `song:${songId}`;
    const artistId = rec.artistId.toLowerCase();
    addNode({
      id: songNode,
      type: "song",
      label: rec.song.title,
      detail: rec.song.artist,
      score: rec.score,
    });
    for (const reason of rec.reasons) {
      const seedId = reason.seedId.toLowerCase();
      const artistNode = `artist:${seedId}:${artistId}:${songId}`;
      addNode({
        id: artistNode,
        type: "artist",
        label: rec.song.artist,
        score: reason.score,
      });
      addEdge(artistNode, songNode);

      for (const tag of reason.sharedTags) {
        const tagNode = `tag:${seedId}:${tag}`;
        addNode({ id: tagNode, type: "tag", label: tag });
        addEdge(`seed:${seedId}`, tagNode);
        addEdge(tagNode, artistNode);
      }

      for (const signal of reason.signals) {
        const signalNode = `signal:${seedId}:${signal}`;
        addNode({ id: signalNode, type: "signal", label: SIGNAL_LABELS[signal] });
        addEdge(`seed:${seedId}`, signalNode);
        addEdge(signalNode, artistNode);
      }
    }
  }

  for (const result of seedResults) {
    if (result.status === "recommended") continue;
    const seedId = result.seedId.toLowerCase();
    const statusNode = `status:${seedId}`;
    addNode({
      id: statusNode,
      type: "status",
      label: "Sin resultados en esta tanda",
      detail: result.message,
    });
    addEdge(`seed:${seedId}`, statusNode);
  }

  const edges = [...edgeSet.values()].sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );

  return { nodes: [...nodes.values()], edges };
}

export type BuildResponseOptions = {
  seeds: Song[];
  recommendations: RecommendationSpec[];
  seedTags?: string[];
  requestId?: string;
  seedArtistIds?: Record<string, string | null>;
  seedStatuses?: Record<
    string,
    {
      status: Exclude<SeedResult["status"], "recommended">;
      message?: string;
      searchLimited?: boolean;
      title?: string;
      artist?: string;
    }
  >;
};

export function buildExplorationResponse(
  options: BuildResponseOptions,
): RecommendationResponse {
  const recommendations: Recommendation[] = options.recommendations.map((spec) => {
    const seedIds = spec.reasons.map((r) => r.seedId);
    const sharedTags = [...new Set(spec.reasons.flatMap((r) => r.sharedTags))];
    const signals = [...new Set(spec.reasons.flatMap((r) => r.signals))];
    const score = Math.max(...spec.reasons.map((r) => r.score));
    return {
      ...(spec.resultId !== undefined ? { resultId: spec.resultId } : {}),
      song: spec.song,
      artistId: spec.artistId,
      seedIds,
      reasons: spec.reasons,
      sharedTags,
      signals,
      score,
    };
  });

  const seedResults: SeedResult[] = options.seeds.map((seed) => {
    const recIds = recommendations
      .filter((rec) =>
        rec.seedIds.some((id) => id.toLowerCase() === seed.id.toLowerCase()),
      )
      .map((rec) => rec.song.id);
    const override = options.seedStatuses?.[seed.id] ?? options.seedStatuses?.[seed.id.toLowerCase()];
    const artistId =
      seed.id in (options.seedArtistIds ?? {})
        ? options.seedArtistIds![seed.id]
        : seed.id.toLowerCase() in (options.seedArtistIds ?? {})
          ? options.seedArtistIds![seed.id.toLowerCase()]
          : makeUuid(20, Number.parseInt(seed.id.slice(-4), 16) || 1);

    if (recIds.length > 0) {
      return {
        seedId: seed.id,
        title: seed.title,
        artist: seed.artist,
        status: "recommended",
        message:
          recIds.length === 1
            ? "1 recomendación a partir de esta canción."
            : `${recIds.length} recomendaciones a partir de esta canción.`,
        recommendationIds: recIds,
        artistId,
        searchLimited: false,
      };
    }

    const status = override?.status ?? "no_candidates";
    return {
      seedId: seed.id,
      title: override?.title ?? seed.title,
      artist: override?.artist ?? seed.artist,
      status,
      message: override?.message ?? `Sin recomendaciones (${status}).`,
      recommendationIds: [],
      artistId: status === "unavailable" ? null : artistId,
      searchLimited: override?.searchLimited ?? status === "search_limit",
    };
  });

  const seedTags =
    options.seedTags ??
    [...new Set(recommendations.flatMap((rec) => rec.sharedTags))];

  return {
    ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
    seedTags,
    recommendations,
    seedResults,
    graph: buildBackendGraph(options.seeds, recommendations, seedResults),
  };
}

export type DeferredTransportCall = {
  request: ExplorationRequest;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<unknown>;
};

export function createDeferredExplorationTransport() {
  const calls: DeferredTransportCall[] = [];

  const transport: ExplorationTransport = (request, signal) => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    calls.push({ request, signal, resolve, reject, promise });
    return promise;
  };

  return { transport, calls };
}

/**
 * Reusable multi-batch exploration fixtures for T3-T6 tests.
 * Covers:
 * - Batch 1 (start): 2 original seeds -> 3 recommendations (1 shared by both seeds)
 * - Batch 2 (expand): 1 rec from Batch 1 -> 2 new recommendations
 * - Batch 3 (expand): 1 rec from Batch 1 + 1 rec from Batch 2 -> multi-batch provenance
 * - Alternatives batch: from original seeds excluding shown recommendation artists
 * - Empty batch: 0 recommendations with non-recommended seed statuses
 */
export function createMultiBatchFixtures(mode: "guest" | "user" = "user") {
  const originals: Song[] = [
    makeSong(1, { title: "Reckoner", artist: "Radiohead", release: "In Rainbows" }, 1),
    makeSong(2, { title: "Teardrop", artist: "Massive Attack", release: "Mezzanine" }, 1),
  ];

  const seedArtistIds: Record<string, string> = {
    [originals[0].id]: makeUuid(2, 1),
    [originals[1].id]: makeUuid(2, 2),
  };

  const rec1 = makeSong(101, { title: "Glory Box", artist: "Portishead", release: "Dummy" }, 3);
  const rec2 = makeSong(102, { title: "Angel", artist: "Unkle", release: "Psyence Fiction" }, 3);
  const rec3 = makeSong(103, { title: "Hyperballad", artist: "Björk", release: "Post" }, 3);
  const rec4 = makeSong(104, { title: "Roads", artist: "Portishead", release: "Dummy" }, 3);
  const rec5 = makeSong(105, { title: "Tezeta", artist: "Mulatu Astatke", release: "Éthiopiques" }, 3);
  const rec6 = makeSong(106, { title: "Paper Tiger", artist: "Beck", release: "Sea Change" }, 3);
  const alt1 = makeSong(107, { title: "Nude", artist: "Atoms for Peace", release: "Amok" }, 3);

  const artistPortishead = makeUuid(4, 1);
  const artistUnkle = makeUuid(4, 2);
  const artistBjork = makeUuid(4, 3);
  const artistMulatu = makeUuid(4, 4);
  const artistBeck = makeUuid(4, 5);
  const artistAtoms = makeUuid(4, 6);

  const idIfUser = (group: number, index: number) =>
    mode === "user" ? makeUuid(group, index) : undefined;

  const batch1Response = buildExplorationResponse({
    requestId: idIfUser(9, 1),
    seeds: originals,
    seedArtistIds,
    seedTags: ["trip hop", "art rock", "electronic"],
    recommendations: [
      {
        resultId: idIfUser(8, 1),
        song: rec1,
        artistId: artistPortishead,
        reasons: [
          {
            seedId: originals[1].id,
            score: 0.92,
            sharedTags: ["trip hop"],
            signals: ["songs"],
          },
        ],
      },
      {
        resultId: idIfUser(8, 2),
        song: rec2,
        artistId: artistUnkle,
        reasons: [
          {
            seedId: originals[1].id,
            score: 0.84,
            sharedTags: ["electronic"],
            signals: ["listeners", "collab"],
          },
        ],
      },
      {
        resultId: idIfUser(8, 3),
        song: rec3,
        artistId: artistBjork,
        reasons: [
          {
            seedId: originals[0].id,
            score: 0.88,
            sharedTags: ["art rock"],
            signals: ["versions"],
          },
          {
            seedId: originals[1].id,
            score: 0.75,
            sharedTags: ["electronic"],
            signals: ["listeners"],
          },
        ],
      },
    ],
  });

  const batch2Response = buildExplorationResponse({
    requestId: idIfUser(9, 2),
    seeds: [rec1],
    seedArtistIds: { [rec1.id]: artistPortishead },
    seedTags: ["trip hop", "ethio-jazz"],
    recommendations: [
      {
        resultId: idIfUser(8, 4),
        song: rec4,
        artistId: artistPortishead,
        reasons: [
          {
            seedId: rec1.id,
            score: 0.9,
            sharedTags: ["trip hop"],
            signals: ["songs"],
          },
        ],
      },
      {
        resultId: idIfUser(8, 5),
        song: rec5,
        artistId: artistMulatu,
        reasons: [
          {
            seedId: rec1.id,
            score: 0.78,
            sharedTags: ["ethio-jazz"],
            signals: ["collab"],
          },
        ],
      },
    ],
  });

  // Combines rec2 (from Batch 1) and rec5 (from Batch 2) into Batch 3.
  const batch3CombinedResponse = buildExplorationResponse({
    requestId: idIfUser(9, 3),
    seeds: [rec2, rec5],
    seedArtistIds: { [rec2.id]: artistUnkle, [rec5.id]: artistMulatu },
    seedTags: ["art rock", "downtempo"],
    recommendations: [
      {
        resultId: idIfUser(8, 6),
        song: rec6,
        artistId: artistBeck,
        reasons: [
          {
            seedId: rec2.id,
            score: 0.86,
            sharedTags: ["downtempo"],
            signals: ["listeners"],
          },
          {
            seedId: rec5.id,
            score: 0.81,
            sharedTags: ["art rock"],
            signals: ["songs"],
          },
        ],
      },
    ],
  });

  const alternativesResponse = buildExplorationResponse({
    requestId: idIfUser(9, 4),
    seeds: originals,
    seedArtistIds,
    seedTags: ["art rock"],
    recommendations: [
      {
        resultId: idIfUser(8, 7),
        song: alt1,
        artistId: artistAtoms,
        reasons: [
          {
            seedId: originals[0].id,
            score: 0.83,
            sharedTags: ["art rock"],
            signals: ["collab"],
          },
        ],
      },
    ],
    seedStatuses: {
      [originals[1].id]: {
        status: "no_candidates",
        message: "No encontramos artistas nuevos para esta semilla.",
      },
    },
  });

  const emptyOriginalsResponse = buildExplorationResponse({
    requestId: idIfUser(9, 5),
    seeds: originals,
    seedArtistIds,
    seedTags: [],
    recommendations: [],
    seedStatuses: {
      [originals[0].id]: { status: "no_candidates" },
      [originals[1].id]: { status: "no_tracks" },
    },
  });

  return {
    originals,
    seedArtistIds,
    recommendations: { rec1, rec2, rec3, rec4, rec5, rec6, alt1 },
    artists: {
      portishead: artistPortishead,
      unkle: artistUnkle,
      bjork: artistBjork,
      mulatu: artistMulatu,
      beck: artistBeck,
      atoms: artistAtoms,
    },
    responses: {
      batch1: batch1Response,
      batch2: batch2Response,
      batch3Combined: batch3CombinedResponse,
      alternatives: alternativesResponse,
      emptyOriginals: emptyOriginalsResponse,
    },
  };
}
