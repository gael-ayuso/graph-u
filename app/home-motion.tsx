"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*/";
const SCRAMBLE_MS = 450;

// Texto que se baraja y se resuelve de izquierda a derecha, como los hover de ore.co.
export function scrambleText(node: Text, random = Math.random) {
  const original = node.textContent ?? "";
  const start = performance.now();
  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / SCRAMBLE_MS);
      const fixed = Math.floor(progress * original.length);
      node.textContent =
        progress < 1
          ? [...original].map((char, i) => (i < fixed || char.trim() === "" ? char : GLYPHS[Math.floor(random() * GLYPHS.length)])).join("")
          : original;
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Scroll suave (Lenis) y texto que se descifra al pasar por botones y enlaces de la portada. */
export default function HomeMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // ponytail: solo en la portada; en /explorar el grafo usa la rueda para hacer zoom.
    const lenis = new Lenis({ autoRaf: true, anchors: { offset: -28 } });

    const running = new WeakSet<Text>();
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = (event.target as Element).closest?.("a, button");
      if (!target || target.contains(event.relatedTarget as Node) || target.closest('[data-testid="intro-overlay"]')) return;
      const node = [...target.childNodes].find((child): child is Text => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim());
      if (!node || running.has(node)) return;
      running.add(node);
      void scrambleText(node).then(() => running.delete(node));
    };
    document.addEventListener("pointerover", onOver);

    return () => {
      document.removeEventListener("pointerover", onOver);
      lenis.destroy();
    };
  }, []);

  return null;
}
