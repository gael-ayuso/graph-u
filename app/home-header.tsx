"use client";

import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Suspense, useState } from "react";
import { GraphUUserButton } from "@/components/shared/graphu-user-button";
import styles from "./page.module.css";

export default function HomeHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.headerBar}>
        <Link href="/" className={styles.brand} aria-label="GraphU, inicio">
          GraphU<span aria-hidden="true">_</span>
        </Link>
        <div className={styles.mobileControls}>
          <Suspense fallback={null}>
            <Show when="signed-in">
              <div className={styles.userControl}>
                <GraphUUserButton />
              </div>
            </Show>
          </Suspense>
          <button
            type="button"
            className={styles.menuToggle}
            aria-expanded={menuOpen}
            aria-controls="home-main-nav"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? "[ CERRAR ]" : "[ MENU ]"}
          </button>
        </div>
      </div>

      <nav
        id="home-main-nav"
        className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`}
        aria-label="Navegación principal"
      >
        <a href="#recorrido" onClick={() => setMenuOpen(false)}>El recorrido</a>
        <a href="#coleccion" onClick={() => setMenuOpen(false)}>Tu colección</a>
        <Link href="/explorar" onClick={() => setMenuOpen(false)}>Explorar</Link>
        <Suspense fallback={null}>
          <Show when="signed-out">
            <Link href="/sign-in" className={styles.signIn} onClick={() => setMenuOpen(false)}>
              Iniciar sesión
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/favoritos" onClick={() => setMenuOpen(false)}>Favoritos</Link>
            <Link href="/playlists" onClick={() => setMenuOpen(false)}>Playlists</Link>
            <Link href="/perfil" className={styles.profileLink} onClick={() => setMenuOpen(false)}>
              Mi perfil
            </Link>
            <div className={`${styles.userControl} ${styles.desktopOnlyUser}`}>
              <GraphUUserButton />
            </div>
          </Show>
        </Suspense>
      </nav>
    </header>
  );
}
