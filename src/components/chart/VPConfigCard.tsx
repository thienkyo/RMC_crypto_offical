'use client';

/**
 * Volume Profile floating config card.
 *
 * Appears below the "VP" button in the chart top bar when VP is enabled.
 * Controls: lookback, bins, value-area %, and the Lines toggle (VAH/POC/VAL).
 */

import { useRef, useEffect } from 'react';
import type { VolumeProfileConfig } from '@/store/chart';

interface Props {
  config:   VolumeProfileConfig;
  onChange: (patch: Partial<VolumeProfileConfig>) => void;
  onClose:  () => void;
}

export function VPConfigCard({ config, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  function numInput(
    label: string,
    field: keyof VolumeProfileConfig,
    min:   number,
    max:   number,
    step:  number,
    hint?: string,
  ) {
    const value = config[field] as number;
    return (
      <label className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted whitespace-nowrap">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = Math.min(max, Math.max(min, parseFloat(e.target.value) || min));
              onChange({ [field]: v } as Partial<VolumeProfileConfig>);
            }}
            className="input-xs w-20 text-right"
          />
          {hint && <span className="text-[10px] text-text-muted/60 w-6">{hint}</span>}
        </div>
      </label>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1.5 z-50 w-64
                 rounded border border-surface-border bg-surface shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#ff6b35' }} />
          <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
            Volume Profile
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-text-muted hover:text-text-primary transition-colors leading-none"
        >
          ×
        </button>
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-surface-border flex-wrap">
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#ff6b35', opacity: 0.92 }} />
          POC
        </span>
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#14b8a6', opacity: 0.70 }} />
          Value Area
        </span>
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#64748b', opacity: 0.50 }} />
          Outside
        </span>
      </div>

      {/* Lines toggle */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">Show VAH / POC / VAL lines</span>
        </div>
        <button
          type="button"
          onClick={() => onChange({ showLines: !config.showLines })}
          className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono transition-colors
                      ${config.showLines
                        ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10'
                        : 'border-surface-border text-text-muted hover:text-text-primary'}`}
        >
          {config.showLines ? 'on' : 'off'}
        </button>
      </div>

      {/* Line color preview when enabled */}
      {config.showLines && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-surface-border">
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="inline-block w-5 h-px border-t-2 border-dashed flex-shrink-0" style={{ borderColor: '#fbbf24' }} />
            VAH / VAL
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="inline-block w-5 h-px border-t-2 flex-shrink-0" style={{ borderColor: '#ff6b35' }} />
            POC
          </span>
        </div>
      )}

      {/* Params */}
      <div className="px-3 py-2.5 space-y-2.5">
        {numInput('Lookback bars', 'lookback',     20, 1000, 10, 'bars')}
        {numInput('Price bins',    'bins',          5,  200,  5, 'bins')}
        {numInput('Value area',    'valueAreaPct', 50,   95,  1, '%'  )}
      </div>

      {/* Footer hint */}
      <div className="px-3 pb-3">
        <p className="text-[10px] text-text-muted/60 leading-relaxed">
          Rolling over last <span className="text-text-muted">{config.lookback}</span> bars ·{' '}
          VA = <span className="text-text-muted">{config.valueAreaPct}%</span> of volume ·{' '}
          Right-click VP button to disable
        </p>
      </div>
    </div>
  );
}
