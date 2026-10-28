import Link from "next/link";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-content">
        <Link href="/" className="auth-brand" aria-label="GraphU, inicio">
          GraphU
        </Link>
        {children}
      </div>
    </main>
  );
}
