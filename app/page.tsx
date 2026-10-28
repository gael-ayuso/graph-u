import { Show, SignIn, UserButton } from "@clerk/nextjs";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";

export default function Home() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="auth-loading" role="status">Cargando tu acceso…</p>}>
        <Show when="signed-out">
          <SignIn routing="hash" />
        </Show>
        <Show when="signed-in">
          <section className="auth-signed-in" aria-labelledby="welcome-title">
          <UserButton/>
            <h1 id="welcome-title">Ya estás dentro.</h1>
            <p>Tu sesión en GraphU está iniciada.</p>
            <p className="auth-account-hint">Selecciona tu perfil para gestionar tu cuenta o cerrar sesión.</p>
          </section>
        </Show>
      </Suspense>
    </AuthShell>
  );
}
