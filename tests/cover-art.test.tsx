import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findHostNodes,
  getTextContent,
  jsxElement,
  reactTestRuntime,
} from "./helpers/recommendation-library-harness";

vi.mock("react", () => reactTestRuntime.reactMock);
vi.mock("react/jsx-runtime", () => reactTestRuntime.jsxRuntimeMock);
vi.mock("react/jsx-dev-runtime", () => reactTestRuntime.jsxRuntimeMock);

import { CoverArt, PlaylistCoverMosaic } from "@/components/shared/cover-art";

describe("CoverArt & PlaylistCoverMosaic", () => {
  beforeEach(() => {
    reactTestRuntime.unmount();
  });

  afterEach(() => {
    reactTestRuntime.unmount();
  });

  it("renders a lazy square <img> when src is provided and swaps to Gruvbox SVG fallback on error", async () => {
    const src = "/api/music/cover?type=recording&mbid=11111111-2222-4333-8444-555555555555";
    await reactTestRuntime.mount(
      jsxElement(CoverArt, {
        src,
        alt: "Portada de Reckoner",
        size: 48,
        label: "Radiohead",
      }),
    );

    const imgs = findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].props.src).toBe(src);
    expect(imgs[0].props.loading).toBe("lazy");
    expect(imgs[0].props.width).toBe(48);
    expect(imgs[0].props.height).toBe(48);

    // Simulate network/image failure -> swaps to fallback SVG
    (imgs[0].props.onError as () => void)();
    await reactTestRuntime.flush();

    expect(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "img")).toHaveLength(0);
    const svgs = findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].props["aria-label"]).toBe("Portada de Reckoner");
    expect(getTextContent(svgs[0])).toBe("RA");
  });

  it("renders Gruvbox SVG monogram directly when src is null with artist vs recording accent", async () => {
    await reactTestRuntime.mount(
      jsxElement(CoverArt, {
        src: null,
        alt: "Álbum representativo de Portishead",
        size: 64,
        entityType: "artist",
        label: "Portishead",
      }),
    );

    const svgs = findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "svg");
    expect(svgs).toHaveLength(1);
    const rects = findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "rect");
    expect(rects.some((r) => r.props.fill === "#fe8019")).toBe(true);
    expect(getTextContent(svgs[0])).toBe("PO");
  });

  it("renders single CoverArt when PlaylistCoverMosaic has <=1 cover and 2x2 grid when >=2 covers", async () => {
    await reactTestRuntime.mount(
      jsxElement(PlaylistCoverMosaic, {
        covers: ["/api/music/cover?type=recording&mbid=11111111-2222-4333-8444-555555555555"],
        name: "Indie Nocturno",
        size: 68,
      }),
    );

    expect(findHostNodes(reactTestRuntime.getTree(), (n) => n.props.className === "cover-mosaic")).toHaveLength(0);
    expect(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "img")).toHaveLength(1);

    await reactTestRuntime.rerender(
      jsxElement(PlaylistCoverMosaic, {
        covers: [
          "/api/music/cover?type=recording&mbid=11111111-2222-4333-8444-555555555555",
          "/api/music/cover?type=recording&mbid=22222222-2222-4333-8444-555555555555",
        ],
        name: "Indie Nocturno",
        size: 68,
      }),
    );

    const mosaics = findHostNodes(
      reactTestRuntime.getTree(),
      (n) => n.props.className === "cover-mosaic",
    );
    expect(mosaics).toHaveLength(1);
    expect(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "img")).toHaveLength(2);
    expect(findHostNodes(reactTestRuntime.getTree(), (n) => n.tag === "svg")).toHaveLength(2);
  });
});
