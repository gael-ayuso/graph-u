import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  clickButton,
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
  return { ...runtime.reactMock, default: runtime.reactMock };
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

const {
  useUserMock,
  usePathnameMock,
  useParamsMock,
  createTestQueryClient,
} = vi.hoisted(() => {
  const makeQueryClient = () => {
    const cache = new Map<string, unknown>();
    const cacheListeners = new Map<string, Set<() => void>>();
    const invalidateListeners = new Map<string, Set<() => void>>();

    const keyToString = (queryKey: readonly unknown[]) => JSON.stringify(queryKey);

    const matchesPrefix = (targetKeyStr: string, prefixKey: readonly unknown[]) => {
      try {
        const target = JSON.parse(targetKeyStr) as unknown[];
        if (!Array.isArray(target) || target.length < prefixKey.length) return false;
        return prefixKey.every((part, idx) => JSON.stringify(target[idx]) === JSON.stringify(part));
      } catch {
        return false;
      }
    };

    const getQueryData = vi.fn(<T,>(queryKey: readonly unknown[]): T | undefined => {
      return cache.get(keyToString(queryKey)) as T | undefined;
    });

    const setQueryData = vi.fn(
      <T,>(queryKey: readonly unknown[], updater: T | ((prev: T | undefined) => T)) => {
        const keyStr = keyToString(queryKey);
        const prev = cache.get(keyStr) as T | undefined;
        const next =
          typeof updater === "function"
            ? (updater as (p: T | undefined) => T)(prev)
            : updater;
        cache.set(keyStr, next);
        const set = cacheListeners.get(keyStr);
        if (set) {
          for (const listener of [...set]) listener();
        }
        return next;
      },
    );

    const cancelQueries = vi.fn(async () => {});

    const invalidateQueries = vi.fn(async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      for (const [registeredKeyStr, listeners] of invalidateListeners.entries()) {
        if (matchesPrefix(registeredKeyStr, queryKey)) {
          for (const listener of [...listeners]) listener();
        }
      }
    });

    return {
      cache,
      getQueryData,
      setQueryData,
      cancelQueries,
      invalidateQueries,
      subscribeCache(keyStr: string, listener: () => void) {
        if (!cacheListeners.has(keyStr)) cacheListeners.set(keyStr, new Set());
        cacheListeners.get(keyStr)!.add(listener);
        return () => {
          cacheListeners.get(keyStr)?.delete(listener);
        };
      },
      subscribeInvalidate(keyStr: string, listener: () => void) {
        if (!invalidateListeners.has(keyStr)) invalidateListeners.set(keyStr, new Set());
        invalidateListeners.get(keyStr)!.add(listener);
        return () => {
          invalidateListeners.get(keyStr)?.delete(listener);
        };
      },
      reset() {
        cache.clear();
        cacheListeners.clear();
        invalidateListeners.clear();
        getQueryData.mockClear();
        setQueryData.mockClear();
        cancelQueries.mockClear();
        invalidateQueries.mockClear();
      },
    };
  };

  return {
    useUserMock: vi.fn(),
    usePathnameMock: vi.fn(),
    useParamsMock: vi.fn(),
    createTestQueryClient: makeQueryClient,
  };
});

const queryClient = createTestQueryClient();

vi.mock("next/link", async () => {
  const { jsxElement: createJsx } = await import(
    "./helpers/recommendation-library-harness"
  );
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children?: ReactNode;
      [key: string]: unknown;
    }) => createJsx("a", { href, ...rest, children }),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useParams: useParamsMock,
}));

