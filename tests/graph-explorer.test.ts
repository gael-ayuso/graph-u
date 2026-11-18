import { describe, expect, it, vi } from "vitest";
import { guardVisNetwork } from "@/components/graph-explorer";

describe("guardVisNetwork", () => {
  it("forwards redraw and setOptions while renderer is active", () => {
    const renderer = { redraw: vi.fn(), setOptions: vi.fn() };
    const network = {
      renderer,
      redraw(this: { renderer?: typeof renderer }) {
        return this.renderer!.redraw();
      },
      setOptions(this: { renderer?: typeof renderer }, options: unknown) {
        return this.renderer!.setOptions(options);
      },
    };

    guardVisNetwork(network);
    network.redraw();
    network.setOptions({ autoResize: true });

    expect(renderer.redraw).toHaveBeenCalledTimes(1);
    expect(renderer.setOptions).toHaveBeenCalledWith({ autoResize: true });
  });

  it("skips redraw and setOptions after destroy deletes renderer", () => {
    const renderer = { redraw: vi.fn(), setOptions: vi.fn() };
    const network: {
      renderer?: typeof renderer;
      redraw: () => unknown;
      setOptions: (options: unknown) => unknown;
    } = {
      renderer,
      redraw() {
        return this.renderer!.redraw();
      },
      setOptions(options: unknown) {
        return this.renderer!.setOptions(options);
      },
    };

    guardVisNetwork(network);
    guardVisNetwork(network);

    delete network.renderer;

    expect(() => network.redraw()).not.toThrow();
    expect(() => network.setOptions({ physics: false })).not.toThrow();
    expect(renderer.redraw).not.toHaveBeenCalled();
    expect(renderer.setOptions).not.toHaveBeenCalled();
  });
});
