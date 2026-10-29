export function FeatureArt({ type }: { type: "favorites" | "playlists" | "feedback" }) {
  if (type === "favorites") {
    return (
      <svg className="feature-art" viewBox="0 0 360 170" preserveAspectRatio="xMinYMin meet" fill="none" aria-hidden="true">
        <path className="art-accent" d="m44 12 11 23 26 4-19 18 4 26-22-12-23 12 5-26L7 39l26-4Z" strokeWidth="2" />
        <g className="art-line" strokeWidth="1.5"><path d="M90 92h244v65H90zM146 92v65M170 112h135M170 135h105" /><path d="M118 137s-17-11-17-21c0-10 12-13 17-5 5-8 17-5 17 5 0 10-17 21-17 21Z" /></g>
      </svg>
    );
  }
  if (type === "playlists") {
    return (
      <svg className="feature-art" viewBox="0 0 360 170" preserveAspectRatio="xMinYMin meet" fill="none" aria-hidden="true">
        <g className="art-accent" strokeWidth="2"><path d="m44 24 20 56-34 24m34-24 33-31m-33 31 40 36" /><circle cx="44" cy="24" r="11" /><circle cx="30" cy="104" r="10" /><circle cx="97" cy="49" r="11" /><circle cx="104" cy="116" r="10" /><circle cx="64" cy="80" r="13" fill="currentColor" /></g>
        <g className="art-line" strokeWidth="1.5"><path d="M151 81h184v76H151zM213 81v76M234 99h80M234 119h62M234 138h76M168 98l24 15-24 15z" /></g>
      </svg>
    );
  }
  return (
    <svg className="feature-art" viewBox="0 0 360 170" preserveAspectRatio="xMinYMin meet" fill="none" aria-hidden="true">
      <path className="art-accent" d="M15 10h42a7 7 0 0 1 7 7v28a7 7 0 0 1-7 7H34L15 67V52h-1a7 7 0 0 1-7-7V17a7 7 0 0 1 8-7Z" strokeWidth="2" />
      <g className="art-line" strokeWidth="1.5"><path d="M92 88h228v69H92zM145 88v69M164 109h130M164 136h98M108 103h19v15h-19zM108 128h19v15h-19z" /></g>
    </svg>
  );
}
