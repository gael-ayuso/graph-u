import Image from "next/image";
import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { Suspense } from "react";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#contenido">Saltar al contenido</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="GraphU, inicio">GraphU<span aria-hidden="true">_</span></Link>
        <nav className={styles.nav} aria-label="Navegación principal">
          <a href="#recorrido">El recorrido</a>
          <a href="#coleccion">Tu colección</a>
          <Link href="/demo">Demo</Link>
          <Suspense fallback={null}>
            <Show when="signed-out"><Link href="/sign-in" className={styles.signIn}>Iniciar sesión</Link></Show>
            <Show when="signed-in"><UserButton /></Show>
          </Suspense>
        </nav>
      </header>

      <main id="contenido">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span aria-hidden="true">[</span> UN MAPA PARA TUS GUSTOS <span aria-hidden="true">]</span></p>
            <h1 id="hero-title">Conecta tus gustos.<br /><span>Descubre otra canción.</span></h1>
            <p className={styles.intro}>La música lleva a más música. Imagina nuevas conexiones entre artistas y canciones con datos de MusicBrainz.</p>
            <div className={styles.actions}>
              <Link href="/sign-up" className={`${styles.button} ${styles.primary}`}>Crear cuenta <span aria-hidden="true">↗</span></Link>
              <Link href="/demo" className={`${styles.button} ${styles.secondary}`}>Probar demo de búsqueda <span aria-hidden="true">→</span></Link>
            </div>
          </div>
          <div className={styles.heroVisual} aria-hidden="true">
            <Image
              src="/illustrations/studio-headphones.svg"
              alt=""
              width={640}
              height={540}
              className={styles.headphonesImage}
              unoptimized
            />
            <p className={styles.visualCaption}>De lo que escuchas<br /><span>a lo que está por descubrir.</span></p>
          </div>
        </section>

        <section className={styles.journey} id="recorrido" aria-labelledby="journey-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>[ EL RECORRIDO ]</p><h2 id="journey-title">De una canción<br />a lo que sigue.</h2></div>
            <p>Tres pasos para imaginar otra forma de explorar tu música.</p>
          </div>
          <ol className={styles.steps}>
            <li><span>01 / EMPIEZA</span><h3>Parte de una canción</h3><p>Elige una canción que ya conoces. En la demo puedes buscar por título o artista.</p><a href="#cancion">Ver el punto de partida <span aria-hidden="true">↗</span></a></li>
            <li><span>02 / EXPLORA</span><h3>Descubre conexiones</h3><p>Imagina un mapa que conecte artistas y canciones. La exploración interactiva está prevista.</p><a href="#conexiones">Ver el ejemplo <span aria-hidden="true">↗</span></a></li>
            <li><span>03 / REÚNE</span><h3>Guarda lo que te gusta</h3><p>Favoritos, playlists y tu opinión forman parte de lo que queremos construir.</p><a href="#coleccion">Conocer la idea <span aria-hidden="true">↗</span></a></li>
          </ol>

          <div className={styles.details}>
            <article className={styles.start} id="cancion">
              <div className={styles.detailLabel}><span>01</span> EL PUNTO DE PARTIDA</div>
              <div className={styles.startBody}>
                <div><h3>Todo comienza<br />con una canción.</h3><p>Piensa en una que no te canses de escuchar. Empieza buscando por canción o artista.</p><Link href="/demo" className={styles.textLink}>Ir a la demo de búsqueda <span aria-hidden="true">→</span></Link></div>
                <div className={styles.record}>
                  <Image src="/music/in-rainbows.jpg" width={180} height={180} alt="Portada de In Rainbows de Radiohead" />
                  <div><span>CANCIÓN DE EJEMPLO</span><strong>Reckoner</strong><p>Radiohead<br />In Rainbows</p></div>
                </div>
              </div>
            </article>

            <article className={styles.connections} id="conexiones">
              <div className={styles.detailLabel}><span>02</span> EXPLORA CONEXIONES</div>
              <div className={styles.connectionHeading}><div><h3>Hay más por descubrir.</h3><p>Una mirada a cómo podría verse un recorrido entre canciones.</p></div><span className={styles.badge}>VISTA ILUSTRATIVA</span></div>
              <figure className={styles.map}>
                <figcaption>MAPA DE CONEXIONES <span> / EJEMPLO</span></figcaption>
                <div className={styles.nodes}>
                  <div className={styles.node}><Image src="/music/in-rainbows.jpg" width={112} height={112} alt="" /><div><span>ARTISTA / CANCIÓN</span><strong>Radiohead</strong><p>Reckoner</p></div></div>
                  <div className={styles.connector} aria-hidden="true"><span>○</span><i /><span>◇</span><i /><span>○</span></div>
                  <div className={styles.node}><Image src="/music/discovery.jpg" width={112} height={112} alt="" /><div><span>ARTISTA / CANCIÓN</span><strong>Daft Punk</strong><p>Digital Love</p></div></div>
                </div>
                <p className={styles.mapNote}>Conexión ilustrativa. El explorador interactivo de grafos es una capacidad prevista.</p>
              </figure>
            </article>

            <article className={styles.collection} id="coleccion">
              <div className={styles.detailLabel}><span>03</span> TU COLECCIÓN</div>
              <div className={styles.collectionBody}><div><h3>Haz espacio para<br />tus hallazgos.</h3><p>Queremos que puedas reunir lo que te gusta y volver a ello cuando quieras.</p><span className={styles.badge}>CAPACIDADES PREVISTAS</span></div>
                <ul><li><span>01</span><strong>Favoritos</strong><p>Guarda artistas y canciones.</p><b aria-hidden="true">☆</b></li><li><span>02</span><strong>Playlists</strong><p>Reúne canciones en listas.</p><b aria-hidden="true">≡</b></li><li><span>03</span><strong>Tu opinión</strong><p>Comparte qué te gusta.</p><b aria-hidden="true">＋</b></li></ul>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.ctaWrapper}>
          <div className={styles.connectionsBanner} aria-hidden="true">
            <Image
              src="/illustrations/music-connections.svg"
              alt=""
              width={1040}
              height={180}
              className={styles.connectionsImage}
              unoptimized
            />
          </div>
          <section className={styles.cta} aria-labelledby="cta-title">
            <div>
              <p className={styles.eyebrow}>[ EL SIGUIENTE PASO ES TUYO ]</p>
              <h2 id="cta-title">Empieza por<br />una canción.</h2>
              <p>Prueba la búsqueda o crea tu cuenta para ser parte de GraphU.</p>
            </div>
            <div>
              <div className={styles.actions}>
                <Link href="/sign-up" className={`${styles.button} ${styles.primary}`}>Crear cuenta <span aria-hidden="true">↗</span></Link>
                <Link href="/demo" className={`${styles.button} ${styles.secondary}`}>Probar demo <span aria-hidden="true">→</span></Link>
              </div>
              <p className={styles.account}>¿Ya tienes cuenta? <Link href="/sign-in">Iniciar sesión</Link></p>
            </div>
          </section>
        </section>
      </main>
      <footer className={styles.footer}><Link href="/" className={styles.footerBrand}>GraphU<span>_</span></Link><span>Una canción lleva a otra.</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos musicales: MusicBrainz <span className={styles.srOnly}>(abre en otra pestaña)</span>↗</a></footer>
    </div>
  );
}