vi.mock("@clerk/nextjs", async () => {
  const { jsxElement: createJsx } = await import(
    "./helpers/recommendation-library-harness"
  );
  return {
    useUser: useUserMock,
    UserButton: () => createJsx("div", { "data-testid": "clerk-user-button" }),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const { reactTestRuntime: runtime } = await import(
    "./helpers/recommendation-library-harness"
  );
  const { useEffect, useRef, useState } = runtime.reactMock;

  return {
    useQueryClient: () => queryClient,
    useQuery: <TData,>(options: {
      queryKey: readonly unknown[];
      queryFn: () => Promise<TData>;
      enabled?: boolean;
    }) => {
      const enabled = options.enabled ?? true;
      const keyStr = JSON.stringify(options.queryKey);
      const queryFnRef = useRef(options.queryFn);
      queryFnRef.current = options.queryFn;

      const [, setTick] = useState(0);
      const stateRef = useRef<{
        keyStr: string;
        status: "idle" | "loading" | "success" | "error";
        error: unknown;
      }>({ keyStr, status: "idle", error: null });

      if (stateRef.current.keyStr !== keyStr) {
        stateRef.current = { keyStr, status: "idle", error: null };
      }

      const runFetch = () => {
        if (!enabled) return Promise.resolve();
        const requestKey = keyStr;
        if (!queryClient.cache.has(requestKey)) {
          stateRef.current.status = "loading";
        }
        stateRef.current.error = null;
        setTick((t) => t + 1);

        return queryFnRef
          .current()
          .then((result) => {
            if (stateRef.current.keyStr !== requestKey) return;
            queryClient.cache.set(requestKey, result);
            stateRef.current.status = "success";
            stateRef.current.error = null;
            setTick((t) => t + 1);
          })
          .catch((error: unknown) => {
            if (stateRef.current.keyStr !== requestKey) return;
            stateRef.current.status = "error";
            stateRef.current.error = error;
            setTick((t) => t + 1);
          });
      };

      const runFetchRef = useRef(runFetch);
      runFetchRef.current = runFetch;

      useEffect(() => {
        const unsubCache = queryClient.subscribeCache(keyStr, () => {
          setTick((t) => t + 1);
        });
        const unsubInvalidate = queryClient.subscribeInvalidate(keyStr, () => {
          void runFetchRef.current();
        });

        if (enabled && !queryClient.cache.has(keyStr)) {
          void runFetchRef.current();
        }

        return () => {
          unsubCache();
          unsubInvalidate();
        };
      }, [keyStr, enabled]);

      const hasCached = queryClient.cache.has(keyStr);
      const isLoading =
        enabled &&
        !hasCached &&
        (stateRef.current.status === "idle" || stateRef.current.status === "loading");
      const isError = enabled && stateRef.current.status === "error";

      return {
        data: hasCached ? (queryClient.cache.get(keyStr) as TData) : undefined,
        isLoading,
        isError,
        error: isError ? stateRef.current.error : null,
        refetch: () => runFetchRef.current(),
      };
    },
    useMutation: <TData, TError extends Error, TVariables, TContext>(options: {
      mutationFn: (variables: TVariables) => Promise<TData>;
      onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
      onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => unknown;
      onError?: (error: TError, variables: TVariables, context: TContext | undefined) => unknown;
      onSettled?: (
        data: TData | undefined,
        error: TError | null,
        variables: TVariables,
        context: TContext | undefined,
      ) => unknown;
    }) => {
      const [state, setState] = useState<{
        isPending: boolean;
        isError: boolean;
        error: unknown;
      }>({ isPending: false, isError: false, error: null });

      const mutate = (variables: TVariables) => {
        setState({ isPending: true, isError: false, error: null });
        void (async () => {
          let context: TContext | undefined;
          try {
            if (options.onMutate) {
              context = await options.onMutate(variables);
            }
            const data = await options.mutationFn(variables);
            await options.onSuccess?.(data, variables, context);
            await options.onSettled?.(data, null, variables, context);
            setState({ isPending: false, isError: false, error: null });
          } catch (error) {
            await options.onError?.(error as TError, variables, context);
            await options.onSettled?.(undefined, error as TError, variables, context);
            setState({ isPending: false, isError: true, error });
          }
        })();
      };

      return {
        mutate,
        isPending: state.isPending,
        isError: state.isError,
        error: state.error,
      };
    },
  };
});

import PlaylistsPage from "@/app/playlists/page";
import PlaylistDetailPage from "@/app/playlists/[id]/page";

const PLAYLIST_ID_1 = "11111111-2222-4333-8444-555555555555";
const PLAYLIST_ID_2 = "22222222-2222-4333-8444-555555555555";
const TRACK_ID_1 = "aaaaaaaa-1111-4111-8111-111111111111";
const TRACK_ID_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const TRACK_ID_3 = "cccccccc-3333-4333-8333-333333333333";
const RECORDING_ID_1 = "dddddddd-4444-4444-8444-444444444444";
const RECORDING_ID_2 = "eeeeeeee-5555-4555-8555-555555555555";
const RECORDING_ID_3 = "ffffffff-6666-4666-8666-666666666666";

async function mountApp(node: ReactNode) {
  await reactTestRuntime.mount(node as unknown as VElement);
}

function findInputById(root: HostNode, id: string): HostNode {
  const match = findHostNodes(
    root,
    (node) => node.tag === "input" && node.props.id === id,
  )[0];
  if (!match) {
    throw new Error(`Input #${id} not found`);
  }
  return match;
}

function changeInput(input: HostNode, value: string) {
  const onChange = input.props.onChange as
    | ((event: { target: { value: string } }) => void)
    | undefined;
  if (!onChange) {
    throw new Error(`Input #${String(input.props.id)} has no onChange`);
  }
  onChange({ target: { value } });
}

function submitForm(form: HostNode) {
  const onSubmit = form.props.onSubmit as
    | ((event: { preventDefault: () => void }) => void)
    | undefined;
  if (!onSubmit) {
    throw new Error("Form has no onSubmit");
  }
  onSubmit({ preventDefault: () => {} });
}

describe("app/playlists/page.tsx", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient.reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    usePathnameMock.mockReturnValue("/playlists");
    useParamsMock.mockReturnValue({});
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "clerk_user_1" },
    });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows LoadingState while Clerk is loading or playlists fetch is pending", async () => {
    useUserMock.mockReturnValue({ isLoaded: false, isSignedIn: false, user: null });
    await mountApp(<PlaylistsPage />);

    let tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain("Cargando tus playlists...");
    expect(findButtons(tree, "+ Nueva playlist")).toHaveLength(0);

    reactTestRuntime.unmount();
    queryClient.reset();

    const pendingFetch = deferred<Response>();
    fetchMock.mockReturnValueOnce(pendingFetch.promise);
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "clerk_user_1" },
    });

    await mountApp(<PlaylistsPage />);
    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain("Cargando tus playlists...");

    pendingFetch.resolve(
      jsonResponse({
        items: [],
        pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
      }),
    );
    await reactTestRuntime.flush();
  });

  it("shows EmptyState with /sign-in link and hides create button/form when unauthenticated", async () => {
    useUserMock.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });

    await mountApp(<PlaylistsPage />);
    const tree = reactTestRuntime.getTree();
    const text = getTextContent(tree);

    expect(text).toContain("Inicia sesión para ver tus playlists");
    expect(findButtons(tree, "+ Nueva playlist")).toHaveLength(0);
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const signInLinks = findHostNodes(
      tree,
      (n) =>
        n.tag === "a" &&
        n.props.href === "/sign-in" &&
        getTextContent(n).includes("Iniciar sesión"),
    );
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("shows ErrorState with retry button and recovers when retry succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Servicio no disponible" }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: PLAYLIST_ID_1,
              name: "Recuperada",
              description: null,
              version: 1,
              _count: { tracks: 2 },
            },
          ],
          pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
        }),
      );

    await mountApp(<PlaylistsPage />);
    let tree = reactTestRuntime.getTree();
    const alert = findByRole(tree, "alert")[0];

    expect(getTextContent(alert)).toContain("Error al cargar playlists");
    expect(getTextContent(alert)).toContain("Servicio no disponible");

    clickButton(findButtons(tree, "Reintentar")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Recuperada");
    expect(getTextContent(tree)).toContain("2 canciones");
  });

  it("creates a playlist via POST /api/me/playlists and renders _count.tracks", async () => {
    const serverPlaylists: Array<{
      id: string;
      name: string;
      description: string | null;
      version: number;
      _count: { tracks: number };
    }> = [
      {
        id: PLAYLIST_ID_1,
        name: "Favoritas 90s",
        description: "Shoegaze y trip-hop",
        version: 1,
        _count: { tracks: 1 },
      },
    ];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/me/playlists?") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          items: [...serverPlaylists],
          pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
        });
      }
      if (url === "/api/me/playlists" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string; description: string | null };
        const created = {
          id: PLAYLIST_ID_2,
          name: body.name,
          description: body.description,
          version: 1,
          _count: { tracks: 0 },
        };
        serverPlaylists.unshift(created);
        return jsonResponse({ playlist: created }, 201);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await mountApp(<PlaylistsPage />);
    let tree = reactTestRuntime.getTree();

    expect(getTextContent(tree)).toContain("Favoritas 90s");
    expect(getTextContent(tree)).toContain("1 canción");

    clickButton(findButtons(tree, "+ Nueva playlist")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    changeInput(findInputById(tree, "playlistName"), "  Noche Electrónica  ");
    changeInput(findInputById(tree, "playlistDesc"), "  Ambient y synth  ");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    submitForm(findHostNodes(tree, (n) => n.tag === "form")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/playlists",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Noche Electrónica", description: "Ambient y synth" }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain('Playlist "Noche Electrónica" creada.');
    expect(getTextContent(tree)).toContain("Noche Electrónica");
    expect(getTextContent(tree)).toContain("0 canciones");
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(0);
  });

  it("supports inline per-card delete confirmation (Cancel / Confirm with expectedVersion) and handles 409 conflicts", async () => {
    let serverPlaylists = [
      {
        id: PLAYLIST_ID_1,
        name: "Lista Uno",
        description: "Desc 1",
        version: 3,
        _count: { tracks: 4 },
      },
      {
        id: PLAYLIST_ID_2,
        name: "Lista Dos",
        description: null,
        version: 2,
        _count: { tracks: 0 },
      },
    ];
    let nextDeleteConflict = true;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/me/playlists?") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          items: [...serverPlaylists],
          pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
        });
      }
      if (url === `/api/me/playlists/${PLAYLIST_ID_1}` && init?.method === "DELETE") {
        if (nextDeleteConflict) {
          nextDeleteConflict = false;
          serverPlaylists = serverPlaylists.map((p) =>
            p.id === PLAYLIST_ID_1 ? { ...p, version: 4 } : p,
          );
          return jsonResponse(
            { error: "La playlist fue modificada en otra sesión.", code: "VERSION_CONFLICT" },
            409,
          );
        }
        serverPlaylists = serverPlaylists.filter((p) => p.id !== PLAYLIST_ID_1);
        return jsonResponse({ deleted: true, id: PLAYLIST_ID_1 }, 200);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await mountApp(<PlaylistsPage />);
    let tree = reactTestRuntime.getTree();

    // Open inline confirm and cancel
    clickButton(findButtons(tree, "Eliminar Lista Uno")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("¿Eliminar Lista Uno y sus 4 canciones?");
    clickButton(findButtons(tree, "Cancelar")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, "Confirmar")).toHaveLength(0);

    // Open inline confirm and submit -> triggers 409 conflict
    clickButton(findButtons(tree, "Eliminar Lista Uno")[0]);
    await reactTestRuntime.flush();
    tree = reactTestRuntime.getTree();
    clickButton(findButtons(tree, "Confirmar")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/me/playlists/${PLAYLIST_ID_1}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "alert")[0])).toContain(
      "La playlist fue modificada en otra sesión.",
    );
    expect(findButtons(tree, "Confirmar")).toHaveLength(0);

    // Retry delete after refetch updated version to 4 -> succeeds
    clickButton(findButtons(tree, "Eliminar Lista Uno")[0]);
    await reactTestRuntime.flush();
    tree = reactTestRuntime.getTree();
    clickButton(findButtons(tree, "Confirmar")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/me/playlists/${PLAYLIST_ID_1}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 4 }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain(
      'Playlist "Lista Uno" eliminada.',
    );
    const cards = findHostNodes(tree, (n) => n.tag === "article");
    expect(cards).toHaveLength(1);
    expect(getTextContent(cards[0])).toContain("Lista Dos");
    expect(getTextContent(cards[0])).not.toContain("Lista Uno");
  });
});

