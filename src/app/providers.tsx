'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { useStrategyStore } from '@/store/strategy';
import { syncStrategies } from '@/lib/strategy/sync';

/**
 * TanStack Query provider.
 *
 * We create the QueryClient inside the component (not at module level) so each
 * server render gets its own instance — required for Next.js App Router SSR safety.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered stale after 60s — aligns with our candles refetch interval
            staleTime: 60_000,
            // Don't retry on 4xx errors — those are config mistakes, not transient
            retry: (failureCount, error) => {
              if (error instanceof Error && error.message.includes('HTTP 4')) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  // Perform background synchronization on mount
  useEffect(() => {
    const state = useStrategyStore.getState();
    syncStrategies(state.strategies, state.setStrategies).catch((err) =>
      console.warn('[sync] Startup background sync failed:', err)
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
