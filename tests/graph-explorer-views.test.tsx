import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DataSet } from "vis-data";
import {
  clickButton,
  createMemoryStorage,
  createWindowEventMock,
  findByRole,
  findButtons,
  findHostNodes,
  getTextContent,
  jsonResponse,
  reactTestRuntime,
  type HostNode,
  type VElement,
} from "./helpers/recommendation-library-harness";
import {
  buildExplorationResponse,
  createMultiBatchFixtures,
  makeSongs,
  makeUuid,
} from "./fixtures/recommendation-exploration";

const { useAuthMock, projectSpy, actualProject } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  projectSpy: vi.fn(),
  actualProject: {
    current: null as null | ((state: { originals: never[]; batches: never[] }) => unknown),
  },
}));

vi.mock("react", async () => {
  const { reactTestRuntime: runtime } = await import("./helpers/recommendation-library-harness");
  return {
    ...runtime.reactMock,
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useSyncExternalStore: (subscribe: (cb: () => void) => () => void, snapshot: () => unknown) => {
      const [, update] = runtime.reactMock.useState(0);
      runtime.reactMock.useEffect(() => subscribe(() => update((value) => value + 1)), [subscribe]);
      return snapshot();
    },
  };
});
vi.mock("react/jsx-runtime", async () => (await import("./helpers/recommendation-library-harness")).reactTestRuntime.jsxRuntimeMock);
vi.mock("react/jsx-dev-runtime", async () => (await import("./helpers/recommendation-library-harness")).reactTestRuntime.jsxRuntimeMock);
vi.mock("next/link", async () => {
  const { jsxElement } = await import("./helpers/recommendation-library-harness");
  return { default: (props: Record<string, unknown>) => jsxElement("a", props) };
});
vi.mock("next/dynamic", async () => {
  const { jsxElement } = await import("./helpers/recommendation-library-harness");
  return { default: () => (props: Record<string, unknown>) => jsxElement("mock-graph", props) };
});
vi.mock("@clerk/nextjs", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/recommendation-graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/recommendation-graph")>();
  actualProject.current = actual.projectRecommendationGraph as typeof actualProject.current;
  projectSpy.mockImplementation(actual.projectRecommendationGraph);
  return {
    ...actual,
    projectRecommendationGraph: (...args: Parameters<typeof actual.projectRecommendationGraph>) =>
      projectSpy(...args),
  };
});

import { GraphExplorer } from "@/components/graph-explorer";
import { RecommendationExplorationProvider } from "@/components/recommendation-exploration-provider";
import { RecommendationLibraryProvider } from "@/components/recommendation-library";
import { writeSongs } from "@/lib/saved-song-list";

type MockGraphProps = {
  graph: {
    nodes: { id: string; label?: string; level?: number; opacity?: number }[];
    edges: { id: string; from: string; to: string; width?: number; color?: { color?: string; opacity?: number } }[];
  };
  options: { physics?: boolean | { enabled?: boolean }; layout?: { hierarchical?: unknown } };
  events: { select?: (payload: { nodes: string[] }) => void };
  getNetwork?: (network: unknown) => void;
};

const tree = () => reactTestRuntime.getTree();
const text = () => getTextContent(tree());
const button = (label: string, scope: HostNode = tree()) => {
  const found = findButtons(scope, label);
  expect(found, `button ${label}`).toHaveLength(1);
  return found[0];
};
function graphHost(): HostNode {
  const found = findHostNodes(tree(), (node) => node.tag === "mock-graph");
  expect(found).toHaveLength(1);
  return found[0];
}
function graphProps(): MockGraphProps {
  return graphHost().props as unknown as MockGraphProps;
}
function graphActionsSection(): HostNode {
  const found = findHostNodes(tree(), (node) => node.tag === "section" && node.props.className === "graph-song-actions");
  expect(found).toHaveLength(1);
  return found[0];
}
function batchCheckbox(title: string): HostNode {
  const label = findHostNodes(tree(), (node) => node.tag === "label" && getTextContent(node).includes(`: ${title},`));
  expect(label).toHaveLength(1);
  const boxes = findHostNodes(label[0], (node) => node.tag === "input" && node.props.type === "checkbox");
  expect(boxes).toHaveLength(1);
  return boxes[0];
}
async function chooseInBatch(title: string, checked: boolean) {
  const input = batchCheckbox(title);
  expect(input.props.disabled).toBe(false);
  (input.props.onChange as (event: unknown) => void)({ target: { checked } });
  await reactTestRuntime.flush();
}
async function selectGraphNode(nodeId: string) {
  graphProps().events.select?.({ nodes: [nodeId] });
  await reactTestRuntime.flush();
}
async function focusBatchValue(value: string) {
  const selector = findHostNodes(tree(), (node) => node.tag === "select" && node.props.id === "focused-batch")[0];
  expect(selector).toBeDefined();
  (selector.props.onChange as (event: unknown) => void)({ target: { value } });
  await reactTestRuntime.flush();
}
function GraphApp() {
  return (
    <RecommendationLibraryProvider>
      <RecommendationExplorationProvider>
        <GraphExplorer />
      </RecommendationExplorationProvider>
    </RecommendationLibraryProvider>
  );
}
async function mount(node: ReactNode) {
  await reactTestRuntime.mount(node as unknown as VElement);
}

