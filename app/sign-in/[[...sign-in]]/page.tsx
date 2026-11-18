import type { Metadata } from "next";
import Link from "next/link";
import { Show, SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { GraphUUserButton } from "@/components/shared/graphu-user-button";
import { AUTH_FORM_ELEMENTS } from "@/lib/clerk-appearance";

export const metadata: Metadata = { title: "Iniciar sesión | GraphU" };

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="auth-loading" role="status">Cargando tu acceso…</p>}>
        <Show when="signed-out">
          <SignIn routing="path" path="/sign-in" appearance={{ elements: AUTH_FORM_ELEMENTS }} />
        </Show>
        <Show when="signed-in">
          <section className="auth-signed-in" aria-labelledby="welcome-title">
            <GraphUUserButton />
            <h1 id="welcome-title">Ya estás dentro.</h1>
            <p>Tu sesión en GraphU está iniciada.</p>
            <p className="auth-account-hint">Selecciona tu perfil para gestionar tu cuenta, preferencias o cerrar sesión.</p>
            <Link
              href="/perfil"
              className="min-h-[44px] inline-flex items-center bg-[var(--clay)] px-5 py-2 text-sm font-bold text-[var(--forest)] transition-colors hover:bg-[var(--cream)]"
            >
              Ir a mi perfil →
            </Link>
          </section>
        </Show>
      </Suspense>
    </AuthShell>
  );
}
