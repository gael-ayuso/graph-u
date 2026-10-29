import type { Metadata } from "next";
import Link from "next/link";
import { SongDemo } from "@/components/song-demo";

export const metadata: Metadata = { title: "Buscar canciones | GraphU" };

export default function DemoPage() {
  return (
    <div className="landing demo-page">
      <header className="site-header">
        <Link href="/" className="site-brand" aria-label="GraphU, inicio">GraphU<span className="brand-cursor" aria-hidden="true" /></Link>
        <Link href="/" className="demo-back">← Volver al inicio</Link>
      </header>
      <main className="demo-main">
        <h1>Busca y crea tu lista.</h1>
        <p className="demo-intro">Busca en tu MusicBrainz local y guarda las canciones que te gusten.</p>
        <SongDemo />
      </main>
      <footer className="site-footer"><span>GraphU · Demo</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos de MusicBrainz ↗</a></footer>
    </div>
  );
}
