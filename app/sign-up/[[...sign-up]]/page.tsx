import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="auth-loading" role="status">Cargando el registro…</p>}>
        <SignUp routing="path" path="/sign-up" />
      </Suspense>
    </AuthShell>
  );
}
