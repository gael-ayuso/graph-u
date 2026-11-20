"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("GraphU route error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--forest)] text-[var(--cream)] font-mono">
      <header className="w-full border-b border-[var(--olive)] bg-[var(--forest)]">
        <div className="mx-auto flex min-h-[72px] max-w-[1512px] items-center justify-between px-5 md:px-8 lg:px-[52px]">
          <Link
            href="/"
            className="inline-flex items-baseline text-3xl font-bold leading-none text-[var(--cream)] no-underline hover:text-[var(--clay)]"
          >
            GraphU
            <span className="ml-1 inline-block h-[0.24em] w-[0.2em] bg-[var(--clay)]" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1512px] flex-1 items-center justify-center px-5 py-16 md:px-8 lg:px-[52px]">
        <section
          role="alert"
          aria-labelledby="error-boundary-title"
          className="w-full max-w-xl border-2 border-[var(--destructive)] bg-[#3c2523]/40 p-8 md:p-10"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--destructive)]">
            [ ERROR INESPERADO ]
          </p>
          <h1
            id="error-boundary-title"
            className="mt-3 text-2xl font-bold tracking-tight text-[var(--cream)] md:text-3xl"
          >
            Algo salió mal al cargar esta vista
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--cream)]/85">
            Ocurrió un problema inesperado mientras se mostraba la página. Puedes intentar
            recargar la vista o regresar al inicio.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="min-h-[44px] bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)] cursor-pointer"
            >
              Reintentar
            </button>
            <Link
              href="/"
              className="min-h-[44px] inline-flex items-center border border-[var(--olive)] px-5 py-2 text-sm text-[var(--cream)] transition-colors hover:border-[var(--clay)] hover:text-[var(--clay)]"
            >
              Volver al inicio
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
