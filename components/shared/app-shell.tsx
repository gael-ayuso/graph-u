import React, { Suspense } from "react";
import { AppNavbar } from "./app-navbar";
import { AsciiBackdrop, Parallax } from "./parallax";
import motion from "./navigation-motion.module.css";

interface AppShellProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  return (
    <div className="relative isolate min-h-screen flex flex-col overflow-x-clip bg-[var(--forest)] text-[var(--cream)] font-mono">
      <AsciiBackdrop />
      <Parallax />
      <Suspense fallback={<div aria-hidden="true" className="h-[77px] shrink-0 border-b border-[var(--olive)]" />}>
        <AppNavbar />
      </Suspense>
      <main className={`${motion.content} mx-auto w-full max-w-[1512px] flex-1 px-5 py-8 md:px-8 lg:px-[52px]`}>
        <header data-parallax="0.15" className="mb-8 flex flex-col gap-4 border-b border-[var(--olive)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--cream)] md:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 max-w-2xl text-sm text-[var(--cream)]/80 md:text-base">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