describe("app/playlists/[id]/page.tsx", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient.reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    usePathnameMock.mockReturnValue(`/playlists/${PLAYLIST_ID_1}`);
    useParamsMock.mockReturnValue({ id: PLAYLIST_ID_1 });
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "clerk_user_1" },
    });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows LoadingState while Clerk or detail/tracks queries are loading", async () => {
    useUserMock.mockReturnValue({ isLoaded: false, isSignedIn: false, user: null });
    await mountApp(<PlaylistDetailPage />);
    expect(getTextContent(findByRole(reactTestRuntime.getTree(), "status")[0])).toContain(
      "Cargando detalle de playlist...",
    );

    reactTestRuntime.unmount();
    queryClient.reset();

    const pendingDetail = deferred<Response>();
    const pendingTracks = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tracks")) return pendingTracks.promise;
      return pendingDetail.promise;
    });

    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "clerk_user_1" },
    });
    await mountApp(<PlaylistDetailPage />);

    expect(getTextContent(findByRole(reactTestRuntime.getTree(), "status")[0])).toContain(
      "Cargando detalle de playlist...",
    );

    pendingDetail.resolve(
      jsonResponse({
        playlist: { id: PLAYLIST_ID_1, name: "P", description: null, version: 1 },
      }),
    );
    pendingTracks.resolve(
      jsonResponse({
        items: [],
        pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
      }),
    );
    await reactTestRuntime.flush();
  });

  it("shows EmptyState with /sign-in link when unauthenticated", async () => {
    useUserMock.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });
    await mountApp(<PlaylistDetailPage />);

    const tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Inicia sesión para ver esta playlist");
    expect(fetchMock).not.toHaveBeenCalled();

    const signInLinks = findHostNodes(
      tree,
      (n) => n.tag === "a" && n.props.href === "/sign-in",
    );
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 404 state with /playlists links and ErrorState with retry recovery", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: "Recurso no encontrado." }, 404));

    await mountApp(<PlaylistDetailPage />);
    let tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("No encontramos esta playlist");
    const backLinks = findHostNodes(
      tree,
      (n) => n.tag === "a" && n.props.href === "/playlists",
    );
    expect(backLinks.length).toBeGreaterThanOrEqual(2);

    reactTestRuntime.unmount();
    queryClient.reset();

    let failDetail = true;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tracks")) {
        return jsonResponse({
          items: [],
          pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
        });
      }
      if (failDetail) {
        failDetail = false;
        return jsonResponse({ error: "Error temporal de servidor" }, 503);
      }
      return jsonResponse({
        playlist: {
          id: PLAYLIST_ID_1,
          name: "Playlist Recuperada",
          description: "Lista",
          version: 1,
        },
      });
    });

    await mountApp(<PlaylistDetailPage />);
    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "alert")[0])).toContain("Error al abrir playlist");

    clickButton(findButtons(tree, "Reintentar")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Playlist Recuperada");
  });

  it("edits playlist name/description with PATCH expectedVersion, searches catalog with disabled 'Ya en lista', adds/removes tracks, and renders honest null fallbacks", async () => {
    let playlistState = {
      id: PLAYLIST_ID_1,
      name: "Mi Mix",
      description: "Original",
      version: 1,
      _count: { tracks: 2 },
    };

    let tracksState = [
      {
        id: TRACK_ID_1,
        playlistId: PLAYLIST_ID_1,
        recordingId: RECORDING_ID_1,
        title: "Reckoner",
        artistName: "Radiohead",
        position: 0,
      },
      {
        id: TRACK_ID_2,
        playlistId: PLAYLIST_ID_1,
        recordingId: RECORDING_ID_2,
        title: null as string | null,
        artistName: null as string | null,
        position: 1,
      },
    ];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === `/api/me/playlists/${PLAYLIST_ID_1}` && method === "GET") {
        return jsonResponse({ playlist: { ...playlistState } });
      }
      if (url.startsWith(`/api/me/playlists/${PLAYLIST_ID_1}/tracks?`) && method === "GET") {
        return jsonResponse({
          items: [...tracksState],
          pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
        });
      }
      if (url === `/api/me/playlists/${PLAYLIST_ID_1}` && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as {
          name: string;
          description: string | null;
          expectedVersion: number;
        };
        playlistState = {
          ...playlistState,
          name: body.name,
          description: body.description ?? "",
          version: playlistState.version + 1,
        };
        return jsonResponse({ playlist: { ...playlistState } });
      }
      if (url.startsWith("/api/music/search?")) {
        return jsonResponse({
          songs: [
            {
              id: RECORDING_ID_1.toUpperCase(),
              title: "Reckoner",
              artist: "Radiohead",
              release: "In Rainbows",
              duration: 290000,
              comment: null,
            },
            {
              id: RECORDING_ID_3,
              title: "Bizarre Love Triangle",
              artist: "New Order",
              release: "Brotherhood",
              duration: 262000,
              comment: null,
            },
          ],
        });
      }
      if (url === `/api/me/playlists/${PLAYLIST_ID_1}/tracks` && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          recordingId: string;
          expectedVersion: number;
        };
        const created = {
          id: TRACK_ID_3,
          playlistId: PLAYLIST_ID_1,
          recordingId: body.recordingId,
          title: "Bizarre Love Triangle",
          artistName: "New Order",
          position: tracksState.length,
        };
        tracksState = [...tracksState, created];
        playlistState = {
          ...playlistState,
          version: playlistState.version + 1,
          _count: { tracks: tracksState.length },
        };
        return jsonResponse(
          { track: created, version: playlistState.version, trackCount: tracksState.length },
          201,
        );
      }
      if (url === `/api/me/playlists/${PLAYLIST_ID_1}/tracks/${TRACK_ID_2}` && method === "DELETE") {
        tracksState = tracksState
          .filter((t) => t.id !== TRACK_ID_2)
          .map((t, i) => ({ ...t, position: i }));
        playlistState = {
          ...playlistState,
          version: playlistState.version + 1,
          _count: { tracks: tracksState.length },
        };
        return jsonResponse({
          deleted: true,
          trackId: TRACK_ID_2,
          version: playlistState.version,
          remainingCount: tracksState.length,
        });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    await mountApp(<PlaylistDetailPage />);
    let tree = reactTestRuntime.getTree();

    // Honest fallback UI for null title / artistName
    const initialText = getTextContent(tree);
    expect(initialText).toContain("Reckoner");
    expect(initialText).toContain(`Grabación (${RECORDING_ID_2.slice(0, 8)}…)`);
    expect(initialText).toContain("Artista no disponible sin catálogo");

    // 1) Edit name and description
    clickButton(findButtons(tree, "Editar nombre")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    changeInput(findInputById(tree, "editName"), "Mi Mix Editado");
    changeInput(findInputById(tree, "editDesc"), "Descripción nueva");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    submitForm(findHostNodes(tree, (n) => n.tag === "form")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/me/playlists/${PLAYLIST_ID_1}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Mi Mix Editado",
          description: "Descripción nueva",
          expectedVersion: 1,
        }),
      }),
    );
    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Mi Mix Editado");
    expect(getTextContent(tree)).toContain("Información actualizada.");

    // 2) Open inline catalog search, search songs, verify 'Ya en lista' disabled state
    clickButton(findButtons(tree, "+ Agregar canciones")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    changeInput(findInputById(tree, "catalogSongQuery"), "Bizarre");
    changeInput(findInputById(tree, "catalogArtistQuery"), "New Order");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    submitForm(findHostNodes(tree, (n) => n.tag === "form")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/music/search?q=Bizarre&artist=New+Order",
      expect.objectContaining({ cache: "no-store" }),
    );

    tree = reactTestRuntime.getTree();
    const alreadyInBtn = findButtons(tree, "Reckoner ya está en la lista")[0];
    expect(alreadyInBtn.props.disabled).toBe(true);
    expect(getTextContent(alreadyInBtn).trim()).toBe("Ya en lista");

    // 3) Add new track from search results
    clickButton(findButtons(tree, "Agregar Bizarre Love Triangle")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/me/playlists/${PLAYLIST_ID_1}/tracks`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recordingId: RECORDING_ID_3, expectedVersion: 2 }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain('Se agregó "Bizarre Love Triangle" a la playlist.');
    expect(findButtons(tree, "Bizarre Love Triangle ya está en la lista")[0].props.disabled).toBe(
      true,
    );

    // 4) Remove null-metadata track
    const removeTargetLabel = `Quitar Grabación (${RECORDING_ID_2.slice(0, 8)}…) de la playlist`;
    clickButton(findButtons(tree, removeTargetLabel)[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/me/playlists/${PLAYLIST_ID_1}/tracks/${TRACK_ID_2}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Canción quitada de la playlist.");
    expect(getTextContent(tree)).not.toContain("Artista no disponible sin catálogo");
  });

  it("reorders tracks optimistically, commits on 200, rolls back on 409 conflict with banner + 'Recargar lista', and reloads state", async () => {
    let serverVersion = 2;
    let serverTracks = [
      {
        id: TRACK_ID_1,
        playlistId: PLAYLIST_ID_1,
        recordingId: RECORDING_ID_1,
        title: "Primera Canción",
        artistName: "Artista A",
        position: 0,
      },
      {
        id: TRACK_ID_2,
        playlistId: PLAYLIST_ID_1,
        recordingId: RECORDING_ID_2,
        title: "Segunda Canción",
        artistName: "Artista B",
        position: 1,
      },
    ];

    const pendingFirstReorder = deferred<Response>();
    const pendingConflictReorder = deferred<Response>();
    let reorderCallCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === `/api/me/playlists/${PLAYLIST_ID_1}` && method === "GET") {
        return jsonResponse({
          playlist: {
            id: PLAYLIST_ID_1,
            name: "Reordenar Test",
            description: null,
            version: serverVersion,
          },
        });
      }
      if (url.startsWith(`/api/me/playlists/${PLAYLIST_ID_1}/tracks?`) && method === "GET") {
        return jsonResponse({
          items: [...serverTracks],
          pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
        });
      }
      if (url === `/api/me/playlists/${PLAYLIST_ID_1}/tracks/reorder` && method === "PUT") {
        reorderCallCount += 1;
        return reorderCallCount === 1
          ? pendingFirstReorder.promise
          : pendingConflictReorder.promise;
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    await mountApp(<PlaylistDetailPage />);
    let tree = reactTestRuntime.getTree();

    const getRenderedTrackTitles = (root: HostNode) => {
      const lists = findHostNodes(root, (n) => n.tag === "ul");
      const items = findHostNodes(lists[0], (n) => n.tag === "li");
      return items.map((li) => getTextContent(li));
    };

    expect(getRenderedTrackTitles(tree)[0]).toContain("Primera Canción");
    expect(getRenderedTrackTitles(tree)[1]).toContain("Segunda Canción");

    // 1) Optimistic move + 200 success
    clickButton(findButtons(tree, "Bajar Primera Canción")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(getRenderedTrackTitles(tree)[0]).toContain("Segunda Canción");
    expect(getRenderedTrackTitles(tree)[1]).toContain("Primera Canción");

    serverVersion = 3;
    serverTracks = [
      { ...serverTracks[1], position: 0 },
      { ...serverTracks[0], position: 1 },
    ];
    pendingFirstReorder.resolve(
      jsonResponse({
        ok: true,
        version: 3,
        trackIds: [TRACK_ID_2, TRACK_ID_1],
      }),
    );
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain("Orden guardado.");
    expect(getRenderedTrackTitles(tree)[0]).toContain("Segunda Canción");
    expect(getRenderedTrackTitles(tree)[1]).toContain("Primera Canción");

    // 2) Optimistic move + 409 conflict -> rollback + banner + "Recargar lista"
    clickButton(findButtons(tree, "Subir Primera Canción")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(getRenderedTrackTitles(tree)[0]).toContain("Primera Canción");
    expect(getRenderedTrackTitles(tree)[1]).toContain("Segunda Canción");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/me/playlists/${PLAYLIST_ID_1}/tracks/reorder`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          trackIds: [TRACK_ID_1, TRACK_ID_2],
          expectedVersion: 3,
        }),
      }),
    );

    serverVersion = 5;
    serverTracks = [
      {
        id: TRACK_ID_3,
        playlistId: PLAYLIST_ID_1,
        recordingId: RECORDING_ID_3,
        title: "Tercera Remota",
        artistName: "Artista C",
        position: 0,
      },
      ...serverTracks.map((t, i) => ({ ...t, position: i + 1 })),
    ];

    pendingConflictReorder.resolve(
      jsonResponse(
        { error: "La playlist fue modificada en otra sesión.", code: "VERSION_CONFLICT" },
        409,
      ),
    );
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    // Rolled back to pre-conflict order [Segunda Canción, Primera Canción]
    expect(getRenderedTrackTitles(tree)[0]).toContain("Segunda Canción");
    expect(getRenderedTrackTitles(tree)[1]).toContain("Primera Canción");

    const conflictBanner = findByRole(tree, "alert")[0];
    expect(getTextContent(conflictBanner)).toContain("La playlist fue modificada en otra sesión.");
    const reloadBtn = findButtons(tree, "Recargar lista")[0];
    expect(reloadBtn).toBeDefined();

    // Click "Recargar lista" -> fetches latest server state and clears conflict banner
    clickButton(reloadBtn);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findByRole(tree, "alert")).toHaveLength(0);
    expect(getRenderedTrackTitles(tree)[0]).toContain("Tercera Remota");
  });
});
