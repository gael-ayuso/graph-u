import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Recommendation, Song } from "@/lib/musicbrainz-types";
import {
  clickButton,
  createMemoryStorage,
  createWindowEventMock,
  deferred,
  findByRole,
  findButtons,
  findHostNodes,
  getTextContent,
  jsonResponse,
  reactTestRuntime,
  type HostNode,
  type VElement,
} from "./helpers/recommendation-library-harness";

vi.mock("react", async () => {
  const { reactTestRuntime: runtime } = await import(
    "./helpers/recommendation-library-harness"
  );
  return runtime.reactMock;
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

import {
  RecommendationActions,
  RecommendationLibraryProvider,
  SavedRecommendationsPanel,
  useRecommendationLibrary,
} from "@/components/recommendation-library";

const STORAGE_KEY = "graphu.recommendations.v1";

const songA: Song = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Reckoner",
  artist: "Radiohead",
  release: "In Rainbows",
  duration: 290000,
  comment: null,
};

const songB: Song = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Weird Fishes",
  artist: "Radiohead",
  release: "In Rainbows",
  duration: 318000,
  comment: null,
};

function makeRecommendation(song: Song, resultId?: string): Recommendation {
  return {
    resultId,
    song,
    score: 0.91,
    sharedTags: ["alternative rock"],
    signals: ["songs"],
    artistId: "33333333-3333-4333-8333-333333333333",
    seedIds: ["44444444-4444-4444-8444-444444444444"],
    reasons: [],
  };
}

function findActionGroup(root: HostNode, song: Song): HostNode | undefined {
  const expectedLabel = `Guardar o evaluar ${song.title}, ${song.artist}`;
  return findByRole(root, "group").find(
    (node) => node.props["aria-label"] === expectedLabel,
  );
}

function findActionGroups(root: HostNode, song: Song): HostNode[] {
  const expectedLabel = `Guardar o evaluar ${song.title}, ${song.artist}`;
  return findByRole(root, "group").filter(
    (node) => node.props["aria-label"] === expectedLabel,
  );
}

async function mountApp(node: ReactNode) {
  await reactTestRuntime.mount(node as unknown as VElement);
}

async function rerenderApp(node: ReactNode) {
  await reactTestRuntime.rerender(node as unknown as VElement);
}

