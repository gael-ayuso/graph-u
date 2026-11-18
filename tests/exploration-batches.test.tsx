import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { clickButton, createMemoryStorage, createWindowEventMock, deferred, findButtons, findHostNodes, getTextContent, jsonResponse, reactTestRuntime, type HostNode, type VElement } from "./helpers/recommendation-library-harness";
import { buildExplorationResponse, createMultiBatchFixtures, makeSong, makeUuid } from "./fixtures/recommendation-exploration";

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
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useAuth: useAuthMock }));

import { ExplorationBatches, ExplorationControls } from "@/components/exploration-batches";
import { GraphExplorer } from "@/components/graph-explorer";
import { RecommendationExplorationProvider } from "@/components/recommendation-exploration-provider";
import { RecommendationLibraryProvider } from "@/components/recommendation-library";

const fixtures = createMultiBatchFixtures("user");
const tree = () => reactTestRuntime.getTree();
const text = () => getTextContent(tree());
const button = (label: string) => {
  const found = findButtons(tree(), label);
  expect(found, `button ${label}`).toHaveLength(1);
  return found[0];
};
function checkbox(title: string): HostNode {
  const label = findHostNodes(tree(), (node) => node.tag === "label" && getTextContent(node).includes(`: ${title},`));
  expect(label).toHaveLength(1);
  const boxes = findHostNodes(label[0], (node) => node.tag === "input" && node.props.type === "checkbox");
  expect(boxes).toHaveLength(1);
  return boxes[0];
}
async function choose(title: string, checked: boolean) {
  const input = checkbox(title);
  expect(input.props.disabled).toBe(false);
  (input.props.onChange as (event: unknown) => void)({ target: { checked } });
  await reactTestRuntime.flush();
}
function Demo() { return <><ExplorationControls saved={fixtures.originals} /><ExplorationBatches /></>; }
function App({ screen }: { screen: "demo" | "graph" }) {
  return <RecommendationLibraryProvider><RecommendationExplorationProvider>{screen === "demo" ? <Demo /> : <GraphExplorer />}</RecommendationExplorationProvider></RecommendationLibraryProvider>;
}
async function mount(node: ReactNode) { await reactTestRuntime.mount(node as unknown as VElement); }
async function rerender(node: ReactNode) { await reactTestRuntime.rerender(node as unknown as VElement); }

