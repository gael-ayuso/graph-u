import type { Metadata } from "next";
import Link from "next/link";
import { AppNavbar } from "@/components/shared/app-navbar";
import { GraphExplorer } from "@/components/graph-explorer";

export const metadata: Metadata = { title: "Explorar grafo | GraphU" };

export default function ExploreGraphPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--forest)] text-[var(--cream)] font-mono">
      <AppNavbar />
      <div className="landing flex flex-1 flex-col">
        <main className="demo-main">
          <div className="mb-4">
            <Link href="/explorar" className="demo-back">← Cambiar lista / Buscar canciones</Link>
          </div>
          <h1>Explora tus recomendaciones.</h1>
          <p className="demo-intro">Navega el grafo de conexiones, revisa cada tanda y elige canciones para ampliar tu exploración.</p>
          <GraphExplorer />
        </main>
        <footer className="site-footer"><span>GraphU · Explorador</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos de MusicBrainz ↗</a></footer>
      </div>
    </div>
  );
}
