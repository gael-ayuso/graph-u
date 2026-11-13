import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  createMemoryStorage,
  createWindowEventMock,
  deferred,
  jsonResponse,
  reactTestRuntime,
  type VElement,
} from "./helpers/recommendation-library-harness";

vi.mock("react", async () => {
  const { reactTestRuntime: runtime } = await import(
    "./helpers/recommendation-library-harness"
  );
  function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
  ): T {
    const [, setTick] = runtime.reactMock.useState(0);
    const subscribeRef = runtime.reactMock.useRef(subscribe);
    subscribeRef.current = subscribe;
    runtime.reactMock.useEffect(() => {
      return subscribeRef.current(() => setTick((n) => n + 1));
    }, [subscribe]);
    return getSnapshot();
  }
  return {
    ...runtime.reactMock,
    useSyncExternalStore,
  };
});

vi.mock("react/jsx-runtime", async () => {
  const { reactTestRuntime: runtime } = await import(
    "./helpers/recommendation-library-harness"
  );
  return runtime.jsxRuntimeMock;
});

vi.mock("react/jsx-dev-runtime", async () => {
  const { reactTestRuntime: runtime } = await import(
    "./helpers/recommendation-library-harness"
  );
  return runtime.jsxRuntimeMock;
});

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn<() => { isLoaded: boolean; userId: string | null | undefined }>(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: useAuthMock,
}));

import { RecommendationLibraryProvider } from "@/components/recommendation-library";
import {
  RecommendationExplorationProvider,
  useRecommendationExploration,
} from "@/components/recommendation-exploration-provider";
import { writeSongs } from "@/lib/saved-song-list";
import {
  createMultiBatchFixtures,
  makeSong,
} from "./fixtures/recommendation-exploration";

async function mountApp(node: ReactNode) {
  await reactTestRuntime.mount(node as unknown as VElement);
}

async function rerenderApp(node: ReactNode) {
  await reactTestRuntime.rerender(node as unknown as VElement);
}

describe("T3 RecommendationExplorationProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let windowMock: ReturnType<typeof createWindowEventMock>;
  let memoryStorage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    fetchMock = vi.fn();
    windowMock = createWindowEventMock();
    memoryStorage = createMemoryStorage();
    const eventWindow = Object.assign(windowMock.window, {
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", eventWindow);
    vi.stubGlobal("localStorage", memoryStorage.storage);
    vi.stubGlobal("Event", class FakeEvent {
      constructor(public type: string) {}
    });
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("throws when useRecommendationExploration is used outside RecommendationExplorationProvider", async () => {
    function Orphan() {
      useRecommendationExploration();
      return null;
    }

    await expect(mountApp(<Orphan />)).rejects.toThrow(
      "useRecommendationExploration requires RecommendationExplorationProvider",
    );
  });

  it("never triggers recommendations on mount and blocks generation while auth scope is loading", async () => {
    useAuthMock.mockReturnValue({ isLoaded: false, userId: undefined });
    let api!: ReturnType<typeof useRecommendationExploration>;

    function Probe() {
      api = useRecommendationExploration();
      return null;
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <Probe />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.state.id).toBeNull();
    expect(api.state.batches).toEqual([]);
    await expect(api.start([makeSong(1)])).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves exploration state and in-flight requests across consumer navigation and saved-song-list edits", async () => {
    const fixtures = createMultiBatchFixtures("guest");
    const expandDeferred = deferred<Response>();
    let expandSignal: AbortSignal | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/recommendations") {
        const body = JSON.parse(String(init?.body)) as { seeds: string[] };
        if (body.seeds.length === 2) {
          return Promise.resolve(jsonResponse(fixtures.responses.batch1));
        }
        expandSignal = init?.signal as AbortSignal;
        return expandDeferred.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    let demoApi!: ReturnType<typeof useRecommendationExploration>;
    let explorerApi!: ReturnType<typeof useRecommendationExploration>;

    function DemoScreen() {
      demoApi = useRecommendationExploration();
      return <div data-screen="demo" />;
    }

    function ExplorerScreen() {
      explorerApi = useRecommendationExploration();
      return <div data-screen="explorer" />;
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <DemoScreen />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );

    await expect(demoApi.start(fixtures.originals)).resolves.toBe(true);
    await reactTestRuntime.flush();
    expect(demoApi.state.batches).toHaveLength(1);

    // Modifying Mi lista does not overwrite captured originals or clear batches.
    writeSongs([makeSong(99, { title: "Changed List Song" })]);
    await reactTestRuntime.flush();
    expect(demoApi.state.originals.map((s) => s.id)).toEqual(
      fixtures.originals.map((s) => s.id),
    );
    expect(demoApi.state.batches).toHaveLength(1);

    // Select a discovery and start expand, then navigate from DemoScreen to ExplorerScreen while pending.
    demoApi.select(fixtures.recommendations.rec1.id, true);
    await reactTestRuntime.flush();
    const pendingExpand = demoApi.expand();
    await reactTestRuntime.flush();

    await rerenderApp(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <ExplorerScreen />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );

    expect(expandSignal?.aborted).toBe(false);
    expect(explorerApi.state.pending).not.toBeNull();
    expect(explorerApi.state.batches).toHaveLength(1);

    expandDeferred.resolve(jsonResponse(fixtures.responses.batch2));
    await expect(pendingExpand).resolves.toBe(true);
    await reactTestRuntime.flush();

    expect(explorerApi.state.pending).toBeNull();
    expect(explorerApi.state.batches).toHaveLength(2);
  });

  it("disposes active exploration, aborts in-flight requests, and isolates state on account switch", async () => {
    const userFixtures = createMultiBatchFixtures("user");
    const userAPending = deferred<Response>();
    let userASignal: AbortSignal | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") {
        return Promise.resolve(jsonResponse({ songs: [] }));
      }
      if (url === "/api/recommendations") {
        userASignal = init?.signal as AbortSignal;
        return userAPending.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    let api!: ReturnType<typeof useRecommendationExploration>;
    function Probe() {
      api = useRecommendationExploration();
      return null;
    }

    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-a" });
    await mountApp(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <Probe />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );

    const pendingStart = api.start(userFixtures.originals);
    await reactTestRuntime.flush();
    expect(api.state.pending).not.toBeNull();
    expect(userASignal?.aborted).toBe(false);

    // Switch to user-b before user-a's request finishes.
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-b" });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <Probe />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );

    expect(userASignal?.aborted).toBe(true);
    expect(api.state.id).toBeNull();
    expect(api.state.batches).toEqual([]);
    expect(api.state.pending).toBeNull();

    // Late resolution for disposed user-a must NOT contaminate user-b.
    userAPending.resolve(jsonResponse(userFixtures.responses.batch1));
    await expect(pendingStart).resolves.toBe(false);
    await reactTestRuntime.flush();

    expect(api.state.id).toBeNull();
    expect(api.state.batches).toEqual([]);
    expect(api.state.lastAttempt).toBeNull();

    // Switch to guest also gets a clean session without calling /api/recommendations.
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <Probe />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );
    expect(api.state.id).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/recommendations"),
    ).toHaveLength(1);
  });
});
