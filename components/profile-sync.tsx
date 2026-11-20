"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

// Clerk owns the session; /api/me ensures its profile exists in PostgreSQL.
export function ProfileSync() {
  const { isLoaded, userId, sessionId } = useAuth();

  useEffect(() => {
    if (!isLoaded || !userId) return;

    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function sync(attempt = 0) {
      let status: number | null = null;
      try {
        const response = await fetch("/api/me", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok || response.status === 401) return;
        status = response.status;
      } catch {
        if (controller.signal.aborted) return;
      }

      if (controller.signal.aborted) return;
      if (attempt < 2) {
        retry = setTimeout(() => void sync(attempt + 1), 1000 * (attempt + 1));
      } else {
        console.warn(
          status
            ? `Unable to synchronize the signed-in profile (HTTP ${status}). Reload to retry.`
            : "Unable to synchronize the signed-in profile. Reload to retry.",
        );
      }
    }

    void sync();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [isLoaded, userId, sessionId]);

  return null;
}
