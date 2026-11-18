import type { RecommendationResponse, Song } from "./musicbrainz-types";
import type { ExplorationRequest } from "./recommendation-exploration";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function canonicalId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("Identificador de canción o artista inválido.");
  return value.toLowerCase();
}
// JSON fields remain dynamically typed until the checks below validate each field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v); // Runtime boundary for untrusted JSON.
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
const unique = (a: string[]) => new Set(a).size === a.length;
const same = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
const validSignals = new Set(["songs", "versions", "listeners", "collab"]);
const graphId = (id: string) => {
  const parts = id.split(":");
  const count = parts[0] === "artist" ? 3 : 1;
  for (let i = 1; i <= count && i < parts.length; i++) if (uuid.test(parts[i])) parts[i] = parts[i].toLowerCase();
  return parts.join(":");
};
function song(value: unknown): Song {
  if (!object(value) || typeof value.title !== "string" || !value.title.trim() || typeof value.artist !== "string" || !value.artist.trim() || !(value.release === null || typeof value.release === "string") || !(value.comment === null || typeof value.comment === "string") || !(value.duration === null || (typeof value.duration === "number" && Number.isFinite(value.duration)))) throw new Error("Canción inválida.");
  return { id: canonicalId(value.id), title: value.title, artist: value.artist, release: value.release, comment: value.comment, duration: value.duration };
}
export function canonicalSong(value: unknown): Song { return song(value); }

