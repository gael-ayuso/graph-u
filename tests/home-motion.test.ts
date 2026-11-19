import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("lenis", () => ({ default: class {} }));
vi.mock("lenis/dist/lenis.css", () => ({}));

import { scrambleText } from "@/app/home-motion";

describe("scrambleText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrambles letters but keeps spaces, then restores the original text", async () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("performance", { now: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));

    const node = { textContent: "Crear cuenta " } as Text;
    const done = scrambleText(node, () => 0);

    now = 100;
    frames.shift()!(now);
    expect(node.textContent).not.toBe("Crear cuenta ");
    expect(node.textContent).toHaveLength("Crear cuenta ".length);
    expect(node.textContent![5]).toBe(" ");

    now = 450;
    frames.shift()!(now);
    await done;
    expect(node.textContent).toBe("Crear cuenta ");
    expect(frames).toHaveLength(0);
  });
});
