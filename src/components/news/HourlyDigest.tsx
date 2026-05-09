'use client';

/**
 * HourlyDigest — "What changed in the last hour" block.
 *
 * On-demand: the digest is generated only when the user clicks "Generate Digest".
 * This avoids spending Claude credits on symbols the user never opens.
 * Once generated, it's cached for 30 min server-side.
 */

import { useState } from 'react';
import { useNewsDigest } from '@/hooks/useNewsFeed';

interface Props {
  symbol: string;
}

export function HourlyDigest({ symbol }: Props) {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading, error } = useNewsDigest(symbol, enabled);

  return (
    <div className="border border-surface-border rounded mx-3 mb-2">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border">
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
          1h digest
        </span>
        {data?.fromCache && (
          <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded border border-surface-border bg-surface-2">
            cached
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {!enabled && (
          <button
            onClick={() => setEnabled(true)}
            className="w-full py-1.5 rounded border font-mono text-[11px]
                       bg-surface-2 border-surface-border text-text-muted
                       hover:text-text-primary hover:border-accent/40 hover:bg-accent/5
                       transition-colors"
          >
            ✦ Generate Digest
          </button>
        )}

        {enabled && isLoading && (
          <div className="flex items-center gap-2 text-[11px] text-text-muted py-1">
            <span className="inline-block w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
            Generating…
          </div>
        )}

        {enabled && error && (
          <p className="text-[11px] text-down">Failed to generate digest. Try again.</p>
        )}

        {data && (
          <>
            <p className="text-[11px] text-text-secondary leading-relaxed">{data.digest}</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-text-muted font-mono">
                {data.articleCount} articles analysed
              </span>
              <button
                onClick={() => setEnabled(false)}
                className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors"
              >
                ↺ refresh
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
