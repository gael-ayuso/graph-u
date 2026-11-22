"use client";

import { useEffect } from "react";
import styles from "./ascii-trail.module.css";

const GLYPHS = ".:-=+*#%@01";
const STEP_PX = 14;

/** Estela de caracteres ASCII que sigue al ratón en todas las páginas. */
export function AsciiTrail() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let last = { x: -1e4, y: -1e4 };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || Math.hypot(event.clientX - last.x, event.clientY - last.y) < STEP_PX) return;
      last = { x: event.clientX, y: event.clientY };
      const glyph = document.createElement("span");
      glyph.className = styles.glyph;
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      glyph.style.left = `${event.clientX}px`;
      glyph.style.top = `${event.clientY}px`;
      glyph.style.setProperty("--drift", `${(Math.random() - 0.5) * 30}px`);
      glyph.addEventListener("animationend", () => glyph.remove());
      document.body.append(glyph);
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  return null;
}
