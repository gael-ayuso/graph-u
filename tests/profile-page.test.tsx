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
  useClerkMock,
  signOutMock,
  usePathnameMock,
  routerReplaceMock,
  useQueryMock,
  queryClientMock,
} = vi.hoisted(() => ({
  useUserMock: vi.fn(),
  useClerkMock: vi.fn(),
  signOutMock: vi.fn(),
  usePathnameMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  useQueryMock: vi.fn(),
  queryClientMock: {
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
    clear: vi.fn(),
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
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  usePathname: usePathnameMock,
}));

vi.mock("@clerk/nextjs", async () => {
  const { jsxElement: createJsx } = await import(
    "./helpers/recommendation-library-harness"
  );
  return {
    useUser: useUserMock,
    useClerk: useClerkMock,
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
      onMutate?: () => void;
      onSuccess?: (data: TData) => unknown;
    }) => {
      const [state, setState] = runtime.reactMock.useState<{
        isPending: boolean;
        isError: boolean;
        error: unknown;
      }>({ isPending: false, isError: false, error: null });

      const mutate = (variables: TVariables) => {
        options.onMutate?.();
        setState({ isPending: true, isError: false, error: null });
        void Promise.resolve()
          .then(() => options.mutationFn(variables))
          .then(async (data) => {
            await options.onSuccess?.(data);
            setState({ isPending: false, isError: false, error: null });
          })
          .catch((error: unknown) => {
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

import PerfilPage from "@/app/perfil/page";
import { AppNavbar } from "@/components/shared/app-navbar";

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

describe("app/perfil/page.tsx", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    usePathnameMock.mockReturnValue("/perfil");
    useClerkMock.mockReturnValue({ signOut: signOutMock });
    signOutMock.mockResolvedValue(undefined);
    useUserMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: "clerk_user_1",
        fullName: "Nombre Clerk",
        username: "usuario_clerk",
        primaryEmailAddress: { emailAddress: "ana@example.com" },
      },
    });
    useQueryMock.mockReturnValue({
      data: {
        id: "db-user-1",
        username: "ana_music",
        name: "Ana López",
        email: "ana@example.com",
        preferences: {
          discoveryMode: "balanced",
          allowExplicit: true,
          defaultLimit: 10,
          preferredTags: ["rock"],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows LoadingState while Clerk is loading or the profile query is loading", async () => {
    useUserMock.mockReturnValue({ isLoaded: false, isSignedIn: false, user: null });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    await mountApp(<PerfilPage />);
    let tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain(
      "Cargando configuración de cuenta...",
    );
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(0);

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

    await mountApp(<PerfilPage />);
    tree = reactTestRuntime.getTree();
    expect(getTextContent(findByRole(tree, "status")[0])).toContain(
      "Cargando configuración de cuenta...",
    );
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(0);
  });

  it("shows EmptyState with /sign-in link and hides forms and delete button when unauthenticated", async () => {
    useUserMock.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    await mountApp(<PerfilPage />);
    const tree = reactTestRuntime.getTree();
    const text = getTextContent(tree);

    expect(text).toContain("Inicia sesión para ver tu perfil");
    expect(text).not.toContain("Información del perfil");
    expect(text).not.toContain("Preferencias de recomendación");
    expect(text).not.toContain("Eliminar mi cuenta");
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(0);
    expect(findButtons(tree, "Eliminar mi cuenta")).toHaveLength(0);

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

  it("shows ErrorState with retry action and hides forms when useQuery fails", async () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("No se pudo obtener la información de tu perfil."),
      refetch,
    });

    await mountApp(<PerfilPage />);
    const tree = reactTestRuntime.getTree();
    const alert = findByRole(tree, "alert")[0];

    expect(getTextContent(alert)).toContain("Error al cargar perfil");
    expect(getTextContent(alert)).toContain(
      "No se pudo obtener la información de tu perfil.",
    );
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(0);
    expect(findButtons(tree, "Eliminar mi cuenta")).toHaveLength(0);

    clickButton(findButtons(tree, "Reintentar")[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("submits profile form with only username when name is untouched, and sends empty name without username when clearing name", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        id: "db-user-1",
        username: "ana_nueva",
        name: "Ana López",
        email: "ana@example.com",
        preferences: {
          discoveryMode: "balanced",
          allowExplicit: true,
          defaultLimit: 10,
          preferredTags: ["rock"],
        },
      }),
    );

    await mountApp(<PerfilPage />);
    let tree = reactTestRuntime.getTree();

    const getProfileForm = (root: HostNode) =>
      findHostNodes(
        root,
        (n) =>
          n.tag === "form" &&
          n.props["aria-labelledby"] === "profile-section-heading",
      )[0];

    // 1) Edit ONLY username (nameDraft === null) -> PATCH body omits "name"
    changeInput(findInputById(tree, "username"), "ana_nueva");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    submitForm(getProfileForm(tree));
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ username: "ana_nueva" }),
      }),
    );
    const firstPayload = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect("name" in firstPayload).toBe(false);
    expect(getTextContent(reactTestRuntime.getTree())).toContain(
      "Perfil actualizado correctamente.",
    );

    // 2) Edit ONLY name to "" (usernameDraft === null after onSuccess reset) -> PATCH body sends { name: "" } without username
    tree = reactTestRuntime.getTree();
    changeInput(findInputById(tree, "name"), "");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    submitForm(getProfileForm(tree));
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "" }),
      }),
    );
    const secondPayload = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect("username" in secondPayload).toBe(false);
    expect(getTextContent(reactTestRuntime.getTree())).toContain(
      "Perfil actualizado correctamente.",
    );
  });

  it("renders both forms, preserves empty strings when data.name/username are null, and manages tags without duplicates", async () => {
    useQueryMock.mockReturnValue({
      data: {
        id: "db-user-1",
        username: null,
        name: null,
        email: "ana@example.com",
        preferences: {
          discoveryMode: "balanced",
          allowExplicit: true,
          defaultLimit: 10,
          preferredTags: ["rock"],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/preferences") {
        return jsonResponse({
          preferences: {
            discoveryMode: "balanced",
            allowExplicit: true,
            defaultLimit: 10,
            preferredTags: ["synthpop"],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await mountApp(<PerfilPage />);
    let tree = reactTestRuntime.getTree();
    const text = getTextContent(tree);

    expect(text).toContain("Información del perfil");
    expect(text).toContain("Preferencias de recomendación");
    expect(findHostNodes(tree, (n) => n.tag === "form")).toHaveLength(2);

    const emailInput = findInputById(tree, "email");
    const nameInput = findInputById(tree, "name");
    const usernameInput = findInputById(tree, "username");
    expect(emailInput.props.disabled).toBe(true);
    expect(emailInput.props.value).toBe("ana@example.com");
    expect(nameInput.props.value).toBe("");
    expect(usernameInput.props.value).toBe("");

    // Add a new tag and verify normalization + input reset
    changeInput(findInputById(tree, "tagInput"), "  SynthPop  ");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const addTagButton = findButtons(tree, "Agregar")[0];
    (
      addTagButton.props.onClick as (event: { preventDefault: () => void }) => void
    )({ preventDefault: () => {} });
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findInputById(tree, "tagInput").props.value).toBe("");
    expect(getTextContent(tree)).toContain("#rock");
    expect(getTextContent(tree)).toContain("#synthpop");

    // Attempt to add duplicate tag in uppercase -> ignored
    changeInput(findInputById(tree, "tagInput"), "ROCK");
    await reactTestRuntime.flush();
    tree = reactTestRuntime.getTree();
    (
      findButtons(tree, "Agregar")[0].props.onClick as (event: {
        preventDefault: () => void;
      }) => void
    )({ preventDefault: () => {} });
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, /^Quitar etiqueta /)).toHaveLength(2);

    // Remove "rock" tag
    clickButton(findButtons(tree, "Quitar etiqueta rock")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, "Quitar etiqueta rock")).toHaveLength(0);
    expect(findButtons(tree, "Quitar etiqueta synthpop")).toHaveLength(1);

    // Submit preferences form
    const prefsForm = findHostNodes(
      tree,
      (n) =>
        n.tag === "form" &&
        n.props["aria-labelledby"] === "preferences-section-heading",
    )[0];
    submitForm(prefsForm);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          discoveryMode: "balanced",
          allowExplicit: true,
          defaultLimit: 10,
          preferredTags: ["synthpop"],
        }),
      }),
    );
    expect(getTextContent(reactTestRuntime.getTree())).toContain(
      "Preferencias de recomendación guardadas.",
    );
  });

  it("executes account deletion calling removeQueries, clear, and signOut, falling back to router.replace('/') if signOut rejects", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ deleted: true }));

    await mountApp(<PerfilPage />);
    let tree = reactTestRuntime.getTree();

    clickButton(findButtons(tree, "Eliminar mi cuenta")[0]);
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    expect(findButtons(tree, "Confirmar eliminación")[0].props.disabled).toBe(true);

    changeInput(findInputById(tree, "confirmDelete"), "ELIMINAR");
    await reactTestRuntime.flush();

    tree = reactTestRuntime.getTree();
    const confirmBtn = findButtons(tree, "Confirmar eliminación")[0];
    expect(confirmBtn.props.disabled).toBe(false);

    // 1) Successful signOut
    clickButton(confirmBtn);
    await reactTestRuntime.flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/profile", { method: "DELETE" });
    expect(queryClientMock.removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-profile"],
    });
    expect(queryClientMock.clear).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: "/" });
    expect(routerReplaceMock).not.toHaveBeenCalled();

    // 2) Fallback to router.replace("/") when signOut rejects
    signOutMock.mockRejectedValueOnce(new Error("Clerk signOut failed"));
    tree = reactTestRuntime.getTree();
    clickButton(findButtons(tree, "Confirmar eliminación")[0]);
    await reactTestRuntime.flush();

    expect(queryClientMock.clear).toHaveBeenCalledTimes(2);
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });
});

