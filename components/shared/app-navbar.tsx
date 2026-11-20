"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useState } from "react";
import { GraphUUserButton } from "./graphu-user-button";
import motion from "./navigation-motion.module.css";

const NAV_LINKS = [
  { href: "/explorar", label: "Explorar" },
  { href: "/favoritos", label: "Favoritos" },
  { href: "/playlists", label: "Playlists" },
  { href: "/perfil", label: "Perfil" },
];

export function AppNavbar() {
  const pathname = usePathname();
  const { isSignedIn } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--olive)] bg-[var(--forest)] font-mono text-[var(--cream)]">
      <div className="mx-auto flex max-w-[1512px] items-center justify-between px-5 py-4 md:px-8 lg:px-[52px]">
        {/* Marca GraphU estilo terminal */}
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 text-xl font-bold tracking-tight text-[var(--cream)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--clay)]"
        >
          <span>GraphU</span>
          <span
            className="inline-block h-5 w-2.5 bg-[var(--clay)] transition-transform duration-150 group-hover:scale-y-110"
            aria-hidden="true"
          />
        </Link>

        {/* Navegación Desktop */}
        <nav aria-label="Navegación principal" className="hidden md:flex md:items-center md:gap-6">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`${motion.link} px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--clay)] ${
                  isActive
                    ? "font-bold text-[var(--clay)]"
                    : "text-[var(--cream)] hover:text-[var(--clay)]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Controles de cuenta y menú móvil */}
        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <div className="flex min-h-[44px] items-center border border-[var(--copper)] bg-[#32302f] p-1">
              <GraphUUserButton />
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-4 py-2 text-sm font-bold text-[var(--cream)] transition-colors duration-150 hover:bg-[var(--clay)] hover:border-[var(--clay)] hover:text-[var(--forest)]"
            >
              Iniciar sesión
            </Link>
          )}

          {/* Botón menú móvil */}
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            className="min-h-[44px] border border-[var(--olive)] px-3 py-2 text-xs font-bold uppercase text-[var(--cream)] hover:border-[var(--clay)] hover:text-[var(--clay)] md:hidden"
          >
            {mobileOpen ? "[ X ]" : "[ MENU ]"}
          </button>
        </div>
      </div>

      {/* Panel desplegable móvil */}
      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Navegación móvil"
          className="border-t border-[var(--olive)] bg-[#1d2021] px-5 py-4 md:hidden"
        >
          <ul className="flex flex-col divide-y divide-[var(--olive)]/40">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={`block py-3 text-sm ${
                      isActive ? "font-bold text-[var(--clay)]" : "text-[var(--cream)]"
                    }`}
                  >
                    {isActive ? `> ${link.label}` : link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
