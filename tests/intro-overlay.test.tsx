import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryStorage,
  findHostNodes,
  getTextContent,
  jsxElement,
  reactTestRuntime,
} from "./helpers/recommendation-library-harness";

vi.mock("react", () => reactTestRuntime.reactMock);
vi.mock("react/jsx-runtime", () => reactTestRuntime.jsxRuntimeMock);
vi.mock("react/jsx-dev-runtime", () => reactTestRuntime.jsxRuntimeMock);

import IntroOverlay, {
  INTRO_ALBUM_LAYERS,
  INTRO_DURATION_MS,
  INTRO_STORAGE_KEY,
} from "@/app/intro-overlay";

function setupWindowEnvironment(options?: {
  reducedMotion?: boolean;
  initialStorage?: Record<string, string>;
}) {
  const { storage, store } = createMemoryStorage(options?.initialStorage);
  const reducedMotion = options?.reducedMotion ?? false;

  const mockWindow = {
    sessionStorage: storage,
    matchMedia: vi.fn((query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  };

  vi.stubGlobal("window", mockWindow);
  return { storage, store, mockWindow };
}

describe("IntroOverlay", () => {
  beforeEach(() => {
    reactTestRuntime.unmount();
  });

  afterEach(() => {
    reactTestRuntime.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("contains the 8 expected album cover layers and all static cover files exist in public/music/intro/", () => {
    expect(INTRO_ALBUM_LAYERS).toHaveLength(8);
    expect(new Set(INTRO_ALBUM_LAYERS.map((layer) => layer.src)).size).toBe(8);

    const publicDir = path.resolve(process.cwd(), "public");
    for (const layer of INTRO_ALBUM_LAYERS) {
      expect(layer.src).toMatch(/^\/music\/intro\/.+\.jpg$/);
      const filePath = path.join(publicDir, layer.src.replace(/^\//, ""));
      expect(fs.statSync(filePath).size).toBeGreaterThan(0);
    }
  });

  it("stacks the covers with the GRAPH-U title, scatters after the count, and enters the page on its own", async () => {
    vi.useFakeTimers();
    const { store } = setupWindowEnvironment();
    const onComplete = vi.fn();

    const mountPromise = reactTestRuntime.mount(
      jsxElement(IntroOverlay, { onComplete }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await mountPromise;

    const getOverlay = () =>
      findHostNodes(
        reactTestRuntime.getTree(),
        (n) => n.props["data-testid"] === "intro-overlay",
      )[0];

    expect(getOverlay().props["data-phase"]).toBe("loading");
    expect(
      findHostNodes(
        reactTestRuntime.getTree(),
        (n) => n.tag === "img" && n.props["data-layer-id"] !== undefined,
      ),
    ).toHaveLength(8);
    const title = findHostNodes(
      reactTestRuntime.getTree(),
      (n) => n.props["data-testid"] === "intro-main-title",
    )[0];
    expect(getTextContent(title)).toContain("GRAPH-U");

    // Se dispersa 700 ms después de terminar la cuenta (INTRO_DURATION_MS).
    await vi.advanceTimersByTimeAsync(INTRO_DURATION_MS + 699);
    expect(getOverlay().props["data-phase"]).toBe("loading");
    await vi.advanceTimersByTimeAsync(1);
    expect(getOverlay().props["data-phase"]).toBe("scatter");

    // Tras la dispersión entra solo, sin pulsar ningún botón.
    await vi.advanceTimersByTimeAsync(1799);
    expect(getOverlay().props["data-phase"]).toBe("scatter");
    await vi.advanceTimersByTimeAsync(1);
    expect(getOverlay().props["data-phase"]).toBe("exiting");
    expect(store.get(INTRO_STORAGE_KEY)).toBe("1");

    await vi.advanceTimersByTimeAsync(550);
    expect(getOverlay()).toBeUndefined();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("has no buttons, but Escape skips the intro, sets sessionStorage, and unmounts after the fade", async () => {
    vi.useFakeTimers();
    const { store, mockWindow } = setupWindowEnvironment();
    const keyListeners: ((event: { key: string }) => void)[] = [];
    Object.assign(mockWindow, {
      addEventListener: (_type: string, cb: (event: { key: string }) => void) => keyListeners.push(cb),
      removeEventListener: vi.fn(),
    });
    const onComplete = vi.fn();

    const mountPromise = reactTestRuntime.mount(jsxElement(IntroOverlay, { onComplete }));
    await vi.advanceTimersByTimeAsync(0);
    await mountPromise;

    expect(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "button")).toHaveLength(0);

    keyListeners.at(-1)!({ key: "Escape" });
    await vi.advanceTimersByTimeAsync(550);

    const overlays = findHostNodes(
      reactTestRuntime.getTree(),
      (n) => n.props["data-testid"] === "intro-overlay",
    );
    expect(overlays).toHaveLength(0);
    expect(store.get(INTRO_STORAGE_KEY)).toBe("1");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("skips the animation immediately when prefers-reduced-motion: reduce is active or sessionStorage already has INTRO_STORAGE_KEY", async () => {
    // Case 1: prefers-reduced-motion: reduce
    const reducedEnv = setupWindowEnvironment({ reducedMotion: true });
    const onCompleteReduced = vi.fn();

    await reactTestRuntime.mount(
      jsxElement(IntroOverlay, { onComplete: onCompleteReduced }),
    );

    expect(
      findHostNodes(
        reactTestRuntime.getTree(),
        (n) => n.props["data-testid"] === "intro-overlay",
      ),
    ).toHaveLength(0);
    expect(reducedEnv.store.get(INTRO_STORAGE_KEY)).toBe("1");
    expect(onCompleteReduced).toHaveBeenCalledTimes(1);

    reactTestRuntime.unmount();

    // Case 2: sessionStorage already has INTRO_STORAGE_KEY = "1"
    const seenEnv = setupWindowEnvironment({
      reducedMotion: false,
      initialStorage: { [INTRO_STORAGE_KEY]: "1" },
    });
    const onCompleteSeen = vi.fn();

    await reactTestRuntime.mount(
      jsxElement(IntroOverlay, { onComplete: onCompleteSeen }),
    );

    expect(
      findHostNodes(
        reactTestRuntime.getTree(),
        (n) => n.props["data-testid"] === "intro-overlay",
      ),
    ).toHaveLength(0);
    expect(seenEnv.store.get(INTRO_STORAGE_KEY)).toBe("1");
    expect(onCompleteSeen).toHaveBeenCalledTimes(1);
  });
});
