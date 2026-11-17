"use client";

import React from "react";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Cargando datos..." }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border border-[var(--olive)] bg-[#32302f] p-6 font-mono text-[var(--cream)]"
    >
      <div className="flex items-center gap-3">
        <span className="inline-block h-4 w-2.5 animate-pulse bg-[var(--clay)]" aria-hidden="true" />
        <p className="text-sm md:text-base">{message}</p>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="border border-dashed border-[var(--olive)] bg-[var(--forest)] p-8 text-center font-mono">
      <p className="text-xs uppercase tracking-widest text-[var(--olive)] mb-2">
        [ SIN REGISTROS ]
      </p>
      <h3 className="text-lg font-bold text-[var(--cream)] mb-2">{title}</h3>
      <p className="mx-auto max-w-md text-sm text-[var(--cream)]/80 mb-6">
        {description}
      </p>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Error de conexión",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="border-2 border-[var(--destructive)] bg-[#3c2523] p-6 font-mono text-[var(--cream)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--destructive)]">
            ! {title}
          </p>
          <p className="mt-1 text-sm text-[var(--cream)]">{message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] border-2 border-[var(--destructive)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--cream)] transition-colors duration-150 hover:bg-[var(--destructive)] hover:text-[var(--forest)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--clay)]"
          >
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}