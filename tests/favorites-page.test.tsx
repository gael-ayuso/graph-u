import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  clickButton,
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
  const reactWithExtras = {
    ...runtime.reactMock,
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(fn: T) => fn,
  };
  return { ...reactWithExtras, default: reactWithExtras };
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
  useQueryMock,
  queryClientMock,
} = vi.hoisted(() => ({
  useUserMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useQueryMock: vi.fn(),
  queryClientMock: {
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
  },
}));

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
  return {
    useQuery: useQueryMock,
    useQueryClient: () => queryClientMock,
    useMutation: <TData, TVariables>(options: {
      mutationFn: (variables: TVariables) => Promise<TData>;
      onSuccess?: (data: TData, variables: TVariables) => unknown;
      onError?: (error: Error) => unknown;
    }) => {
      const [state, setState] = runtime.reactMock.useState<{
        isPending: boolean;
        isError: boolean;
        error: unknown;
      }>({ isPending: false, isError: false, error: null });

      const mutate = (variables: TVariables) => {
        setState({ isPending: true, isError: false, error: null });
        void Promise.resolve()
          .then(() => options.mutationFn(variables))
          .then(async (data) => {
            await options.onSuccess?.(data, variables);
            setState({ isPending: false, isError: false, error: null });
          })
          .catch((error: unknown) => {
            options.onError?.(error instanceof Error ? error : new Error(String(error)));
            setState({ isPending: false, isError: true, error });
          });
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

import FavoritosPage from "@/app/favoritos/page";

const TRACK_1 = {
  id: "fav-t1",
  recordingMbid: "11111111-2222-4333-8444-555555555555",
  title: "Weird Fishes",
  artistName: "Radiohead",
  createdAt: "2025-05-01T00:00:00.000Z",
};

const TRACK_CATALOG_NEW = {
  recordingMbid: "22222222-2222-4333-8444-555555555555",
  title: "Reckoner",
  artistName: "Radiohead",
  artistMbid: "99999999-8888-4777-8666-555555555555",
  durationMs: 290000,
  comment: null,
};

const ARTIST_1 = {
  id: "fav-a1",
  artistMbid: "99999999-8888-4777-8666-555555555555",
  name: "Radiohead",
  createdAt: "2025-05-01T00:00:00.000Z",
};

const ARTIST_CATALOG_NEW = {
  artistMbid: "88888888-8888-4777-8666-555555555555",
  name: "Portishead",
  sortName: "Portishead",
  comment: "Bristol",
};

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
    throw new Error(`Input has no onChange`);
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

describe("app/favoritos/page.tsx", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let favoritesState: {
    tracks: Array<typeof TRACK_1>;
    artists: Array<typeof ARTIST_1>;
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    favoritesState = {
      tracks: [{ ...TRACK_1 }],
      artists: [{ ...ARTIST_1 }],
    };

    usePathnameMock.mockReturnValue("/favoritos");
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "clerk_user_1" },
    });

    queryClientMock.invalidateQueries.mockResolvedValue(undefined);
    queryClientMock.setQueryData.mockImplementation(
      (_key: unknown, updater: unknown) => {
        if (typeof updater === "function") {
          favoritesState = (
            updater as (prev: typeof favoritesState) => typeof favoritesState
          )(favoritesState);
        } else if (updater && typeof updater === "object") {
          favoritesState = updater as typeof favoritesState;
        }
      },
    );

    useQueryMock.mockImplementation(() => ({
      data: favoritesState,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows LoadingState while Clerk is not loaded or favorites query is loading", async () => {
    useUserMock.mockReturnValue({ isLoaded: false, isSignedIn: false, user: null });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    await mountApp(<FavoritosPage />);
    let tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain(
      "Cargando biblioteca de favoritos...",
    );
    expect(findByRole(tree, "tab")).toHaveLength(0);

    reactTestRuntime.unmount();
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "clerk_user_1" },
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    await mountApp(<FavoritosPage />);
    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain(
      "Cargando biblioteca de favoritos...",
    );
    expect(findByRole(tree, "tab")).toHaveLength(0);
  });

  it("shows sign-in EmptyState without 'Canciones (0)' or tabs when unauthenticated", async () => {
    useUserMock.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    await mountApp(<FavoritosPage />);
    const tree = reactTestRuntime.getTree();
    const text = getTextContent(tree);

    expect(text).toContain("Inicia sesión para ver tus favoritos");
    expect(text).not.toContain("Canciones (0)");
    expect(text).not.toContain("Artistas (0)");
    expect(findByRole(tree, "tab")).toHaveLength(0);

    const signInLinks = findHostNodes(
      tree,
      (n) =>
        n.tag === "a" &&
        n.props.href === "/sign-in" &&
        getTextContent(n).includes("Iniciar sesión"),
    );
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("renders only ErrorState without tabs or EmptyState when query fails", async () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("No se pudieron cargar tus favoritos."),
      refetch,
    });

    await mountApp(<FavoritosPage />);
    const tree = reactTestRuntime.getTree();
    const text = getTextContent(tree);
    const alert = findByRole(tree, "alert")[0];

    expect(getTextContent(alert)).toContain("Error al cargar favoritos");
    expect(getTextContent(alert)).toContain("No se pudieron cargar tus favoritos.");
    expect(findByRole(tree, "tab")).toHaveLength(0);
    expect(text).not.toContain("[ SIN REGISTROS ]");
    expect(text).not.toContain("Aún no tienes canciones favoritas");
    expect(text).not.toContain("Canciones (");

    clickButton(findButtons(tree, "Reintentar")[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("switches between Canciones and Artistas tabs and renders corrected links without /demo or /recomendaciones", async () => {
    await mountApp(<FavoritosPage />);
    let tree = reactTestRuntime.getTree();

    const allLinks = findHostNodes(tree, (n) => n.tag === "a");
    const hrefs = allLinks.map((n) => String(n.props.href));
    expect(hrefs).toContain("/explorar");
    expect(hrefs).toContain("/explorar?q=Weird+Fishes&artist=Radiohead");
    expect(hrefs).toContain(
      `/explorar/grafo?seed=${TRACK_1.recordingMbid}&title=Weird+Fishes&artist=Radiohead`,
    );
    expect(hrefs).not.toContain("/demo");
    expect(hrefs).not.toContain("/recomendaciones");
    expect(getTextContent(tree)).not.toContain("Recomendaciones");

    const tracksTab = findByRole(tree, "tab").find((n) => n.props.id === "tab-tracks")!;
    const artistsTab = findByRole(tree, "tab").find((n) => n.props.id === "tab-artists")!;
    expect(tracksTab.props["aria-selected"]).toBe(true);
    expect(artistsTab.props["aria-selected"]).toBe(false);
    expect(getTextContent(tracksTab)).toBe("Canciones (1)");
    expect(getTextContent(artistsTab)).toBe("Artistas (1)");

    const tracksPanel = findByRole(tree, "tabpanel").find((n) => n.props.id === "panel-tracks")!;
    const artistsPanel = findByRole(tree, "tabpanel").find((n) => n.props.id === "panel-artists")!;
    expect(tracksPanel.props.hidden).toBe(false);
    expect(artistsPanel.props.hidden).toBe(true);

    // Switch to Artistas tab
    clickButton(artistsTab);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const updatedTracksTab = findByRole(tree, "tab").find((n) => n.props.id === "tab-tracks")!;
    const updatedArtistsTab = findByRole(tree, "tab").find((n) => n.props.id === "tab-artists")!;
    const updatedTracksPanel = findByRole(tree, "tabpanel").find((n) => n.props.id === "panel-tracks")!;
    const updatedArtistsPanel = findByRole(tree, "tabpanel").find((n) => n.props.id === "panel-artists")!;

    expect(updatedTracksTab.props["aria-selected"]).toBe(false);
    expect(updatedArtistsTab.props["aria-selected"]).toBe(true);
    expect(updatedTracksPanel.props.hidden).toBe(true);
    expect(updatedArtistsPanel.props.hidden).toBe(false);
    expect(getTextContent(updatedArtistsPanel)).toContain("Radiohead");
  });

  it("supports inline catalog search to add tracks and artists and remove buttons to delete them", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/favorites/catalog?type=tracks")) {
        return jsonResponse({
          type: "tracks",
          items: [
            {
              recordingMbid: TRACK_1.recordingMbid,
              title: TRACK_1.title,
              artistName: TRACK_1.artistName,
              artistMbid: ARTIST_1.artistMbid,
              durationMs: 318000,
              comment: null,
            },
            TRACK_CATALOG_NEW,
          ],
        });
      }
      if (url.startsWith("/api/favorites/catalog?type=artists")) {
        return jsonResponse({
          type: "artists",
          items: [ARTIST_CATALOG_NEW],
        });
      }
      if (url === "/api/favorites/tracks" && init?.method === "POST") {
        return jsonResponse(
          {
            track: {
              id: "fav-t2",
              recordingMbid: TRACK_CATALOG_NEW.recordingMbid,
              title: TRACK_CATALOG_NEW.title,
              artistName: TRACK_CATALOG_NEW.artistName,
              createdAt: "2025-05-02T00:00:00.000Z",
            },
            created: true,
            alreadyExists: false,
          },
          201,
        );
      }
      if (url === "/api/favorites/artists" && init?.method === "POST") {
        return jsonResponse(
          {
            artist: {
              id: "fav-a2",
              artistMbid: ARTIST_CATALOG_NEW.artistMbid,
              name: ARTIST_CATALOG_NEW.name,
              createdAt: "2025-05-02T00:00:00.000Z",
            },
            created: true,
            alreadyExists: false,
          },
          201,
        );
      }
      if (
        url === `/api/favorites/tracks/${TRACK_CATALOG_NEW.recordingMbid}` &&
        init?.method === "DELETE"
      ) {
        return jsonResponse({
          deleted: true,
          recordingMbid: TRACK_CATALOG_NEW.recordingMbid,
        });
      }
      if (
        url === `/api/favorites/artists/${ARTIST_CATALOG_NEW.artistMbid}` &&
        init?.method === "DELETE"
      ) {
        return jsonResponse({
          deleted: true,
          artistMbid: ARTIST_CATALOG_NEW.artistMbid,
        });
      }
      throw new Error(`Unexpected fetch: ${url} (${init?.method ?? "GET"})`);
    });

    await mountApp(<FavoritosPage />);
    let tree = reactTestRuntime.getTree();

    // 1) Open inline catalog panel
    const openCatalogBtn = findButtons(tree, "+ Agregar favorito")[0];
    clickButton(openCatalogBtn);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const catalogPanel = findHostNodes(
      tree,
      (n) => n.tag === "section" && n.props.id === "favorites-catalog-panel",
    )[0];
    expect(catalogPanel).toBeDefined();

    // Short query validation blocks fetch
    changeInput(findInputById(catalogPanel, "catalog-query"), "a");
    await reactTestRuntime.flush();
    tree = reactTestRuntime.getTree();
    submitForm(findHostNodes(tree, (n) => n.tag === "form")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getTextContent(findByRole(reactTestRuntime.getTree(), "alert")[0])).toContain(
      "Escribe entre 2 y 150 caracteres",
    );

    // 2) Search tracks and add Reckoner
    changeInput(findInputById(reactTestRuntime.getTree(), "catalog-query"), "Reckoner");
    await reactTestRuntime.flush();
    submitForm(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "form")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/favorites/catalog?type=tracks&limit=15&q=Reckoner",
      expect.objectContaining({ cache: "no-store" }),
    );

    tree = reactTestRuntime.getTree();
    const addButtons = findButtons(tree, "+ Agregar");
    expect(addButtons).toHaveLength(1);
    expect(findButtons(tree, "✓ En favoritos")).toHaveLength(1);

    clickButton(addButtons[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/favorites/tracks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recordingMbid: TRACK_CATALOG_NEW.recordingMbid }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain('"Reckoner" agregada a canciones favoritas.');
    expect(getTextContent(findByRole(tree, "tab").find((n) => n.props.id === "tab-tracks")!)).toBe(
      "Canciones (2)",
    );

    // 3) Remove the newly added track
    clickButton(findButtons(tree, "Quitar Reckoner de favoritos")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/favorites/tracks/${TRACK_CATALOG_NEW.recordingMbid}`,
      { method: "DELETE" },
    );
    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Canción eliminada de tus favoritos.");
    expect(getTextContent(findByRole(tree, "tab").find((n) => n.props.id === "tab-tracks")!)).toBe(
      "Canciones (1)",
    );

    // 4) Switch catalog search to Artistas, search Portishead, add, and remove
    const catalogArtistsBtn = findButtons(
      findHostNodes(tree, (n) => n.tag === "section" && n.props.id === "favorites-catalog-panel")[0],
      "Artistas",
    )[0];
    clickButton(catalogArtistsBtn);
    await reactTestRuntime.flush();

    changeInput(findInputById(reactTestRuntime.getTree(), "catalog-query"), "Portishead");
    await reactTestRuntime.flush();
    submitForm(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "form")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/favorites/catalog?type=artists&limit=15&q=Portishead",
      expect.objectContaining({ cache: "no-store" }),
    );

    tree = reactTestRuntime.getTree();
    clickButton(findButtons(tree, "+ Agregar")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/favorites/artists",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ artistMbid: ARTIST_CATALOG_NEW.artistMbid }),
      }),
    );

    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain('"Portishead" agregado a artistas favoritos.');
    expect(getTextContent(findByRole(tree, "tab").find((n) => n.props.id === "tab-artists")!)).toBe(
      "Artistas (2)",
    );

    // Switch to Artistas tab and click Quitar Portishead de favoritos
    clickButton(findByRole(tree, "tab").find((n) => n.props.id === "tab-artists")!);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    clickButton(findButtons(tree, "Quitar Portishead de favoritos")[0]);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/favorites/artists/${ARTIST_CATALOG_NEW.artistMbid}`,
      { method: "DELETE" },
    );
    tree = reactTestRuntime.getTree();
    expect(getTextContent(tree)).toContain("Artista eliminado de tus favoritos.");
    expect(getTextContent(findByRole(tree, "tab").find((n) => n.props.id === "tab-artists")!)).toBe(
      "Artistas (1)",
    );
  });
});
