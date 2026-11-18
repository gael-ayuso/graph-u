import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

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
import { snapshot as savedSongSnapshot } from "@/lib/saved-song-list";

describe("T3 SSR hydration without window or browser storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty exploration state on server without touching window, localStorage, sessionStorage, or fetch", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof localStorage).toBe("undefined");
    expect(typeof sessionStorage).toBe("undefined");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    useAuthMock.mockReturnValue({ isLoaded: false, userId: undefined });

    let capturedState: ReturnType<typeof useRecommendationExploration>["state"] | undefined;
    function Consumer() {
      const { state } = useRecommendationExploration();
      capturedState = state;
      return (
        <div data-testid="ssr-probe">
          {`${state.id ?? "empty"}:${state.batches.length}:${state.originals.length}`}
        </div>
      );
    }

    const html = renderToString(
      <RecommendationLibraryProvider>
        <RecommendationExplorationProvider>
          <Consumer />
        </RecommendationExplorationProvider>
      </RecommendationLibraryProvider>,
    );

    expect(html).toContain("empty:0:0");
    expect(capturedState).toEqual({
      id: null,
      revision: 0,
      originals: [],
      songsById: {},
      batches: [],
      selectedIds: [],
      focusedBatchId: null,
      pending: null,
      lastAttempt: null,
    });
    expect(savedSongSnapshot()).toBe("[]");
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
