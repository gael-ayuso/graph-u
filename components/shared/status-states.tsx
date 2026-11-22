"use client";

import React from "react";
import { LoadingSkeleton, type SkeletonVariant } from "./loading-skeleton";

interface LoadingStateProps {
  message?: string;
  variant?: SkeletonVariant;
  rows?: number;
}

export function LoadingState({ message = "Cargando datos...", variant = "songs", rows = 4 }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="font-mono text-[var(--cream)]"
    >
      <p className="mb-4 text-sm">{message}</p>
      <div aria-busy="true"><LoadingSkeleton variant={variant} rows={rows} /></div>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
  eyebrow?: string;
}

export function EmptyState({
  title,
  description,
  action,
  eyebrow = "[ SIN REGISTROS ]",
}: EmptyStateProps) {
  return (
    <div className="border border-dashed border-[var(--olive)] bg-[var(--forest)]/60 p-8 text-center font-mono backdrop-blur-md">
      <p className="text-xs uppercase tracking-widest text-[var(--olive)] mb-2">
        {eyebrow}
      </p>
      <h2 className="text-lg font-bold text-[var(--cream)] mb-2">{title}</h2>
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
