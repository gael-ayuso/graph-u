import "./graph-decoration.css";

export function GraphDecoration({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={compact ? "graph-mark" : "graph-decoration"}
      viewBox={compact ? "0 0 36 36" : "0 0 220 90"}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {compact ? (
        <>
          <path d="m7 10 20-3-9 20L7 10m11 17 13 4" stroke="currentColor" strokeWidth="1.5" />
          <g stroke="currentColor" strokeWidth="1.5" fill="var(--forest)">
            <circle cx="7" cy="10" r="4" />
            <circle cx="27" cy="7" r="4" />
            <circle cx="18" cy="27" r="5" fill="currentColor" />
            <circle cx="31" cy="31" r="3" />
          </g>
        </>
      ) : (
        <>
          <g stroke="var(--graph-aqua)" strokeWidth="1.5">
            <path d="m12 48 50-30 44 29 49-32 52 29M12 48l53 28 41-29 48 28 53-31M62 18l3 58m90-61-1 60M62 18l92 57M65 76l90-61" />
          </g>
          <g stroke="var(--graph-green)" strokeWidth="1.5" fill="var(--forest)">
            <circle cx="12" cy="48" r="5" />
            <circle cx="62" cy="18" r="6" />
            <circle cx="65" cy="76" r="4" />
            <circle cx="155" cy="15" r="4" />
            <circle cx="154" cy="75" r="6" />
            <circle cx="207" cy="44" r="5" />
            <circle cx="106" cy="47" r="10" />
            <circle cx="106" cy="47" r="3" fill="var(--clay)" stroke="none" />
          </g>
        </>
      )}
    </svg>
  );
}

