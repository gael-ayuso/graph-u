import type { ExplorationState } from "./recommendation-exploration";
import type { Recommendation, RecommendationReason, Song } from "./musicbrainz-types";

export type ExplorationGraphNode = {
  id: string;
  song: Song;
  depth: number;
  batchId: string | null;
  recommendation?: Recommendation;
};
export type ExplorationGraphEdge = {
  id: string;
  from: string;
  to: string;
  batchId: string;
  reason: RecommendationReason;
};
export type ExplorationGraph = { nodes: ExplorationGraphNode[]; edges: ExplorationGraphEdge[] };

/** Project only validated, chronological recommendation provenance; never infer edges. */
export function projectRecommendationGraph(state: Pick<ExplorationState, "originals" | "batches">): ExplorationGraph {
  const nodes = new Map<string, ExplorationGraphNode>();
  const edges: ExplorationGraphEdge[] = [];
  const batchIds = new Set<string>();
  const nodeId = (id: string) => `recording:${id}`;
  const fail = (): never => { throw new Error("Historial de exploración inválido"); };
  for (const song of state.originals) {
    if (!song.id || nodes.has(song.id)) fail();
    nodes.set(song.id, { id: nodeId(song.id), song, depth: 0, batchId: null });
  }
  for (const batch of state.batches) {
    if (!batch.id || batchIds.has(batch.id) || !batch.inputs.length || !batch.response.recommendations.length) fail();
    batchIds.add(batch.id);
    const inputs = new Set<string>();
    for (const song of batch.inputs) {
      if (inputs.has(song.id) || !nodes.has(song.id)) fail();
      inputs.add(song.id);
    }
    const recs = batch.response.recommendations;
    const newIds = new Set(batch.newSongIds);
    if (newIds.size !== batch.newSongIds.length || newIds.size !== recs.length) fail();
    // Build the entire batch only after checking all inputs existed before this batch.
    const additions: ExplorationGraphNode[] = [];
    for (const recommendation of recs) {
      const id = recommendation.song.id;
      if (!id || nodes.has(id) || !newIds.has(id) || additions.some((node) => node.song.id === id) || !recommendation.reasons.length) fail();
      const reasons = new Set<string>();
      let depth = 0;
      for (const reason of recommendation.reasons) {
        const origin = nodes.get(reason.seedId);
        if (!origin || !inputs.has(reason.seedId) || reasons.has(reason.seedId)) fail();
        reasons.add(reason.seedId);
        depth = Math.max(depth, origin!.depth + 1);
        edges.push({ id: `${batch.id}:${reason.seedId}:${id}`, from: origin!.id, to: nodeId(id), batchId: batch.id, reason });
      }
      additions.push({ id: nodeId(id), song: recommendation.song, depth, batchId: batch.id, recommendation });
    }
    for (const node of additions) nodes.set(node.song.id, node);
  }
  return { nodes: [...nodes.values()], edges };
}
