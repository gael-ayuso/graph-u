"use client";

import { useEffect } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*/";
const SCRAMBLE_MS = 450;

// Texto que se baraja y se resuelve de izquierda a derecha, como los hover de ore.co.
export function scrambleText(node: Text, random = Math.random) {
  const original = node.textContent ?? "";
  const start = performance.now();
  let written = original;
  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      // Si React cambió el texto a mitad (p. ej. «Pausar» → «Reanudar»), se deja el nuevo.
      if (node.textContent !== written) return resolve();
      const progress = Math.min(1, (now - start) / SCRAMBLE_MS);
      const fixed = Math.floor(progress * original.length);
      written =
        progress < 1
          ? [...original].map((char, i) => (i < fixed || char.trim() === "" ? char : GLYPHS[Math.floor(random() * GLYPHS.length)])).join("")
          : original;
      node.textContent = written;
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Texto que se descifra al pasar el ratón por botones y enlaces, en todas las páginas. */
export function TextScramble() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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
    };
  }, []);

  return null;
}
