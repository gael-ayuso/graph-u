import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { Suspense } from "react";
import { MusicPreview } from "@/components/music-preview";
import { FeatureArt } from "@/components/feature-art";

const features = [
  { id: "favorites", title: "Favoritos", description: "Guarda artistas y canciones.", type: "favorites" },
  { id: "playlists", title: "Playlists", description: "Reúne tus recomendaciones.", type: "playlists" },
  { id: "feedback", title: "Tu opinión", description: "Comparte qué te gusta.", type: "feedback" },
] as const;

export default function Home() {
  return (
    <div className="landing">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className="site-header">
        <Link href="/" className="site-brand" aria-label="GraphU, inicio">GraphU<span className="brand-cursor" aria-hidden="true" /></Link>
        <nav className="site-nav" aria-label="Navegación principal">
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#tu-coleccion">Tu colección</a>
          <Link href="/demo">Demo</Link>
          <Suspense fallback={<span className="nav-auth-placeholder" aria-hidden="true" />}>
            <Show when="signed-out"><Link href="/sign-in" className="nav-sign-in">Iniciar sesión</Link></Show>
            <Show when="signed-in"><Link href="/sign-in" className="nav-sign-in">Tu cuenta</Link><UserButton /></Show>
          </Suspense>
        </nav>
      </header>
      <main id="contenido">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="hero-wordmark" aria-hidden="true">GraphU<span className="brand-cursor" /></div>
            <h1 id="hero-title">Conecta tus gustos.<br /><span>Descubre</span> otra canción.</h1>
            <p>Explora recomendaciones y conexiones entre artistas y canciones con datos de MusicBrainz.</p>
            <div className="hero-actions">
              <Link href="/sign-up" className="terminal-button terminal-button-primary">Crear cuenta</Link>
              <Link href="/demo" className="terminal-button terminal-button-outline">Probar demo</Link>
            </div>
          </div>
          <MusicPreview />
        </section>
        <section className="discovery-section" id="como-funciona" aria-labelledby="discovery-title">
          <h2 id="discovery-title">Tu música, con nuevas conexiones.</h2>
          <p className="section-description">Guarda lo que te gusta, descubre relaciones entre artistas y canciones,<br className="desktop-break" /> y crea playlists con nuevas recomendaciones.</p>
          <div className="features" id="tu-coleccion">
            {features.map((feature) => (
              <article className="feature" key={feature.id}>
                <div className="feature-copy"><h3>{feature.title}</h3><p>{feature.description}</p></div>
                <FeatureArt type={feature.type} />
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-footer"><Link href="/">GraphU</Link><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos musicales: MusicBrainz<span className="sr-only"> (abre en otra pestaña)</span></a></footer>
    </div>
  );
}