/** Validates and canonicalizes an entire response before it can affect the exploration. */
export function validateExplorationResponse(input: unknown, request: ExplorationRequest): RecommendationResponse {
  const fail = (): never => { throw new Error("La respuesta de recomendaciones es incompleta o inconsistente."); };
  if (!object(input) || !strings(input.seedTags) || !Array.isArray(input.recommendations) || input.recommendations.length > request.limit || !Array.isArray(input.seedResults) || !object(input.graph) || !Array.isArray(input.graph.nodes) || !Array.isArray(input.graph.edges)) return fail();
  const seeds = request.seeds.map((s) => s.id);
  const excluded = new Set(request.excludeRecordings);
  const recIds: string[] = [];
  const expectedNodes = new Map<string, string>();
  const expectedEdges = new Set<string>();
  const edge = (from: string, to: string) => expectedEdges.add(JSON.stringify([from, to]));
  seeds.forEach((id) => expectedNodes.set(`seed:${id}`, "seed"));
  const recommendations = input.recommendations.map((r: unknown) => {
    if (!object(r) || !Array.isArray(r.reasons) || !r.reasons.length || !strings(r.seedIds) || !strings(r.sharedTags) || !strings(r.signals) || !r.signals.every((x: string) => validSignals.has(x)) || typeof r.score !== "number" || !Number.isFinite(r.score)) return fail();
    const item = song(r.song); const artistId = canonicalId(r.artistId);
    if (excluded.has(item.id) || request.excludeArtists.includes(artistId) || seeds.includes(item.id) || recIds.includes(item.id)) return fail();
    recIds.push(item.id);
    const seedIds = r.seedIds.map(canonicalId);
    const reasons = r.reasons.map((reason: unknown) => {
      if (!object(reason) || typeof reason.score !== "number" || !Number.isFinite(reason.score) || !strings(reason.sharedTags) || !strings(reason.signals) || !reason.signals.every((x: string) => validSignals.has(x))) return fail();
      const seedId = canonicalId(reason.seedId);
      if (!seeds.includes(seedId)) return fail();
      const artistNode = `artist:${seedId}:${artistId}:${item.id}`;
      expectedNodes.set(`song:${item.id}`, "song"); expectedNodes.set(artistNode, "artist"); edge(artistNode, `song:${item.id}`);
      for (const tag of reason.sharedTags) { const node = `tag:${seedId}:${tag}`; expectedNodes.set(node, "tag"); edge(`seed:${seedId}`, node); edge(node, artistNode); }
      for (const signal of reason.signals) { const node = `signal:${seedId}:${signal}`; expectedNodes.set(node, "signal"); edge(`seed:${seedId}`, node); edge(node, artistNode); }
      return { seedId, score: reason.score, sharedTags: [...reason.sharedTags], signals: [...reason.signals] };
    });
    if (!same(seedIds, reasons.map((x: { seedId: string }) => x.seedId)) || reasons.some((reason: { sharedTags: string[]; signals: string[] }) => !reason.sharedTags.length && !reason.signals.length)) return fail();
    const tags = [...new Set<string>(reasons.flatMap((reason: { sharedTags: string[] }) => reason.sharedTags))];
    const signals = [...new Set<string>(reasons.flatMap((reason: { signals: string[] }) => reason.signals))];
    if (!same(r.sharedTags, tags) || !same(r.signals, signals) || r.score !== Math.max(...reasons.map((reason: { score: number }) => reason.score))) return fail();
    return { song: item, artistId, seedIds, reasons, score: r.score, sharedTags: [...r.sharedTags], signals: [...r.signals], ...(r.resultId === undefined ? {} : { resultId: canonicalId(r.resultId) }) };
  });
  const statuses = new Set(["recommended", "no_candidates", "no_tracks", "limit", "search_limit", "unavailable"]);
  if (!unique(recommendations.flatMap((r) => r.resultId ? [r.resultId] : []))) return fail();
  const seedResults = input.seedResults.map((r: unknown) => {
    if (!object(r) || typeof r.title !== "string" || typeof r.artist !== "string" || typeof r.message !== "string" || !statuses.has(r.status) || !strings(r.recommendationIds) || !(r.searchLimited === undefined || typeof r.searchLimited === "boolean")) return fail();
    const seedId = canonicalId(r.seedId); const recommendationIds = r.recommendationIds.map(canonicalId);
    if (!seeds.includes(seedId) || !same(recommendationIds, recommendations.filter((rec: { seedIds: string[] }) => rec.seedIds.includes(seedId)).map((rec: { song: Song }) => rec.song.id)) || (r.status === "recommended") !== (recommendationIds.length > 0)) return fail();
    if (r.status !== "recommended") { expectedNodes.set(`status:${seedId}`, "status"); edge(`seed:${seedId}`, `status:${seedId}`); }
    return { seedId, title: r.title, artist: r.artist, status: r.status, message: r.message, recommendationIds, ...(r.artistId === undefined ? {} : { artistId: r.artistId === null ? null : canonicalId(r.artistId) }), ...(r.searchLimited === undefined ? {} : { searchLimited: r.searchLimited }) };
  });
  if (!same(seedResults.map((r: { seedId: string }) => r.seedId), seeds)) return fail();
  const nodes = input.graph.nodes.map((node: unknown) => {
    if (!object(node) || typeof node.id !== "string" || typeof node.label !== "string" || typeof node.type !== "string" || !(node.detail === undefined || typeof node.detail === "string") || !(node.score === undefined || (typeof node.score === "number" && Number.isFinite(node.score)))) return fail();
    const id = graphId(node.id); if (expectedNodes.get(id) !== node.type) return fail();
    return { ...node, id };
  });
  if (!unique(nodes.map((n: { id: string }) => n.id)) || nodes.length !== expectedNodes.size) return fail();
  const edges = input.graph.edges.map((e: unknown) => {
    if (!object(e) || typeof e.from !== "string" || typeof e.to !== "string") return fail();
    const from = graphId(e.from), to = graphId(e.to); if (!expectedEdges.has(JSON.stringify([from, to]))) return fail(); return { from, to };
  });
  if (!unique(edges.map((e: { from: string; to: string }) => JSON.stringify([e.from, e.to]))) || edges.length !== expectedEdges.size) return fail();
  return { seedTags: [...input.seedTags], recommendations, seedResults, graph: { nodes, edges }, ...(input.requestId === undefined ? {} : { requestId: canonicalId(input.requestId) }) } as RecommendationResponse;
}
