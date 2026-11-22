import { afterEach, describe, expect, it, vi } from "vitest";

import { scrambleText } from "@/components/shared/text-scramble";
import { asciiVinyl, asciiWave, parallaxOffset } from "@/components/shared/parallax";

describe("parallaxOffset", () => {
  it("is zero at the viewport center and grows with distance and speed", () => {
    expect(parallaxOffset(400, 200, 1000, 0.5)).toBe(0);
    expect(parallaxOffset(900, 200, 1000, 0.5)).toBe(250);
    expect(parallaxOffset(-100, 200, 1000, -0.3, 600)).toBeCloseTo(150);
  });

  it("keeps elements at the top of the page still until the user scrolls", () => {
    expect(parallaxOffset(100, 200, 1000, 0.5, 0)).toBe(0);
    expect(parallaxOffset(-200, 200, 1000, 0.5, 300)).toBe(-150);
  });
});

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

  it("stops and keeps the new text when React changes it mid-scramble", async () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("performance", { now: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));

    const node = { textContent: " Pausar" } as Text;
    const done = scrambleText(node, () => 0);
    now = 100;
    frames.shift()!(now);

    node.textContent = " Reanudar";
    now = 200;
    frames.shift()!(now);
    await done;
    expect(node.textContent).toBe(" Reanudar");
    expect(frames).toHaveLength(0);
  });
});

describe("asciiVinyl", () => {
  it("draws a round record with a rim and an empty center hole", () => {
    const rows = asciiVinyl(80, 48).split("\n");
    expect(rows).toHaveLength(48);
    expect(rows[0]).toMatch(/^ {20,}@+$/);
    expect(rows[24]).toContain("@");
    expect(rows[24][40]).toBe(" ");
  });
});

describe("asciiWave", () => {
  it("draws symmetric bars over a center line and changes over time", () => {
    const rows = asciiWave(0, 110, 15).split("\n");
    expect(rows).toHaveLength(15);
    expect(rows[7]).toMatch(/^[#-]+$/);
    expect(rows[0]).toBe(rows[14]);
    expect(asciiWave(0.5)).not.toBe(asciiWave(0));
  });
});
