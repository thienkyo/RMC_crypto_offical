/**
 * Hooks for the Strategy Version History tab.
 *
 * useStrategyVersions — fetches the lightweight version list (metadata only).
 * useStrategyVersion  — fetches one full snapshot definition on demand.
 */

import { useQuery } from '@tanstack/react-query';
import type { Strategy } from '@/types/strategy';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VersionMeta {
  version:  number;
  saved_at: string;  // ISO 8601
  name:     string;  // strategy name at that point in time
}

export interface VersionSnapshot {
  version:    number;
  savedAt:    string;
  definition: Strategy;
}

// ── useStrategyVersions ───────────────────────────────────────────────────────

export function useStrategyVersions(strategyId: string | null) {
  return useQuery<VersionMeta[]>({
    queryKey: ['strategy-versions', strategyId],
    enabled:  !!strategyId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategyId}/versions`);
      if (!res.ok) throw new Error(`Failed to fetch versions: ${res.statusText}`);
      const data = await res.json() as { versions: VersionMeta[] };
      return data.versions;
    },
  });
}

// ── useStrategyVersion ────────────────────────────────────────────────────────

export function useStrategyVersion(
  strategyId: string | null,
  version:    number | null,
) {
  return useQuery<VersionSnapshot>({
    queryKey: ['strategy-version', strategyId, version],
    enabled:  !!strategyId && version !== null,
    staleTime: Infinity, // snapshots are immutable — never re-fetch
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategyId}/versions/${version}`);
      if (!res.ok) throw new Error(`Failed to fetch version ${version}: ${res.statusText}`);
      return res.json() as Promise<VersionSnapshot>;
    },
  });
}
