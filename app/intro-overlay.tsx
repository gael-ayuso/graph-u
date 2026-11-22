"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

// Collage de la referencia "Intro Collage": tamaño (vw), posición apilada y posición final
// dispersa como [x vw, y vh, giro deg].
export type IntroAlbumLayer = {
  id: string;
  src: string;
  artist: string;
  album: string;
  width: number;
  stack: readonly [number, number, number];
  final: readonly [number, number, number];
};

export const INTRO_ALBUM_LAYERS: readonly IntroAlbumLayer[] = [
  { id: "utopia", src: "/music/intro/utopia.jpg", artist: "Travis Scott", album: "UTOPIA", width: 22, stack: [-5, -6, -4], final: [-36, -22, -5] },
  { id: "die-lit", src: "/music/intro/die-lit.jpg", artist: "Playboi Carti", album: "Die Lit", width: 18, stack: [6, -7, 5], final: [33, -27, 4] },
  { id: "gkmc", src: "/music/intro/gkmc.jpg", artist: "Kendrick Lamar", album: "good kid, m.A.A.d city", width: 24, stack: [-3, 4, -2], final: [-30, 22, 3] },
  { id: "sos", src: "/music/intro/sos.jpg", artist: "SZA", album: "SOS", width: 17, stack: [8, 3, 6], final: [37, 19, -6] },
  { id: "dtmf", src: "/music/intro/dtmf.jpg", artist: "Bad Bunny", album: "DeBÍ TiRAR MáS FOToS", width: 20, stack: [-9, 1, -7], final: [-8, -31, 2] },
  { id: "madvillainy", src: "/music/intro/madvillainy.jpg", artist: "Madvillain", album: "Madvillainy", width: 16, stack: [2, -2, 3], final: [10, 30, -3] },
  { id: "good-am", src: "/music/intro/good-am.jpg", artist: "Mac Miller", album: "GO:OD AM", width: 19, stack: [6, 8, -4], final: [-4, 26, 6] },
  { id: "willie-colon", src: "/music/intro/willie-colon.jpg", artist: "Willie Colón", album: "Greatest Hits", width: 21, stack: [-1, 1, 2], final: [14, -20, -2] },
];

export const INTRO_STORAGE_KEY = "graphu_intro_seen_v1";

// loading: las portadas se apilan y cuenta 0-100 %; scatter: se dispersan y entra solo a la página;
// exiting: fundido hacia la página.
type IntroPhase = "loading" | "scatter" | "exiting" | "done";

type IntroOverlayProps = {
  onComplete?: () => void;
  forcePlay?: boolean;
};

export const INTRO_DURATION_MS = 4000;
const SCATTER_DELAY_MS = INTRO_DURATION_MS + 700;
const EXIT_DURATION_MS = 550;
// Lo que tarda la dispersión (1300 ms + el retraso de la última portada) antes de entrar sola.
const SCATTER_HOLD_MS = 1800;

function markSeen() {
  try {
    window.sessionStorage?.setItem(INTRO_STORAGE_KEY, "1");
  } catch {
    // Sin almacenamiento el intro solo se repetirá en la siguiente visita.
  }
}

export default function IntroOverlay({
  onComplete,
  forcePlay = false,
}: IntroOverlayProps) {
  const [phase, setPhase] = useState<IntroPhase>("loading");
  const [count, setCount] = useState(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const enter = useCallback(() => {
    markSeen();
    setPhase("exiting");
  }, []);

  useEffect(() => {
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let alreadySeen = false;
    if (!forcePlay) {
      try {
        alreadySeen = window.sessionStorage?.getItem(INTRO_STORAGE_KEY) === "1";
      } catch {
        alreadySeen = false;
      }
    }

    if (reducedMotion || alreadySeen) {
      markSeen();
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setPhase("done");
        onCompleteRef.current?.();
      });
      return () => {
        cancelled = true;
      };
    }

    let raf = 0;
    let cancelled = false;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const p = Math.min(1, (now - t0) / INTRO_DURATION_MS);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      setCount(Math.round(eased * 100));
      if (p < 1 && typeof requestAnimationFrame === "function") {
        raf = requestAnimationFrame(tick);
      }
    };
    if (typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(tick);
    } else {
      queueMicrotask(() => {
        if (!cancelled) setCount(100);
      });
    }

    return () => {
      cancelled = true;
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    };
  }, [forcePlay]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => setPhase("scatter"), SCATTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "scatter") return;
    const timer = setTimeout(enter, SCATTER_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase, enter]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const timer = setTimeout(() => {
      setPhase("done");
      onCompleteRef.current?.();
    }, EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "done" || phase === "exiting") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") enter();
    };
    window.addEventListener?.("keydown", onKey);
    return () => window.removeEventListener?.("keydown", onKey);
  }, [phase, enter]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (phase === "done" || phase === "exiting") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [phase]);

  if (phase === "done") {
    return null;
  }

  const scattered = phase === "scatter" || phase === "exiting";

  return (
    <div
      className={`${styles.introOverlay} ${phase === "exiting" ? styles.introOverlayExiting : ""}`}
      role="region"
      aria-label="Animación de introducción de GRAPH-U"
      data-testid="intro-overlay"
      data-phase={phase}
    >
      {INTRO_ALBUM_LAYERS.map((layer, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={layer.id}
          src={layer.src}
          alt={`Portada de ${layer.album} por ${layer.artist}`}
          width={320}
          height={320}
          decoding="async"
          className={`${styles.introPhoto} ${styles.introPhotoIn} ${scattered ? styles.introPhotoScatter : ""}`}
          data-layer-id={layer.id}
          style={
            {
              "--w": `${layer.width}vw`,
              "--sx": `${layer.stack[0]}vw`,
              "--sy": `${layer.stack[1]}vh`,
              "--sr": `${layer.stack[2]}deg`,
              "--fx": `${layer.final[0]}vw`,
              "--fy": `${layer.final[1]}vh`,
              "--fr": `${layer.final[2]}deg`,
              "--in-delay": `${Math.round((index / INTRO_ALBUM_LAYERS.length) * INTRO_DURATION_MS * 0.92)}ms`,
              "--out-delay": `${index * 60}ms`,
            } as React.CSSProperties
          }
        />
      ))}

      <div className={styles.introText}>
        <div className={styles.introTitleClip}>
          {/* div y no h1: la página ya tiene su h1 debajo del intro. */}
          <div className={`${styles.introTitle} ${styles.introTitleIn}`} data-testid="intro-main-title">
            GRAPH-U
          </div>
        </div>
        <div className={`${styles.introCounter} ${scattered ? styles.introFadeOut : ""}`} data-testid="intro-counter" aria-hidden="true">
          {count}
          <span>%</span>
        </div>
      </div>
    </div>
  );
}