describe("T5 GraphExplorer cumulative and batch-detail views", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let reducedMotionMatches = false;

  beforeEach(() => {
    projectSpy.mockImplementation((state: { originals: never[]; batches: never[] }) =>
      actualProject.current!(state),
    );
    reducedMotionMatches = false;
    fetchMock = vi.fn();
    const { storage } = createMemoryStorage();
    const windowMock = createWindowEventMock();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal(
      "window",
      Object.assign(windowMock.window, {
        localStorage: storage,
        dispatchEvent: vi.fn(),
        matchMedia: () => ({
          matches: reducedMotionMatches,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-a" });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("switches between cumulative summary (topological levels) and isolated batch detail without firing POST requests", async () => {
    const fixtures = createMultiBatchFixtures("user");
    writeSongs(fixtures.originals);
    const recommendationPosts: { seeds: string[] }[] = [];

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") return Promise.resolve(jsonResponse({ songs: [] }));
      if (url === "/api/recommendations") {
        recommendationPosts.push(JSON.parse(String(init?.body)));
        if (recommendationPosts.length === 1) return Promise.resolve(jsonResponse(fixtures.responses.batch1));
        if (recommendationPosts.length === 2) return Promise.resolve(jsonResponse(fixtures.responses.batch2));
        return Promise.resolve(jsonResponse(fixtures.responses.batch3Combined));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await mount(<GraphApp />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await chooseInBatch("Glory Box", true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    await chooseInBatch("Angel", true);
    await chooseInBatch("Tezeta", true);
    clickButton(button("Ampliar con 2 canciones"));
    await reactTestRuntime.flush();
    expect(recommendationPosts).toHaveLength(3);

    // A successful expansion shows the cumulative graph; detail is explicitly selected.
    expect(findHostNodes(tree(), (n) => n.props.id === "graph-title").map(getTextContent)).toEqual(["Exploración completa"]);
    const batchSelector = findHostNodes(tree(), (n) => n.tag === "select" && n.props.id === "focused-batch")[0];
    const batch3Option = findHostNodes(batchSelector, (n) => n.tag === "option")[3];
    await focusBatchValue(String(batch3Option.props.value));
    expect(findHostNodes(tree(), (n) => n.props.id === "graph-title").map(getTextContent)).toEqual(["Detalle de tanda"]);
    const batch3DetailIds = graphProps().graph.nodes.map((n) => n.id);
    expect(batch3DetailIds).toContain(`seed:${fixtures.recommendations.rec2.id}`);
    expect(batch3DetailIds).toContain(`seed:${fixtures.recommendations.rec5.id}`);
    expect(batch3DetailIds).toContain(`song:${fixtures.recommendations.rec6.id}`);
    expect(batch3DetailIds.some((id) => id.startsWith("tag:"))).toBe(true);
    // Batch 1's intermediate tag/seed nodes must not leak into Batch 3's detail graph.
    expect(batch3DetailIds).not.toContain(`seed:${fixtures.originals[0].id}`);

    // Clicking the recommended song node in Batch 3 detail surfaces both origins & connected tags/signals in footnote.
    await selectGraphNode(`song:${fixtures.recommendations.rec6.id}`);
    expect(getTextContent(graphActionsSection())).toContain("A partir de: Angel · Unkle, Tezeta · Mulatu Astatke");
    expect(text()).toContain("Paper Tiger · Beck · 86% parecido · conectado por");

    // Select a song to verify selection survives all mode/focus transitions.
    await chooseInBatch("Paper Tiger", true);

    // Switch to "Todas las tandas · Exploración completa" -> no POST.
    await focusBatchValue("");
    expect(recommendationPosts).toHaveLength(3);
    expect(findHostNodes(tree(), (n) => n.props.id === "graph-title").map(getTextContent)).toEqual(["Exploración completa"]);

    const summaryGraph = graphProps().graph;
    expect(summaryGraph.nodes).toHaveLength(8);
    expect(summaryGraph.nodes.every((n) => n.id.startsWith("recording:"))).toBe(true);
    expect(summaryGraph.nodes.some((n) => n.id.startsWith("tag:") || n.id.startsWith("signal:") || n.id.startsWith("artist:") || n.id.startsWith("status:"))).toBe(false);
    // Ensure resultIds are never used as node or edge IDs in the summary graph.
    const allResultIds = [
      ...fixtures.responses.batch1.recommendations,
      ...fixtures.responses.batch2.recommendations,
      ...fixtures.responses.batch3Combined.recommendations,
    ].map((r) => r.resultId!);
    for (const rid of allResultIds) {
      expect(summaryGraph.nodes.some((n) => n.id.includes(rid))).toBe(false);
      expect(summaryGraph.edges.some((e) => e.id.includes(rid))).toBe(false);
    }

    // Switch to "Por niveles" -> topological depth drives node levels, no POST.
    clickButton(button("Por niveles"));
    await reactTestRuntime.flush();
    expect(recommendationPosts).toHaveLength(3);
    expect(button("Por niveles").props["aria-pressed"]).toBe(true);
    expect(button("Libre").props["aria-pressed"]).toBe(false);
    expect(findButtons(tree(), "Pausar movimiento")).toHaveLength(0);
    expect(text()).toContain("Conexiones de izquierda a derecha, sin repulsión.");

    const levels = new Map(graphProps().graph.nodes.map((n) => [n.id, n.level]));
    expect(levels.get(`recording:${fixtures.originals[0].id}`)).toBe(0);
    expect(levels.get(`recording:${fixtures.originals[1].id}`)).toBe(0);
    expect(levels.get(`recording:${fixtures.recommendations.rec1.id}`)).toBe(1);
    expect(levels.get(`recording:${fixtures.recommendations.rec2.id}`)).toBe(1);
    expect(levels.get(`recording:${fixtures.recommendations.rec4.id}`)).toBe(2);
    expect(levels.get(`recording:${fixtures.recommendations.rec5.id}`)).toBe(2);
    expect(levels.get(`recording:${fixtures.recommendations.rec6.id}`)).toBe(3);

    // Highlight only real ancestors/descendants in the cumulative projection.
    await selectGraphNode(`recording:${fixtures.recommendations.rec4.id}`);
    const summaryHighlight = graphProps().graph;
    expect(summaryHighlight.nodes.find((n) => n.id === `recording:${fixtures.originals[1].id}`)?.opacity).toBe(1);
    expect(summaryHighlight.nodes.find((n) => n.id === `recording:${fixtures.originals[0].id}`)?.opacity).toBe(0.2);
    expect(summaryHighlight.edges.find((e) => e.from === `recording:${fixtures.recommendations.rec1.id}` && e.to === `recording:${fixtures.recommendations.rec4.id}`)?.color?.opacity).toBe(1);
    expect(summaryHighlight.edges.find((e) => e.from === `recording:${fixtures.originals[0].id}`)?.color?.opacity).toBe(0.15);

    // Focus Batch 1 via selector -> isolated Batch 1 detail with type-based levels (seed=0, tag/signal=1, artist=2, song=3).
    const selector = findHostNodes(tree(), (n) => n.tag === "select" && n.props.id === "focused-batch")[0];
    const batch1Option = findHostNodes(selector, (n) => n.tag === "option")[1];
    await focusBatchValue(String(batch1Option.props.value));
    expect(recommendationPosts).toHaveLength(3);
    expect(findHostNodes(tree(), (n) => n.props.id === "graph-title").map(getTextContent)).toEqual(["Detalle de tanda"]);
    expect(text()).toContain("Tanda 1. Entradas: Reckoner · Radiohead, Teardrop · Massive Attack.");
    const b1Nodes = graphProps().graph.nodes;
    expect(b1Nodes.find((n) => n.id === `seed:${fixtures.originals[0].id}`)?.level).toBe(0);
    expect(b1Nodes.find((n) => n.id.startsWith("tag:"))?.level).toBe(1);
    expect(b1Nodes.find((n) => n.id.startsWith("artist:"))?.level).toBe(2);
    expect(b1Nodes.find((n) => n.id === `song:${fixtures.recommendations.rec1.id}`)?.level).toBe(3);

    // In detail, selecting one song does not highlight another branch of the same batch.
    await selectGraphNode(`song:${fixtures.recommendations.rec1.id}`);
    const detailHighlight = graphProps().graph;
    expect(detailHighlight.nodes.find((n) => n.id === `seed:${fixtures.originals[1].id}`)?.opacity).toBe(1);
    expect(detailHighlight.nodes.find((n) => n.id === `seed:${fixtures.originals[0].id}`)?.opacity).toBe(0.2);
    expect(detailHighlight.nodes.find((n) => n.id === `song:${fixtures.recommendations.rec2.id}`)?.opacity).toBe(0.2);
    expect(detailHighlight.edges.find((e) => e.to === `song:${fixtures.recommendations.rec1.id}`)?.color?.opacity).toBe(1);
    expect(detailHighlight.edges.find((e) => e.to === `song:${fixtures.recommendations.rec2.id}`)?.color?.opacity).toBe(0.15);

    // Focus Batch 2 via its detail link -> still no POST and selection kept.
    const batchLinks = findHostNodes(tree(), (n) => n.tag === "a" && getTextContent(n) === "Ver detalle de esta tanda");
    expect(batchLinks).toHaveLength(3);
    (batchLinks[1].props.onClick as () => void)();
    await reactTestRuntime.flush();
    expect(recommendationPosts).toHaveLength(3);
    expect(text()).toContain("Tanda 2. Entradas: Glory Box · Portishead.");
    expect(batchCheckbox("Paper Tiger").props.checked).toBe(true);
    expect(findButtons(tree(), "Ampliar con 1 canción")).toHaveLength(1);
  });

  it.each(["free", "hierarchical"] as const)(
    "restores persistent DataSet styles across selections in summary and detail (%s)",
    async (view) => {
      const fixtures = createMultiBatchFixtures("user");
      writeSongs(fixtures.originals);
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/me/saved-recommendations") return Promise.resolve(jsonResponse({ songs: [] }));
        if (url === "/api/recommendations") return Promise.resolve(jsonResponse(fixtures.responses.batch1));
        throw new Error(`Unexpected fetch: ${url}`);
      });
      await mount(<GraphApp />);
      clickButton(button("Iniciar desde Mi lista"));
      await reactTestRuntime.flush();
      if (view === "hierarchical") {
        clickButton(button("Por niveles"));
        await reactTestRuntime.flush();
      }

      async function checkTransitions(first: string, second: string) {
        const initial = graphProps().graph;
        const nodes = new DataSet(initial.nodes);
        const edges = new DataSet(initial.edges);
        const initialNodes = new Map(nodes.get().map((node) => [node.id, node.opacity]));
        const initialEdges = new Map(edges.get().map((edge) => [edge.id, { width: edge.width, color: edge.color }]));
        const applyUpdate = () => {
          const next = graphProps().graph;
          // Like the wrapper, keep the same DataSets and merge the next objects by id.
          nodes.update(next.nodes);
          edges.update(next.edges);
        };
        expect(nodes.get(second)?.opacity).toBe(1);
        await selectGraphNode(first);
        expect(getTextContent(graphActionsSection())).toContain("Glory Box");
        applyUpdate();
        expect(nodes.get(second)?.opacity).toBe(0.2);
        expect(edges.get().some((edge) => edge.width === 2 && edge.color?.opacity === 1)).toBe(true);
        expect(edges.get().some((edge) => edge.width === 1 && edge.color?.opacity === 0.15)).toBe(true);

        await selectGraphNode(second);
        applyUpdate();
        expect(nodes.get(second)?.opacity).toBe(1);
        // DataSet retains merged attributes; it must match every emitted selection style.
        for (const edge of graphProps().graph.edges) {
          expect(edges.get(edge.id)).toMatchObject({ width: edge.width, color: edge.color });
        }

        graphProps().events.select?.({ nodes: [] });
        await reactTestRuntime.flush();
        applyUpdate();
        expect(new Set(nodes.getIds())).toEqual(new Set(initialNodes.keys()));
        expect(new Set(edges.getIds())).toEqual(new Set(initialEdges.keys()));
        for (const node of nodes.get()) expect(node.opacity).toBe(initialNodes.get(node.id));
        for (const edge of edges.get()) {
          expect({ width: edge.width, color: edge.color }).toEqual(initialEdges.get(edge.id));
          expect(edge.width).toBe(view === "free" ? 1.2 : 1);
          expect(edge.color?.opacity).toBe(view === "free" ? 0.35 : 1);
          expect(edge.color?.color).toBe(view === "free" ? "#ebdbb2" : "#665c54");
        }
      }

      await checkTransitions(`recording:${fixtures.recommendations.rec1.id}`, `recording:${fixtures.originals[0].id}`);
      const selector = findHostNodes(tree(), (n) => n.tag === "select" && n.props.id === "focused-batch")[0];
      const batch1 = findHostNodes(selector, (n) => n.tag === "option")[1];
      await focusBatchValue(String(batch1.props.value));
      await checkTransitions(`song:${fixtures.recommendations.rec1.id}`, `seed:${fixtures.originals[0].id}`);
    },
  );

  it("handles graph/dropdown selection, blocks expanding originals, and sends exact owner batch requestId/resultId on save/feedback", async () => {
    const fixtures = createMultiBatchFixtures("user");
    writeSongs(fixtures.originals);
    const recommendationPosts: unknown[] = [];
    const actionCalls: { url: string; body: Record<string, unknown> }[] = [];

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") return Promise.resolve(jsonResponse({ songs: [] }));
      if (url === "/api/recommendations") {
        recommendationPosts.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          jsonResponse(recommendationPosts.length === 1 ? fixtures.responses.batch1 : fixtures.responses.batch2),
        );
      }
      if (url.endsWith("/saved") || url.endsWith("/feedback")) {
        actionCalls.push({ url, body: JSON.parse(String(init?.body)) });
        return Promise.resolve(jsonResponse(url.endsWith("/saved") ? { saved: true } : { value: "LIKE" }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await mount(<GraphApp />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await chooseInBatch("Glory Box", true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();

    // The cumulative summary is the default after the second batch.
    await focusBatchValue("");

    // 1) Click rec2 (from Batch 1) directly on the summary graph.
    await selectGraphNode(`recording:${fixtures.recommendations.rec2.id}`);
    const actionsPanel1 = graphActionsSection();
    expect(getTextContent(actionsPanel1)).toContain("Angel");
    expect(getTextContent(actionsPanel1)).toContain("Tanda 1");
    expect(getTextContent(actionsPanel1)).toContain("A partir de: Teardrop · Massive Attack");

    // Toggle "Elegir para ampliar" from the graph panel -> updates shared selection state.
    const graphCheck = findHostNodes(actionsPanel1, (n) => n.tag === "input" && n.props.type === "checkbox")[0];
    (graphCheck.props.onChange as (e: unknown) => void)({ target: { checked: true } });
    await reactTestRuntime.flush();
    expect(batchCheckbox("Angel").props.checked).toBe(true);
    expect(findButtons(tree(), "Ampliar con 1 canción")).toHaveLength(1);

    // Save & Like rec2 -> must use Batch 1's requestId and rec2's resultId.
    clickButton(button("Guardar", graphActionsSection()));
    await reactTestRuntime.flush();
    clickButton(button("Me gusta", graphActionsSection()));
    await reactTestRuntime.flush();
    expect(actionCalls.slice(0, 2)).toEqual([
      {
        url: `/api/me/recommendations/${fixtures.responses.batch1.requestId}/saved`,
        body: { resultId: fixtures.responses.batch1.recommendations[1].resultId, saved: true },
      },
      {
        url: `/api/me/recommendations/${fixtures.responses.batch1.requestId}/feedback`,
        body: { resultId: fixtures.responses.batch1.recommendations[1].resultId, value: "LIKE" },
      },
    ]);

    // 2) Switch active song via accessible #graph-action-song select to rec5 (from Batch 2).
    const songSelect = findHostNodes(graphActionsSection(), (n) => n.tag === "select" && n.props.id === "graph-action-song")[0];
    (songSelect.props.onChange as (e: unknown) => void)({ target: { value: fixtures.recommendations.rec5.id } });
    await reactTestRuntime.flush();
    expect(getTextContent(graphActionsSection())).toContain("Tezeta");
    expect(getTextContent(graphActionsSection())).toContain("Tanda 2");
    expect(getTextContent(graphActionsSection())).toContain("A partir de: Glory Box · Portishead");

    clickButton(button("Guardar", graphActionsSection()));
    await reactTestRuntime.flush();
    expect(actionCalls[2]).toEqual({
      url: `/api/me/recommendations/${fixtures.responses.batch2.requestId}/saved`,
      body: { resultId: fixtures.responses.batch2.recommendations[1].resultId, saved: true },
    });

    // 3) Click an original song on the summary graph -> shows footnote, never offers expand checkbox/actions.
    await selectGraphNode(`recording:${fixtures.originals[0].id}`);
    expect(text()).toContain("Reckoner · Radiohead · canción inicial");
    const panelForOriginal = graphActionsSection();
    expect(findHostNodes(panelForOriginal, (n) => n.tag === "input" && n.props.type === "checkbox")).toHaveLength(0);
    expect(findButtons(panelForOriginal, "Guardar")).toHaveLength(0);

    // 4) Switch to Batch 2 detail and click seed:rec1 (originated in Batch 1) -> keeps Batch 1 requestId/resultId & preserves rec2 selection.
    const selector = findHostNodes(tree(), (n) => n.tag === "select" && n.props.id === "focused-batch")[0];
    const batch2Value = String(findHostNodes(selector, (n) => n.tag === "option")[2].props.value);
    await focusBatchValue(batch2Value);
    await selectGraphNode(`seed:${fixtures.recommendations.rec1.id}`);
    const seedPanel = graphActionsSection();
    expect(getTextContent(seedPanel)).toContain("Glory Box");
    expect(getTextContent(seedPanel)).toContain("Tanda 1");
    clickButton(button("Me gusta", seedPanel));
    await reactTestRuntime.flush();
    expect(actionCalls[3]).toEqual({
      url: `/api/me/recommendations/${fixtures.responses.batch1.requestId}/feedback`,
      body: { resultId: fixtures.responses.batch1.recommendations[0].resultId, value: "LIKE" },
    });
    expect(batchCheckbox("Angel").props.checked).toBe(true);
    expect(recommendationPosts).toHaveLength(2);
  });

  it("preserves summary graph and selection on failed/empty attempts, enforces reduced-motion and guardVisNetwork on centerGraph, and alerts on invalid history", async () => {
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    const guest = createMultiBatchFixtures("guest");
    writeSongs(guest.originals);
    let calls = 0;

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/recommendations");
      calls++;
      if (calls === 1) return Promise.resolve(jsonResponse(guest.responses.batch1));
      if (calls === 2) return Promise.resolve(jsonResponse({ error: "Backend caído" }, 503));
      return Promise.resolve(jsonResponse(guest.responses.emptyOriginals));
    });

    await mount(<GraphApp />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await chooseInBatch("Glory Box", true);
    const selector = findHostNodes(tree(), (n) => n.tag === "select" && n.props.id === "focused-batch")[0];
    const focusedId = String(findHostNodes(selector, (n) => n.tag === "option")[1].props.value);
    await focusBatchValue(focusedId);
    const nodesBeforeFailure = graphProps().graph.nodes.map((n) => n.id);
    const edgesBeforeFailure = graphProps().graph.edges.map((e) => e.id);

    // Failed alternatives() must not add nodes/edges or clear selection.
    clickButton(button("Otras desde las canciones iniciales"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Backend caído");
    expect(graphProps().graph.nodes.map((n) => n.id)).toEqual(nodesBeforeFailure);
    expect(graphProps().graph.edges.map((e) => e.id)).toEqual(edgesBeforeFailure);
    expect(batchCheckbox("Glory Box").props.checked).toBe(true);
    expect(findHostNodes(tree(), (n) => n.props.id === "focused-batch")[0].props.value).toBe(focusedId);

    // Empty alternatives() retry also leaves the focused detail intact.
    clickButton(button("Volver a intentar"));
    await reactTestRuntime.flush();
    expect(text()).toContain("No encontramos canciones nuevas en esta consulta.");
    expect(graphProps().graph.nodes.map((n) => n.id)).toEqual(nodesBeforeFailure);
    expect(graphProps().graph.edges.map((e) => e.id)).toEqual(edgesBeforeFailure);
    expect(batchCheckbox("Glory Box").props.checked).toBe(true);
    expect(findHostNodes(tree(), (n) => n.props.id === "focused-batch")[0].props.value).toBe(focusedId);

    // centerGraph respects guardVisNetwork when renderer is active vs destroyed.
    const fit = vi.fn();
    const network: { renderer?: object; redraw: () => void; setOptions: () => void; fit: () => void } = {
      renderer: {},
      redraw: vi.fn(),
      setOptions: vi.fn(),
      fit,
    };
    graphProps().getNetwork?.(network);
    clickButton(button("Centrar grafo"));
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledWith({ animation: false });
    delete network.renderer;
    expect(() => clickButton(button("Centrar grafo"))).not.toThrow();
    expect(fit).toHaveBeenCalledTimes(1);

    // Reduced-motion disables physics and disables the motion toggle.
    reducedMotionMatches = true;
    await focusBatchValue(String(findHostNodes(findHostNodes(tree(), (n) => n.props.id === "focused-batch")[0], (n) => n.tag === "option")[1].props.value));
    await focusBatchValue("");
    expect((graphProps().options.physics as { enabled: boolean }).enabled).toBe(false);
    expect(button("Activar movimiento").props.disabled).toBe(true);
    expect(text()).toContain("Movimiento reducido activo. Puedes mover cada nodo manualmente.");

    // Invalid history alert when projection throws.
    projectSpy.mockImplementationOnce(() => {
      throw new Error("Historial de exploración inválido");
    });
    clickButton(button("Por niveles"));
    await reactTestRuntime.flush();
    const alerts = findByRole(tree(), "alert").map(getTextContent);
    expect(alerts).toContain("No se puede mostrar el grafo: el historial de exploración contiene referencias inválidas.");
  });

  it("renders a 200-song summary exploration without intermediate nodes", async () => {
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    const originals = makeSongs(4, 1, 1);
    writeSongs(originals);

    const batchSizes = [10, ...Array.from({ length: 18 }, () => 10), 6]; // 4 + 196 = 200
    let nextIdx = 1;
    let currentSeeds = originals;
    const responses = batchSizes.map((size) => {
      const recs = makeSongs(size, nextIdx, 3);
      nextIdx += size;
      const resp = buildExplorationResponse({
        seeds: currentSeeds,
        recommendations: recs.map((song, offset) => ({
          song,
          artistId: makeUuid(4, nextIdx + offset),
          reasons: [{ seedId: currentSeeds[offset % currentSeeds.length].id, score: 0.85, sharedTags: ["ambient"], signals: ["songs"] }],
        })),
      });
      currentSeeds = [recs[0]];
      return resp;
    });

    let call = 0;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(responses[call++])));

    await mount(<GraphApp />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();

    for (let i = 1; i < batchSizes.length; i++) {
      const firstRecTitle = responses[i - 1].recommendations[0].song.title;
      await chooseInBatch(firstRecTitle, true);
      clickButton(button("Ampliar con 1 canción"));
      await reactTestRuntime.flush();
    }

    await focusBatchValue("");
    const summary = graphProps().graph;
    expect(summary.nodes).toHaveLength(200);
    expect(summary.edges).toHaveLength(196);
    expect(summary.nodes.every((n) => n.id.startsWith("recording:"))).toBe(true);
    const canvas = findHostNodes(tree(), (n) => n.props.className === "graph-canvas")[0];
    expect(canvas.props["aria-label"]).toBe("Grafo de la exploración completa con 200 canciones");
  });
});
