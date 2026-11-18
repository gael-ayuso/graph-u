import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { AUTH_FORM_ELEMENTS } from "@/lib/clerk-appearance";

export default function SignUpPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="auth-loading" role="status">Cargando el registro…</p>}>
        <SignUp routing="path" path="/sign-up" appearance={{ elements: AUTH_FORM_ELEMENTS }} />
      </Suspense>
    </AuthShell>
  );
}