describe("T2 RecommendationLibrary context and components", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let windowMock: ReturnType<typeof createWindowEventMock>;
  let memoryStorage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    fetchMock = vi.fn();
    windowMock = createWindowEventMock();
    memoryStorage = createMemoryStorage();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", windowMock.window);
    vi.stubGlobal("localStorage", memoryStorage.storage);
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-a" });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requires RecommendationLibraryProvider for useRecommendationLibrary and renders null for RecommendationActions outside it", async () => {
    function OrphanHookConsumer() {
      useRecommendationLibrary();
      return null;
    }

    await expect(mountApp(<OrphanHookConsumer />)).rejects.toThrow(
      "useRecommendationLibrary requires RecommendationLibraryProvider",
    );
    reactTestRuntime.unmount();

    await mountApp(<RecommendationActions recommendation={makeRecommendation(songA, "res-a")} requestId="req-a" />);
    expect(reactTestRuntime.getTree().children).toEqual([]);
  });

  it("holds loading state without fetching until Clerk auth is loaded", async () => {
    useAuthMock.mockReturnValue({ isLoaded: false, userId: undefined });
    let capturedScope = "";
    let capturedReady = true;

    function Probe() {
      const lib = useRecommendationLibrary();
      capturedScope = lib.accountScope;
      capturedReady = lib.ready;
      return (
        <>
          <SavedRecommendationsPanel />
          <RecommendationActions recommendation={makeRecommendation(songA, "res-a")} requestId="req-a" />
        </>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    expect(capturedScope).toBe("loading");
    expect(capturedReady).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const tree = reactTestRuntime.getTree();
    const panel = findHostNodes(tree, (n) => n.tag === "section")[0];
    expect(panel.props["aria-busy"]).toBe(true);
    expect(getTextContent(panel)).toContain("Cargando canciones guardadas…");

    const group = findActionGroup(tree, songA)!;
    for (const button of findButtons(group)) {
      expect(button.props.disabled).toBe(true);
    }
  });

  it("routes save and unsave actions to each card's own (requestId, resultId) pair in either order", async () => {
    const recA = makeRecommendation(songA, "res-a");
    const recB = makeRecommendation(songB, "res-b");

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") {
        return jsonResponse({ songs: [] });
      }
      if (url.endsWith("/saved")) {
        const body = JSON.parse(String(init?.body)) as { saved: boolean };
        return jsonResponse({ saved: body.saved });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await mountApp(
      <RecommendationLibraryProvider>
        <RecommendationActions recommendation={recA} requestId="req-a" />
        <RecommendationActions recommendation={recB} requestId="req-b" />
        <SavedRecommendationsPanel />
      </RecommendationLibraryProvider>,
    );

    // Trigger batch B first, then batch A (reverse order), then unsave A via its RecommendationActions.
    let tree = reactTestRuntime.getTree();
    const groupB = findActionGroup(tree, songB)!;
    clickButton(findButtons(groupB, "Guardar")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const groupA = findActionGroup(tree, songA)!;
    clickButton(findButtons(groupA, "Guardar")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const unsaveA = findButtons(findActionGroup(tree, songA)!, "Guardada · Quitar")[0];
    expect(unsaveA.props["aria-pressed"]).toBe(true);
    clickButton(unsaveA);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/me/recommendations/req-b/saved",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ resultId: "res-b", saved: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/me/recommendations/req-a/saved",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ resultId: "res-a", saved: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/me/recommendations/req-a/saved",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ resultId: "res-a", saved: false }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(findButtons(findActionGroup(tree, songA)!, "Guardar")[0].props["aria-pressed"]).toBe(false);
    expect(findButtons(findActionGroup(tree, songB)!, "Guardada · Quitar")[0].props["aria-pressed"]).toBe(true);
    const panelText = getTextContent(findHostNodes(tree, (n) => n.tag === "section")[0]);
    expect(panelText).toContain("Guardadas en tu cuenta.");
    expect(panelText).toContain(songB.title);
    expect(panelText).not.toContain(`Quitar ${songA.title} de guardadas`);
  });

  it("keeps authenticated votes independent per (requestId, resultId), even when the same song appears in two batches", async () => {
    const recBatch1 = makeRecommendation(songA, "res-1");
    const recBatch2SameSong = makeRecommendation(songA, "res-2");
    const recBatch2Other = makeRecommendation(songB, "res-3");
    let capturedVotes: Record<string, "LIKE" | "DISLIKE" | null> = {};

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") {
        return jsonResponse({ songs: [] });
      }
      if (url.endsWith("/feedback")) {
        const body = JSON.parse(String(init?.body)) as { value: "LIKE" | "DISLIKE" | null };
        return jsonResponse({ value: body.value });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    function Probe() {
      capturedVotes = useRecommendationLibrary().votes;
      return (
        <>
          <RecommendationActions recommendation={recBatch1} requestId="req-1" />
          <RecommendationActions recommendation={recBatch2SameSong} requestId="req-2" />
          <RecommendationActions recommendation={recBatch2Other} requestId="req-2" />
        </>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    let tree = reactTestRuntime.getTree();
    let songAGroups = findActionGroups(tree, songA);
    expect(songAGroups).toHaveLength(2);

    // Vote LIKE on (req-1, res-1) and DISLIKE on (req-2, res-2) for the same song.
    clickButton(findButtons(songAGroups[0], "Me gusta")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    songAGroups = findActionGroups(tree, songA);
    clickButton(findButtons(songAGroups[1], "No me interesa")[0]);
    await reactTestRuntime.flush();

    // Vote LIKE on (req-2, res-3).
    tree = reactTestRuntime.getTree();
    clickButton(findButtons(findActionGroup(tree, songB)!, "Me gusta")[0]);
    await reactTestRuntime.flush();

    expect(capturedVotes).toEqual({
      "req-1:res-1": "LIKE",
      "req-2:res-2": "DISLIKE",
      "req-2:res-3": "LIKE",
    });

    tree = reactTestRuntime.getTree();
    songAGroups = findActionGroups(tree, songA);
    expect(findButtons(songAGroups[0], "Me gusta")[0].props["aria-pressed"]).toBe(true);
    expect(findButtons(songAGroups[0], "No me interesa")[0].props["aria-pressed"]).toBe(false);
    expect(findButtons(songAGroups[1], "Me gusta")[0].props["aria-pressed"]).toBe(false);
    expect(findButtons(songAGroups[1], "No me interesa")[0].props["aria-pressed"]).toBe(true);

    // Toggling LIKE again on (req-1, res-1) clears only that result's vote.
    clickButton(findButtons(songAGroups[0], "Me gusta")[0]);
    await reactTestRuntime.flush();

    expect(capturedVotes).toEqual({
      "req-1:res-1": null,
      "req-2:res-2": "DISLIKE",
      "req-2:res-3": "LIKE",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/me/recommendations/req-1/feedback",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ resultId: "res-1", value: null }),
      }),
    );
  });

  it("aborts and ignores late load/action responses and rejections when switching accounts or logging out", async () => {
    const loadUserA = deferred<Response>();
    const loadUserB = deferred<Response>();
    const actionUserA = deferred<Response>();
    const actionRejectUserB = deferred<Response>();
    let userASignal: AbortSignal | undefined;
    let userAActionSignal: AbortSignal | undefined;
    let userBActionSignal: AbortSignal | undefined;

    let latestLib!: ReturnType<typeof useRecommendationLibrary>;
    function Probe() {
      latestLib = useRecommendationLibrary();
      return <SavedRecommendationsPanel />;
    }

    fetchMock
      .mockImplementationOnce((_url, init) => {
        userASignal = init?.signal as AbortSignal;
        return loadUserA.promise;
      })
      .mockImplementationOnce((_url, init) => {
        userAActionSignal = init?.signal as AbortSignal;
        return actionUserA.promise;
      })
      .mockImplementationOnce(() => loadUserB.promise)
      .mockImplementationOnce((_url, init) => {
        userBActionSignal = init?.signal as AbortSignal;
        return actionRejectUserB.promise;
      });

    // 1) Mount as user-a, resolve initial load, start an in-flight action, then switch to user-b.
    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );
    expect(latestLib.accountScope).toBe("user:user-a");

    loadUserA.resolve(jsonResponse({ songs: [songA] }));
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songA]);

    const pendingActionA = latestLib.act(makeRecommendation(songB, "res-b"), "req-b", "save");
    await reactTestRuntime.flush();
    expect(latestLib.busy.has(songB.id)).toBe(true);
    expect(userAActionSignal?.aborted).toBe(false);

    // Switch to user-b before user-a's action finishes.
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-b" });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    expect(userAActionSignal?.aborted).toBe(true);
    expect(latestLib.accountScope).toBe("user:user-b");
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.busy.size).toBe(0);
    expect(latestLib.ready).toBe(false);

    // Resolve user-a's late action: must NOT mutate user-b state.
    actionUserA.resolve(jsonResponse({ saved: true }));
    await pendingActionA;
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.notice).toBe("");

    // Resolve user-b's load, start user-b action, then log out to guest before user-b action rejects.
    loadUserB.resolve(jsonResponse({ songs: [songB] }));
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songB]);
    expect(latestLib.ready).toBe(true);

    const pendingActionB = latestLib.act(makeRecommendation(songA, "res-a"), "req-a", "LIKE");
    await reactTestRuntime.flush();
    expect(userBActionSignal?.aborted).toBe(false);

    memoryStorage.store.set(STORAGE_KEY, JSON.stringify({ songs: [], votes: {} }));
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    expect(userBActionSignal?.aborted).toBe(true);
    expect(latestLib.accountScope).toBe("guest");
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.error).toBe("");

    // Late rejection from user-b must NOT set error or notice in guest session.
    actionRejectUserB.reject(new Error("User B late network failure"));
    await pendingActionB;
    await reactTestRuntime.flush();

    expect(latestLib.accountScope).toBe("guest");
    expect(latestLib.error).toBe("");
    expect(latestLib.notice).toBe("");
    expect(userASignal?.aborted).toBe(true);
  });

  it("ignores late initial load resolution and rejection after switching accounts", async () => {
    const staleLoad = deferred<Response>();
    const freshLoad = deferred<Response>();
    let staleSignal: AbortSignal | undefined;
    let latestLib!: ReturnType<typeof useRecommendationLibrary>;

    function Probe() {
      latestLib = useRecommendationLibrary();
      return null;
    }

    fetchMock
      .mockImplementationOnce((_url, init) => {
        staleSignal = init?.signal as AbortSignal;
        return staleLoad.promise;
      })
      .mockImplementationOnce(() => freshLoad.promise);

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-b" });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    expect(staleSignal?.aborted).toBe(true);
    staleLoad.resolve(jsonResponse({ songs: [songA] }));
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.ready).toBe(false);

    freshLoad.resolve(jsonResponse({ songs: [songB] }));
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songB]);
    expect(latestLib.ready).toBe(true);

    // Also verify late rejection of an aborted initial load does not set error.
    const failingStaleLoad = deferred<Response>();
    let failingSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url, init) => {
      failingSignal = init?.signal as AbortSignal;
      return failingStaleLoad.promise;
    });

    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-c" });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );
    expect(latestLib.accountScope).toBe("user:user-c");

    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );
    expect(failingSignal?.aborted).toBe(true);

    failingStaleLoad.reject(new Error("Aborted late load"));
    await reactTestRuntime.flush();
    expect(latestLib.accountScope).toBe("guest");
    expect(latestLib.error).toBe("");
    expect(latestLib.ready).toBe(true);
  });

  it("persists guest library, sanitizes stored data, and syncs cross-tab storage events while cleaning up on auth switch", async () => {
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    memoryStorage.store.set(
      STORAGE_KEY,
      JSON.stringify({
        songs: [songA, { id: "bad", title: 123 }],
        votes: { [songA.id]: "LIKE", invalidKey: "LOVE", [songB.id]: null },
      }),
    );

    let latestLib!: ReturnType<typeof useRecommendationLibrary>;
    function Probe() {
      latestLib = useRecommendationLibrary();
      return (
        <>
          <RecommendationActions recommendation={makeRecommendation(songB, "res-ignored")} requestId="req-ignored" />
          <SavedRecommendationsPanel />
        </>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(latestLib.accountScope).toBe("guest");
    expect(latestLib.ready).toBe(true);
    expect(latestLib.songs).toEqual([songA]);
    expect(latestLib.votes).toEqual({ [songA.id]: "LIKE", [songB.id]: null });
    expect(windowMock.listenerCount("storage")).toBe(1);
    expect(
      getTextContent(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "section")[0]),
    ).toContain("Guardadas en este navegador, sin iniciar sesión.");

    // Save and vote songB as guest -> persists to localStorage keyed by song.id without calling fetch.
    const tree = reactTestRuntime.getTree();
    clickButton(findButtons(findActionGroup(tree, songB)!, "Guardar")[0]);
    await reactTestRuntime.flush();
    clickButton(findButtons(findActionGroup(tree, songB)!, "No me interesa")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    const persisted = JSON.parse(memoryStorage.store.get(STORAGE_KEY)!);
    expect(persisted.songs).toEqual([songA, songB]);
    expect(persisted.votes).toEqual({ [songA.id]: "LIKE", [songB.id]: "DISLIKE" });

    // Unrelated storage key does not overwrite guest state.
    memoryStorage.store.set("graphu.demo.songs.v1", JSON.stringify([songA]));
    windowMock.window.dispatchStorageEvent("graphu.demo.songs.v1");
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songA, songB]);

    // Storage event for STORAGE_KEY updates state from another tab.
    memoryStorage.store.set(
      STORAGE_KEY,
      JSON.stringify({ songs: [songB], votes: { [songB.id]: "LIKE" } }),
    );
    windowMock.window.dispatchStorageEvent(STORAGE_KEY);
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songB]);
    expect(latestLib.votes).toEqual({ [songB.id]: "LIKE" });

    // Storage event with key === null (localStorage.clear) resets guest state.
    memoryStorage.store.delete(STORAGE_KEY);
    windowMock.window.dispatchStorageEvent(null);
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.votes).toEqual({});

    // Switching to an authenticated user removes the guest storage listener.
    fetchMock.mockResolvedValueOnce(jsonResponse({ songs: [songA] }));
    useAuthMock.mockReturnValue({ isLoaded: true, userId: "user-a" });
    await rerenderApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );
    expect(windowMock.listenerCount("storage")).toBe(0);

    memoryStorage.store.set(STORAGE_KEY, JSON.stringify({ songs: [songB], votes: {} }));
    windowMock.window.dispatchStorageEvent(STORAGE_KEY);
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songA]);
  });

  it("falls back to in-memory guest mode when localStorage read or write throws", async () => {
    useAuthMock.mockReturnValue({ isLoaded: true, userId: null });
    const failingReadStorage: Storage = {
      ...memoryStorage.storage,
      getItem() {
        throw new Error("SecurityError: storage blocked");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    vi.stubGlobal("localStorage", failingReadStorage);

    let latestLib!: ReturnType<typeof useRecommendationLibrary>;
    function Probe() {
      latestLib = useRecommendationLibrary();
      return (
        <>
          <RecommendationActions recommendation={makeRecommendation(songA)} />
          <SavedRecommendationsPanel />
        </>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    expect(latestLib.ready).toBe(true);
    expect(latestLib.error).toBe("");
    expect(latestLib.notice).toBe(
      "El almacenamiento local no está disponible. Los cambios durarán mientras permanezcas en esta página.",
    );

    // Mutate in memory even when setItem throws.
    clickButton(findButtons(findActionGroup(reactTestRuntime.getTree(), songA)!, "Guardar")[0]);
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songA]);
    expect(latestLib.error).toBe("");
    expect(latestLib.notice).toBe(
      `Canción guardada: ${songA.title}. Solo en esta página: el almacenamiento local no está disponible.`,
    );

    // Storage events while localUnavailable is true should leave in-memory state intact.
    windowMock.window.dispatchStorageEvent(STORAGE_KEY);
    await reactTestRuntime.flush();
    expect(latestLib.songs).toEqual([songA]);

    // Also test readable storage on mount that starts throwing on setItem.
    reactTestRuntime.unmount();
    vi.stubGlobal("localStorage", {
      ...memoryStorage.storage,
      setItem() {
        throw new Error("QuotaExceededError");
      },
    });
    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );
    expect(latestLib.notice).toBe("");
    clickButton(findButtons(findActionGroup(reactTestRuntime.getTree(), songA)!, "Me gusta")[0]);
    await reactTestRuntime.flush();
    expect(latestLib.votes).toEqual({ [songA.id]: "LIKE" });
    expect(latestLib.notice).toBe(
      `Evaluación guardada: ${songA.title}. Solo en esta página: el almacenamiento local no está disponible.`,
    );
  });

  it("removes saved recordings without resultId via DELETE /api/me/favorites/recordings and rejects missing batch context on authenticated PUTs", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") {
        return jsonResponse({ songs: [songA] });
      }
      if (url === "/api/me/favorites/recordings") {
        return jsonResponse({ saved: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    let latestLib!: ReturnType<typeof useRecommendationLibrary>;
    function Probe() {
      latestLib = useRecommendationLibrary();
      return (
        <>
          <SavedRecommendationsPanel />
          <RecommendationActions recommendation={makeRecommendation(songB)} requestId={undefined} />
        </>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    // Unsaved authenticated recommendation without requestId/resultId produces recoverable error without calling fetch.
    let tree = reactTestRuntime.getTree();
    clickButton(findButtons(findActionGroup(tree, songB)!, "Guardar")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latestLib.error).toBe(
      "Genera otra tanda para guardar o evaluar recomendaciones con tu cuenta.",
    );
    expect(latestLib.songs).toEqual([songA]);

    // Clicking "Quitar" in SavedRecommendationsPanel calls act({ song }, undefined, "save") -> DELETE endpoint.
    tree = reactTestRuntime.getTree();
    const removeButton = findButtons(tree, `Quitar ${songA.title} de guardadas`)[0];
    clickButton(removeButton);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/me/favorites/recordings",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ recordingId: songA.id }),
      }),
    );
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.error).toBe("");
    expect(latestLib.notice).toBe(`Canción quitada de guardadas: ${songA.title}.`);
  });

  it("handles initial load failures with retryLoad, action failures without corrupting state, and per-song busy locks", async () => {
    const saveADeferred = deferred<Response>();
    const saveBDeferred = deferred<Response>();

    fetchMock
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ error: "Servicio no disponible" }, 503))
      .mockResolvedValueOnce(jsonResponse({ songs: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "Error temporal al guardar" }, 500))
      .mockImplementationOnce(() => saveADeferred.promise)
      .mockImplementationOnce(() => saveBDeferred.promise);

    let latestLib!: ReturnType<typeof useRecommendationLibrary>;
    function Probe() {
      latestLib = useRecommendationLibrary();
      return (
        <>
          <SavedRecommendationsPanel />
          <RecommendationActions recommendation={makeRecommendation(songA, "res-a")} requestId="req-a" />
          <RecommendationActions recommendation={makeRecommendation(songB, "res-b")} requestId="req-b" />
        </>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <Probe />
      </RecommendationLibraryProvider>,
    );

    // 1) Non-JSON 502 initial load failure falls back to generic error, shows Reintentar, keeps actions disabled.
    expect(latestLib.ready).toBe(false);
    expect(latestLib.error).toBe("No se pudo guardar el cambio. Inténtalo de nuevo.");
    let tree = reactTestRuntime.getTree();
    clickButton(findButtons(tree, "Reintentar")[0]);
    await reactTestRuntime.flush();

    // 2) JSON 503 failure surfaces server error message and keeps Reintentar button visible.
    expect(latestLib.ready).toBe(false);
    expect(latestLib.error).toBe("Servicio no disponible");
    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "alert")[0])).toContain("Servicio no disponible");
    const retryButton = findButtons(tree, "Reintentar")[0];
    expect(retryButton).toBeDefined();
    expect(findButtons(findActionGroup(tree, songA)!, "Guardar")[0].props.disabled).toBe(true);

    // 3) Click Reintentar -> succeeds, clears error, removes Reintentar button.
    clickButton(retryButton);
    await reactTestRuntime.flush();

    expect(latestLib.ready).toBe(true);
    expect(latestLib.error).toBe("");
    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, "Reintentar")).toHaveLength(0);

    // 4) Failed action preserves state and clears busy so user can retry.
    clickButton(findButtons(findActionGroup(tree, songA)!, "Guardar")[0]);
    await reactTestRuntime.flush();
    expect(latestLib.error).toBe("Error temporal al guardar");
    expect(latestLib.songs).toEqual([]);
    expect(latestLib.busy.size).toBe(0);

    // 5) Concurrent actions on different songs: songA busy blocks duplicate songA + panel Quitar, allows songB.
    tree = reactTestRuntime.getTree();
    clickButton(findButtons(findActionGroup(tree, songA)!, "Guardar")[0]);
    await reactTestRuntime.flush();

    expect(latestLib.busy.has(songA.id)).toBe(true);
    tree = reactTestRuntime.getTree();
    expect(findActionGroup(tree, songA)!.props["aria-busy"]).toBe(true);
    expect(findButtons(findActionGroup(tree, songA)!, "Guardar")[0].props.disabled).toBe(true);

    // Direct duplicate call for songA while busy is ignored (no extra fetch).
    void latestLib.act(makeRecommendation(songA, "res-a"), "req-a", "save");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // Different songB remains enabled and can act concurrently.
    const saveBBtn = findButtons(findActionGroup(tree, songB)!, "Guardar")[0];
    expect(saveBBtn.props.disabled).toBe(false);
    clickButton(saveBBtn);
    await reactTestRuntime.flush();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(latestLib.busy.has(songB.id)).toBe(true);

    // Resolve both concurrent actions -> both songs survive via state.current ref continuity.
    saveADeferred.resolve(jsonResponse({ saved: true }));
    await reactTestRuntime.flush();
    saveBDeferred.resolve(jsonResponse({ saved: true }));
    await reactTestRuntime.flush();

    expect(latestLib.busy.size).toBe(0);
    expect(latestLib.songs).toEqual([songA, songB]);

    // While any song is busy, SavedRecommendationsPanel's Quitar buttons are disabled.
    const voteADeferred = deferred<Response>();
    fetchMock.mockImplementationOnce(() => voteADeferred.promise);
    tree = reactTestRuntime.getTree();
    clickButton(findButtons(findActionGroup(tree, songA)!, "Me gusta")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, `Quitar ${songA.title} de guardadas`)[0].props.disabled).toBe(true);
    expect(findButtons(tree, `Quitar ${songB.title} de guardadas`)[0].props.disabled).toBe(true);

    voteADeferred.resolve(jsonResponse({ value: "LIKE" }));
    await reactTestRuntime.flush();
    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, `Quitar ${songA.title} de guardadas`)[0].props.disabled).toBe(false);
  });

  it("preserves saved songs, votes, and in-flight pending state when switching consumers under the shared provider", async () => {
    const inFlightVote = deferred<Response>();

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me/saved-recommendations") {
        return jsonResponse({ songs: [] });
      }
      if (url.endsWith("/saved")) {
        return jsonResponse({ saved: true });
      }
      if (url.endsWith("/feedback")) {
        return inFlightVote.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    function DemoScreen() {
      return (
        <div data-screen="demo">
          <RecommendationActions recommendation={makeRecommendation(songA, "res-a")} requestId="req-a" />
          <SavedRecommendationsPanel />
        </div>
      );
    }

    function ExplorerScreen() {
      return (
        <div data-screen="explorer">
          <RecommendationActions recommendation={makeRecommendation(songA, "res-a")} requestId="req-a" />
          <SavedRecommendationsPanel />
        </div>
      );
    }

    await mountApp(
      <RecommendationLibraryProvider>
        <DemoScreen />
      </RecommendationLibraryProvider>,
    );

    // Save songA and start an in-flight vote in DemoScreen.
    clickButton(findButtons(findActionGroup(reactTestRuntime.getTree(), songA)!, "Guardar")[0]);
    await reactTestRuntime.flush();
    clickButton(findButtons(findActionGroup(reactTestRuntime.getTree(), songA)!, "Me gusta")[0]);
    await reactTestRuntime.flush();

    // Navigate to ExplorerScreen under the same RecommendationLibraryProvider while vote is still pending.
    await rerenderApp(
      <RecommendationLibraryProvider>
        <ExplorerScreen />
      </RecommendationLibraryProvider>,
    );

    // No duplicate initial load occurred.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/me/saved-recommendations")).toHaveLength(1);

    // ExplorerScreen immediately sees saved song and pending busy state.
    let tree = reactTestRuntime.getTree();
    expect(findHostNodes(tree, (n) => n.props["data-screen"] === "explorer")).toHaveLength(1);
    const explorerGroup = findActionGroup(tree, songA)!;
    expect(explorerGroup.props["aria-busy"]).toBe(true);
    expect(findButtons(explorerGroup, "Guardada · Quitar")[0].props["aria-pressed"]).toBe(true);
    expect(findButtons(explorerGroup, "Me gusta")[0].props.disabled).toBe(true);

    // Complete the in-flight vote after navigation -> ExplorerScreen updates cleanly.
    inFlightVote.resolve(jsonResponse({ value: "LIKE" }));
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const updatedGroup = findActionGroup(tree, songA)!;
    expect(updatedGroup.props["aria-busy"]).toBe(false);
    expect(findButtons(updatedGroup, "Me gusta")[0].props["aria-pressed"]).toBe(true);
    expect(findButtons(updatedGroup, "Me gusta")[0].props.disabled).toBe(false);
  });
});
