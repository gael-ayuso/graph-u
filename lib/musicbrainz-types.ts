export type Song = {
  id: string;
  title: string;
  artist: string;
  release: string | null;
  duration: number | null;
  comment: string | null;
};

export type Recommendation = {
  resultId?: string;
  song: Song;
  score: number;
  sharedTags: string[];
  /** Otras señales: canción o artista similar en Last.fm, o colaboraciones. */
  signals: ("songs" | "versions" | "listeners" | "collab")[];
  artistId: string;
  seedIds: string[];
  reasons: RecommendationReason[];
};

export type RecommendationReason = {
  seedId: string;
  score: number;
  sharedTags: string[];
  signals: Recommendation["signals"];
};

export type ExcludedVersion = { artistId: string; title: string };

export type RecommendationOptions = {
  limit?: number;
  excludeRecordings?: string[];
  excludeVersions?: ExcludedVersion[];
};

export type SeedResult = {
  artistId?: string | null;
  searchLimited?: boolean;
  seedId: string;
  title: string;
  artist: string;
  status: "recommended" | "no_candidates" | "no_tracks" | "limit" | "search_limit" | "unavailable";
  message: string;
  recommendationIds: string[];
};

export type GraphNode = {
  id: string;
  type: "seed" | "tag" | "signal" | "artist" | "song" | "status";
  label: string;
  detail?: string;
  score?: number;
  degree?: number; // conexiones del nodo (NetworkX)
};

export type RecommendationGraph = {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
};

export type RecommendationResponse = {
  requestId?: string;
  seedTags: string[];
  recommendations: Recommendation[];
  seedResults: SeedResult[];
  graph: RecommendationGraph;
};
