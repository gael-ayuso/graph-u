"use client";

import { useEffect, useRef } from "react";

/**
 * Desplazamiento parallax: 0 cuando el centro del elemento coincide con el del viewport.
 * Lo que ya está en la parte de arriba de la página empieza en 0 y solo se mueve al hacer scroll.
 */
export function parallaxOffset(top: number, height: number, viewport: number, speed: number, scrollY = 0) {
  const center = Math.max(top + height / 2 + scrollY, viewport / 2);
  return (center - scrollY - viewport / 2) * speed;
}

/** Mueve los [data-parallax] (vertical) y [data-parallax-x] (horizontal) según el scroll. */
export function Parallax() {
  useEffect(() => {
    // Sin DOM (pruebas que montan las páginas en Node) no hay nada que mover.
    if (typeof document === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // ponytail: se leen al montar; un elemento que aparezca después no tendrá parallax.
    const layers = [...document.querySelectorAll<HTMLElement>("[data-parallax], [data-parallax-x]")].map((el) => ({
      el,
      y: Number(el.dataset.parallax ?? 0),
      x: Number(el.dataset.parallaxX ?? 0),
      applied: 0,
    }));
    const update = () => {
      for (const layer of layers) {
        const rect = layer.el.getBoundingClientRect();
        // Se resta el desplazamiento ya aplicado para medir la posición natural del elemento.
        const offset = parallaxOffset(rect.top - (layer.y ? layer.applied : 0), rect.height, window.innerHeight, 1, window.scrollY);
        layer.applied = offset * layer.y;
        layer.el.style.transform = `translate3d(${(offset * layer.x).toFixed(1)}px, ${layer.applied.toFixed(1)}px, 0)`;
      }
    };
    update();
    // Evento nativo: Lenis también desplaza con window.scrollTo.
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const layer of layers) layer.el.style.transform = "";
    };
  }, []);

  return null;
}

/** Vinilo en texto ASCII: borde, surcos con un brillo diagonal, etiqueta y agujero central. */
export function asciiVinyl(cols = 80, rows = 48) {
  const char = (r: number, angle: number) => {
    if (r > 1) return " ";
    if (r > 0.95) return "@";
    if (r > 0.38) {
      const groove = Math.floor(r * 30) % 3;
      if (groove === 0) return " ";
      if (Math.abs(Math.sin(angle * 2 + 0.6)) > 0.93) return "#";
      return groove === 1 ? "x" : ":";
    }
    if (r > 0.34) return "@";
    if (r > 0.1) return "=";
    if (r > 0.07) return "@";
    return " ";
  };
  // Las filas se estiran: un carácter monoespaciado mide ~0.6 de ancho por 1 de alto.
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => {
      const dx = ((x + 0.5) / cols) * 2 - 1;
      const dy = ((y + 0.5) / rows) * 2 - 1;
      return char(Math.hypot(dx, dy), Math.atan2(dy, dx));
    }).join("").trimEnd(),
  ).join("\n");
}

const VINYL = asciiVinyl();

/**
 * Onda de audio ASCII en el instante `t` (segundos): barras simétricas sobre una línea central,
 * más altas en el centro, que suben y bajan con dos ondas que se desplazan.
 */
export function asciiWave(t: number, cols = 110, rows = 15) {
  const mid = Math.floor(rows / 2);
  const heights = Array.from({ length: cols }, (_, x) => {
    if (x % 2) return -1; // hueco entre barras
    const envelope = Math.sin((Math.PI * (x + 1)) / (cols + 1));
    const pulse = 0.55 + 0.45 * Math.sin(x * 0.45 + t * 4) * Math.cos(x * 0.13 - t * 2.3);
    return Math.round(envelope * pulse * mid);
  });
  return Array.from({ length: rows }, (_, y) => {
    const d = Math.abs(y - mid);
    return heights
      .map((h) => {
        if (h >= d) return d === h && d > 0 ? "@" : "#";
        return d === 0 ? "-" : " ";
      })
      .join("")
      .trimEnd();
  }).join("\n");
}

const WAVE_FRAME_MS = 90;

// Mismo filtro que los audífonos de la portada (.headphonesImage): el blanco queda crema con bordes dorados.
const HEADPHONES_TINT = "text-white [filter:grayscale(1)_brightness(2.6)_sepia(1)_saturate(2)]";

function AsciiWave() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    // Se escribe el texto directamente para no re-renderizar React en cada cuadro.
    const timer = setInterval(() => {
      el.textContent = asciiWave((performance.now() - start) / 1000);
    }, WAVE_FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <pre
      ref={ref}
      data-parallax="0.3"
      data-parallax-x="-0.25"
      className={`absolute -left-20 top-[560px] m-0 font-mono text-[clamp(6px,0.85vw,13px)] leading-none opacity-45 ${HEADPHONES_TINT}`}
    >
      {asciiWave(0)}
    </pre>
  );
}

/** Fondo decorativo ASCII (vinilo que gira y onda de audio animada, del color de los audífonos) con parallax. El padre necesita `relative isolate`. */
export function AsciiBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none">
      <pre
        data-parallax="-0.45"
        className={`absolute -right-24 top-28 m-0 font-mono text-[clamp(5px,0.75vw,10px)] leading-none opacity-55 motion-safe:animate-[vinyl-spin_24s_linear_infinite] ${HEADPHONES_TINT}`}
      >
        {VINYL}
      </pre>
      <AsciiWave />
    </div>
  );
}
