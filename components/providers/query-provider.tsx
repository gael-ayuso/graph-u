"use client";

import { useAuth } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

function SessionCacheGuard({ queryClient }: { queryClient: QueryClient }) {
  const { isLoaded, userId } = useAuth();
  const previousUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    const prev = previousUserIdRef.current;
    if (prev !== undefined && prev !== userId) {
      queryClient.clear();
    }
    previousUserIdRef.current = userId;
  }, [isLoaded, userId, queryClient]);

  return null;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionCacheGuard queryClient={queryClient} />
      {children}
    </QueryClientProvider>
  );
}
