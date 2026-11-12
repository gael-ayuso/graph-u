export type Song = {
  id: string;
  title: string;
  artist: string;
  release: string | null;
  duration: number | null;
  comment: string | null;
};

export type Recommendation = {
  song: Song;
  score: number;
  sharedTags: string[];
  /** Otras señales: canción o artista similar en Last.fm, o colaboraciones. */
  signals: ("songs" | "listeners" | "collab")[];
  artistId: string;
};

export type GraphNode = {
  id: string;
  type: "seed" | "tag" | "signal" | "artist" | "song";
  label: string;
  detail?: string;
  score?: number;
};

export type RecommendationGraph = {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
};

export type RecommendationResponse = {
  seedTags: string[];
  recommendations: Recommendation[];
  graph: RecommendationGraph;
};
