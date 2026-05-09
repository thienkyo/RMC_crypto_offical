'use client';

import { StrategyBuilder } from '@/components/strategy/StrategyBuilder';

/**
 * Strategy builder page.
 *
 * 'use client' because StrategyBuilder mounts Zustand stores and
 * interactive form components — all browser-only.
 */
export default function StrategyPage() {
  return (
    <main className="h-full w-full overflow-hidden bg-surface">
      <StrategyBuilder />
    </main>
  );
}
