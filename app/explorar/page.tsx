import type { Metadata } from "next";
import Link from "next/link";
import { AppNavbar } from "@/components/shared/app-navbar";
import { GraphExplorer } from "@/components/graph-explorer";

export const metadata: Metadata = { title: "Explorar grafo | GraphU" };

export default function ExplorePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--forest)] text-[var(--cream)] font-mono">
      <AppNavbar />
      <div className="landing flex flex-1 flex-col">
        <main className="demo-main">
          <div className="mb-4">
            <Link href="/demo" className="demo-back">← Volver a mi lista</Link>
          </div>
          <h1>Explora tus recomendaciones.</h1>
          <p className="demo-intro">El resumen muestra qué canciones dieron lugar a cada recomendación. En el detalle de cada tanda puedes explorar las etiquetas, las señales de Last.fm y las colaboraciones que explican sus resultados.</p>
          <GraphExplorer />
        </main>
        <footer className="site-footer"><span>GraphU · Explorador</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos de MusicBrainz ↗</a></footer>
      </div>
    </div>
  );
}
