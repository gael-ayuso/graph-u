"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/** Desplazamiento suave (Lenis) en todas las páginas. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      autoRaf: true,
      anchors: { offset: -28 },
      // Listas y paneles con scroll propio siguen desplazándose por dentro.
      allowNestedScroll: true,
      // En el lienzo del grafo la rueda hace zoom: Lenis no debe tocarla.
      prevent: (node) => !!node.closest?.(".graph-canvas"),
    });
    return () => lenis.destroy();
  }, []);

  return null;
}
