import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  clickButton,
  createMemoryStorage,
  deferred,
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
  makeSong,
  makeUuid,
} from "./fixtures/recommendation-exploration";

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

import { GraphExplorer } from "@/components/graph-explorer";
import { RecommendationExplorationProvider } from "@/components/recommendation-exploration-provider";
import { RecommendationLibraryProvider } from "@/components/recommendation-library";
import { SongDemo } from "@/components/song-demo";
import { writeSongs } from "@/lib/saved-song-list";

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
function App({ screen }: { screen: "demo" | "graph" }) {
  return (
    <RecommendationLibraryProvider>
      <RecommendationExplorationProvider>
        {screen === "demo" ? <SongDemo /> : <GraphExplorer />}
      </RecommendationExplorationProvider>
    </RecommendationLibraryProvider>
  );
}
async function mount(node: ReactNode) { await reactTestRuntime.mount(node as unknown as VElement); }
async function rerender(node: ReactNode) { await reactTestRuntime.rerender(node as unknown as VElement); }

function createInteractiveWindowMock(storage: Storage) {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    localStorage: storage,
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: { type?: string }) {
      const set = event.type ? listeners.get(event.type) : undefined;
      if (set) for (const listener of [...set]) listener(event);
      return true;
    },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  };
}

describe("T6 integrated UI flows across SongDemo and GraphExplorer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let memoryStorage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    fetchMock = vi.fn();
    memoryStorage = createMemoryStorage();
    vi.stubGlobal("window", createInteractiveWindowMock(memoryStorage.storage));
    vi.stubGlobal("localStorage", memoryStorage.storage);
    vi.stubGlobal("Event", class FakeEvent {
      constructor(public type: string) {}
    });
    vi.stubGlobal("fetch", fetchMock);
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("supports cancel, reset confirmation, failed/empty replacement, and Mi lista edits without losing active batches", async () => {
    const guest = createMultiBatchFixtures("guest");
    const lateExpand = deferred<Response>();
    const emptyReplacement = buildExplorationResponse({
      seeds: [guest.originals[0]],
      recommendations: [],
    });
    const requests: { seeds: string[] }[] = [];
    const signals: AbortSignal[] = [];

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/recommendations");
      requests.push(JSON.parse(String(init?.body)));
      signals.push(init?.signal as AbortSignal);
      if (requests.length === 1) return Promise.resolve(jsonResponse(guest.responses.batch1));
      if (requests.length === 2) return lateExpand.promise;
      if (requests.length === 3) return Promise.resolve(jsonResponse({ error: "Error temporal al reemplazar" }, 503));
      if (requests.length === 4) return Promise.resolve(jsonResponse(emptyReplacement));
      return lateExpand.promise;
    });

    writeSongs(guest.originals);
    await mount(<App screen="demo" />);

    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Tanda 1");
    expect(text()).toContain("Canciones iniciales: Reckoner · Radiohead, Teardrop · Massive Attack.");

    // Modifying Mi lista during exploration leaves active originals and batches intact.
    clickButton(findHostNodes(tree(), (n) => n.tag === "button" && n.props["aria-label"] === "Quitar Teardrop de mi lista")[0]);
    await reactTestRuntime.flush();
    expect(text()).toContain("Quitada de tu lista: Teardrop.");
    expect(text()).toContain("Canciones iniciales: Reckoner · Radiohead, Teardrop · Massive Attack.");
    expect(text()).toContain("Tanda 1");

    // Cancel pending expand keeps Batch 1 and selection.
    await choose("Glory Box", true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    clickButton(button("Cancelar consulta"));
    await reactTestRuntime.flush();
    expect(signals[1].aborted).toBe(true);
    expect(checkbox("Glory Box").props.checked).toBe(true);
    expect(text()).toContain("Tanda 1");

    // Failed and empty replacement both send the updated Mi lista seed, yet preserve Batch 1 and selection.
    clickButton(button("Reemplazar desde Mi lista"));
    await reactTestRuntime.flush();
    expect(requests[2].seeds).toEqual([guest.originals[0].id]);
    expect(text()).toContain("Error temporal al reemplazar");
    expect(text()).toContain("Tanda 1");
    expect(checkbox("Glory Box").props.checked).toBe(true);

    clickButton(button("Reemplazar desde Mi lista"));
    await reactTestRuntime.flush();
    expect(requests[3].seeds).toEqual([guest.originals[0].id]);
    expect(text()).toContain("No encontramos canciones nuevas en esta consulta.");
    expect(text()).toContain("Tanda 1");
    expect(checkbox("Glory Box").props.checked).toBe(true);

    // Reset confirmation: "Conservar" keeps state; "Sí, reiniciar" clears even if a late response resolves.
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    clickButton(button("Cancelar consulta"));
    await reactTestRuntime.flush();
    clickButton(button("Reiniciar exploración"));
    await reactTestRuntime.flush();
    expect(text()).toContain("¿Descartar las tandas temporales?");
    clickButton(button("Conservar"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Tanda 1");

    clickButton(button("Reiniciar exploración"));
    await reactTestRuntime.flush();
    clickButton(button("Sí, reiniciar"));
    await reactTestRuntime.flush();
    expect(text()).toContain("0 / 200 canciones");
    expect(text()).not.toContain("Tanda 1");

    lateExpand.resolve(jsonResponse(guest.responses.batch2));
    await reactTestRuntime.flush();
    expect(text()).toContain("0 / 200 canciones");
    expect(text()).not.toContain("Tanda 2");
  });

  it("renders searchLimited notice, 200-song cap UI controls, and alerts on invalid knownUnselectedOrigin without mutating history", async () => {
    const seed = makeSong(1, { title: "Reckoner", artist: "Radiohead" }, 70);
    const batchSongs = Array.from({ length: 19 }, (_, batchIndex) =>
      Array.from({ length: 10 }, (__, slot) =>
        makeSong(10 + batchIndex * 10 + slot, { title: `Track ${batchIndex}-${slot}` }, 71),
      ),
    );
    const tailSongs = Array.from({ length: 9 }, (_, slot) =>
      makeSong(300 + slot, { title: `Tail ${slot}` }, 72),
    );

    const requests: { limit: number; excludeRecordings?: string[] }[] = [];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/recommendations");
      const body = JSON.parse(String(init?.body)) as { seeds: string[]; limit: number; excludeRecordings?: string[] };
      requests.push(body);

      if (requests.length === 1) {
        const recs = batchSongs[0].map((song, i) => ({
          song,
          artistId: makeUuid(80, i + 1),
          reasons: [{ seedId: seed.id, score: 0.9, sharedTags: ["trip-hop"], signals: ["songs" as const] }],
        }));
        const res = buildExplorationResponse({ seeds: [seed], recommendations: recs });
        res.seedResults[0].searchLimited = true;
        return Promise.resolve(jsonResponse(res));
      }
      if (requests.length === 2) {
        // Invalid response: cites unselected Track 0-1 as reason while expanding from Track 0-0.
        const badRec = {
          song: makeSong(999, { title: "Bad Origin" }, 79),
          artistId: makeUuid(89, 1),
          reasons: [{ seedId: batchSongs[0][1].id, score: 0.7, sharedTags: [], signals: ["songs" as const] }],
        };
        return Promise.resolve(jsonResponse(buildExplorationResponse({ seeds: [batchSongs[0][0]], recommendations: [badRec] })));
      }
      const batchIdx = requests.length - 2;
      if (batchIdx < 19) {
        const prevSeed = batchSongs[batchIdx - 1][0];
        return Promise.resolve(jsonResponse(buildExplorationResponse({
          seeds: [prevSeed],
          recommendations: batchSongs[batchIdx].map((song, i) => ({
            song,
            artistId: makeUuid(80 + batchIdx, i + 1),
            reasons: [{ seedId: prevSeed.id, score: 0.85, sharedTags: [], signals: ["songs" as const] }],
          })),
        })));
      }
      const prevSeed = batchSongs[18][0];
      return Promise.resolve(jsonResponse(buildExplorationResponse({
        seeds: [prevSeed],
        recommendations: tailSongs.map((song, i) => ({
          song,
          artistId: makeUuid(99, i + 1),
          reasons: [{ seedId: prevSeed.id, score: 0.8, sharedTags: [], signals: ["songs" as const] }],
        })),
      })));
    });

    writeSongs([seed]);
    await mount(<App screen="demo" />);
    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    expect(text()).toContain("La búsqueda fue limitada; podrían existir más resultados.");
    expect(text()).toContain("11 / 200 canciones");

    // Attempt expand with Track 0-0 -> server returns knownUnselectedOrigin (Track 0-1) -> UI alerts and keeps Batch 1 intact.
    await choose(batchSongs[0][0].title, true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    const alertNode = findHostNodes(tree(), (n) => n.props.role === "alert")[0];
    expect(alertNode).toBeDefined();
    expect(text()).toContain("11 / 200 canciones");
    expect(text()).not.toContain("Bad Origin");

    // Advance up to 200 songs: last step requests limit=9 (trailing space < 10) and reaches 200 / 200 cap.
    for (let step = 1; step <= 19; step++) {
      if (step > 1) {
        await choose(batchSongs[step - 2][0].title, false);
        await choose(batchSongs[step - 1][0].title, true);
      }
      clickButton(button("Ampliar con 1 canción"));
      await reactTestRuntime.flush();
    }

    expect(requests.at(-1)?.limit).toBe(9);
    expect(text()).toContain("200 / 200 canciones");
    expect(text()).toContain("Límite alcanzado. Reinicia o reemplaza para explorar de nuevo.");
    expect(button("Otras desde las canciones iniciales").props.disabled).toBe(true);
    expect(button("Ampliar con 0 canciones").props.disabled).toBe(true);
    expect(button("Reemplazar desde Mi lista").props.disabled).toBe(false);
  });

  it("shares guest save/vote across two batches in SongDemo and GraphExplorer and resets cleanly on account switch", async () => {
    const guest = createMultiBatchFixtures("guest");
    const userPendingExpand = deferred<Response>();
    const userPendingSave = deferred<Response>();

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") {
        return Promise.resolve(jsonResponse({ songs: [] }));
      }
      if (url === "/api/recommendations") {
        const body = JSON.parse(String(init?.body)) as { seeds: string[] };
        if (body.seeds.length === 2) return Promise.resolve(jsonResponse(guest.responses.batch1));
        return useAuthMock().userId ? userPendingExpand.promise : Promise.resolve(jsonResponse(guest.responses.batch2));
      }
      if (url.endsWith("/saved")) return userPendingSave.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    });

    writeSongs(guest.originals);
    await mount(<App screen="demo" />);

    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await choose("Glory Box", true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    expect(text()).toContain("Tanda 2");

    // Guest saves a card from Batch 1 on SongDemo, then navigates to GraphExplorer and votes on Batch 2.
    const batch1Group = findHostNodes(tree(), (n) => n.props["aria-label"] === "Guardar o evaluar Glory Box, Portishead")[0];
    clickButton(findButtons(batch1Group, "Guardar")[0]);
    await reactTestRuntime.flush();
    expect(text()).toContain("Canciones guardadas1");

    await rerender(<App screen="graph" />);
    const batch2GroupBefore = findHostNodes(tree(), (n) => n.props["aria-label"] === "Guardar o evaluar Tezeta, Mulatu Astatke")[0];
    clickButton(findButtons(batch2GroupBefore, "Me gusta")[0]);
    await reactTestRuntime.flush();
    const batch2GroupAfter = findHostNodes(tree(), (n) => n.props["aria-label"] === "Guardar o evaluar Tezeta, Mulatu Astatke")[0];
    expect(findButtons(batch2GroupAfter, "Me gusta")[0].props["aria-pressed"]).toBe(true);
    expect(text()).toContain("Canciones guardadas1");

    // Sign in as user-a, launch pending expand + pending save, then switch to user-b while both are pending.
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-a" });
    await rerender(<App screen="demo" />);
    expect(text()).toContain("0 / 200 canciones");

    const userFixtures = createMultiBatchFixtures("user");
    let userCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") return Promise.resolve(jsonResponse({ songs: [] }));
      if (url === "/api/recommendations") {
        userCalls++;
        return userCalls === 1 ? Promise.resolve(jsonResponse(userFixtures.responses.batch1)) : userPendingExpand.promise;
      }
      if (url.endsWith("/saved")) return userPendingSave.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    });

    clickButton(button("Iniciar desde Mi lista"));
    await reactTestRuntime.flush();
    await choose("Glory Box", true);
    clickButton(button("Ampliar con 1 canción"));
    await reactTestRuntime.flush();
    const userGroup = findHostNodes(tree(), (n) => n.props["aria-label"] === "Guardar o evaluar Glory Box, Portishead")[0];
    clickButton(findButtons(userGroup, "Guardar")[0]);
    await reactTestRuntime.flush();

    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-b" });
    await rerender(<App screen="graph" />);
    userPendingExpand.resolve(jsonResponse(userFixtures.responses.batch2));
    userPendingSave.resolve(jsonResponse({ saved: true }));
    await reactTestRuntime.flush();

    expect(text()).toContain("0 / 200 canciones");
    expect(text()).not.toContain("Tanda 1");
    expect(text()).not.toContain("Tanda 2");
    expect(text()).not.toContain("Canciones guardadas1");
  });
});
