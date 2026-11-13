import type { ExcludedVersion, RecommendationResponse, Song } from "./musicbrainz-types";
import { canonicalId, canonicalSong, validateExplorationResponse } from "./recommendation-exploration-validation";

export const EXPLORATION_CAP = 200;
export const SELECTION_CAP = 10;
export type ExplorationSong = { song: Song; artistId: string | null; batchId: string | null };
export type ExplorationRequest = { kind: "start" | "expand" | "alternatives"; seeds: Song[]; excludeArtists: string[]; excludeRecordings: string[]; excludeVersions: ExcludedVersion[]; limit: number };
export type ExplorationBatch = { id: string; inputs: Song[]; originBatchIds: string[]; newSongIds: string[]; response: RecommendationResponse; requestId?: string };
export type ExplorationAttempt = { request: ExplorationRequest; response?: RecommendationResponse; error?: string };
export type ExplorationState = { id: string | null; revision: number; originals: Song[]; songsById: Record<string, ExplorationSong>; batches: ExplorationBatch[]; selectedIds: string[]; focusedBatchId: string | null; pending: ExplorationRequest | null; lastAttempt: ExplorationAttempt | null };
export const initialExplorationState = (): ExplorationState => ({ id: null, revision: 0, originals: [], songsById: {}, batches: [], selectedIds: [], focusedBatchId: null, pending: null, lastAttempt: null });
export type ExplorationAction =
  | { type: "begin"; request: ExplorationRequest }
  | { type: "complete"; request: ExplorationRequest; response: RecommendationResponse; id: string; batchId: string }
  | { type: "failure"; request: ExplorationRequest; error: string; id: string }
  | { type: "select"; id: string; selected: boolean }
  | { type: "focus"; id: string | null }
  | { type: "cancel" } | { type: "reset" };

function initialFrom(request: ExplorationRequest, id: string, previous: ExplorationState): ExplorationState {
  const originals = request.seeds.map((s) => Object.freeze({ ...s }));
  Object.freeze(originals);
  return { ...initialExplorationState(), revision: previous.revision, id, originals, songsById: Object.fromEntries(originals.map((s) => [s.id, { song: s, artistId: null, batchId: null }])) };
}
export function explorationReducer(state: ExplorationState, action: ExplorationAction): ExplorationState {
  switch (action.type) {
    case "begin": return { ...state, pending: action.request, lastAttempt: null };
    case "cancel": return { ...state, pending: null, revision: state.revision + 1 };
    case "reset": return { ...initialExplorationState(), revision: state.revision + 1 };
    case "focus": return action.id === null || state.batches.some((b) => b.id === action.id) ? { ...state, focusedBatchId: action.id } : state;
    case "select": {
      if (state.pending || !state.songsById[action.id]?.batchId) return state;
      const selected = state.selectedIds.includes(action.id);
      if (selected === action.selected || (action.selected && state.selectedIds.length >= SELECTION_CAP)) return state;
      return { ...state, selectedIds: action.selected ? [...state.selectedIds, action.id] : state.selectedIds.filter((id) => id !== action.id) };
    }
    case "failure": {
      const base = action.request.kind === "start" && !state.batches.length ? initialFrom(action.request, action.id, state) : state;
      return { ...base, pending: null, lastAttempt: { request: action.request, error: action.error } };
    }
    case "complete": {
      let base = action.request.kind === "start" && (!state.batches.length || action.response.recommendations.length > 0) ? initialFrom(action.request, action.id, state) : state;
      const lastAttempt = { request: action.request, response: action.response };
      const songsById = { ...base.songsById };
      for (const result of action.response.seedResults) if (songsById[result.seedId] && result.artistId) songsById[result.seedId] = { ...songsById[result.seedId], artistId: result.artistId };
      if (!action.response.recommendations.length) return { ...base, songsById, pending: null, lastAttempt };
      for (const rec of action.response.recommendations) songsById[rec.song.id] = { song: rec.song, artistId: rec.artistId, batchId: action.batchId };
      const originBatchIds = [...new Set(action.request.seeds.map((s) => base.songsById[s.id]?.batchId).filter((id): id is string => !!id))];
      const batch: ExplorationBatch = { id: action.batchId, inputs: action.request.seeds, originBatchIds, newSongIds: action.response.recommendations.map((rec) => rec.song.id), response: action.response, requestId: action.response.requestId };
      base = { ...base, songsById, batches: [...base.batches, batch], focusedBatchId: null, selectedIds: [], pending: null, lastAttempt };
      return base;
    }
  }
}

