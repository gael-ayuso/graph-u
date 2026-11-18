import type { Metadata } from "next";
import Link from "next/link";
import { GraphExplorer } from "@/components/graph-explorer";

export const metadata: Metadata = { title: "Explorar grafo | GraphU" };

export default function ExplorePage() {
  return (
    <div className="landing demo-page">
      <header className="site-header">
        <Link href="/" className="site-brand" aria-label="GraphU, inicio">GraphU<span className="brand-cursor" aria-hidden="true" /></Link>
        <Link href="/demo" className="demo-back">← Volver a mi lista</Link>
      </header>
      <main className="demo-main">
        <h1>Explora tus recomendaciones.</h1>
        <p className="demo-intro">El resumen muestra qué canciones dieron lugar a cada recomendación. En el detalle de cada tanda puedes explorar las etiquetas, las señales de Last.fm y las colaboraciones que explican sus resultados.</p>
        <GraphExplorer />
      </main>
      <footer className="site-footer"><span>GraphU · Explorador</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos de MusicBrainz ↗</a></footer>
    </div>
  );
}