describe("components/shared/app-navbar.tsx", () => {
  beforeEach(() => {
    usePathnameMock.mockReturnValue("/perfil");
    useUserMock.mockReturnValue({ isSignedIn: true });
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.clearAllMocks();
  });

  it("renders expected navigation links without /recomendaciones and marks aria-current='page' on the active route", async () => {
    await mountApp(<AppNavbar />);
    const tree = reactTestRuntime.getTree();

    const desktopNav = findHostNodes(
      tree,
      (n) =>
        n.tag === "nav" && n.props["aria-label"] === "Navegación principal",
    )[0];
    const navLinks = findHostNodes(desktopNav, (n) => n.tag === "a");
    const hrefs = navLinks.map((link) => link.props.href);

    expect(hrefs).toEqual([
      "/explorar",
      "/demo",
      "/favoritos",
      "/playlists",
      "/perfil",
    ]);
    expect(hrefs).not.toContain("/recomendaciones");
    expect(getTextContent(desktopNav)).not.toContain("Recomendaciones");

    for (const link of navLinks) {
      if (link.props.href === "/perfil") {
        expect(link.props["aria-current"]).toBe("page");
      } else {
        expect(link.props["aria-current"]).toBeUndefined();
      }
    }

    expect(
      findHostNodes(
        tree,
        (n) => n.props["data-testid"] === "clerk-user-button",
      ),
    ).toHaveLength(1);
  });

  it("shows sign-in link when signed out and supports sub-route active matching", async () => {
    usePathnameMock.mockReturnValue("/perfil/seguridad");
    useUserMock.mockReturnValue({ isSignedIn: false });

    await mountApp(<AppNavbar />);
    const tree = reactTestRuntime.getTree();

    const profileLink = findHostNodes(
      tree,
      (n) => n.tag === "a" && n.props.href === "/perfil",
    )[0];
    expect(profileLink.props["aria-current"]).toBe("page");

    const signInLink = findHostNodes(
      tree,
      (n) => n.tag === "a" && n.props.href === "/sign-in",
    );
    expect(signInLink).toHaveLength(1);
    expect(getTextContent(signInLink[0])).toContain("Iniciar sesión");

    // Open mobile menu and verify links inside mobile nav
    const menuBtn = findButtons(tree, "[ MENU ]")[0];
    expect(menuBtn.props["aria-expanded"]).toBe(false);
    clickButton(menuBtn);
    await reactTestRuntime.flush();

    const updatedTree = reactTestRuntime.getTree();
    const mobileNav = findHostNodes(
      updatedTree,
      (n) => n.tag === "nav" && n.props.id === "mobile-nav",
    )[0];
    expect(mobileNav).toBeDefined();
    const mobileHrefs = findHostNodes(mobileNav, (n) => n.tag === "a").map(
      (link) => link.props.href,
    );
    expect(mobileHrefs).toEqual([
      "/explorar",
      "/demo",
      "/favoritos",
      "/playlists",
      "/perfil",
    ]);
  });
});