export function remainingCapacity(state: ExplorationState) { return Math.max(0, EXPLORATION_CAP - Object.keys(state.songsById).length); }
export function selectedSongs(state: ExplorationState): ExplorationSong[] { return state.selectedIds.map((id) => state.songsById[id]).filter(Boolean); }
export type ExplorationTransport = (request: ExplorationRequest, signal: AbortSignal) => Promise<unknown>;
export async function fetchExploration(request: ExplorationRequest, signal: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ seeds: request.seeds.map((s) => s.id), excludeArtists: request.excludeArtists, excludeRecordings: request.excludeRecordings, excludeVersions: request.excludeVersions, limit: request.limit }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "No se pudieron generar recomendaciones.");
  return body;
}

function freezeRequest(request: ExplorationRequest): ExplorationRequest {
  request.seeds.forEach(Object.freeze);
  request.excludeVersions.forEach(Object.freeze);
  Object.freeze(request.seeds); Object.freeze(request.excludeArtists); Object.freeze(request.excludeRecordings); Object.freeze(request.excludeVersions);
  return Object.freeze(request);
}

/** A per-provider coordinator; no browser or server global state. */
export class ExplorationCoordinator {
  private state = initialExplorationState();
  private listeners = new Set<() => void>();
  private active: { controller: AbortController; revision: number; scope: string } | null = null;
  private serial = 0;
  private mounted = true;
  constructor(private readonly scope: string, private readonly transport: ExplorationTransport = fetchExploration) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private dispatch(action: ExplorationAction) { this.state = explorationReducer(this.state, action); this.listeners.forEach((listener) => listener()); }
  activate = () => { this.mounted = true; };
  dispose = () => {
    this.mounted = false;
    if (this.active) {
      this.active.controller.abort();
      this.active = null;
      // Clear the pending snapshot silently during unmount; React may reactivate this instance.
      this.state = explorationReducer(this.state, { type: "cancel" });
    }
  };
  cancel = () => { this.active?.controller.abort(); this.active = null; this.dispatch({ type: "cancel" }); };
  reset = () => { this.active?.controller.abort(); this.active = null; this.dispatch({ type: "reset" }); };
  select = (id: string, selected: boolean) => { try { this.dispatch({ type: "select", id: canonicalId(id), selected }); } catch { /* Invalid selection is ignored. */ } };
  focus = (id: string | null) => this.dispatch({ type: "focus", id });
  start = (songs: Song[]) => this.run("start", songs);
  expand = () => this.run("expand");
  alternatives = () => this.run("alternatives");
  private async run(kind: ExplorationRequest["kind"], songs?: Song[]): Promise<boolean> {
    if (!this.mounted || this.scope === "loading" || this.active) return false;
    let seeds: Song[];
    try { seeds = (kind === "start" ? (songs ?? []).slice(0, 10) : kind === "expand" ? selectedSongs(this.state).map((entry) => entry.song) : this.state.originals).map(canonicalSong); } catch { return false; }
    if (!seeds.length || seeds.length > 10 || new Set(seeds.map((s) => s.id)).size !== seeds.length || (kind !== "start" && !this.state.id)) return false;
    const entries = kind === "start" ? seeds.map((s) => ({ song: s, artistId: null, batchId: null })) : Object.values(this.state.songsById);
    const remaining = EXPLORATION_CAP - entries.length;
    if (remaining <= 0) return false;
    const request: ExplorationRequest = freezeRequest({ kind, seeds: seeds.map((s) => ({ ...s })), excludeArtists: kind === "alternatives" ? [...new Set(entries.filter((entry) => entry.batchId && entry.artistId).map((entry) => entry.artistId!))] : [], excludeRecordings: entries.map((entry) => entry.song.id), excludeVersions: entries.filter((entry) => entry.artistId && entry.song.title.trim()).map((entry) => ({ artistId: entry.artistId!, title: entry.song.title })), limit: Math.min(10, remaining) });
    const current = { controller: new AbortController(), revision: this.state.revision, scope: this.scope };
    this.active = current;
    const id = `exploration-${++this.serial}`;
    this.dispatch({ type: "begin", request });
    const valid = () => this.mounted && this.active === current && !current.controller.signal.aborted && this.state.revision === current.revision && this.scope === current.scope;
    try {
      const data = await this.transport(request, current.controller.signal);
      if (!valid()) return false;
      const response = validateExplorationResponse(data, request);
      if (this.scope.startsWith("user:") && (!response.requestId || response.recommendations.some((rec) => !rec.resultId))) throw new Error("Faltan los identificadores de la tanda para tu cuenta.");
      if (!valid()) return false;
      this.active = null;
      this.dispatch({ type: "complete", request, response, id, batchId: `batch-${++this.serial}` });
      return true;
    } catch (failure) {
      if (!valid()) return false;
      this.active = null;
      this.dispatch({ type: "failure", request, id, error: failure instanceof Error ? failure.message : "No se pudieron generar recomendaciones." });
      return false;
    }
  }
}
