import type { Metadata } from "next";
import Link from "next/link";
import { AppNavbar } from "@/components/shared/app-navbar";

export const metadata: Metadata = {
  title: "Página no encontrada | GraphU",
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--forest)] text-[var(--cream)] font-mono">
      <AppNavbar />
      <main className="mx-auto flex w-full max-w-[1512px] flex-1 items-center justify-center px-5 py-16 md:px-8 lg:px-[52px]">
        <section
          aria-labelledby="not-found-title"
          className="w-full max-w-xl border border-[var(--olive)] bg-[#32302f]/40 p-8 md:p-10"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--clay)]">
            [ ERROR 404 ]
          </p>
          <h1
            id="not-found-title"
            className="mt-3 text-2xl font-bold tracking-tight text-[var(--cream)] md:text-3xl"
          >
            Esta ruta no existe en GraphU
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--cream)]/80">
            La dirección que abriste no corresponde a ninguna vista activa o cambió de lugar.
            Puedes volver al inicio o abrir directamente el explorador musical.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/explorar"
              className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)]"
            >
              Ir al explorador
            </Link>
            <Link
              href="/"
              className="min-h-[44px] inline-flex items-center border-2 border-[var(--copper)] px-5 py-2 text-sm font-bold text-[var(--cream)] transition-colors hover:border-[var(--clay)] hover:bg-[var(--clay)] hover:text-[var(--forest)]"
            >
              Volver al inicio
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
