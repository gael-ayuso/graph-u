import type { Metadata } from "next";
import Link from "next/link";
import { AppNavbar } from "@/components/shared/app-navbar";
import { SongDemo } from "@/components/song-demo";
import motion from "@/components/shared/navigation-motion.module.css";

export const metadata: Metadata = { title: "Explorar | GraphU" };

export default function ExplorePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--forest)] text-[var(--cream)] font-mono">
      <AppNavbar />
      <div className="landing flex flex-1 flex-col">
        <main className={`demo-main ${motion.content}`}>
          <div className="mb-4">
            <Link href="/" className="demo-back">← Volver al inicio</Link>
          </div>
          <h1>Busca y crea tu lista.</h1>
          <p className="demo-intro">Busca en MusicBrainz, arma tu lista de canciones iniciales y genera tu grafo de recomendaciones.</p>
          <SongDemo />
        </main>
        <footer className="site-footer"><span>GraphU · Explorar</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos de MusicBrainz ↗</a></footer>
      </div>
    </div>
  );
}
