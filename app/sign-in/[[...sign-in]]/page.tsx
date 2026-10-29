import type { Metadata } from "next";
import { Show, SignIn, UserButton } from "@clerk/nextjs";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Iniciar sesión | GraphU" };

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="auth-loading" role="status">Cargando tu acceso…</p>}>
        <Show when="signed-out">
          <SignIn routing="path" path="/sign-in" />
        </Show>
        <Show when="signed-in">
          <section className="auth-signed-in" aria-labelledby="welcome-title">
            <UserButton />
            <h1 id="welcome-title">Ya estás dentro.</h1>
            <p>Tu sesión en GraphU está iniciada.</p>
            <p className="auth-account-hint">Selecciona tu perfil para gestionar tu cuenta o cerrar sesión.</p>
          </section>
        </Show>
      </Suspense>
    </AuthShell>
  );
}
