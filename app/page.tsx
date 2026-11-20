import Image from "next/image";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Suspense } from "react";
import styles from "./page.module.css";
import HomeHeader from "./home-header";
import HeadphonesVideo from "./headphones-video";
import IntroOverlay from "./intro-overlay";
import HomeMotion from "./home-motion";
import { Anton } from "next/font/google";

// Solo el título y el contador del intro usan Anton.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

export default function Home() {
  return (
    <div className={`${styles.page} ${anton.variable}`}>
      <IntroOverlay />
      <HomeMotion />
      <a className={styles.skip} href="#contenido">Saltar al contenido</a>
      <HomeHeader />

      <main id="contenido">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span aria-hidden="true">[</span> UN MAPA PARA TUS GUSTOS <span aria-hidden="true">]</span></p>
            <h1 id="hero-title">Conecta tus gustos. <br /><span>Descubre otra canción.</span></h1>
            <p className={styles.intro}>La música lleva a más música. Explora nuevas conexiones entre artistas y canciones con datos de MusicBrainz.</p>
            <div className={styles.actions}>
              <Suspense
                fallback={
                  <Link href="/sign-up" className={`${styles.button} ${styles.primary} ${styles.tip}`} data-tip="Guarda favoritos y playlists, y recibe recomendaciones a tu medida.">
                    Crear cuenta <span aria-hidden="true">↗</span>
                  </Link>
                }
              >
                <Show when="signed-out">
                  <Link href="/sign-up" className={`${styles.button} ${styles.primary} ${styles.tip}`} data-tip="Guarda favoritos y playlists, y recibe recomendaciones a tu medida.">
                    Crear cuenta <span aria-hidden="true">↗</span>
                  </Link>
                </Show>
                <Show when="signed-in">
                  <Link href="/perfil" className={`${styles.button} ${styles.primary} ${styles.tip}`} data-tip="Tus preferencias, favoritos y playlists en un solo lugar.">
                    Ir a mi perfil <span aria-hidden="true">↗</span>
                  </Link>
                </Show>
              </Suspense>
              <Link href="/explorar" className={`${styles.button} ${styles.secondary} ${styles.tip}`} data-tip="Busca una canción y descubre otras parecidas en un mapa de conexiones.">Empezar a explorar <span aria-hidden="true">→</span></Link>
            </div>
          </div>
          <HeadphonesVideo />
        </section>

        <section className={styles.journey} id="recorrido" aria-labelledby="journey-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>[ EL RECORRIDO ]</p><h2 id="journey-title">De una canción <br />a lo que sigue.</h2></div>
            <p>Tres pasos para explorar tu música desde un mapa de conexiones.</p>
          </div>
          <ol className={styles.steps}>
            <li><span>01 / EMPIEZA</span><h3>Parte de una canción</h3><p>Elige una canción que ya conoces. En Explorar puedes buscar por título o artista.</p><a href="#cancion">Ver el punto de partida <span aria-hidden="true">↗</span></a></li>
            <li><span>02 / EXPLORA</span><h3>Descubre conexiones</h3><p>Recorre un grafo interactivo que enlaza artistas y canciones por etiquetas y similitud.</p><a href="#conexiones">Ver cómo funciona <span aria-hidden="true">↗</span></a></li>
            <li><span>03 / REÚNE</span><h3>Guarda lo que te gusta</h3><p>Administra favoritos, arma playlists y ajusta las preferencias de tu motor musical.</p><a href="#coleccion">Ver tu colección <span aria-hidden="true">↗</span></a></li>
          </ol>

          <div className={styles.details}>
            <article className={styles.start} id="cancion">
              <div className={styles.detailLabel}><span>01</span> EL PUNTO DE PARTIDA</div>
              <div className={styles.startBody}>
                <div><h3>Todo comienza <br />con una canción.</h3><p>Piensa en una que no te canses de escuchar. Empieza buscando por canción o artista.</p><Link href="/explorar" className={styles.textLink}>Ir a Explorar <span aria-hidden="true">→</span></Link></div>
                <div className={styles.record}>
                  <Image src="/music/in-rainbows.jpg" width={180} height={180} alt="Portada de In Rainbows de Radiohead" />
                  <div><span>CANCIÓN DE EJEMPLO</span><strong>Reckoner</strong><p>Radiohead <br />In Rainbows</p></div>
                </div>
              </div>
            </article>

            <article className={styles.connections} id="conexiones">
              <div className={styles.detailLabel}><span>02</span> EXPLORA CONEXIONES</div>
              <div className={styles.connectionHeading}><div><h3>Hay más por descubrir.</h3><p>Una mirada a cómo se enlazan las canciones dentro del explorador interactivo de grafos.</p></div><span className={styles.badge}>VISTA ILUSTRATIVA</span></div>
              <figure className={styles.map}>
                <figcaption>MAPA DE CONEXIONES <span> / EJEMPLO</span></figcaption>
                <div className={styles.nodes}>
                  <div className={styles.node}><Image src="/music/in-rainbows.jpg" width={112} height={112} alt="" /><div><span>ARTISTA / CANCIÓN</span><strong>Radiohead</strong><p>Reckoner</p></div></div>
                  <div className={styles.connector} aria-hidden="true"><span>○</span><i /><span>◇</span><i /><span>○</span></div>
                  <div className={styles.node}><Image src="/music/discovery.jpg" width={112} height={112} alt="" /><div><span>ARTISTA / CANCIÓN</span><strong>Daft Punk</strong><p>Digital Love</p></div></div>
                </div>
                <p className={styles.mapNote}>Conexión ilustrativa. <Link href="/explorar/grafo" className={styles.mapLink}>Abre el grafo interactivo con tu propia lista →</Link></p>
              </figure>
            </article>

            <article className={styles.collection} id="coleccion">
              <div className={styles.detailLabel}><span>03</span> TU COLECCIÓN</div>
              <div className={styles.collectionBody}><div><h3>Haz espacio para <br />tus hallazgos.</h3><p>Reúne lo que descubres, organiza tus listas y afina las recomendaciones desde tu cuenta.</p><span className={styles.badge}>DISPONIBLE CON TU CUENTA</span></div>
                <ul><li><span>01</span><strong>Favoritos</strong><p>Guarda artistas y canciones del catálogo MusicBrainz.</p><b aria-hidden="true">☆</b></li><li><span>02</span><strong>Playlists</strong><p>Crea listas, añade canciones y conserva su orden.</p><b aria-hidden="true">≡</b></li><li><span>03</span><strong>Tu opinión</strong><p>Evalúa recomendaciones y ajusta tus preferencias.</p><b aria-hidden="true">＋</b></li></ul>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.ctaWrapper}>
          <div className={styles.connectionsBanner} aria-hidden="true">
            <Image
              src="/ascii/recorrido-connections-ascii.png"
              alt=""
              width={2560}
              height={443}
              className={styles.connectionsImage}
              unoptimized
            />
          </div>
          <section className={styles.cta} aria-labelledby="cta-title">
            <div>
              <p className={styles.eyebrow}>[ EL SIGUIENTE PASO ES TUYO ]</p>
              <h2 id="cta-title">Empieza por <br />una canción.</h2>
              <p>Prueba la búsqueda o crea tu cuenta para guardar tus descubrimientos en GraphU.</p>
            </div>
            <div>
              <div className={styles.actions}>
                <Suspense
                  fallback={
                    <Link href="/sign-up" className={`${styles.button} ${styles.primary} ${styles.tip}`} data-tip="Guarda favoritos y playlists, y recibe recomendaciones a tu medida.">
                      Crear cuenta <span aria-hidden="true">↗</span>
                    </Link>
                  }
                >
                  <Show when="signed-out">
                    <Link href="/sign-up" className={`${styles.button} ${styles.primary} ${styles.tip}`} data-tip="Guarda favoritos y playlists, y recibe recomendaciones a tu medida.">
                      Crear cuenta <span aria-hidden="true">↗</span>
                    </Link>
                  </Show>
                  <Show when="signed-in">
                    <Link href="/perfil" className={`${styles.button} ${styles.primary} ${styles.tip}`} data-tip="Tus preferencias, favoritos y playlists en un solo lugar.">
                      Ir a mi perfil <span aria-hidden="true">↗</span>
                    </Link>
                  </Show>
                </Suspense>
                <Link href="/explorar" className={`${styles.button} ${styles.secondary} ${styles.tip}`} data-tip="Busca una canción y descubre otras parecidas en un mapa de conexiones.">Ir a Explorar <span aria-hidden="true">→</span></Link>
              </div>
              <Suspense fallback={<p className={styles.account}>¿Ya tienes cuenta? <Link href="/sign-in">Iniciar sesión</Link></p>}>
                <Show when="signed-out">
                  <p className={styles.account}>¿Ya tienes cuenta? <Link href="/sign-in">Iniciar sesión</Link></p>
                </Show>
                <Show when="signed-in">
                  <p className={styles.account}>
                    Accesos rápidos: <Link href="/favoritos">Favoritos</Link> · <Link href="/playlists">Playlists</Link> · <Link href="/explorar/grafo">Explorar grafo</Link>
                  </p>
                </Show>
              </Suspense>
            </div>
          </section>
        </section>
      </main>
      <footer className={styles.footer}><Link href="/" className={styles.footerBrand}>GraphU<span>_</span></Link><span>Una canción lleva a otra.</span><a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">Datos musicales: MusicBrainz <span className={styles.srOnly}>(abre en otra pestaña)</span>↗</a></footer>
    </div>
  );
}
