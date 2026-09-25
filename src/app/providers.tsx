'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';

import { CommandPalette } from '@/components/ui/CommandPalette';
import { fetchStrategiesFromDb } from '@/lib/strategy/api';
import { useStrategyStore } from '@/store/strategy';

/**
 * Global hydrator: on app startup, syncs strategies from the database so
 * any client device (desktop, tablet, mobile) on any route has the full
 * strategy library immediately available.
 */
function StrategyGlobalHydrator() {
  useEffect(() => {
    fetchStrategiesFromDb().then((remote) => {
      if (remote && remote.length > 0) {
        const store = useStrategyStore.getState();
        store.setStrategies(remote);
        if (!store.activeStrategyId) {
          const first =
            remote.find((s) => !s.isTemplate && s.isActive) ??
            remote.find((s) => !s.isTemplate) ??
            remote[0];
          if (first) store.setActiveStrategy(first.id);
        }
      }
    });
  }, []);

  return null;
}

/**
 * TanStack Query provider and global UI portals.
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

  return (
    <QueryClientProvider client={queryClient}>
      <StrategyGlobalHydrator />
      {children}
      <CommandPalette />
    </QueryClientProvider>
  );
}