describe("T4 shared exploration controls and batches", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    const windowMock = createWindowEventMock();
    vi.stubGlobal("window", Object.assign(windowMock.window, { matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) }));
    vi.stubGlobal("localStorage", createMemoryStorage().storage);
    vi.stubGlobal("fetch", fetchMock);
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-a" });
  });
  afterEach(() => { reactTestRuntime.unmount(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("shares pending state across screens, selects from different batches, and keeps each card's request context", async () => {
    const pending = deferred<Response>();
    const requests: { seeds: string[] }[] = [];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") return Promise.resolve(jsonResponse({ songs: [] }));
      if (url === "/api/recommendations") {
        requests.push(JSON.parse(String(init?.body)));
        return requests.length === 1 ? Promise.resolve(jsonResponse(fixtures.responses.batch1)) : requests.length === 2 ? pending.promise : Promise.resolve(jsonResponse(fixtures.responses.batch3Combined));
      }
      if (url.endsWith("/saved")) return Promise.resolve(jsonResponse({ saved: true }));
      if (url.endsWith("/feedback")) return Promise.resolve(jsonResponse({ value: "LIKE" }));
      throw new Error(`Unexpected fetch: ${url}`);
    });
    await mount(<App screen="demo" />);
    expect(requests).toHaveLength(0);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Tanda 1");
    await choose("Glory Box", true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Buscando recomendaciones");
    expect(checkbox("Glory Box").props.disabled).toBe(true);
    expect(button("Ampliar con 1 canción").props.disabled).toBe(true);
    await rerender(<App screen="graph" />);
    expect(requests).toHaveLength(2);
    expect(text()).toContain("Buscando recomendaciones");
    expect(text()).toContain("Glory Box");
    pending.resolve(jsonResponse(fixtures.responses.batch2));
    await reactTestRuntime.flush();
    expect(text()).toContain("Tanda 2");
    const graph = findHostNodes(tree(), (node) => node.tag === "mock-graph")[0];
    const graphData = graph.props.graph as { nodes: { id: string }[]; edges: { from: string; to: string }[] };
    expect(graphData.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      `recording:${fixtures.originals[1].id}`,
      `recording:${fixtures.recommendations.rec1.id}`,
      `recording:${fixtures.recommendations.rec5.id}`,
    ]));
    expect(graphData.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `recording:${fixtures.originals[1].id}`, to: `recording:${fixtures.recommendations.rec1.id}` }),
      expect.objectContaining({ from: `recording:${fixtures.recommendations.rec1.id}`, to: `recording:${fixtures.recommendations.rec5.id}` }),
    ]));
    await choose("Angel", true);
    const links = findHostNodes(tree(), (node) => node.tag === "a" && getTextContent(node) === "Ver detalle de esta tanda");
    expect(links).toHaveLength(2);
    expect(links[0].props.href).toBe("/explorar");
    (links[0].props.onClick as () => void)();
    await reactTestRuntime.flush();
    const focusedFirst = findHostNodes(tree(), (node) => node.tag === "mock-graph")[0].props.graph as { nodes: { id: string }[] };
    expect(focusedFirst.nodes.map((node) => node.id)).toContain(`seed:${fixtures.originals[0].id}`);
    expect(checkbox("Angel").props.checked).toBe(true);
    const globalLink = findHostNodes(tree(), (node) => node.tag === "a" && getTextContent(node) === "Ver todas las tandas en un solo grafo");
    expect(globalLink).toHaveLength(1);
    expect(globalLink[0].props.href).toBe("/explorar");
    (globalLink[0].props.onClick as () => void)();
    await reactTestRuntime.flush();
    expect(findHostNodes(tree(), (node) => node.tag === "mock-graph")[0].props.graph).toEqual(graphData);
    expect(checkbox("Angel").props.checked).toBe(true);
    const selector = findHostNodes(tree(), (node) => node.tag === "select" && node.props.id === "focused-batch")[0];
    const options = findHostNodes(selector, (node) => node.tag === "option");
    (selector.props.onChange as (event: unknown) => void)({ target: { value: options[1].props.value } });
    await reactTestRuntime.flush();
    expect(requests).toHaveLength(2);
    await choose("Tezeta", true);
    clickButton(button("Ampliar con 2 canciones"));
    await reactTestRuntime.flush();
    expect(requests).toHaveLength(3);
    expect(requests[2].seeds).toEqual([fixtures.recommendations.rec2.id, fixtures.recommendations.rec5.id]);
    const afterExpansion = findHostNodes(tree(), (node) => node.tag === "mock-graph")[0].props.graph as { nodes: { id: string }[] };
    expect(afterExpansion.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      `recording:${fixtures.recommendations.rec1.id}`,
      `recording:${fixtures.recommendations.rec5.id}`,
      `recording:${fixtures.recommendations.rec6.id}`,
    ]));
    expect(text()).toContain("A partir de Angel · Unkle: 86% parecido");
    expect(text()).toContain("A partir de Tezeta · Mulatu Astatke: 81% parecido");
    const oldGroup = findHostNodes(tree(), (node) => node.props["aria-label"] === "Guardar o evaluar Glory Box, Portishead")[0];
    clickButton(findButtons(oldGroup, "Guardar")[0]);
    await reactTestRuntime.flush();
    clickButton(findButtons(findHostNodes(tree(), (node) => node.props["aria-label"] === "Guardar o evaluar Glory Box, Portishead")[0], "Me gusta")[0]);
    await reactTestRuntime.flush();
    const oldRequestId = fixtures.responses.batch1.requestId;
    const oldResultId = fixtures.responses.batch1.recommendations[0].resultId;
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes(`/api/me/recommendations/${oldRequestId}/`));
    expect(calls.map(([url, init]) => [String(url).split("/").pop(), JSON.parse(String(init?.body)).resultId])).toEqual([["saved", oldResultId], ["feedback", oldResultId]]);
    await rerender(<App screen="demo" />);
    expect(requests).toHaveLength(3);
    expect(text()).toContain("Tanda 3");
  });

  it("limits selection to ten while allowing a selected song to be removed", async () => {
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    const seed = fixtures.originals[0];
    const songs = Array.from({ length: 11 }, (_, index) => makeSong(200 + index, {}, 30));
    const response = buildExplorationResponse({ seeds: [seed], recommendations: songs.map((song, index) => ({ song, artistId: makeUuid(31, index + 1), reasons: [{ seedId: seed.id, score: 0.8, sharedTags: [], signals: ["songs"] }] })) });
    // The exploration request permits at most ten results; use two valid batches.
    const first = buildExplorationResponse({ seeds: [seed], recommendations: response.recommendations.slice(0, 9).map((rec) => ({ song: rec.song, artistId: rec.artistId, reasons: rec.reasons })) });
    const second = buildExplorationResponse({ seeds: [songs[0]], recommendations: songs.slice(9).map((song, index) => ({ song, artistId: makeUuid(31, index + 10), reasons: [{ seedId: songs[0].id, score: 0.8, sharedTags: [], signals: ["songs"] }] })) });
    let calls = 0;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(++calls === 1 ? first : second)));
    function SingleSeedDemo() { return <><ExplorationControls saved={[seed]} /><ExplorationBatches /></>; }
    await mount(<RecommendationLibraryProvider><RecommendationExplorationProvider><SingleSeedDemo /></RecommendationExplorationProvider></RecommendationLibraryProvider>);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await choose(songs[0].title, true);
    clickButton(button("Ampliar con 1 canci\u00f3n"));
    await reactTestRuntime.flush();
    for (const song of songs.slice(0, 10)) await choose(song.title, true);
    expect(checkbox(songs[10].title).props.disabled).toBe(true);
    expect(checkbox(songs[0].title).props.disabled).toBe(false);
    expect(button("Ampliar con 10 canciones").props.disabled).toBe(false);
    await choose(songs[0].title, false);
    expect(checkbox(songs[10].title).props.disabled).toBe(false);
  });

  it.each(["error", "empty"] as const)("requires a current selection to retry an %s expansion", async (outcome) => {
    const guest = createMultiBatchFixtures("guest");
    const pending = deferred<Response>();
    const requests: { seeds: string[] }[] = [];
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    const empty = buildExplorationResponse({ seeds: [guest.recommendations.rec1], recommendations: [] });
    const success = buildExplorationResponse({
      seeds: [guest.recommendations.rec2],
      recommendations: [{ song: guest.recommendations.rec4, artistId: guest.artists.portishead, reasons: [{ seedId: guest.recommendations.rec2.id, score: 0.8, sharedTags: [], signals: ["songs"] }] }],
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/recommendations");
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) return Promise.resolve(jsonResponse(guest.responses.batch1));
      if (requests.length === 2) return Promise.resolve(outcome === "error" ? jsonResponse({ error: "Expansion failed" }, 503) : jsonResponse(empty));
      return pending.promise;
    });
    await mount(<App screen="demo" />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await choose("Glory Box", true);
    clickButton(button("Ampliar con 1 canci\u00f3n"));
    await reactTestRuntime.flush();
    expect(requests[1].seeds).toEqual([guest.recommendations.rec1.id]);
    const message = outcome === "error" ? "Expansion failed" : "No encontramos canciones nuevas en esta consulta.";
    expect(text()).toContain(message);
    await choose("Glory Box", false);
    expect(text()).toContain(message);
    expect(text()).toContain("Tanda 1");
    expect(button("Ampliar con 0 canciones").props.disabled).toBe(true);
    expect(button("Volver a intentar").props.disabled).toBe(true);
    await reactTestRuntime.flush();
    expect(requests).toHaveLength(2);
    await choose("Angel", true);
    expect(button("Volver a intentar").props.disabled).toBe(false);
    clickButton(button("Volver a intentar"));
    await reactTestRuntime.flush();
    expect(requests).toHaveLength(3);
    expect(requests[2].seeds).toEqual([guest.recommendations.rec2.id]);
    expect(text()).toContain("Tanda 1");
    expect(checkbox("Angel").props.checked).toBe(true);
    expect(checkbox("Angel").props.disabled).toBe(true);
    pending.resolve(jsonResponse(success));
    await reactTestRuntime.flush();
    expect(text()).toContain("Tanda 2");
    expect(text()).toContain("Roads");
  });

  it.each([
    ["start", "error"], ["start", "empty"],
    ["alternatives", "error"], ["alternatives", "empty"],
  ] as const)("allows %s retry after %s without selecting discoveries", async (kind, outcome) => {
    const guest = createMultiBatchFixtures("guest");
    const requests: { seeds: string[] }[] = [];
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/recommendations");
      requests.push(JSON.parse(String(init?.body)));
      const attemptNumber = requests.length - (kind === "alternatives" ? 1 : 0);
      if (attemptNumber === 0) return Promise.resolve(jsonResponse(guest.responses.batch1));
      if (attemptNumber === 1) return Promise.resolve(outcome === "error" ? jsonResponse({ error: "Request failed" }, 503) : jsonResponse(guest.responses.emptyOriginals));
      return Promise.resolve(jsonResponse(kind === "start" ? guest.responses.batch1 : guest.responses.alternatives));
    });
    await mount(<App screen="demo" />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    if (kind === "alternatives") {
      clickButton(button("Otras desde las canciones iniciales"));
      await reactTestRuntime.flush();
      expect(button("Ampliar con 0 canciones").props.disabled).toBe(true);
    }
    expect(button("Volver a intentar").props.disabled).toBe(false);
    clickButton(button("Volver a intentar"));
    await reactTestRuntime.flush();
    expect(requests).toHaveLength(kind === "start" ? 2 : 3);
    expect(requests.at(-1)?.seeds).toEqual(guest.originals.map((song) => song.id));
    expect(text()).toContain(kind === "start" ? "Tanda 1" : "Tanda 2");
  });

  it("keeps selection and history visible after an error and an empty retry", async () => {
    const guest = createMultiBatchFixtures("guest");
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    let calls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input) !== "/api/recommendations") throw new Error("Unexpected fetch");
      calls++;
      if (calls === 1) return Promise.resolve(jsonResponse(guest.responses.batch1));
      if (calls === 2) return Promise.resolve(jsonResponse({ error: "Servicio temporalmente no disponible" }, 503));
      return Promise.resolve(jsonResponse(guest.responses.emptyOriginals));
    });
    await mount(<App screen="demo" />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await choose("Glory Box", true);
    clickButton(button("Otras desde las canciones iniciales"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Servicio temporalmente no disponible");
    expect(checkbox("Glory Box").props.checked).toBe(true);
    expect(text()).toContain("Tanda 1");
    clickButton(button("Volver a intentar"));
    await reactTestRuntime.flush();
    expect(calls).toBe(3);
    expect(text()).toContain("No encontramos canciones nuevas en esta consulta.");
    expect(text()).toContain("Sin recomendaciones (no_candidates).");
    expect(text()).toContain("Tanda 1");
    expect(checkbox("Glory Box").props.checked).toBe(true);
  });
});
